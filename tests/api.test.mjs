import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvents, request, runJobs, resolveBackendBase, cancelWorkspaceRequests } from '../api.js';

test('account change aborts old requests and discards late responses', async () => {
  const original = globalThis.fetch;
  let finish, oldSignal;
  globalThis.fetch = async (_url, options) => {
    oldSignal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  };
  try {
    const pending = request('https://backend.example', '/domains');
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    cancelWorkspaceRequests();
    assert.equal(oldSignal.aborted, true);
    finish(new Response('[{"key":"old-private-base"}]'));
    await rejected;
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.signal.aborted, false);
      return new Response('[]');
    };
    assert.deepEqual(await (await request('https://backend.example', '/domains')).json(), []);
  } finally { globalThis.fetch = original; cancelWorkspaceRequests(); }
});

test('account change stops remaining page jobs', async () => {
  const original = globalThis.fetch;
  let current = true, calls = 0;
  globalThis.fetch = async () => {
    calls++;
    current = false;
    return new Response('{"status":"pending","message":"old account page"}');
  };
  try {
    const events = [];
    await runJobs('https://backend.example', 'customer_support', [{ file_hash: 'private', status: 'pending' }], event => events.push(event), () => current);
    assert.equal(calls, 1);
    assert.deepEqual(events, []);
  } finally { globalThis.fetch = original; }
});

test('local backend matches the frontend host so session cookies remain same-site', () => {
  assert.equal(resolveBackendBase('127.0.0.1', 'http://127.0.0.1:3000'), 'http://127.0.0.1:8000');
  assert.equal(resolveBackendBase('localhost', 'http://localhost:3000'), 'http://localhost:8000');
  assert.equal(resolveBackendBase('127.0.0.1', 'http://127.0.0.1:3000', '', 'http://localhost:8123'), 'http://127.0.0.1:8123');
  assert.equal(resolveBackendBase('localhost', 'http://localhost:3000', '', 'http://127.0.0.1:8123'), 'http://localhost:8123');
});

test('backend selection retains remote settings and discards stale local or invalid URLs', () => {
  assert.equal(resolveBackendBase('localhost', 'http://localhost:3000', '', 'https://backend.example'), 'https://backend.example');
  assert.equal(resolveBackendBase('frontend.example', 'https://frontend.example', 'https://backend.example', 'http://localhost:8000'), 'https://backend.example');
  assert.equal(resolveBackendBase('localhost', 'http://localhost:3000', '', 'broken-url'), 'http://localhost:8000');
  assert.equal(resolveBackendBase('localhost', 'http://localhost:3000', '', 'https://user:secret@backend.example'), 'http://localhost:8000');
});

test('requests use HttpOnly cookies and CSRF protection without password headers', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.credentials, 'include');
    assert.equal(options.headers.get('X-CSRF-Protection'), '1');
    assert.equal(options.headers.get('Authorization'), null);
    return new Response('{}');
  };
  try { await request('https://backend.example', '/domains'); }
  finally { globalThis.fetch = original; }
});

test('expired access refreshes once and retries the original request', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push(url);
    assert.equal(options.credentials, 'include');
    if (seen.length === 1) return new Response('{}', { status: 401 });
    return new Response('{}');
  };
  try {
    await request('https://backend.example', '/domains');
    assert.deepEqual(seen, ['https://backend.example/api/domains', 'https://backend.example/api/auth/refresh', 'https://backend.example/api/domains']);
  } finally { globalThis.fetch = original; }
});

test('invalid login never attempts a token refresh', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{"detail":"Wrong password"}', { status: 401 }); };
  try {
    await assert.rejects(request('https://backend.example', '/auth/login', { method: 'POST' }), /Wrong password/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('concurrent expired requests share one refresh', async () => {
  const original = globalThis.fetch;
  let refreshed = false, refreshCalls = 0;
  globalThis.fetch = async url => {
    if (url.endsWith('/auth/refresh')) {
      refreshCalls++;
      await new Promise(resolve => setTimeout(resolve, 5));
      refreshed = true;
    }
    return new Response('{}', { status: refreshed ? 200 : 401 });
  };
  try {
    await Promise.all([request('https://backend.example', '/domains'), request('https://backend.example', '/health')]);
    assert.equal(refreshCalls, 1);
  } finally { globalThis.fetch = original; }
});

test('unauthorized backend responses retain the login error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Please sign in.' }), { status: 401 });
  try { await assert.rejects(request('https://backend.example', '/domains'), /Please sign in/); }
  finally { globalThis.fetch = original; }
});

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

test('image preview on an older backend explains that restart is needed', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
  try {
    await assert.rejects(request('http://localhost:8000', '/domains/example/documents/hash/text'), /Restart the backend.*View text/);
  } finally { globalThis.fetch = original; }
});

test('image preview retains a specific missing-document error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Document not found in this knowledge base.' }), { status: 404 });
  try {
    await assert.rejects(request('http://localhost:8000', '/domains/example/documents/hash/text'), /Document not found in this knowledge base/);
  } finally { globalThis.fetch = original; }
});

test('cloud processing continues page jobs until ready and emits one completion', async () => {
  const original = globalThis.fetch;
  const events = [];
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://backend.example/api/domains/customer_support/documents/hash/step');
    assert.equal(options.method, 'POST');
    calls++;
    return new Response(JSON.stringify({ status: calls === 2 ? 'ready' : 'pending', message: `page ${calls}`, report: { name: 'guide.pdf', chunks: calls } }));
  };
  try {
    await runJobs('https://backend.example', 'customer_support', [{ file_hash: 'hash', status: 'pending' }], event => events.push(event));
    assert.equal(calls, 2);
    assert.equal(events.filter(event => event.type === 'done').length, 1);
    assert.equal(events.at(-1).report.chunks, 2);
  } finally { globalThis.fetch = original; }
});

test('cloud processing failure stops without reporting success', async () => {
  const original = globalThis.fetch;
  const events = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'Set OCR_API_KEY, then resume.' }), { status: 400 });
  try {
    await assert.rejects(runJobs('https://backend.example', 'customer_support', [{ file_hash: 'hash', status: 'pending' }], event => events.push(event)), /OCR_API_KEY/);
    assert.equal(events.length, 0);
  } finally { globalThis.fetch = original; }
});
