import { createVoiceInput } from './voice.js';
import { request, readEvents, runJobs, resolveBackendBase, cancelWorkspaceRequests } from './api.js';
import { backendUrl } from './config.js';

// Supabase email links can redirect with tokens in the fragment. Sign in through
// the cookie endpoint instead, and remove those credentials from browser history.
const authReturn = new URLSearchParams(location.hash.slice(1));
if (authReturn.has('access_token') || authReturn.has('refresh_token') || authReturn.has('error_description')) {
  window.history.replaceState(null, '', location.pathname + location.search);
}

const $ = id => document.getElementById(id);
let savedBase = '';
try { savedBase = localStorage.getItem('pagewise-api') || ''; } catch { /* Storage may be unavailable. */ }
let base = resolveBackendBase(location.hostname, location.origin, backendUrl, savedBase);
const state = { domains: [], key: '', status: null, online: false, busy: false, mode: 'chat', histories: {}, results: {}, file: null, generation: 0 };
const authChanges = typeof BroadcastChannel === 'function' ? new BroadcastChannel('query-assistant-auth') : null;
const history = () => state.histories[state.key] ||= [];
function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function controls() {
  const unavailable = !state.online || state.busy;
  for (const id of ['domain', 'bundled', 'refresh', 'reset', 'new-domain', 'rename-domain', 'delete-domain']) $(id).disabled = unavailable;
  $('delete-domain').disabled = unavailable || !state.domains.find(d => d.key === state.key)?.custom;
  for (const id of ['pdf', 'bundled', 'refresh', 'reset', 'rename-domain']) $(id).disabled = unavailable || !state.key;
  document.querySelectorAll('.view-image-text, .view-pdf').forEach(button => { button.disabled = unavailable; });
  $('upload').disabled = unavailable || !state.key || !state.file;
  $('question').disabled = unavailable || !state.status?.chunks;
  if (unavailable || !state.status?.chunks) voice.pause('Paused while the workspace is unavailable. Resume when ready.');
  const voiceState = voice.snapshot();
  $('question').readOnly = voiceState.phase === 'listening' || voiceState.pending;
  $('send').disabled = unavailable || !state.status?.chunks || (!$('question').value.trim() && !voiceState.interim.trim());
  renderVoice();
  $('clear').disabled = state.busy;
  $('connection').disabled = state.busy;
  document.querySelectorAll('.delete-document').forEach(button => { button.disabled = unavailable; });
  $('chat-mode').disabled = state.busy;
  $('search-mode').disabled = state.busy;
  $('force').disabled = state.busy;
  if (state.cloud) { $('reset').disabled = true; $('force').disabled = true; $('force').checked = false; }
}
async function json(path, body) { return (await request(base, path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); }
function sourceList(sources) {
  const details = node('details', 'sources');
  details.append(node('summary', '', `${sources.length} supporting ${sources.length === 1 ? 'source' : 'sources'}`));
  for (const hit of sources) {
    const meta = hit.metadata || hit;
    const item = node('article', 'source');
    item.append(node('strong', '', `${meta.source || 'Document'} · Page ${meta.page ?? '?'}${meta.heading ? ` · ${meta.heading}` : ''}`), node('p', '', hit.text || ''));
    details.append(item);
  }
  return details;
}
function renderMessages() {
  const box = $('messages'); box.replaceChildren();
  if (!state.key) {
    const empty = node('div', 'chat-empty');
    empty.append(node('h4', '', 'Select your knowledge base'), node('p', '', 'Choose a knowledge base from the dropdown to view your documents and start asking questions.'));
    box.append(empty); return;
  }
  const messages = state.mode === 'chat' ? history() : (state.results[state.key] || []);
  if (!messages.length) {
    const empty = node('div', 'chat-empty');
    empty.append(node('div', 'empty-symbol', state.mode === 'chat' ? '✦' : '⌕'), node('h4', '', state.mode === 'chat' ? 'From Questions to Clarity, From Data to Insights' : 'Find the passage you need.'));
    const domain = state.domains.find(d => d.key === state.key);
    empty.append(node('p', '', state.mode === 'search' ? 'Find relevant excerpts in your documents.' : domain?.welcome || 'Connect your backend and add a PDF to get started.'));
    if (domain?.examples?.length) {
      const examples = node('div', 'examples');
      for (const text of domain.examples) {
        const button = node('button', 'example'); button.type = 'button'; button.append(node('div', '', text), node('span', '', '↗'));
        button.addEventListener('click', () => { $('question').value = text; controls(); if (!$('question').disabled) $('question').focus(); else notice('Process an uploaded PDF or image or use the bundled documents to get started.'); });
        examples.append(button);
      }
      empty.append(examples);
    }
    box.append(empty);
  }
  for (const message of messages) {
    const item = node('article', `message ${message.role}`);
    item.append(node('div', 'message-label', message.role === 'user' ? 'You' : state.mode === 'search' ? 'Retrieved passages' : '✦ Query Assistant'), node('div', 'message-content', message.content));
    if (message.sources?.length) item.append(sourceList(message.sources));
    box.append(item);
  }
  box.scrollTop = box.scrollHeight;
}
function renderStatus() {
  const files = Object.entries({ ...state.status?.files, ...state.status?.pending_files });
  $('file-count').textContent = files.length;
  $('chunk-count').textContent = state.status ? `${state.status.chunks} searchable passages` : state.key ? 'Status unavailable' : 'No knowledge base selected';
  $('documents').replaceChildren();
  for (const [fileHash, file] of files) {
    const item = node('div', 'document'); const info = node('div', 'document-info');
    const title = node('strong', '', file.name); title.title = file.name;
    info.append(title, node('small', '', state.status?.pending_files?.[fileHash] ? `${file.pages} pages · Processing incomplete` : `${file.pages} pages · ${file.chunks} passages`));
    const remove = node('button', 'delete-document');
    remove.type = 'button'; remove.title = `Delete ${file.name}`;
    remove.setAttribute('aria-label', `Delete ${file.name}`);
    remove.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
    remove.addEventListener('click', () => deleteDocument(fileHash, file.name));
    const isImage = /\.(jpe?g|png|jfif|webp|bmp|tiff?|avif)$/i.test(file.name);
    if (isImage && !state.status?.pending_files?.[fileHash]) {
      const view = node('button', 'view-image-text', 'View text');
      view.type = 'button'; view.setAttribute('aria-label', `View extracted text from ${file.name}`);
      view.addEventListener('click', () => showImageText(fileHash));
      info.append(view);
    }
    if (/\.pdf$/i.test(file.name)) {
      const view = node('button', 'view-pdf', 'View PDF');
      view.type = 'button'; view.setAttribute('aria-label', `View PDF ${file.name}`);
      view.addEventListener('click', () => openPdf(fileHash, file.name));
      info.append(view);
    }
    item.append(node('span', 'mini-file', isImage ? 'IMG' : 'PDF'), info, remove); $('documents').append(item);
  }
  if (!files.length) $('documents').append(node('p', 'empty-documents', state.key ? 'No documents processed yet. Upload yours or try the bundled documents.' : 'Select your knowledge base to view its documents.'));
  controls();
}
const voice = createVoiceInput({
  Recognition: window.SpeechRecognition || window.webkitSpeechRecognition,
  read: () => $('question').value,
  write: text => {
    $('question').value = text;
    $('question').style.height = 'auto';
    $('question').style.height = `${Math.min($('question').scrollHeight, 130)}px`;
  },
  changed: () => controls()
});
function renderVoice() {
  const current = voice.snapshot();
  const active = current.phase !== 'idle' || current.pending;
  const unavailable = !state.online || state.busy || !state.status?.chunks;
  $('voice-start').disabled = active || unavailable || !current.supported || !window.isSecureContext;
  $('voice-start').setAttribute('aria-pressed', String(current.phase === 'listening'));
  $('voice-start').title = active ? 'Voice input in progress. Use the controls above.' : 'Start voice query';
  $('voice-language').disabled = active || unavailable;
  $('voice-pause').hidden = current.phase !== 'listening';
  $('voice-resume').hidden = current.phase !== 'paused';
  $('voice-resume').disabled = unavailable || current.pending;
  $('voice-stop').hidden = !active;
  $('voice-stop').disabled = current.pending;
  $('voice-cancel').hidden = !active;
  $('voice-status').textContent = !current.supported ? 'Voice input is unavailable in this browser. You can type your query.'
    : !window.isSecureContext ? 'Voice input requires HTTPS or localhost.'
    : current.message || (current.phase === 'listening' ? 'Listening... Select Pause to check your PDF.' : current.phase === 'paused' ? 'Paused. Resume to continue your query.' : 'Choose English or Urdu, then speak. Review text before sending.');
  $('voice-interim').textContent = current.interim;
  $('voice-interim').hidden = !current.interim;
}
$('voice-start').addEventListener('click', () => voice.start($('voice-language').value));
$('voice-pause').addEventListener('click', () => voice.pause());
$('voice-resume').addEventListener('click', () => voice.start($('voice-language').value));
$('voice-stop').addEventListener('click', () => voice.stop());
$('voice-cancel').addEventListener('click', () => voice.cancel());
window.addEventListener('pagehide', () => voice.cancel({ restore: false }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) voice.pause('Paused while you are away. Select Resume to continue.');
});
const pdfTabs = new Map();
let activePdf = null;
function activatePdf(fileHash = null) {
  if (fileHash) voice.pause('Paused for PDF review. Return to your question tab and select Resume to continue.');
  activePdf = fileHash;
  for (const [hash, tab] of pdfTabs) {
    tab.panel.hidden = hash !== fileHash;
    tab.button.classList.toggle('active', hash === fileHash);
    tab.button.setAttribute('aria-pressed', String(hash === fileHash));
  }
  for (const mode of ['chat', 'search']) {
    const active = !fileHash && state.mode === mode;
    $(`${mode}-mode`).classList.toggle('active', active);
    $(`${mode}-mode`).setAttribute('aria-pressed', String(active));
  }
  $('pdf-panels').hidden = !fileHash;
  $('messages').hidden = Boolean(fileHash);
  document.querySelector('.composer-wrap').hidden = Boolean(fileHash);
  $('clear').hidden = Boolean(fileHash);
  renderVoice();
}
function closePdf(fileHash) {
  const tab = pdfTabs.get(fileHash);
  if (!tab) return;
  tab.controller.abort();
  tab.panel.remove(); tab.wrapper.remove();
  if (tab.url) URL.revokeObjectURL(tab.url);
  pdfTabs.delete(fileHash);
  if (activePdf === fileHash) {
    const next = [...pdfTabs.keys()].at(-1) || null;
    activatePdf(next);
    (next ? pdfTabs.get(next).button : $(`${state.mode}-mode`)).focus();
  }
}
function clearPdfTabs() {
  for (const hash of [...pdfTabs.keys()]) closePdf(hash);
  activatePdf();
}
async function openPdf(fileHash, filename) {
  if (pdfTabs.has(fileHash)) { activatePdf(fileHash); return; }
  const key = state.key;
  const wrapper = node('div', 'pdf-tab');
  const button = node('button', '', filename);
  button.type = 'button'; button.title = filename;
  button.addEventListener('click', () => activatePdf(fileHash));
  const close = node('button', 'pdf-tab-close', '\u00d7');
  close.type = 'button'; close.title = `Close ${filename}`;
  close.setAttribute('aria-label', `Close PDF ${filename}`);
  close.addEventListener('click', () => closePdf(fileHash));
  wrapper.append(button, close); document.querySelector('.chat-tabs').append(wrapper);
  const panel = node('section', 'pdf-panel');
  panel.setAttribute('aria-label', `PDF preview: ${filename}`);
  const status = node('p', 'pdf-status', 'Loading PDF...'); status.setAttribute('role', 'status');
  panel.append(status); $('pdf-panels').append(panel);
  const tab = { wrapper, button, panel, controller: new AbortController(), url: null };
  pdfTabs.set(fileHash, tab); activatePdf(fileHash);
  try {
    const response = await request(base, `/domains/${encodeURIComponent(key)}/documents/${encodeURIComponent(fileHash)}/pdf`, { signal: tab.controller.signal });
    const blob = await response.blob();
    if (pdfTabs.get(fileHash) !== tab) return;
    tab.url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const frame = node('iframe', 'pdf-frame'); frame.title = filename; frame.src = tab.url;
    const fallback = node('a', 'pdf-fallback', 'Open PDF in a new tab');
    fallback.href = tab.url; fallback.target = '_blank'; fallback.rel = 'noopener';
    panel.replaceChildren(fallback, frame);
  } catch (error) {
    if (pdfTabs.get(fileHash) === tab) {
      status.textContent = error.message;
      const retry = node('button', 'button secondary', 'Retry');
      retry.type = 'button'; retry.addEventListener('click', () => { closePdf(fileHash); openPdf(fileHash, filename); });
      panel.append(retry);
    }
  }
}
let previewRequest = 0;
function clearImageText() {
  previewRequest++; $('ocr-preview').hidden = true; $('ocr-text').textContent = ''; $('ocr-filename').textContent = '';
}
async function showImageText(fileHash) {
  const key = state.key; const generation = state.generation; const requestId = ++previewRequest;
  $('ocr-preview').hidden = false; $('ocr-filename').textContent = ''; $('ocr-text').textContent = 'Loading extracted text...';
  try {
    const result = await json(`/domains/${encodeURIComponent(key)}/documents/${encodeURIComponent(fileHash)}/text`);
    if (key !== state.key || generation !== state.generation || requestId !== previewRequest) return;
    $('ocr-filename').textContent = result.name;
    $('ocr-text').textContent = result.text || 'No readable text was found.';
  } catch (e) {
    if (key === state.key && generation === state.generation && requestId === previewRequest) $('ocr-text').textContent = e.message;
  }
}
$('close-ocr-preview').addEventListener('click', clearImageText);
async function refresh() {
  if (!state.key) { state.status = null; renderStatus(); return; }
  const key = state.key, generation = state.generation;
  state.status = null; controls();
  try { const result = await json(`/domains/${encodeURIComponent(key)}/status`); if (key === state.key && generation === state.generation) state.status = result; }
  finally { if (generation === state.generation) renderStatus(); }
}
async function deleteDocument(fileHash, filename) {
  if (state.busy || !state.online || !state.key) return;
  if (!confirm(`Delete “${filename}” from this knowledge base? Its saved PDF and searchable passages will be removed. Other documents will stay unchanged.`)) return;
  const key = state.key, generation = state.generation;
  state.busy = true; controls();
  try {
    await request(base, `/domains/${encodeURIComponent(key)}/documents/${encodeURIComponent(fileHash)}`, { method: 'DELETE' });
    if (generation !== state.generation) return;
    closePdf(fileHash);
    // Old answers may still quote the removed document.
    delete state.histories[key]; delete state.results[key]; clearImageText();
    renderMessages(); await refresh();
    if (generation !== state.generation) return;
    notice(`“${filename}” and its searchable passages have been deleted.`);
  } catch (e) { if (generation === state.generation) notice(e.message); }
  finally { if (generation === state.generation) { state.busy = false; controls(); } }
}
function renderDomainOptions() {
  const placeholder = node('option', '', 'Select your knowledge base');
  placeholder.value = '';
  $('domain').replaceChildren(placeholder, ...state.domains.map(d => {
    const option = node('option', '', d.label); option.value = d.key; return option;
  }));
  $('domain').value = '';
}
async function selectDomain() {
  const generation = state.generation;
  voice.cancel({ restore: false });
  clearPdfTabs();
  clearImageText();
  state.key = $('domain').value; state.file = null; $('pdf').value = ''; $('selected-file').textContent = ''; $('question').value = ''; $('processing').hidden = true; notice();
  const domain = state.domains.find(d => d.key === state.key);
  if (!domain) {
    state.key = ''; state.status = null;
    $('chat-title').textContent = 'Document assistant';
    $('rename-domain').hidden = true; $('delete-domain').hidden = true;
    $('assistant-description').textContent = 'Select your knowledge base to get started, or create a new one.';
    $('bundled').textContent = state.cloud ? 'Resume saved documents' : 'Use bundled documents';
    renderMessages(); renderStatus(); return;
  }
  $('chat-title').textContent = domain.label;
  $('rename-domain').hidden = !domain.custom;
  $('delete-domain').hidden = !domain.custom;
  $('bundled').textContent = state.cloud ? 'Resume saved documents' : domain.custom ? 'Process saved documents' : 'Use bundled documents';
  $('assistant-description').textContent = domain.custom ? 'Add PDFs on any topic and explore them together.' : state.key === 'legal_assistant' ? 'Understand your contracts, clauses, and obligations.' : 'Explore orders, delivery, returns, and support policies.';
  renderMessages();
  try { await refresh(); if (generation !== state.generation) return; if (Object.keys(state.status?.pending_files || {}).length) notice('Some PDFs are incomplete. Click Resume saved documents to continue.'); else if (state.status && !state.status.chunks) notice(state.cloud || domain.custom ? 'Upload your first PDF to this knowledge base. You can add more PDFs on the same topic later.' : 'Add a PDF or use the bundled documents to start exploring.'); } catch (e) { if (generation === state.generation) notice(e.message); }
}
async function connect() {
  voice.cancel({ restore: false });
  clearPdfTabs();
  clearImageText();
  const generation = ++state.generation;
  state.online = false; state.status = null; state.domains = []; state.key = ''; controls(); renderStatus(); renderMessages();
  try {
    const health = await json('/health');
    if (generation !== state.generation) return;
    if (!health.ok) throw new Error(health.configuration_errors?.join('. ') || 'Backend is not configured.');
    const domains = await json('/domains');
    if (generation !== state.generation) return;
    if (!Array.isArray(domains) || !domains.length) throw new Error('No assistants available from this backend.');
    state.cloud = health.storage === 'supabase';
    state.domains = domains; state.online = true;
    renderDomainOptions();
    await selectDomain();
    if (generation !== state.generation) return;
    if (!health.deepseek_key) notice('Backend connected. Set DEEPSEEK_API_KEY in the backend .env to generate answers. You can still process PDFs and search passages.');
  } catch (e) {
    if (generation !== state.generation) return;
    state.online = false; $('domain').replaceChildren(node('option', '', 'Backend unavailable')); notice(e.message);
  } finally { if (generation === state.generation) controls(); }
}
function chooseFile(file) {
  if (!file || state.busy || !state.key) return;
  if (! /\.(pdf|jpe?g|png|jfif|webp|bmp|tiff?|avif)$/i.test(file.name)) { notice('Please choose a PDF, JPG, JPEG, PNG, JFIF, WebP, BMP, TIF, TIFF or AVIF file.'); return; }
  if (!file.size) { notice('This file is empty. Choose a different file.'); return; }
  if (file.size > 4000000) { notice('Choose a PDF or image smaller than 4 MB.'); return; }
  clearImageText();
  state.file = file; $('selected-file').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`; notice(); controls();
}
async function ingest(bundled) {
  if (state.busy || !state.online || !state.key) return;
  const key = state.key, generation = state.generation;
  const imageName = !bundled && /\.(jpe?g|png|jfif|webp|bmp|tiff?|avif)$/i.test(state.file?.name || '') ? state.file.name.replace(/[^A-Za-z0-9._-]+/g, '_') : null;
  clearImageText();
  state.busy = true; controls(); notice(); $('processing').hidden = false; $('logs').textContent = 'Starting document processing…\n';
  const data = new FormData(); if (!bundled) data.append('file', state.file);
  data.append('force', $('force').checked); data.append('use_llm', $('use-llm').checked);
  try {
    const response = await request(base, `/domains/${encodeURIComponent(key)}/ingest`, { method: 'POST', body: data });
    if (generation !== state.generation) return;
    const onEvent = event => {
      if (generation !== state.generation) return;
      const log = event.type === 'done' ? `${event.report.name || event.report.file || 'Document'}: ${event.report.status}. ${event.report.chunks ?? 0} passages ready.` : event.message;
      if (log) { $('logs').append(document.createTextNode(log + '\n')); $('logs').scrollTop = $('logs').scrollHeight; }
    };
    if (response.headers.get('content-type')?.includes('application/json')) {
      const { jobs } = await response.json();
      if (generation !== state.generation) return;
      await runJobs(base, key, jobs, onEvent, () => generation === state.generation);
    } else await readEvents(response, onEvent);
    if (generation !== state.generation) return;
    state.file = null; $('pdf').value = ''; $('selected-file').textContent = ''; notice('Your knowledge is ready. Ask a question or search the passages.');
  } catch (e) { if (generation === state.generation) notice(e.message); }
  finally {
    if (generation !== state.generation) return;
    try {
      await refresh();
      if (generation !== state.generation) return;
      const image = imageName && Object.entries(state.status?.files || {}).find(([, file]) => file.name === imageName);
      if (image) await showImageText(image[0]);
    } catch (e) { if (generation === state.generation) notice(e.message); }
    if (generation === state.generation) { state.busy = false; controls(); }
  }
}
async function submit(event) {
  event.preventDefault();
  if (state.busy || !state.status?.chunks || !state.online) return;
  const topK = Number($('top-k').value);
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) { notice('Choose between 1 and 20 retrieved passages in processing settings.'); return; }
  const key = state.key, generation = state.generation;
  if (voice.snapshot().phase !== 'idle' || voice.snapshot().pending) {
    // Request final recognition results before reading or clearing the question.
    const finished = voice.finish();
    state.busy = true; controls();
    const ready = await finished;
    state.busy = false; controls();
    if (!ready || key !== state.key || generation !== state.generation || !state.online) return;
  }
  const question = $('question').value.trim();
  if (!question) return;
  voice.cancel({ restore: false });
  const prior = history().map(({ role, content }) => ({ role, content }));
  const messages = state.mode === 'chat' ? history() : (state.results[state.key] ||= []);
  messages.push({ role: 'user', content: question }); $('question').value = ''; $('question').style.height = ''; state.busy = true; controls(); notice(); renderMessages();
  const thinking = node('div', 'thinking message', state.mode === 'chat' ? '✦ Finding answers in your documents…' : '⌕ Searching relevant passages…'); $('messages').append(thinking); $('messages').scrollTop = $('messages').scrollHeight;
  try {
    const result = await json(`/domains/${encodeURIComponent(state.key)}/${state.mode === 'chat' ? 'ask' : 'search'}`, state.mode === 'chat' ? { question, history: prior, top_k: topK } : { query: question, top_k: topK });
    if (generation !== state.generation) return;
    messages.push({ role: 'assistant', content: state.mode === 'chat' ? result.answer : result.hits.length ? `Found ${result.hits.length} relevant passages. Open the sources below to explore.` : 'No matching passages found.', sources: state.mode === 'chat' ? result.sources : result.hits });
  } catch (e) { if (generation === state.generation) { messages.pop(); $('question').value = question; notice(e.message); } }
  finally { if (generation === state.generation) { state.busy = false; renderMessages(); controls(); $('question').focus(); } }
}
$('domain').addEventListener('change', selectDomain);
$('pdf').addEventListener('change', event => chooseFile(event.target.files[0]));
for (const type of ['dragenter', 'dragover']) $('dropzone').addEventListener(type, event => { event.preventDefault(); if (!state.busy) $('dropzone').classList.add('dragover'); });
for (const type of ['dragleave', 'drop']) $('dropzone').addEventListener(type, event => { event.preventDefault(); $('dropzone').classList.remove('dragover'); });
$('dropzone').addEventListener('drop', event => { if (state.online && !state.busy) chooseFile(event.dataTransfer.files[0]); });
$('upload').addEventListener('click', () => ingest(false)); $('bundled').addEventListener('click', () => ingest(true));
$('question-form').addEventListener('submit', submit);
$('question').addEventListener('input', () => { $('question').style.height = 'auto'; $('question').style.height = `${Math.min($('question').scrollHeight, 130)}px`; controls(); });
$('question').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('question-form').requestSubmit(); } });
for (const mode of ['chat', 'search']) $(`${mode}-mode`).addEventListener('click', () => { state.mode = mode; activatePdf(); for (const name of ['chat', 'search']) { $(`${name}-mode`).classList.toggle('active', name === mode); $(`${name}-mode`).setAttribute('aria-pressed', String(name === mode)); } $('question').placeholder = mode === 'chat' ? 'What would you like to know?' : 'Search for a clause, topic, or passage…'; notice(); renderMessages(); });
$('clear').addEventListener('click', () => { if (state.mode === 'chat') state.histories[state.key] = []; else state.results[state.key] = []; renderMessages(); notice(); });
$('refresh').addEventListener('click', async () => {
  const generation = state.generation;
  state.busy = true; controls();
  try { await refresh(); if (generation === state.generation) notice(); }
  catch (e) { if (generation === state.generation) notice(e.message); }
  finally { if (generation === state.generation) { state.busy = false; controls(); } }
});
$('reset').addEventListener('click', async () => {
  const generation = state.generation, key = state.key;
  if (!confirm('Reset this assistant’s knowledge base? This removes its searchable passages and processing registry. The PDF files are kept.')) return;
  state.busy = true; controls();
  try { await json(`/domains/${encodeURIComponent(key)}/reset`, {}); if (generation !== state.generation) return; state.histories[key] = []; state.results[key] = []; clearPdfTabs(); renderMessages(); await refresh(); if (generation === state.generation) notice('Knowledge base reset. Process documents again to start a new conversation.'); } catch (e) { if (generation === state.generation) notice(e.message); } finally { if (generation === state.generation) { state.busy = false; controls(); } }
});
$('delete-domain').addEventListener('click', async () => {
  const generation = state.generation;
  const domain = state.domains.find(d => d.key === state.key);
  if (state.busy || !domain?.custom) return;
  if (!confirm(`Delete “${domain.label}” permanently? Its saved PDFs, vectors, and conversation will be removed. Other knowledge bases will stay unchanged.`)) return;
  state.busy = true; controls();
  try {
    await request(base, `/domains/${encodeURIComponent(domain.key)}`, { method: 'DELETE' });
    if (generation !== state.generation) return;
    delete state.histories[domain.key]; delete state.results[domain.key];
    state.domains = state.domains.filter(d => d.key !== domain.key);
    renderDomainOptions();
    await selectDomain();
    if (generation !== state.generation) return;
    notice(`“${domain.label}” and its saved PDFs and vectors have been deleted.`);
  } catch (e) { if (generation === state.generation) notice(e.message); }
  finally { if (generation === state.generation) { state.busy = false; controls(); } }
});
$('connection').addEventListener('click', () => { $('api-url').value = base; $('settings').showModal(); });
$('close-settings').addEventListener('click', () => $('settings').close());
$('settings-form').addEventListener('submit', event => {
  event.preventDefault(); const url = new URL($('api-url').value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) { $('api-url').setCustomValidity('Use an HTTP or HTTPS server URL without credentials, query, or fragment.'); $('api-url').reportValidity(); return; }
  base = resolveBackendBase(location.hostname, location.origin, backendUrl, url.href.replace(/\/$/, '').replace(/\/api$/, '')); try { localStorage.setItem('pagewise-api', base); } catch {} $('settings').close(); resumeSession();
});
$('api-url').addEventListener('input', () => $('api-url').setCustomValidity(''));
let editingDomain = null;
function openDomainDialog(rename) {
  editingDomain = rename ? state.key : null;
  $('domain-name').value = rename ? state.domains.find(d => d.key === state.key).label : state.file?.name.replace(/\.(pdf|jpe?g|png|jfif|webp|bmp|tiff?|avif)$/i, '') || '';
  $('domain-dialog-title').textContent = rename ? 'Rename knowledge base' : 'New knowledge base';
  $('save-domain').textContent = rename ? 'Save name ↗' : 'Create knowledge base ↗';
  $('domain-help').textContent = rename ? 'Update the name. Your documents and conversations stay saved.' : 'Name your topic, then add related PDFs. It stays saved in the dropdown.';
  $('domain-error').hidden = true; $('domain-dialog').showModal();
}
$('new-domain').addEventListener('click', () => openDomainDialog(false));
$('rename-domain').addEventListener('click', () => openDomainDialog(true));
$('close-domain').addEventListener('click', () => $('domain-dialog').close());
$('domain-form').addEventListener('submit', async event => {
  event.preventDefault();
  const generation = state.generation;
  const name = $('domain-name').value.trim();
  if (!name) { $('domain-name').setCustomValidity('Please enter a knowledge base name.'); $('domain-name').reportValidity(); return; }
  const rename = Boolean(editingDomain);
  const retainedFile = state.file;
  state.busy = true; controls(); $('save-domain').disabled = true; $('close-domain').disabled = true; $('domain-error').hidden = true;
  try {
    const domain = await (await request(base, rename ? `/domains/${encodeURIComponent(editingDomain)}` : '/domains', { method: rename ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json();
    if (generation !== state.generation) return;
    if (rename) state.domains = state.domains.map(d => d.key === domain.key ? domain : d); else state.domains.push(domain);
    renderDomainOptions();
    $('domain').value = domain.key;
    await selectDomain();
    if (generation !== state.generation) return;
    if (retainedFile) chooseFileAfterCreate(retainedFile);
    $('domain-dialog').close();
    notice(rename ? 'Knowledge base renamed. Your saved PDFs are unchanged.' : `“${domain.label}” is saved in your dropdown. Choose a PDF and click Upload & process.`);
  } catch (e) { if (generation === state.generation) { $('domain-error').textContent = e.message; $('domain-error').hidden = false; } }
  finally { if (generation === state.generation) { state.busy = false; controls(); } $('save-domain').disabled = false; $('close-domain').disabled = false; }
});
function chooseFileAfterCreate(file) { state.file = file; $('selected-file').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`; }
$('domain-name').addEventListener('input', () => $('domain-name').setCustomValidity(''));
function setPasswordVisible(visible) {
  $('admin-password').type = visible ? 'text' : 'password';
  const button = $('toggle-password');
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  button.title = visible ? 'Hide password' : 'Show password';
  button.querySelector('.eye-slash').toggleAttribute('hidden', !visible);
}
$('toggle-password').addEventListener('click', () => {
  setPasswordVisible($('admin-password').type === 'password');
});
function showLogin() {
  cancelWorkspaceRequests();
  voice.cancel({ restore: false });
  clearPdfTabs();
  ++state.generation;
  state.file = null; $('pdf').value = ''; $('selected-file').textContent = '';
  clearImageText();
  state.online = false; state.status = null; state.domains = []; state.key = '';
  state.busy = false; $('question').value = ''; $('logs').textContent = ''; $('processing').hidden = true;
  $('domain').replaceChildren(node('option', '', 'Select your knowledge base'));
  for (const id of ['domain-dialog', 'settings']) if ($(id).open) $(id).close();
  $('domain-name').value = ''; $('account-name').textContent = ''; notice();
  $('chat-title').textContent = 'Document assistant';
  $('assistant-description').textContent = 'Select your knowledge base to get started, or create a new one.';
  $('rename-domain').hidden = true; $('delete-domain').hidden = true;
  $('domain-error').textContent = ''; $('domain-error').hidden = true;
  state.histories = {}; state.results = {};
  $('admin-app').hidden = true; $('admin-app').inert = true;
  $('login-gate').hidden = false;
  $('admin-password').value = '';
  $('confirm-password').value = '';
  setPasswordVisible(false);
  controls(); renderMessages(); renderStatus();
}
window.addEventListener('user-login-required', showLogin);
$('admin-logout').addEventListener('click', async () => {
  $('admin-logout').disabled = true;
  try {
    await request(base, '/auth/logout', { method: 'POST' });
    showLogin();
    authChanges?.postMessage('session-changed');
  } catch (error) { notice(error.message); }
  finally { $('admin-logout').disabled = false; }
});
document.addEventListener('click', event => {
  const menu = $('admin-menu');
  if (!menu.contains(event.target)) menu.open = false;
});
document.addEventListener('keydown', event => {
  const menu = $('admin-menu');
  if (event.key === 'Escape' && menu.open) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});
$('login-connection').addEventListener('click', () => { $('api-url').value = base; $('settings').showModal(); });
let signupMode = false;
let adminMode = false;
function authMode(signup, admin = false) {
  signupMode = signup;
  adminMode = admin;
  $('user-email').type = admin ? 'text' : 'email';
  $('user-email').maxLength = admin ? 80 : 254;
  $('user-email').value = '';
  $('login-identity-label').textContent = admin ? 'ADMIN USERNAME' : 'EMAIL';
  $('admin-auth-switch').textContent = admin ? 'User sign in' : 'Admin sign in';
  $('auth-switch').hidden = admin;

  $('auth-title').textContent = admin ? 'Admin sign in' : signup ? 'Create your account' : 'Welcome back';
  $('auth-description').textContent = admin ? 'Use your existing admin username and password.' : signup ? 'Sign up to start asking questions about your documents.' : 'Sign in to access your knowledge bases and documents.';
  $('signup-name-field').hidden = !signup;
  $('confirm-password-field').hidden = !signup;
  for (const id of ['user-name', 'confirm-password']) {
    $(id).disabled = !signup; $(id).required = signup;
  }
  $('admin-password').minLength = signup ? 8 : 1;
  $('admin-password').autocomplete = signup ? 'new-password' : 'current-password';
  $('login-submit').textContent = signup ? 'Create account' : 'Sign in';
  $('auth-switch').textContent = signup ? 'Already have an account? Sign in' : 'New here? Create an account';
  $('login-error').hidden = true; $('auth-message').hidden = true;
  $('admin-password').value = ''; $('confirm-password').value = '';
  $('confirm-password').setCustomValidity('');
  $('confirm-password').type = 'password';
  $('toggle-confirm-password').textContent = 'Show';
  $('toggle-confirm-password').setAttribute('aria-pressed', 'false');
  $('toggle-confirm-password').setAttribute('aria-label', 'Show confirm password');
  setPasswordVisible(false);
}
$('auth-switch').addEventListener('click', () => authMode(!signupMode));
$('admin-auth-switch').addEventListener('click', () => authMode(false, !adminMode));
$('toggle-confirm-password').addEventListener('click', () => {
  const visible = $('confirm-password').type === 'password';
  $('confirm-password').type = visible ? 'text' : 'password';
  $('toggle-confirm-password').textContent = visible ? 'Hide' : 'Show';
  $('toggle-confirm-password').setAttribute('aria-pressed', String(visible));
  $('toggle-confirm-password').setAttribute('aria-label', visible ? 'Hide confirm password' : 'Show confirm password');
});
for (const id of ['admin-password', 'confirm-password']) {
  $(id).addEventListener('input', () => $('confirm-password').setCustomValidity(''));
}
async function openWorkspace(user) {
  showLogin();
  $('account-name').textContent = user.name || user.email;
  $('admin-password').value = ''; $('confirm-password').value = '';
  setPasswordVisible(false);
  $('session-loading').hidden = true;
  $('login-gate').hidden = true;
  $('admin-app').hidden = false; $('admin-app').inert = false;
  await connect();
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const generation = state.generation;
  if (signupMode && $('admin-password').value !== $('confirm-password').value) {
    $('confirm-password').setCustomValidity('Passwords do not match.');
    $('confirm-password').reportValidity(); return;
  }
  $('login-submit').disabled = true; $('auth-switch').disabled = true; $('admin-auth-switch').disabled = true;
  $('login-error').hidden = true; $('auth-message').hidden = true;
  try {
    const body = { [adminMode ? 'username' : 'email']: $('user-email').value.trim(), password: $('admin-password').value };
    if (signupMode) body.name = $('user-name').value.trim();
    const data = await json(adminMode ? '/auth/admin/login' : signupMode ? '/auth/signup' : '/auth/login', body);
    if (generation !== state.generation) return;
    if (data.confirmation_required) {
      const email = body.email;
      authMode(false);
      $('user-email').value = email;
      $('auth-message').textContent = data.message; $('auth-message').hidden = false;
    } else {
      authChanges?.postMessage('session-changed');
      await openWorkspace(data.user);
    }
  } catch (error) {
    if (generation === state.generation) { $('login-error').textContent = error.message; $('login-error').hidden = false; }
  } finally { $('login-submit').disabled = false; $('auth-switch').disabled = false; $('admin-auth-switch').disabled = false; }
});
renderMessages();
async function resumeSession() {
  // Cookies persist safely across reloads. A 401 triggers one refresh and retry.
  showLogin();
  const generation = state.generation;
  $('login-gate').hidden = true; $('session-loading').hidden = false;
  $('login-submit').disabled = true;
  try {
    const data = await json('/auth/session');
    if (generation !== state.generation) return;
    await openWorkspace(data.user);
  } catch (error) {
    if (generation !== state.generation) return;
    $('login-gate').hidden = false;
    if (error.status !== 401) {
      $('login-error').textContent = error.message; $('login-error').hidden = false;
    }
  } finally {
    $('session-loading').hidden = true;
    $('login-submit').disabled = false;
  }
}
authChanges?.addEventListener('message', () => resumeSession());
window.addEventListener('pageshow', event => { if (event.persisted) resumeSession(); });
resumeSession();
