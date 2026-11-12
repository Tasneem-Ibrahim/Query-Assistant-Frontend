// Tokens are managed by the backend in HttpOnly cookies, never browser storage.
const refreshes = new Map();
let workspaceRequests = new AbortController();

export function cancelWorkspaceRequests() {
  workspaceRequests.abort();
  workspaceRequests = new AbortController();
  refreshes.clear();
}

export function resolveBackendBase(hostname, origin, configured = '', saved = '') {
  const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const local = loopback(hostname);
  const fallback = configured || (local ? `http://${hostname}:8000` : origin);
  let target;
  try {
    target = new URL(saved || fallback);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash
        || (!local && loopback(target.hostname))) target = new URL(fallback);
  } catch { target = new URL(fallback); }
  // Ports may differ, but loopback hosts must match for SameSite cookies.
  if (local && loopback(target.hostname)) target.hostname = hostname;
  return target.href.replace(/\/$/, '');
}

function forgetLegacySession() {
  try { sessionStorage.removeItem('query-assistant-admin-session'); } catch { /* Storage may be unavailable. */ }
}
forgetLegacySession();

export async function request(base, path, options = {}) {
  const scopeSignal = workspaceRequests.signal;
  const signal = options.signal ? AbortSignal.any([options.signal, scopeSignal]) : scopeSignal;
  base = base.replace(/\/$/, '');
  const headers = new Headers(options.headers);
  headers.set('X-CSRF-Protection', '1');
  const send = () => fetch(`${base}/api${path}`, {
    ...options, signal, headers, credentials: 'include', cache: 'no-store', redirect: 'error'
  });
  let response;
  try {
    response = await send();
    signal.throwIfAborted();
    if (response.status === 401 && !['/auth/login', '/auth/admin/login', '/auth/signup', '/auth/refresh', '/auth/logout'].includes(path)) {
      if (!refreshes.has(base)) {
        const refresh = fetch(`${base}/api/auth/refresh`, {
          method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
          signal: scopeSignal,
          headers: { 'X-CSRF-Protection': '1' }
        }).finally(() => { if (refreshes.get(base) === refresh) refreshes.delete(base); });
        refreshes.set(base, refresh);
      }
      const refreshed = await refreshes.get(base);
      signal.throwIfAborted();
      if (refreshed.ok) response = await send();
      else response = refreshed.clone();
    }
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(`Cannot reach the backend at ${base || location.origin}. Check Connection settings and the backend CORS_ORIGINS setting.`);
  }
  if (!response.ok) {
    if (response.status === 401 && !['/auth/login', '/auth/admin/login', '/auth/signup'].includes(path) && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('user-login-required'));
    }
    if (response.status === 405 && options.method === 'DELETE') {
      throw new Error('Deletion is not available in the running backend. Restart api_server.py, refresh this page, and try again. Nothing was deleted.');
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 404 && body.detail === 'Not Found' && /\/documents\/[^/]+\/text$/.test(path)) {
      throw new Error('The running backend has not loaded the extracted-text feature. Restart the backend (api_server:app), refresh this page, and click View text again. For a live website, deploy the updated backend.');
    }
    const detail = typeof body.detail === 'string' ? body.detail
      : Array.isArray(body.detail) ? body.detail.map(item => `${item.loc?.at(-1) || 'Input'}: ${item.msg}`).join('. ')
      : `Request failed (${response.status}).`;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return response;
}

export async function readEvents(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneEvent = false;
  const emit = line => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') doneEvent = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) emit(line);
      if (done) break;
    }
    emit(buffer);
    if (!doneEvent) throw new Error('Processing ended before completion. Refresh the document status and try again.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function runJobs(base, key, jobs, onEvent, isCurrent = () => true) {
  for (const job of jobs) {
    if (!isCurrent()) return;
    let result = job;
    while (result.status !== 'ready') {
      if (!isCurrent()) return;
      result = await (await request(base, `/domains/${encodeURIComponent(key)}/documents/${encodeURIComponent(job.file_hash)}/step`, { method: 'POST' })).json();
      if (!isCurrent()) return;
      if (!['pending', 'ready'].includes(result.status)) throw new Error('Unexpected document processing status. Resume saved documents to retry.');
      if (result.message) onEvent({ type: 'log', message: result.message });
    }
    onEvent({ type: 'done', report: { ...result.report, status: 'ingested' } });
  }
}
