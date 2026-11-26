import { createVoiceInput } from './voice.js';
import { request, readEvents, runJobs, resolveBackendBase, cancelWorkspaceRequests, selectWorkspaceAccount } from './api.js';
import { backendUrl } from './config.js';
import { createWorkspaceGuide } from './onboarding.js';
import { createAdminPanel } from './admin-panel.js';
import { createSuperAdminPanel } from './super-admin.js';
import { createSavedProcessor } from './saved-processing.js';

// Supabase email links can redirect with tokens in the fragment. Sign in through
// the cookie endpoint instead, and remove those credentials from browser history.
const authReturn = new URLSearchParams(location.hash.slice(1));
let inviteToken = authReturn.get('qa_invite') || '';
if (inviteToken || authReturn.has('access_token') || authReturn.has('refresh_token') || authReturn.has('error_description')) {
  window.history.replaceState(null, '', location.pathname + location.search);
}

const $ = id => document.getElementById(id);
let savedBase = '';
try { savedBase = localStorage.getItem('pagewise-api') || ''; } catch { /* Storage may be unavailable. */ }
let base = resolveBackendBase(location.hostname, location.origin, backendUrl, savedBase);
const state = { domains: [], key: '', status: null, online: false, busy: false, mode: 'chat', histories: {}, results: {}, file: null, generation: 0, user: null };
const savedProcessor = createSavedProcessor({
  canRun: () => state.user && state.user.id !== 'local-admin' && state.user.role !== 'super_admin' && permitted('documents.add') && document.body.classList.contains('workspace-page') && state.online && !state.busy && ![...pdfTabs.values()].some(tab => tab.isDirty?.()),
  onStart: row => {
    state.busy = true; controls(); $('processing').hidden = false;
    $('processing-status').textContent = 'Processing'; $('processing-status').className = 'approval-badge processing-status';
    $('logs').textContent = `Processing saved file: ${row.filename}\n`;
  },
  process: (row, current) => runJobs(base, row.domain, [{ file_hash:row.file_hash, status:'pending' }], event => {
    if (!current()) return;
    if (event.message) $('logs').append(document.createTextNode(event.message + '\n'));
    if (event.type === 'done') { $('processing-status').textContent = 'Ready'; $('processing-status').className = 'approval-badge approved'; }
  }, current),
  onError: error => { notice(error.message); $('processing-status').textContent = error.processingFailed ? 'Failed' : 'Paused'; $('processing-status').className = error.processingFailed ? 'approval-badge rejected' : 'approval-badge'; },
  onFinish: async (row, result, current) => {
    if (result === 'paused') { $('processing-status').textContent = 'Paused'; $('processing-status').className = 'approval-badge'; }
    await adminPanel.refresh();
    if (current()) {
      state.busy = false;
      try { await refreshApprovedDocuments(result === 'ready' ? [row] : []); }
      catch (error) { if (current()) notice(error.message); }
      if (current()) controls();
    }
  }
});
let managedUploadAccount = null;
let selectedWorkspaceAccount = null;

async function switchWorkspace(person, status, destination = person ? 'workspace' : 'users', historyMode = 'push') {
  const delegated = state.user?.role !== 'super_admin' && Boolean(person);
  if (state.busy || [...pdfTabs.values()].some(tab => tab.isDirty?.())) {
    status.textContent = 'Finish processing or save your document edits before switching workspaces.';
    return false;
  }
  ++state.generation;
  managedUploadAccount = delegated ? person : null;
  selectedWorkspaceAccount = person || null;
  document.body.classList.toggle('managed-uploads', delegated);
  $('workspace-title').textContent = delegated ? 'User uploads' : 'Documents & assistant';
  selectWorkspaceAccount(person?.id);
  if (originalPdfDialog.open) originalPdfDialog.close();
  clearPdfTabs();
  clearImageText();
  voice.cancel({ restore: false });
  state.online = false;
  state.histories = {}; state.results = {}; state.status = null;
  state.domains = []; state.key = ''; state.file = null;
  $('pdf').value = ''; $('selected-file').textContent = '';
  $('question').value = ''; $('logs').textContent = ''; $('processing').hidden = true;
  const scope = $('super-workspace-scope');
  scope.textContent = person ? (delegated ? 'Managing uploads for ' : 'Viewing workspace for ') + (person.email || person.name) : '';
  adminPanel.fileChanged(null, '');
  renderDomainOptions();
  renderMessages();
  renderStatus();
  const browsing = destination === 'knowledge-bases' && Boolean(person);
  adminPanel.navigate(destination, { message: browsing ? 'Loading knowledge bases…' : undefined, historyMode });
  const connection = connect();
  const generation = state.generation;
  const error = await connection;
  if (browsing && generation === state.generation) adminPanel.renderKnowledgeBases(error);
  return true;
}

const superPanel = createSuperAdminPanel({
  user: () => state.user,
  exportLogs: async () => (await request(base, '/super-admin/login-logs.csv')).blob(),
  api: async (path, method = 'GET', body) => (await request(base, path, {
    method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })).json(),
  openWorkspace: switchWorkspace,
  openKnowledgeBases: (person, status) => switchWorkspace(person, status, 'knowledge-bases'),
  confirmDeletion: (...args) => confirmDeletion(...args),
  confirmRevision: (title, description) => confirmDeletion(title, description, 'Reverse', { revision: true }),
});
const adminPanel = createAdminPanel({ user: () => state.user, onError: message => notice(message),
  onManageUploads: switchWorkspace,
  managingUploads: () => Boolean(managedUploadAccount),
  addApprovalRequest: (owner, data) => request(base, '/admin/upload-requests/for/' + encodeURIComponent(owner),
    { method: 'POST', body: data }).then(response => response.json()),
  confirmApprovalDelete: row => confirmDeletion('Delete approval request?',
    `Remove the approval request for "${row.filename}"? Documents already in the user's knowledge base stay there.`, 'Delete request'),
  sendUpload: data => request(base, '/uploads', { method:'POST', body:data }).then(response => response.json()),
  onReady: rows => refreshApprovedDocuments(rows).catch(error => notice(error.message)),
  onApprovedUploads: rows => savedProcessor.enqueue(rows),
  onViewPdf: row => viewOriginalPdf(row),
  onViewDocument: (hash, filename) => openPdf(hash, filename),
  knowledgeBases: () => state.domains,
  workspaceAccount: () => selectedWorkspaceAccount,
  onPage: page => superPanel.show(page),
  onOpenBase: async key => {
    if (key === state.key) return true;
    if (state.busy || !state.domains.some(domain => domain.key === key)) return false;
    $('domain').value = key;
    await selectDomain();
    return state.key === key;
  },
  confirmRemoveCard: row => confirmDeletion('Delete upload card?', `Remove the card for "${row.filename}" from your request list? Your PDF, processing and the admin record remain saved.`, 'Delete card'),
  api: async (path, body, method = 'GET') => (await request(base, path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json() });
const guide = createWorkspaceGuide({
  dialog: $('welcome-guide'), close: $('close-welcome'), later: $('welcome-later'),
  start: $('welcome-create'), error: $('welcome-error'),
  complete: () => json('/auth/onboarding/complete', {}),
  create: () => { $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' }); openDomainDialog(false); }
});
const authChanges = typeof BroadcastChannel === 'function' ? new BroadcastChannel('query-assistant-auth') : null;
const history = () => state.histories[state.key] ||= [];
function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function permitted(key) { return state.user?.permissions?.[key] !== false; }
function controls() {
  savedProcessor.kick();
  const unavailable = !state.online || state.busy;
  for (const id of ['domain', 'bundled', 'refresh', 'reset', 'new-domain', 'rename-domain', 'delete-domain']) $(id).disabled = unavailable;
  $('new-domain').disabled ||= !permitted('bases.view') || !permitted('bases.add');
  $('delete-domain').disabled = unavailable || !permitted('bases.delete') || !permitted('documents.delete') || !state.domains.find(d => d.key === state.key)?.custom;
  for (const id of ['pdf', 'bundled', 'refresh', 'reset', 'rename-domain']) $(id).disabled = unavailable || !state.key;
  $('refresh').disabled ||= !permitted('documents.view');
  $('rename-domain').disabled ||= !permitted('bases.edit');
  for (const id of ['pdf', 'bundled']) $(id).disabled ||= !permitted('documents.add');
  if (managedUploadAccount) $('pdf').disabled ||= !permitted('user_uploads.add');
  if (state.user?.id === 'local-admin' && state.user.direct_upload_restricted) $('pdf').disabled = true;
  $('reset').disabled ||= !permitted('bases.delete') || !permitted('documents.delete');
  document.querySelectorAll('.view-image-text, .view-pdf').forEach(button => { button.disabled = unavailable || button.dataset.ready === 'false'; });
  $('upload').disabled = unavailable || !state.key || !state.file || !permitted('documents.add')
    || Boolean(managedUploadAccount && !permitted('user_uploads.add')) || $('pdf').disabled;
  const uploadNote = $('upload-request-message'); if (uploadNote) uploadNote.disabled = $('upload').disabled;
  $('question').disabled = unavailable || !state.status?.chunks;
  if (unavailable || !state.status?.chunks) voice.pause('Paused while the workspace is unavailable. Resume when ready.');
  const voiceState = voice.snapshot();
  $('question').readOnly = voiceState.phase === 'listening' || voiceState.pending;
  $('send').disabled = unavailable || !state.status?.chunks || (!$('question').value.trim() && !voiceState.interim.trim());
  renderVoice();
  $('clear').disabled = state.busy;
  document.querySelectorAll('.delete-document').forEach(button => {
    button.disabled = unavailable || !permitted('documents.delete') || Boolean(managedUploadAccount && !permitted('user_uploads.delete'));
  });
  $('chat-mode').disabled = state.busy;
  $('search-mode').disabled = state.busy;
  $('force').disabled = state.busy || !permitted('documents.edit');
  if (!permitted('documents.edit')) $('force').checked = false;
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
function workspaceSparkle() {
  const icon = node('div', 'empty-symbol ai-empty-icon workspace-hero-icon');
  icon.append(node('span', '', '✦'));
  return icon;
}
function renderMessages() {
  const box = $('messages'); box.replaceChildren();
  if (!state.key) {
    const empty = node('div', 'chat-empty');
    const fresh = state.online && !state.domains.length;
    if (document.body.classList.contains('workspace-page')) {
      empty.classList.add('workspace-start');
      const icon = workspaceSparkle();
      icon.setAttribute('aria-hidden', 'true');
      empty.append(icon);
    }
    empty.append(node('h4', '', fresh ? 'Your workspace starts here.' : 'Select your knowledge base'), node('p', '', fresh ? 'Create your first knowledge base, then upload a PDF or image to start exploring your documents.' : 'Choose a knowledge base from the dropdown to view your documents and start asking questions.'));
    if (fresh) {
      const create = node('button', 'button secondary', '+ Create knowledge base');
      create.type = 'button'; create.disabled = state.busy;
      create.addEventListener('click', () => { if (!state.busy) openDomainDialog(false); });
      empty.append(create);
    }
    box.append(empty); return;
  }
  const messages = state.mode === 'chat' ? history() : (state.results[state.key] || []);
  if (!messages.length) {
    const empty = node('div', 'chat-empty');
    const isWorkspace = document.body.classList.contains('workspace-page');
    if (isWorkspace) empty.classList.add('workspace-start');
    const heading = state.mode === 'search' ? 'Find the passage you need.' :
      'From Questions to Clarity,\nFrom Data to Insights';
    const icon = isWorkspace && state.mode === 'chat'
      ? workspaceSparkle()
      : node('div', 'empty-symbol ai-empty-icon', state.mode === 'chat' ? '✦' : '⌕');
    icon.setAttribute('aria-hidden', 'true');
    const title = node('h4', state.mode === 'chat' ? 'clarity-quote' : '', heading);
    if (isWorkspace) title.classList.add('assistant-prompt-title');
    empty.append(icon, title);
    const domain = state.domains.find(d => d.key === state.key);
    empty.append(node('p', '', state.mode === 'search' ? 'Find relevant excerpts in your documents.' :
      isWorkspace ? 'Ask a question about your documents to get started.' : domain?.welcome || 'Connect your backend and add a PDF to get started.'));
    const defaultSuggestions = ['What are the key takeaways from these documents?', 'Summarize the main ideas in this knowledge base.', 'Which details are most important to understand?', 'What conclusions are supported by these documents?'];
    const suggestions = state.status?.chunks && state.mode === 'chat'
      ? [...new Set([...(domain?.examples || []), ...defaultSuggestions])].slice(0, 4) : [];
    if (suggestions.length) {
      const examples = node('div', 'examples');
      for (const text of suggestions) {
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
    const remove = node('button', 'delete-document');
    remove.type = 'button'; remove.title = `Delete ${file.name}`;
    remove.setAttribute('aria-label', `Delete ${file.name}`);
    remove.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
    remove.append(document.createTextNode('Delete'));
    remove.addEventListener('click', () => deleteDocument(fileHash, file.name));
    const heading = node('div', 'document-title-row');
    heading.append(title, remove);
    info.append(heading, node('small', '', state.status?.pending_files?.[fileHash] ? `${file.pages} pages · Processing incomplete` : `${file.pages} pages · ${file.chunks} passages`));
    const isImage = /\.(jpe?g|png|jfif|webp|bmp|tiff?|avif)$/i.test(file.name);
    if (isImage && !state.status?.pending_files?.[fileHash]) {
      const view = node('button', 'view-image-text', 'View text');
      view.type = 'button'; view.setAttribute('aria-label', `View extracted text from ${file.name}`);
      view.addEventListener('click', () => showImageText(fileHash));
      info.append(view);
    }
    if (/\.pdf$/i.test(file.name) || isImage) {
      const view = node('button', 'button secondary view-pdf', 'View document');
      view.type = 'button'; view.setAttribute('aria-label', `View and edit processed chunks: ${file.name}`);
      view.dataset.ready = state.status?.pending_files?.[fileHash] ? 'false' : 'true';
      view.title = view.dataset.ready === 'false' ? 'Available after processing finishes.' : 'View and edit the cleaned, normalized content used for search and answers.';
      view.addEventListener('click', () => openPdf(fileHash, file.name));
      info.append(view);
    }
    item.append(node('span', 'mini-file', isImage ? 'IMG' : 'PDF'), info); $('documents').append(item);
  }
  if (!files.length) $('documents').append(node('p', 'empty-documents', state.key ? 'No documents processed yet. Upload your first PDF or image.' : state.online && !state.domains.length ? 'Create a knowledge base to add your first document.' : 'Select your knowledge base to view its documents.'));
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
const originalPdfDialog = document.createElement('dialog'); originalPdfDialog.id = 'original-pdf-dialog';
originalPdfDialog.setAttribute('aria-labelledby', 'original-pdf-title');
const originalPdfHeader = node('div', 'original-pdf-header');
const originalPdfTitle = node('h3', '', 'PDF preview'); originalPdfTitle.id = 'original-pdf-title';
const originalPdfClose = node('button', 'button secondary', 'Close'); originalPdfClose.type = 'button';
originalPdfClose.addEventListener('click', () => originalPdfDialog.close());
originalPdfHeader.append(originalPdfTitle, originalPdfClose);
const originalPdfStatus = node('p'); originalPdfStatus.setAttribute('role', 'status');
const originalPdfFrame = document.createElement('iframe'); originalPdfFrame.title = 'Your original PDF';
const originalPdfLink = node('a', 'text-link', 'Open PDF in a new tab'); originalPdfLink.target = '_blank'; originalPdfLink.rel = 'noopener'; originalPdfLink.hidden = true;
originalPdfDialog.append(originalPdfHeader, originalPdfStatus, originalPdfFrame, originalPdfLink); document.body.append(originalPdfDialog);
let originalPdfUrl = null, originalPdfSequence = 0;
function clearOriginalPdfPreview() {
  ++originalPdfSequence; originalPdfFrame.src = 'about:blank'; originalPdfLink.removeAttribute('href'); originalPdfLink.hidden = true;
  if (originalPdfUrl) URL.revokeObjectURL(originalPdfUrl); originalPdfUrl = null;
}
originalPdfDialog.addEventListener('close', () => { if (!originalPdfDialog.open) clearOriginalPdfPreview(); });
async function viewOriginalPdf(row) {
  if (originalPdfDialog.open) originalPdfDialog.close();
  clearOriginalPdfPreview();
  const sequence = ++originalPdfSequence, generation = state.generation;
  originalPdfTitle.textContent = row.filename; originalPdfStatus.textContent = 'Loading your PDF…';
  originalPdfFrame.src = 'about:blank'; originalPdfLink.hidden = true; originalPdfDialog.showModal();
  try {
    const response = await request(base, `/domains/${encodeURIComponent(row.domain)}/documents/${encodeURIComponent(row.file_hash)}/pdf`);
    const blob = await response.blob();
    if (generation !== state.generation || sequence !== originalPdfSequence || !originalPdfDialog.open) return;
    if (!blob.type.includes('application/pdf')) throw new Error('The PDF preview is unavailable.');
    originalPdfUrl = URL.createObjectURL(blob); originalPdfFrame.src = originalPdfUrl;
    originalPdfLink.href = originalPdfUrl; originalPdfLink.hidden = false; originalPdfStatus.textContent = '';
  } catch (error) {
    if (generation === state.generation && sequence === originalPdfSequence && originalPdfDialog.open) originalPdfStatus.textContent = error.message;
  }
}
window.addEventListener('beforeunload', event => {
  if ([...pdfTabs.values()].some(tab => tab.isDirty?.())) { event.preventDefault(); event.returnValue = ''; }
});
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
  tab.editorResize?.disconnect();
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
  close.addEventListener('click', () => {
    if (tab.isDirty?.() && !confirm('Discard unsaved document changes?')) return;
    closePdf(fileHash);
  });
  wrapper.append(button, close); document.querySelector('.chat-tabs').append(wrapper);
  const panel = node('section', 'pdf-panel');
  panel.setAttribute('aria-label', `Processed document editor: ${filename}`);
  const status = node('p', 'pdf-status', 'Loading processed chunks...'); status.setAttribute('role', 'status');
  panel.append(status); $('pdf-panels').append(panel);
  const tab = { wrapper, button, panel, controller: new AbortController(), url: null };
  pdfTabs.set(fileHash, tab); activatePdf(fileHash);
  const generation = state.generation;
  try {
    const path = `/domains/${encodeURIComponent(key)}/documents/${encodeURIComponent(fileHash)}/chunks`;
    const response = await request(base, path, { signal: tab.controller.signal });
    let saved = await response.json();
    if (pdfTabs.get(fileHash) !== tab || generation !== state.generation) return;
    const heading = node('div', 'editor-heading');
    heading.append(node('span', 'editor-eyebrow', 'YOUR DOCUMENT'), node('h3', '', filename));
    const editable = permitted('documents.edit') && (!managedUploadAccount || permitted('user_uploads.edit'));
    const intro = node('p', 'editor-help', editable ? 'Review your processed text, make changes, then save.' : 'Review your processed text.');
    const explanation = node('details', 'editor-explanation');
    explanation.append(node('summary', '', 'How saving works'), node('p', '', 'Saving cleans the text, removes duplicate chunks and updates search. Page numbers refer to the original PDF; choose a source page for added text.'));
    heading.append(intro);
    if (editable) heading.append(explanation);
    const scroll = node('div', 'editor-scroll');
    const list = node('div', 'editor-chunks');
    const toolbar = node('div', 'editor-toolbar');
    const add = node('button', 'button secondary', 'Add chunk');
    const save = node('button', 'button primary', 'Save & vectorize');
    const message = node('p', 'editor-status', 'All changes saved.');
    message.setAttribute('role', 'status');
    let dirty = false, saving = false;
    const changed = () => { dirty = true; message.textContent = 'Unsaved changes'; save.disabled = false; };
    const numberChunks = () => {
      [...list.children].forEach((card, index) => { card.querySelector('.editor-chunk-number').textContent = `CHUNK ${String(index + 1).padStart(2, '0')}`; });
    };
    const addChunk = (part = { text: '', page: 1 }) => {
      const card = node('section', 'editor-chunk');
      const header = node('div', 'editor-chunk-header');
      const number = node('h4', 'editor-chunk-number');
      const label = node('label', '', 'Source page ');
      const page = node('input'); page.type = 'number'; page.min = '1'; page.max = String(saved.pages); page.value = part.page;
      page.setAttribute('aria-label', 'Original page number');
      const remove = node('button', 'button secondary', 'Remove chunk'); remove.type = 'button';
      const text = node('textarea'); text.value = part.text; text.rows = 2;
      text.setAttribute('aria-label', 'Chunk text'); text.maxLength = 100000;
      text.readOnly = page.readOnly = !editable;
      const fitText = () => {
        if (!text.clientWidth) return;
        text.style.height = 'auto';
        text.style.height = `${text.scrollHeight + 2}px`;
      };
      text.addEventListener('input', () => { fitText(); changed(); }); page.addEventListener('input', changed);
      remove.addEventListener('click', () => { card.remove(); numberChunks(); changed(); });
      label.append(page); header.append(number, label); if (editable) header.append(remove);
      card.append(header, text); list.append(card); numberChunks(); requestAnimationFrame(fitText);
    };
    const render = () => { list.replaceChildren(); saved.chunks.forEach(addChunk); };
    add.type = save.type = 'button'; save.disabled = true;
    add.addEventListener('click', () => { addChunk(); changed(); list.lastElementChild.querySelector('textarea').focus(); });
    close.addEventListener('click', event => { if (saving) event.stopImmediatePropagation(); }, { capture: true });
    // Keep all drafts intact if validation or embedding fails.
    save.addEventListener('click', async () => {
      if (!dirty || saving || state.busy || generation !== state.generation) return;
      const chunks = [...list.children].map(card => ({ text: card.querySelector('textarea').value, page: Number(card.querySelector('input').value) }));
      if (!chunks.some(c => c.text.trim())) { message.textContent = 'Keep at least one non-empty chunk.'; return; }
      saving = true; state.busy = true; controls();
      panel.querySelectorAll('button, input, textarea').forEach(el => { el.disabled = true; });
      save.textContent = 'Saving...';
      message.textContent = 'Saving and rebuilding embeddings...';
      try {
        const result = await request(base, path, { method: 'PUT', signal: tab.controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: saved.revision, chunks }) });
        const updated = await result.json();
        if (generation !== state.generation || pdfTabs.get(fileHash) !== tab) return;
        saved = updated; dirty = false; render();
        delete state.histories[key]; delete state.results[key]; renderMessages();
        message.textContent = `Saved. All changes saved. ${saved.chunks.length} chunks ready for search.`;
        try { await refresh(); } catch { message.textContent += ' Refresh document status to update the count.'; }
      } catch (error) {
        if (generation === state.generation && pdfTabs.get(fileHash) === tab) message.textContent = error.message + ' Your draft is still here.';
      } finally {
        saving = false;
        if (generation === state.generation && pdfTabs.get(fileHash) === tab) {
          state.busy = false; controls();
          panel.querySelectorAll('button, input, textarea').forEach(el => { el.disabled = false; });
          save.disabled = !dirty; save.textContent = 'Save & vectorize';
        }
      }
    });
    tab.isDirty = () => dirty;
    render();
    scroll.append(heading, list);
    toolbar.setAttribute('aria-label', 'Document save actions');
    toolbar.append(add, message, save);
    panel.replaceChildren(scroll);
    if (editable) panel.append(toolbar);
    let editorWidth = 0;
    tab.editorResize = new ResizeObserver(() => {
      const width = list.clientWidth;
      if (!width || width === editorWidth) return;
      editorWidth = width;
      list.querySelectorAll('textarea').forEach(text => {
        text.style.height = 'auto'; text.style.height = `${text.scrollHeight + 2}px`;
      });
    });
    tab.editorResize.observe(list);

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
  if (!state.key || !permitted('documents.view')) { state.status = null; renderStatus(); return; }
  const key = state.key, generation = state.generation;
  state.status = null; controls();
  try { const result = await json(`/domains/${encodeURIComponent(key)}/status`); if (key === state.key && generation === state.generation) state.status = result; }
  finally {
    if (generation === state.generation) {
      renderStatus();
      const messages = state.mode === 'chat' ? history() : (state.results[state.key] || []);
      if (!messages.length) renderMessages();
    }
  }
}
async function refreshApprovedDocuments(rows = []) {
  if (!document.body.classList.contains('workspace-page')) return;
  if (!state.key && !state.busy && !state.file) {
    const ready = rows.find(row => state.domains.some(domain => domain.key === row.domain));
    if (ready) { $('domain').value = ready.domain; await selectDomain(); return; }
  }
  await refresh();
}
let confirmationPending = false;
function confirmDeletion(title, description, actionLabel = 'Permanently delete', { revision = false } = {}) {
  const dialog = $('delete-document-dialog');
  if (confirmationPending || dialog.open) return Promise.resolve(false);
  dialog.classList.toggle('management-detail-dialog', revision);
  $('delete-document-title').textContent = title;
  $('delete-document-description').textContent = description;
  $('confirm-permanent-delete').textContent = actionLabel;
  dialog.returnValue = 'cancel';
  confirmationPending = true;
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      confirmationPending = false;
      dialog.classList.remove('management-detail-dialog');
      resolve(dialog.returnValue === 'delete');
    }, { once: true });
    dialog.showModal();
  });
}
async function deleteDocument(fileHash, filename) {
  if (state.busy || !state.online || !state.key) return;
  const key = state.key, generation = state.generation;
  const location = managedUploadAccount ? ` from ${managedUploadAccount.email || managedUploadAccount.name}’s workspace` : '';
  const confirmed = await confirmDeletion('Delete document?', `Permanently delete "${filename}"${location}? The saved file and its searchable passages will be removed. This cannot be undone.`);
  if (!confirmed || state.busy || !state.online || key !== state.key || generation !== state.generation) return;
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
  const placeholder = node('option', '', state.domains.length ? 'Select your knowledge base' : 'Create your first knowledge base');
  placeholder.value = '';
  $('domain').replaceChildren(placeholder, ...state.domains.map(d => {
    const option = node('option', '', d.label); option.value = d.key; return option;
  }));
  $('domain').value = '';
}
async function selectDomain() {
  if ($('domain').value !== state.key && [...pdfTabs.values()].some(tab => tab.isDirty?.())
      && !confirm('Discard unsaved document changes and switch knowledge base?')) {
    $('domain').value = state.key; return;
  }
  const generation = state.generation;
  voice.cancel({ restore: false });
  clearPdfTabs();
  clearImageText();
  state.key = $('domain').value; state.file = null; $('pdf').value = ''; $('selected-file').textContent = ''; $('question').value = ''; $('processing').hidden = true; notice();
  adminPanel.fileChanged(null, state.key);
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
    if (state.user?.access_suspended) {
      notice('Admin workspace access is paused. Contact Super Admin.');
      return;
    }
    if (!health.ok) throw new Error(health.configuration_errors?.join('. ') || 'Backend is not configured.');
    const domains = permitted('bases.view') ? await json('/domains') : [];
    if (generation !== state.generation) return;
    if (!Array.isArray(domains)) throw new Error('Invalid knowledge base response from the backend.');
    state.cloud = health.storage === 'supabase';
    state.domains = domains; state.online = true;
    renderDomainOptions();
    await selectDomain();
    if (generation !== state.generation) return;
    if (!document.body.classList.contains('landing-page') && permitted('bases.add')) guide.show(state.user, state.domains);
    if (!health.deepseek_key) notice('Backend connected. Set DEEPSEEK_API_KEY in the backend .env to generate answers. You can still process PDFs and search passages.');
  } catch (e) {
    if (generation !== state.generation) return;
    state.online = false; $('domain').replaceChildren(node('option', '', 'Backend unavailable')); notice(e.message);
    return e.message;
  } finally { if (generation === state.generation) controls(); }
}
function chooseFile(file) {
  if (!file || state.busy || !state.key) return;
  if (! /\.(pdf|jpe?g|png|jfif|webp|bmp|tiff?|avif)$/i.test(file.name)) { notice('Please choose a PDF, JPG, JPEG, PNG, JFIF, WebP, BMP, TIF, TIFF or AVIF file.'); return; }
  if (!file.size) { notice('This file is empty. Choose a different file.'); return; }
  if (file.size > 4000000) { notice('Choose a PDF or image smaller than 4 MB.'); return; }
  clearImageText();
  state.file = file; $('selected-file').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`; notice(); controls();
  adminPanel.fileChanged(file, state.key);
}
async function ingest(bundled) {
  if (state.busy || !state.online || !state.key) return;
  const key = state.key, generation = state.generation;
  const imageName = !bundled && /\.(jpe?g|png|jfif|webp|bmp|tiff?|avif)$/i.test(state.file?.name || '') ? state.file.name.replace(/[^A-Za-z0-9._-]+/g, '_') : null;
  clearImageText();
  state.busy = true; controls(); notice();
  $('processing').hidden = false;
  $('processing-status').textContent = bundled ? 'Processing' : 'Uploading';
  $('processing-status').className = 'approval-badge processing-status';
  $('logs').textContent = bundled ? 'Starting document processing…\n' : `Uploading ${state.file.name}…\n`;
  const data = new FormData(); if (!bundled) data.append('file', state.file);
  data.append('force', $('force').checked); data.append('use_llm', $('use-llm').checked);
  try {
    if (!bundled) {
      const prepared = await adminPanel.prepare(state.file, key, $('use-llm').checked);
      if (generation !== state.generation) return;
      if (!prepared) { $('processing').hidden = true; return; }
      if (prepared !== true) {
        state.file = null; $('pdf').value = ''; $('selected-file').textContent = '';
        const message = prepared.job_message || 'Your file is saved. Track its status below; no re-upload is needed.';
        $('processing-status').textContent = prepared.status === 'pending' ? 'Awaiting approval' : 'File saved';
        $('processing-status').className = prepared.status === 'pending' ? 'approval-badge pending' : 'approval-badge';
        $('logs').textContent = message;
        return;
      }
    }
    if (generation !== state.generation) return;
    const response = await request(base, `/domains/${encodeURIComponent(key)}/ingest`, { method: 'POST', body: data });
    if (generation !== state.generation) return;
    $('processing-status').textContent = 'Processing';
    const onEvent = event => {
      if (generation !== state.generation) return;
      const log = event.type === 'done' ? `${event.report.name || event.report.file || 'Document'}: ${event.report.status}. ${event.report.chunks ?? 0} passages ready.` : event.message;
      if (log) { $('logs').append(document.createTextNode(log + '\n')); $('logs').scrollTop = $('logs').scrollHeight; }
    };
    if (response.headers.get('content-type')?.includes('application/json')) {
      const { jobs } = await response.json();
      if (generation !== state.generation) return;
      const result = await runJobs(base, key, jobs, onEvent, () => generation === state.generation);
      if (generation !== state.generation) return;
      if (result === 'paused') {
        $('processing-status').textContent = 'Paused';
        $('processing-status').className = 'approval-badge';
        return;
      }
    } else await readEvents(response, onEvent);
    if (generation !== state.generation) return;
    state.file = null; $('pdf').value = ''; $('selected-file').textContent = '';
    notice(managedUploadAccount ? 'The file is ready in the user workspace.' : 'Your knowledge is ready. Ask a question or search the passages.');
    $('processing-status').textContent = 'Ready'; $('processing-status').className = 'approval-badge approved';
  } catch (e) {
    if (generation === state.generation) {
      $('processing-status').textContent = 'Failed';
      $('processing-status').className = 'approval-badge rejected';
      $('logs').append(document.createTextNode(e.message + '\n'));
    }
  }
  finally {
    if (generation !== state.generation) return;
    try {
      await refresh();
      if (generation !== state.generation) return;
      const image = imageName && Object.entries(state.status?.files || {}).find(([, file]) => file.name === imageName);
      if (image && !managedUploadAccount) await showImageText(image[0]);
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
for (const mode of ['chat', 'search']) $(`${mode}-mode`).addEventListener('click', () => { state.mode = mode; activatePdf(); for (const name of ['chat', 'search']) { $(`${name}-mode`).classList.toggle('active', name === mode); $(`${name}-mode`).setAttribute('aria-pressed', String(name === mode)); } $('question').placeholder = mode === 'chat' ? 'Ask a question' : 'Search documents'; notice(); renderMessages(); });
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
  const confirmed = await confirmDeletion('Delete knowledge base?', `Permanently delete "${domain.label}"? All its saved documents, searchable passages, and conversation will be removed. This cannot be undone.`);
  if (!confirmed || state.busy || !state.online || generation !== state.generation || domain.key !== state.key) return;
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
function chooseFileAfterCreate(file) { state.file = file; $('selected-file').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`; adminPanel.fileChanged(file, state.key); }
$('domain-name').addEventListener('input', () => $('domain-name').setCustomValidity(''));
function setPasswordVisible(visible) {
  $('admin-password').type = visible ? 'text' : 'password';
  const button = $('toggle-password');
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  button.title = visible ? 'Hide password' : 'Show password';
  button.textContent = visible ? 'Hide' : 'Show';
}
$('toggle-password').addEventListener('click', () => {
  setPasswordVisible($('admin-password').type === 'password');
});
function showLogin() {
  managedUploadAccount = null;
  document.body.classList.remove('managed-uploads');
  $('workspace-title').textContent = 'Documents & assistant';
  savedProcessor.reset();
  if (originalPdfDialog.open) originalPdfDialog.close();
  adminPanel.reset();
  superPanel.reset();
  selectWorkspaceAccount();
  selectedWorkspaceAccount = null;
  $('super-workspace-scope').textContent = '';
  guide.reset();
  state.user = null;
  cancelWorkspaceRequests();
  voice.cancel({ restore: false });
  clearPdfTabs();
  ++state.generation;
  state.file = null; $('pdf').value = ''; $('selected-file').textContent = '';
  clearImageText();
  state.online = false; state.status = null; state.domains = []; state.key = '';
  state.busy = false; $('question').value = ''; $('logs').textContent = ''; $('processing').hidden = true;
  $('domain').replaceChildren(node('option', '', 'Select your knowledge base'));
  for (const id of ['domain-dialog', 'delete-document-dialog']) if ($(id).open) $(id).close();
  $('domain-name').value = ''; $('account-name').textContent = ''; notice();
  $('chat-title').textContent = 'Document assistant';
  $('assistant-description').textContent = 'Select your knowledge base to get started, or create a new one.';
  $('rename-domain').hidden = true; $('delete-domain').hidden = true;
  $('domain-error').textContent = ''; $('domain-error').hidden = true;
  state.histories = {}; state.results = {};
  $('admin-app').hidden = true; $('admin-app').inert = true;
  $('login-gate').hidden = false;
  clearMfa();
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
let signupMode = false;
function clearMfa() {
  $('mfa-form').hidden = true;
  $('login-form').hidden = false;
  $('mfa-key').value = '';
  $('mfa-qr').hidden = true;
  $('mfa-qr').removeAttribute('src');
  $('mfa-code').value = '';
  $('mfa-error').hidden = true;
}

function showMfa(data) {
  const setup = data.mfa_required === 'setup';
  const qr = $('mfa-qr');
  const hasQr = setup && Boolean(data.setup_qr_png);
  qr.hidden = !hasQr;
  if (hasQr) qr.src = 'data:image/png;base64,' + data.setup_qr_png;
  else qr.removeAttribute('src');
  $('login-form').hidden = true;
  $('mfa-form').hidden = false;
  $('mfa-setup').hidden = !setup;
  $('mfa-title').textContent = setup ? 'Set up two-factor authentication' : 'Verify your sign-in';
  $('mfa-description').textContent = setup
    ? (hasQr
      ? 'Scan the QR code with your authenticator app, or enter the setup key manually. Then enter the six-digit code it generates.'
      : 'Add a time-based account in your authenticator app using this setup key. Then enter the code it generates.')
    : 'Enter the current six-digit code from your authenticator app.';
  $('mfa-key').value = data.setup_key || '';
  $('mfa-submit').textContent = setup ? 'Confirm setup' : 'Verify code';
  $('admin-password').value = '';
  $('confirm-password').value = '';
  $('mfa-title').focus();
}

$('mfa-copy').addEventListener('click', async () => {
  const key = $('mfa-key');
  key.select();
  try { await navigator.clipboard.writeText(key.value); }
  catch { key.focus(); }
});
$('mfa-back').addEventListener('click', async () => {
  const generation = state.generation;
  $('mfa-back').disabled = true;
  $('mfa-submit').disabled = true;
  try { await json('/auth/mfa/cancel', {}); }
  catch (error) {
    if (generation === state.generation) {
      $('mfa-error').textContent = error.message;
      $('mfa-error').hidden = false;
    }
    return;
  }
  finally {
    $('mfa-back').disabled = false;
    $('mfa-submit').disabled = false;
  }
  if (generation === state.generation) {
    clearMfa();
    authMode(false);
    $('user-email').focus();
  }
});
$('mfa-form').addEventListener('submit', async event => {
  event.preventDefault();
  const generation = state.generation;
  $('mfa-submit').disabled = true;
  $('mfa-back').disabled = true;
  $('mfa-error').hidden = true;
  try {
    await json('/auth/mfa/verify', { code: $('mfa-code').value });
    if (generation !== state.generation) return;
    clearMfa();
    authChanges?.postMessage('session-changed');
    window.location.replace('index.html');
  } catch (error) {
    if (generation !== state.generation) return;
    $('mfa-error').textContent = error.message;
    $('mfa-error').hidden = false;
    $('mfa-code').select();
  } finally {
    $('mfa-submit').disabled = false;
    $('mfa-back').disabled = false;
  }
});

function authMode(signup) {
  signupMode = signup;
  const accepting = Boolean(inviteToken);
  $('user-email').hidden = accepting;
  $('user-email').disabled = accepting;
  $('login-identity-label').hidden = accepting;
  $('user-email').type = signup ? 'email' : 'text';
  $('user-email').maxLength = 254;
  $('user-email').value = '';
  $('login-identity-label').textContent = signup ? 'EMAIL' : 'EMAIL OR USERNAME';

  $('auth-title').textContent = accepting ? 'Accept your invitation' : signup ? 'Create your account' : 'Welcome back';
  $('auth-description').textContent = accepting ? 'Choose a password to activate your Query Assistant sign-in.' : signup ? 'Sign up to start asking questions about your documents.' : 'Sign in to access your knowledge bases and documents.';
  $('signup-name-field').hidden = !signup;
  $('confirm-password-field').hidden = !(signup || accepting);
  $('user-name').disabled = !signup; $('user-name').required = signup;
  $('confirm-password').disabled = !(signup || accepting);
  $('confirm-password').required = signup || accepting;
  $('admin-password').minLength = signup || accepting ? 8 : 1;
  $('admin-password').autocomplete = signup || accepting ? 'new-password' : 'current-password';
  $('login-submit').textContent = accepting ? 'Set password and sign in' : signup ? 'Create account' : 'Sign in';
  $('auth-switch').textContent = accepting ? 'Return to sign in' : signup ? 'Already have an account? Sign in' : 'New here? Create an account';
  $('login-error').hidden = true; $('auth-message').hidden = true;
  $('admin-password').value = ''; $('confirm-password').value = '';
  $('confirm-password').setCustomValidity('');
  $('confirm-password').type = 'password';
  $('toggle-confirm-password').textContent = 'Show';
  $('toggle-confirm-password').setAttribute('aria-pressed', 'false');
  $('toggle-confirm-password').setAttribute('aria-label', 'Show confirm password');
  setPasswordVisible(false);
}
$('auth-switch').addEventListener('click', () => {
  if (inviteToken) { inviteToken = ''; authMode(false); void resumeSession(); }
  else authMode(!signupMode);
});
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
  state.user = user;
  $('account-name').textContent = user.name || user.email;
  if (user.role === 'super_admin') $('super-workspace-scope').textContent = 'Viewing your Super Admin workspace';
  $('admin-password').value = ''; $('confirm-password').value = '';
  setPasswordVisible(false);
  $('login-gate').hidden = true;
  await connect();
  if (state.user !== user) return;
  await adminPanel.start(() => {
    $('admin-app').hidden = false; $('admin-app').inert = false;
    $('session-loading').hidden = true;
  });
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const generation = state.generation;
  if ((signupMode || inviteToken) && $('admin-password').value !== $('confirm-password').value) {
    $('confirm-password').setCustomValidity('Passwords do not match.');
    $('confirm-password').reportValidity(); return;
  }
  $('login-submit').disabled = true; $('auth-switch').disabled = true;
  $('login-error').hidden = true; $('auth-message').hidden = true;
  try {
    const body = { [signupMode ? 'email' : 'identity']: $('user-email').value.trim(), password: $('admin-password').value };
    if (signupMode) body.name = $('user-name').value.trim();
    const data = inviteToken
      ? await json('/auth/accept-invite', { token_hash: inviteToken, password: body.password })
      : await json(signupMode ? '/auth/signup' : '/auth/login', body);
    if (generation !== state.generation) return;
    if (data.confirmation_required) {
      const email = body.email;
      authMode(false);
      $('user-email').value = email;
      $('auth-message').textContent = data.message; $('auth-message').hidden = false;
    } else if (data.mfa_required) {
      inviteToken = '';
      showMfa(data);
    } else {
      authChanges?.postMessage('session-changed');
      window.location.replace('index.html');
    }
  } catch (error) {
    if (generation === state.generation) { $('login-error').textContent = error.message; $('login-error').hidden = false; }
  } finally { $('login-submit').disabled = false; $('auth-switch').disabled = false; }
});
renderMessages();
async function resumeSession() {
  // Cookies persist safely across reloads. A 401 triggers one refresh and retry.
  showLogin();
  if (inviteToken) { authMode(false); $('session-loading').hidden = true; return; }
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

let checkingPermissions = false;
async function checkCurrentPermissions() {
  const previous = state.user;
  if (!previous || checkingPermissions) return;
  checkingPermissions = true;
  try {
    const { user } = await json('/auth/session');
    if (state.user !== previous) return;
    const keys = new Set([...Object.keys(previous.permissions || {}), ...Object.keys(user.permissions || {})]);
    if (user.id !== previous.id || user.role !== previous.role
        || user.access_suspended !== previous.access_suspended
        || user.direct_upload_restricted !== previous.direct_upload_restricted
        || JSON.stringify(user.account_scope || []) !== JSON.stringify(previous.account_scope || [])
        || [...keys].some(key => user.permissions?.[key] !== previous.permissions?.[key])) {
      await openWorkspace(user);
    }
  } catch (error) {
    if (state.user === previous && error.status === 403) await resumeSession();
  } finally {
    checkingPermissions = false;
  }
}
window.setInterval(() => { if (!document.hidden) void checkCurrentPermissions(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkCurrentPermissions(); });
$('admin-refresh').addEventListener('click', () => void checkCurrentPermissions());
