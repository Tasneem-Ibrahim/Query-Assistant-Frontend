import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvents, request } from '../api.js';

function streamed(parts) {
  return new Response(new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } }));
}
test('ingestion parser handles network boundaries and a final line without newline', async () => {
  const events = [];
  await readEvents(streamed(['{"type":"lo', 'g","message":"OCR ready"}\n{"type":"done","report":{"chunks":8}}']), event => events.push(event));
  assert.equal(events[0].message, 'OCR ready'); assert.equal(events[1].report.chunks, 8);
});
test('ingestion parser propagates backend errors', async () => {
  await assert.rejects(readEvents(streamed(['{"type":"error","message":"OCR failed"}\n']), () => {}), /OCR failed/);
});
test('ingestion parser rejects a truncated stream', async () => {
  await assert.rejects(readEvents(streamed(['{"type":"log","message":"Extracting"}\n']), () => {}), /before completion/);
});
test('request preserves backend error details and constructs the route', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => { assert.equal(url, 'http://localhost:8000/api/health'); return new Response(JSON.stringify({ detail: 'Missing configuration' }), { status: 500 }); };
  try { await assert.rejects(request('http://localhost:8000/', '/health'), /Missing configuration/); } finally { globalThis.fetch = original; }
});

test('delete on an older backend explains that restart is needed', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Method Not Allowed' }), { status: 405 });
  try {
    await assert.rejects(request('http://localhost:8000', '/domains/custom_example', { method: 'DELETE' }), /Restart api_server.py.*Nothing was deleted/);
  } finally { globalThis.fetch = original; }
});
