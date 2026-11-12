import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceGuide } from '../onboarding.js';

function element() {
  const events = new Map();
  return { disabled: false, hidden: true, textContent: '', open: false,
    addEventListener: (name, callback) => events.set(name, callback),
    fire: (name, event = {}) => events.get(name)?.(event),
    showModal() { this.open = true; }, close() { this.open = false; }
  };
}
function setup(complete = async () => {}) {
  const ui = Object.fromEntries(['dialog', 'close', 'later', 'start', 'error'].map(key => [key, element()]));
  let created = 0;
  return { ui, guide: createWorkspaceGuide({ ...ui, complete, create: () => created++ }), created: () => created };
}
const account = id => ({ id, role: 'user', onboarding_seen: false });

test('guide is offered only to an unseen account with an empty workspace', () => {
  const { guide, ui } = setup();
  assert.equal(guide.show({ ...account('admin'), role: 'admin' }, []), false);
  assert.equal(guide.show({ ...account('seen'), onboarding_seen: true }, []), false);
  assert.equal(guide.show(account('established'), [{ key: 'custom_existing' }]), false);
  assert.equal(guide.show(account('new'), []), true);
  assert.equal(ui.dialog.open, true);
  assert.equal(guide.show(account('new'), []), false);
});

test('create action persists completion before opening the knowledge-base form', async () => {
  let saved = false;
  const user = account('alice');
  const { guide, ui, created } = setup(async () => { saved = true; });
  guide.show(user, []);
  await ui.start.fire('click');
  assert.equal(saved, true);
  assert.equal(user.onboarding_seen, true);
  assert.equal(ui.dialog.open, false);
  assert.equal(created(), 1);
  assert.equal(guide.show(user, []), false);
});

test('close, explore and Escape acknowledge the guide without creating a base', async () => {
  for (const action of ['close', 'later', 'escape']) {
    let saves = 0, prevented = false;
    const { guide, ui, created } = setup(async () => saves++);
    const user = account(action);
    guide.show(user, []);
    if (action === 'escape') {
      await ui.dialog.fire('cancel', { preventDefault() { prevented = true; } });
      // The browser event handler starts the async acknowledgement.
      await Promise.resolve();
      assert.equal(prevented, true);
    } else await ui[action].fire('click');
    assert.equal(saves, 1);
    assert.equal(user.onboarding_seen, true);
    assert.equal(ui.dialog.open, false);
    assert.equal(created(), 0);
  }
});

test('failed save keeps the guide open and lets the user retry', async () => {
  let fail = true;
  const { guide, ui, created } = setup(async () => { if (fail) throw new Error('offline'); });
  const user = account('alice');
  guide.show(user, []);
  await ui.start.fire('click');
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.error.hidden, false);
  assert.equal(user.onboarding_seen, false);
  assert.equal(created(), 0);
  assert.equal(ui.start.disabled, false);
  fail = false;
  await ui.start.fire('click');
  assert.equal(ui.dialog.open, false);
  assert.equal(created(), 1);
});

test('logout or account change discards a pending guide action', async () => {
  let finish;
  const { guide, ui, created } = setup(() => new Promise(resolve => { finish = resolve; }));
  const alice = account('alice'), bob = account('bob');
  guide.show(alice, []);
  const pending = ui.start.fire('click');
  assert.equal(ui.start.disabled, true);
  await ui.start.fire('click'); // No duplicate save while pending.
  guide.reset();
  assert.equal(ui.dialog.open, false);
  guide.show(bob, []);
  finish();
  await pending;
  assert.equal(ui.dialog.open, true);
  assert.equal(created(), 0);
  assert.equal(bob.onboarding_seen, false);
  assert.equal(ui.start.disabled, false);
});
