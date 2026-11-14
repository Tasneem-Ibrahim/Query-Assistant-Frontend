import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedProcessor } from '../saved-processing.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const row = id => ({id,domain:'private',file_hash:id,filename:id+'.pdf'});

test('approved files wait for an available dashboard and then run sequentially', async () => {
  let available=false, finish; const calls=[];
  const processor=createSavedProcessor({canRun:()=>available,onStart:()=>{},onError:assert.fail,
    process:async item=>{calls.push(item.id);if(item.id==='a')await new Promise(resolve=>{finish=resolve;});},onFinish:()=>{}});
  processor.enqueue([row('a'),row('b')]);await flush();assert.deepEqual(calls,[]);
  available=true;processor.kick();await flush();assert.deepEqual(calls,['a']);
  processor.enqueue([row('a'),row('b')]);finish();await flush();await flush();
  assert.deepEqual(calls,['a','b']);
});

test('account cleanup discards old processing callbacks and queued files', async () => {
  let release;const errors=[],finished=[];
  const processor=createSavedProcessor({canRun:()=>true,onStart:()=>{},onError:e=>errors.push(e),
    process:()=>new Promise(resolve=>{release=resolve;}),onFinish:item=>finished.push(item.id)});
  processor.enqueue([row('a'),row('b')]);await flush();processor.reset();release();await flush();
  assert.deepEqual(finished,[]);assert.deepEqual(errors,[]);
});

test('a paused file waits for a later dashboard poll rather than looping', async () => {
  let calls=0;
  const processor=createSavedProcessor({canRun:()=>true,onStart:()=>{},onError:assert.fail,
    process:async()=>{calls++;return 'paused';},onFinish:()=>{}});
  processor.enqueue([row('a')]);await flush();await flush();assert.equal(calls,1);
  processor.enqueue([row('a')]);await flush();assert.equal(calls,2);
});

test('a failed request reports its error and does not block another approved file', async () => {
  const calls=[],errors=[];
  const processor=createSavedProcessor({canRun:()=>true,onStart:()=>{},onError:e=>errors.push(e.message),
    process:async item=>{calls.push(item.id);if(item.id==='a')throw new Error('Paused by network');},onFinish:()=>{}});
  processor.enqueue([row('a'),row('b')]);await flush();await flush();
  assert.deepEqual(calls,['a','b']);assert.deepEqual(errors,['Paused by network']);
});

test('new approval snapshots remove queued records which are no longer eligible', async () => {
  let available=false;const calls=[];
  const processor=createSavedProcessor({canRun:()=>available,onStart:()=>{},onError:assert.fail,
    process:async item=>calls.push(item.id),onFinish:()=>{}});
  processor.enqueue([row('a'),row('b')]);await flush();processor.enqueue([row('b')]);
  available=true;processor.kick();await flush();assert.deepEqual(calls,['b']);
});
