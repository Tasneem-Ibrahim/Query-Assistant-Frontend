import { request, readEvents } from './api.js';

const $ = id => document.getElementById(id);
let base;
try { base = localStorage.getItem('pagewise-api') || 'http://localhost:8000'; } catch { base = 'http://localhost:8000'; }
const state = { domains: [], key: '', status: null, online: false, busy: false, mode: 'chat', histories: {}, results: {}, file: null, generation: 0 };
const history = () => state.histories[state.key] ||= [];
function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function controls() {
  const unavailable = !state.online || state.busy;
  for (const id of ['domain', 'bundled', 'refresh', 'reset', 'new-domain', 'rename-domain', 'delete-domain']) $(id).disabled = unavailable;
  $('delete-domain').disabled = unavailable || !state.domains.find(d => d.key === state.key)?.custom;
  $('pdf').disabled = unavailable;
  $('upload').disabled = unavailable || !state.file;
  $('question').disabled = unavailable || !state.status?.chunks;
  $('send').disabled = unavailable || !state.status?.chunks || !$('question').value.trim();
  $('clear').disabled = state.busy;
  $('connection').disabled = state.busy;
  document.querySelectorAll('.delete-document').forEach(button => { button.disabled = unavailable; });
  $('chat-mode').disabled = state.busy;
  $('search-mode').disabled = state.busy;
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
        button.addEventListener('click', () => { $('question').value = text; controls(); if (!$('question').disabled) $('question').focus(); else notice('Process an uploaded PDF or use the bundled documents to get started.'); });
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
  const files = Object.entries(state.status?.files || {});
  $('file-count').textContent = files.length;
  $('chunk-count').textContent = state.status ? `${state.status.chunks} searchable passages` : 'Status unavailable';
  $('documents').replaceChildren();
  for (const [fileHash, file] of files) {
    const item = node('div', 'document'); const info = node('div', 'document-info');
    const title = node('strong', '', file.name); title.title = file.name;
    info.append(title, node('small', '', `${file.pages} pages · ${file.chunks} passages`));
    const remove = node('button', 'delete-document');
    remove.type = 'button'; remove.title = `Delete ${file.name}`;
    remove.setAttribute('aria-label', `Delete ${file.name}`);
    remove.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
    remove.addEventListener('click', () => deleteDocument(fileHash, file.name));
    item.append(node('span', 'mini-file', 'PDF'), info, remove); $('documents').append(item);
  }
  if (!files.length) $('documents').append(node('p', 'empty-documents', 'No PDFs processed yet. Upload yours or try the bundled documents.'));
  controls();
}
async function refresh() {
  const key = state.key;
  state.status = null; controls();
  try { const result = await json(`/domains/${encodeURIComponent(key)}/status`); if (key === state.key) state.status = result; }
  finally { renderStatus(); }
}
async function deleteDocument(fileHash, filename) {
  if (state.busy || !state.online) return;
  if (!confirm(`Delete “${filename}” from this knowledge base? Its saved PDF and searchable passages will be removed. Other documents will stay unchanged.`)) return;
  const key = state.key;
  state.busy = true; controls();
  try {
    await request(base, `/domains/${encodeURIComponent(key)}/documents/${encodeURIComponent(fileHash)}`, { method: 'DELETE' });
    // Old answers may still quote the removed document.
    delete state.histories[key]; delete state.results[key];
    renderMessages(); await refresh();
    notice(`“${filename}” and its searchable passages have been deleted.`);
  } catch (e) { notice(e.message); }
  finally { state.busy = false; controls(); }
}
async function selectDomain() {
  state.key = $('domain').value; state.file = null; $('pdf').value = ''; $('selected-file').textContent = ''; $('question').value = ''; $('processing').hidden = true; notice();
  const domain = state.domains.find(d => d.key === state.key);
  $('chat-title').textContent = domain.label;
  $('rename-domain').hidden = !domain.custom;
  $('delete-domain').hidden = !domain.custom;
  $('bundled').textContent = domain.custom ? 'Process saved documents' : 'Use bundled documents';
  $('assistant-description').textContent = domain.custom ? 'Add PDFs on any topic and explore them together.' : state.key === 'legal_assistant' ? 'Understand your contracts, clauses, and obligations.' : 'Explore orders, delivery, returns, and support policies.';
  renderMessages();
  try { await refresh(); if (state.status && !state.status.chunks) notice(domain.custom ? 'Upload your first PDF to this knowledge base. You can add more PDFs on the same topic later.' : 'Add a PDF or use the bundled documents to start exploring.'); } catch (e) { notice(e.message); }
}
async function connect() {
  const generation = ++state.generation;
  state.online = false; state.status = null; state.domains = []; state.key = ''; controls(); renderStatus(); renderMessages();
  try {
    const [health, domains] = await Promise.all([json('/health'), json('/domains')]);
    if (generation !== state.generation) return;
    if (!health.ok || !Array.isArray(domains) || !domains.length) throw new Error('No assistants available from this backend.');
    state.domains = domains; state.online = true;
    $('domain').replaceChildren(...domains.map(d => { const option = node('option', '', d.label); option.value = d.key; return option; }));
    await selectDomain();
    if (!health.deepseek_key) notice('Backend connected. Set DEEPSEEK_API_KEY in the backend .env to generate answers. You can still process PDFs and search passages.');
  } catch (e) {
    if (generation !== state.generation) return;
    state.online = false; $('domain').replaceChildren(node('option', '', 'Backend unavailable')); notice(e.message);
  } finally { if (generation === state.generation) controls(); }
}
function chooseFile(file) {
  if (!file || state.busy) return;
  if (!file.name.toLowerCase().endsWith('.pdf')) { notice('Please choose a PDF file.'); return; }
  if (!file.size) { notice('This PDF is empty. Choose a different file.'); return; }
  state.file = file; $('selected-file').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`; notice(); controls();
}
async function ingest(bundled) {
  if (state.busy || !state.online) return;
  state.busy = true; controls(); notice(); $('processing').hidden = false; $('logs').textContent = 'Starting document processing…\n';
  const data = new FormData(); if (!bundled) data.append('file', state.file);
  data.append('force', $('force').checked); data.append('use_llm', $('use-llm').checked);
  try {
    const response = await request(base, `/domains/${encodeURIComponent(state.key)}/ingest`, { method: 'POST', body: data });
    await readEvents(response, event => {
      const log = event.type === 'done' ? `${event.report.name || event.report.file || 'Document'}: ${event.report.status}. ${event.report.chunks ?? 0} passages ready.` : event.message;
      if (log) { $('logs').append(document.createTextNode(log + '\n')); $('logs').scrollTop = $('logs').scrollHeight; }
    });
    state.file = null; $('pdf').value = ''; $('selected-file').textContent = ''; notice('Your knowledge is ready. Ask a question or search the passages.');
  } catch (e) { notice(e.message); }
  finally { try { await refresh(); } catch (e) { notice(e.message); } state.busy = false; controls(); }
}
async function submit(event) {
  event.preventDefault(); const question = $('question').value.trim();
  if (!question || state.busy || !state.status?.chunks || !state.online) return;
  const topK = Number($('top-k').value);
  if (!Number.isInteger(topK) || topK < 1 || topK > 20) { notice('Choose between 1 and 20 retrieved passages in processing settings.'); return; }
  const prior = history().map(({ role, content }) => ({ role, content }));
  const messages = state.mode === 'chat' ? history() : (state.results[state.key] ||= []);
  messages.push({ role: 'user', content: question }); $('question').value = ''; $('question').style.height = ''; state.busy = true; controls(); notice(); renderMessages();
  const thinking = node('div', 'thinking message', state.mode === 'chat' ? '✦ Finding answers in your documents…' : '⌕ Searching relevant passages…'); $('messages').append(thinking); $('messages').scrollTop = $('messages').scrollHeight;
  try {
    const result = await json(`/domains/${encodeURIComponent(state.key)}/${state.mode === 'chat' ? 'ask' : 'search'}`, state.mode === 'chat' ? { question, history: prior, top_k: topK } : { query: question, top_k: topK });
    messages.push({ role: 'assistant', content: state.mode === 'chat' ? result.answer : result.hits.length ? `Found ${result.hits.length} relevant passages. Open the sources below to explore.` : 'No matching passages found.', sources: state.mode === 'chat' ? result.sources : result.hits });
  } catch (e) { messages.pop(); $('question').value = question; notice(e.message); }
  finally { state.busy = false; renderMessages(); controls(); $('question').focus(); }
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
for (const mode of ['chat', 'search']) $(`${mode}-mode`).addEventListener('click', () => { state.mode = mode; for (const name of ['chat', 'search']) { $(`${name}-mode`).classList.toggle('active', name === mode); $(`${name}-mode`).setAttribute('aria-pressed', String(name === mode)); } $('question').placeholder = mode === 'chat' ? 'What would you like to know?' : 'Search for a clause, topic, or passage…'; notice(); renderMessages(); });
$('clear').addEventListener('click', () => { if (state.mode === 'chat') state.histories[state.key] = []; else state.results[state.key] = []; renderMessages(); notice(); });
$('refresh').addEventListener('click', async () => { state.busy = true; controls(); try { await refresh(); notice(); } catch (e) { notice(e.message); } finally { state.busy = false; controls(); } });
$('reset').addEventListener('click', async () => {
  if (!confirm('Reset this assistant’s knowledge base? This removes its searchable passages and processing registry. The PDF files are kept.')) return;
  state.busy = true; controls();
  try { await json(`/domains/${encodeURIComponent(state.key)}/reset`, {}); state.histories[state.key] = []; state.results[state.key] = []; renderMessages(); await refresh(); notice('Knowledge base reset. Process documents again to start a new conversation.'); } catch (e) { notice(e.message); } finally { state.busy = false; controls(); }
});
$('delete-domain').addEventListener('click', async () => {
  const domain = state.domains.find(d => d.key === state.key);
  if (state.busy || !domain?.custom) return;
  if (!confirm(`Delete “${domain.label}” permanently? Its saved PDFs, vectors, and conversation will be removed. Other knowledge bases will stay unchanged.`)) return;
  state.busy = true; controls();
  try {
    await request(base, `/domains/${encodeURIComponent(domain.key)}`, { method: 'DELETE' });
    delete state.histories[domain.key]; delete state.results[domain.key];
    state.domains = state.domains.filter(d => d.key !== domain.key);
    $('domain').replaceChildren(...state.domains.map(d => { const option = node('option', '', d.label); option.value = d.key; return option; }));
    await selectDomain();
    notice(`“${domain.label}” and its saved PDFs and vectors have been deleted.`);
  } catch (e) { notice(e.message); }
  finally { state.busy = false; controls(); }
});
$('connection').addEventListener('click', () => { $('api-url').value = base; $('settings').showModal(); });
$('close-settings').addEventListener('click', () => $('settings').close());
$('settings-form').addEventListener('submit', event => {
  event.preventDefault(); const url = new URL($('api-url').value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) { $('api-url').setCustomValidity('Use an HTTP or HTTPS server URL without credentials, query, or fragment.'); $('api-url').reportValidity(); return; }
  base = url.href.replace(/\/$/, ''); try { localStorage.setItem('pagewise-api', base); } catch {} $('settings').close(); connect();
});
$('api-url').addEventListener('input', () => $('api-url').setCustomValidity(''));
let editingDomain = null;
function openDomainDialog(rename) {
  editingDomain = rename ? state.key : null;
  $('domain-name').value = rename ? state.domains.find(d => d.key === state.key).label : state.file?.name.replace(/\.pdf$/i, '') || '';
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
  const name = $('domain-name').value.trim();
  if (!name) { $('domain-name').setCustomValidity('Please enter a knowledge base name.'); $('domain-name').reportValidity(); return; }
  const rename = Boolean(editingDomain);
  const retainedFile = state.file;
  state.busy = true; controls(); $('save-domain').disabled = true; $('close-domain').disabled = true; $('domain-error').hidden = true;
  try {
    const domain = await (await request(base, rename ? `/domains/${encodeURIComponent(editingDomain)}` : '/domains', { method: rename ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json();
    if (rename) state.domains = state.domains.map(d => d.key === domain.key ? domain : d); else state.domains.push(domain);
    $('domain').replaceChildren(...state.domains.map(d => { const option = node('option', '', d.label); option.value = d.key; return option; }));
    $('domain').value = domain.key;
    await selectDomain();
    if (retainedFile) chooseFileAfterCreate(retainedFile);
    $('domain-dialog').close();
    notice(rename ? 'Knowledge base renamed. Your saved PDFs are unchanged.' : `“${domain.label}” is saved in your dropdown. Choose a PDF and click Upload & process.`);
  } catch (e) { $('domain-error').textContent = e.message; $('domain-error').hidden = false; }
  finally { state.busy = false; controls(); $('save-domain').disabled = false; $('close-domain').disabled = false; }
});
function chooseFileAfterCreate(file) { state.file = file; $('selected-file').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`; }
$('domain-name').addEventListener('input', () => $('domain-name').setCustomValidity(''));
renderMessages(); connect();
