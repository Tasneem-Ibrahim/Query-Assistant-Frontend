export async function request(base, path, options = {}) {
  let response;
  try { response = await fetch(`${base.replace(/\/$/, '')}/api${path}`, options); }
  catch { throw new Error('Cannot reach the backend. Start api_server.py on port 8000, then reconnect.'); }
  if (!response.ok) {
    if (response.status === 405 && options.method === 'DELETE') {
      throw new Error('Deletion is not available in the running backend. Restart api_server.py, refresh this page, and try again. Nothing was deleted.');
    }
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status}).`);
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
