import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceInput } from '../voice.js';

class FakeRecognition {
  static instances = [];
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  abort() { this.aborted = true; }
  result(...parts) {
    this.onresult({ results: parts.map(([text, final]) => Object.assign([{ transcript: text }], { isFinal: final })) });
  }
  end() { this.onend(); }
}
function setup(initial = '') {
  let text = initial;
  const voice = createVoiceInput({ Recognition: FakeRecognition, read: () => text, write: value => { text = value; }, changed: () => {} });
  return { voice, text: () => text, edit: value => { text = value; }, current: () => FakeRecognition.instances.at(-1) };
}

test('pause keeps confirmed text, waits for final results, and resume appends without duplicates', () => {
  const ctx = setup('Existing question');
  ctx.voice.start('ur-PK');
  const first = ctx.current();
  assert.equal(first.lang, 'ur-PK');
  first.result(['first phrase', true], ['unfinished', false]);
  assert.equal(ctx.text(), 'Existing question first phrase');
  assert.equal(ctx.voice.snapshot().interim, 'unfinished');
  ctx.voice.pause('Paused for PDF review.');
  assert.equal(first.stopped, true);
  assert.equal(ctx.voice.snapshot().phase, 'paused');
  assert.equal(ctx.voice.snapshot().pending, true);
  ctx.voice.start();
  assert.equal(ctx.current(), first);
  first.result(['first phrase', true], ['last phrase', true]);
  first.end();
  ctx.edit(ctx.text() + ' edited');
  ctx.voice.start('ur-PK');
  ctx.current().result(['continued', true]);
  ctx.current().result(['continued', true], ['again', true]);
  assert.equal(ctx.text(), 'Existing question first phrase last phrase edited continued again');
});

test('stop retains final results and allows a new independent dictation', () => {
  const ctx = setup(); ctx.voice.start();
  const first = ctx.current();
  ctx.voice.stop();
  assert.equal(ctx.voice.snapshot().pending, true);
  first.result(['finished question', true]); first.end();
  assert.equal(ctx.voice.snapshot().phase, 'idle');
  ctx.voice.start(); ctx.current().result(['extra', true]);
  ctx.voice.cancel();
  assert.equal(ctx.text(), 'finished question');
});

test('cancel restores draft across pauses and ignores late recognition events', () => {
  const ctx = setup('Original draft'); ctx.voice.start();
  const first = ctx.current(); first.result(['new text', true]);
  ctx.voice.pause(); first.end(); ctx.voice.start();
  const second = ctx.current(); second.result(['more text', true]);
  ctx.voice.cancel();
  assert.equal(second.aborted, true);
  assert.equal(ctx.text(), 'Original draft');
  second.result(['late result', true]); second.end();
  assert.equal(ctx.text(), 'Original draft');
  assert.equal(ctx.voice.snapshot().phase, 'idle');
});

test('domain or session cleanup discards callbacks without restoring old drafts', () => {
  const ctx = setup('old'); ctx.voice.start();
  const current = ctx.current(); current.result(['query', true]);
  ctx.voice.cancel({ restore: false }); ctx.edit('new domain');
  current.result(['late old query', true]);
  assert.equal(ctx.text(), 'new domain');
});

test('unexpected end pauses until explicit resume and permission failures retain text', () => {
  const ctx = setup(); ctx.voice.start();
  ctx.current().result(['saved text', true]); ctx.current().end();
  assert.equal(ctx.voice.snapshot().phase, 'paused');
  ctx.voice.start(); const next = ctx.current();
  next.onerror({ error: 'not-allowed' });
  assert.match(ctx.voice.snapshot().message, /denied/);
  assert.equal(ctx.voice.snapshot().phase, 'idle');
  assert.equal(ctx.text(), 'saved text');
  assert.equal(next.aborted, true);
});

test('unsupported browsers and start failures leave typing available', () => {
  const voice = createVoiceInput({ read: () => '', write: () => {}, changed: () => {} });
  voice.start(); assert.equal(voice.snapshot().supported, false);
  class FailedRecognition { start() { throw new Error('blocked'); } }
  const blocked = createVoiceInput({ Recognition: FailedRecognition, read: () => '', write: () => {}, changed: () => {} });
  blocked.start(); assert.equal(blocked.snapshot().phase, 'idle');
  assert.match(blocked.snapshot().message, /Could not start/);
});

test('dictation respects question length limit', () => {
  const ctx = setup(); ctx.voice.start();
  ctx.current().result([Array(13000).fill('a').join(''), true]);
  assert.equal(ctx.text().length, 12000);
  assert.equal(ctx.current().stopped, true);
  assert.equal(ctx.voice.snapshot().phase, 'idle');
});


test('direct send stops listening and waits for final text before completing', async () => {
  const ctx = setup('Question'); ctx.voice.start();
  const current = ctx.current(); current.result(['partial', false]);
  let completed = false;
  const finishing = ctx.voice.finish().then(ready => { completed = true; return ready; });
  assert.equal(current.stopped, true);
  await Promise.resolve(); assert.equal(completed, false);
  current.result(['final words', true]); current.end();
  assert.equal(await finishing, true);
  assert.equal(ctx.text(), 'Question final words');
});

test('direct send handles an already paused microphone and cancellation', async () => {
  const ctx = setup('draft'); ctx.voice.start(); ctx.voice.pause();
  const finishing = ctx.voice.finish();
  ctx.voice.cancel();
  assert.equal(await finishing, false);
  assert.equal(ctx.text(), 'draft');
  ctx.voice.start(); ctx.voice.pause(); ctx.current().end();
  assert.equal(await ctx.voice.finish(), true);
});

test('recognition failure cancels pending send and retains confirmed text', async () => {
  const ctx = setup('saved'); ctx.voice.start();
  const finishing = ctx.voice.finish();
  ctx.current().onerror({ error: 'network' });
  assert.equal(await finishing, false);
  assert.equal(ctx.text(), 'saved');
});
