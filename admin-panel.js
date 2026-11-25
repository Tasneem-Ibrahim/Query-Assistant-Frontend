// Account-scoped administration UI. All authorization remains on the backend.
export function createAdminPanel({ api, user, onError, sendUpload, onReady = () => {}, onApprovedUploads = () => {}, onViewPdf, confirmRemoveCard, knowledgeBases, workspaceAccount, onOpenBase, onManageUploads, managingUploads, addApprovalRequest, confirmApprovalDelete, onPage = () => {} }) {
  const isAdminAccount = () => ['admin', 'super_admin'].includes(user()?.role);
  const isSuper = () => user()?.role === 'super_admin';
  const can = key => user()?.role === 'user' && /^(accounts|approvals)\./.test(key)
    ? user()?.permissions?.[key] === true : user()?.permissions?.[key] !== false;
  const hasManagement = () => isAdminAccount() || (user() && (can('accounts.view') || can('approvals.view')));
  const pagePermissions = { 'knowledge-bases': 'bases.view', users: 'accounts.view', requests: 'approvals.view' };
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
  let generation = 0, timer, people = [], requests = [], selected = null, tab = 'overview', page = 'dashboard', filter = 'pending', busy = false;
  let own = { policy: 'approval_required', requests: [] };
  let message = '';
  let selectedFile = null, selectedDomain = '';
  const landing = !/\/(workspace|dashboard)\.html$/.test(location.pathname);
  const how = $('how-it-works');
  const footer = document.querySelector('#admin-app footer');
  const help = document.createElement('details'); help.id = 'dashboard-help';
  const helpTitle = el('summary', 'How it works'); help.append(helpTitle, how); footer.prepend(help);
  document.querySelectorAll('#admin-app .brand').forEach(n => { n.href = 'index.html'; });
  document.body.classList.toggle('landing-page', landing);
  document.body.classList.toggle('workspace-page', !landing);
  if (!landing) {
    document.querySelector('#admin-menu .admin-dropdown').prepend($('admin-refresh'));
    $('dashboard-page-title').textContent = 'Workspace';
    $('workspace-title').textContent = 'Documents & assistant';
  }
  const pages = ['users', 'requests', 'knowledge-bases'];
  const superPages = ['roles', 'permission-list', 'permissions', 'login-logs', 'revisions', 'workspace'];
  const workspacePages = ['workspace', 'knowledge-bases'];
  let activeRoute;
  const paths = { home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    'knowledge-bases': 'M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M7 11h10 M7 15h7',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M20 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
    requests: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 15l3 3 5-5',
    workspace: 'M3 5h18v14H3z M9 5v14 M12 9h5 M12 13h5',
    roles: 'M12 22s7-3 7-10V5l-7-3-7 3v7c0 7 7 10 7 10Z M9 12l2 2 4-4',
    'permission-list': 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
    permissions: 'M3 4h18v16H3z M3 9h18 M9 9v11 M15 9v11 M3 14h18',
    'login-logs': 'M5 4h10l4 4v12H5z M15 4v5h4 M8 12h8 M8 16h8',
    revisions: 'M3 12a9 9 0 1 1 2.6 6.4 M3 6v6h6 M12 7v5l3 2' };
  document.querySelectorAll('[data-admin-page], [data-super-page]').forEach(n => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[n.dataset.adminPage || n.dataset.superPage]); svg.append(path); n.prepend(svg);
  });
  const backdrop = document.createElement('button'); backdrop.className = 'dashboard-backdrop'; backdrop.hidden = true;
  backdrop.type = 'button'; backdrop.setAttribute('aria-label', 'Close navigation'); $('admin-app').append(backdrop);
  function closeNavigation(restoreFocus = false) {
    $('admin-sidebar').classList.remove('is-open'); backdrop.hidden = true;
    $('admin-menu-toggle').setAttribute('aria-expanded', 'false');
    if (restoreFocus) $('admin-menu-toggle').focus();
  }
  backdrop.addEventListener('click', () => closeNavigation(true));
  window.matchMedia('(min-width:1200px)').addEventListener('change', event => { if (event.matches) closeNavigation(); });
  function button(text, action) {
    const n = el('button', text, text === 'Approve file' ? 'button primary' : 'button secondary');
    if (text === 'Reject request') n.classList.add('decision-reject');
    n.type = 'button'; n.addEventListener('click', action); return n;
  }
  function reset() {
    generation++; clearInterval(timer); people = []; requests = []; selected = null; busy = false; message = ''; selectedFile = null; selectedDomain = '';
    own = { policy: 'approval_required', requests: [] };
    document.body.classList.remove('admin-layout');
    $('admin-sidebar').hidden = true; $('admin-overview').hidden = true; $('admin-content').hidden = true;
    $('user-upload-status').hidden = true; $('workspace').hidden = true;
    $('admin-content').replaceChildren(); $('user-upload-status').replaceChildren();
    $('knowledge-bases').hidden = true; $('knowledge-bases-link').hidden = true;
    $('knowledge-base-list').replaceChildren();
    $('admin-bell').hidden = true; $('admin-menu-toggle').hidden = true; $('admin-sync-status').textContent = '';
    $('admin-dashboard-entry').hidden = true; $('admin-sync').hidden = true;
    closeNavigation();
  }
  async function refresh(background = false) {
    const version = generation;
    try {
      const isAdmin = isAdminAccount();
      const canLoadAdmin = hasManagement() && (can('accounts.view') || can('approvals.view'));
      if (!hasManagement() && !can('documents.view')) return;
      const managed = canLoadAdmin ? await api('/admin/users') : { users: [], requests: [] };
      if (version !== generation) return;
      $('admin-sync-status').textContent = '';
      if (hasManagement()) {
        people = managed.users; requests = managed.requests;
        const count = requests.filter(r => r.status === 'pending').length;
        $('admin-pending').textContent = count; $('admin-bell').textContent = `Notifications (${count})`;
        $('admin-total-users').textContent = people.length; $('admin-total-pending').textContent = count;
        const hasDraft = Array.from($('admin-content').querySelectorAll('textarea, input[type="search"]')).some(n => n.value);
        if (['users', 'requests'].includes(page) && (!background || (!hasDraft && !$('admin-content').contains(document.activeElement)))) render();
        if (!landing && !managingUploads() && user()?.id !== 'local-admin' && !isSuper() && user()?.permissions?.['documents.view'] !== false) {
          const saved = await api('/upload-requests');
          if (version === generation) onApprovedUploads(saved.processing || []);
        }
      } else if (can('documents.view')) {
        const data = await api('/upload-requests');
        if (version !== generation) return;
        const readyDocuments = data.ready_documents || data.requests.filter(r => r.job_state === 'ready');
        const previousReady = own.ready_documents || own.requests.filter(r => r.job_state === 'ready');
        const becameReady = readyDocuments.some(r => !previousReady.some(old => old.domain === r.domain && old.file_hash === r.file_hash));
        const approved = data.requests.some(r => r.status === 'approved' && own.requests.find(old => old.id === r.id)?.status === 'pending');
        const failed = data.requests.find(r => r.job_state === 'failed' && own.requests.find(old => old.id === r.id)?.job_state !== 'failed');
        own = data;
        if (!landing) onApprovedUploads(data.processing || []);
        if (!background || !$('user-upload-status').contains(document.activeElement)) renderOwn();
        if (becameReady) onReady(readyDocuments);
        if (failed) onError(failed.job_message || 'Processing failed after the single retry. Contact the administrator.');
        else if (becameReady) onError('Your processed document is ready. You can now ask questions and search it.');
        else if (approved) onError('Your upload was approved. It will be processed automatically; no re-upload is needed.');
      }
    } catch (error) { if (version === generation) { if (isAdminAccount()) { $('admin-total-users').textContent = '—'; $('admin-total-pending').textContent = '—'; } $('admin-sync-status').textContent = error.message; onError(error.message); } }
  }
  async function change(path, body) {
    if (busy) return;
    busy = true;
    const version = generation;
    try { await api(path, body, 'PUT'); if (version === generation) await refresh(); }
    catch (error) { if (version === generation) { $('admin-sync-status').textContent = error.message; onError(error.message); } }
    finally { if (version === generation) busy = false; }
  }
  function navigate(next, { message: knowledgeBaseMessage, historyMode = 'push' } = {}) {
    if ((managingUploads() && next !== 'workspace') || (workspaceAccount() && !workspacePages.includes(next))) {
      void onManageUploads(null, $('admin-sync-status'), next, historyMode);
      return;
    }
    if (pagePermissions[next] && !can(pagePermissions[next])) next = isAdminAccount() ? 'dashboard' : 'workspace';
    if (next === 'home' && !landing) { location.assign('index.html'); return; }
    if (next === 'workspace' && landing) { location.assign('workspace.html'); return; }
    if (next !== 'home' && landing) { location.assign(`dashboard.html${next === 'dashboard' ? '' : '#' + next}`); return; }
    page = next; selected = null; tab = 'overview';
    const browsing = next === 'knowledge-bases';
    const isAdmin = hasManagement();
    if (!landing) {
      const path = ['workspace', 'dashboard'].includes(next)
        ? new URL(next + '.html', location.href).pathname : location.pathname;
      const hash = next !== 'workspace' && [...pages, ...(isSuper() ? superPages : [])].includes(next) ? '#' + next : '';
      const account = workspacePages.includes(next) ? workspaceAccount() : null;
      const previous = activeRoute;
      const changed = previous?.page !== next || previous?.account?.id !== account?.id;
      const push = historyMode === 'push' && previous && changed;
      activeRoute = { page: next, account, owner: user()?.id,
        position: push ? previous.position + 1 : (history.state?.queryAssistantRoute?.position ?? 0) };
      if (historyMode !== 'restore') {
        history[push ? 'pushState' : 'replaceState']({ queryAssistantRoute: activeRoute }, '', path + location.search + hash);
      }
    }
    $('dashboard-page-title').textContent = ({ dashboard: 'Dashboard', users: 'Users', requests: 'Upload requests', 'knowledge-bases': 'Knowledge Bases', roles: 'Role Management', 'permission-list': 'Permissions List', permissions: 'Permission Matrix', 'login-logs': 'Logs Management', revisions: 'Revision' })[next] || 'Workspace';
    const home = next === 'home';
    document.body.classList.toggle('admin-layout', isAdmin && !home);
    $('admin-sidebar').hidden = !isAdmin || home; $('admin-menu-toggle').hidden = !isAdmin || home;
    $('admin-dashboard-entry').hidden = !home; $('admin-sync').hidden = home || browsing;
    $('admin-bell').hidden = !isAdmin || home || !can('approvals.view');
    $('workspace').hidden = next !== 'workspace' && (next !== 'dashboard' || isSuper());
    $('super-workspace-scope').hidden = !(isSuper() || managingUploads())
      || next !== 'workspace' || !$('super-workspace-scope').textContent;
    document.querySelectorAll('[data-super-page]').forEach(button => {
      button.hidden = !isSuper();
      button.setAttribute('aria-current', button.dataset.superPage === next ? 'page' : 'false');
    });
    $('super-settings-label').hidden = !isSuper();
    onPage(next);
    $('admin-overview').hidden = next !== 'dashboard' || user()?.role !== 'admin';
    $('admin-content').hidden = !['users', 'requests'].includes(next);
    $('knowledge-bases').hidden = !browsing;
    const browseLink = $('knowledge-bases-link');
    browseLink.hidden = isAdmin || landing || !can('bases.view');
    browseLink.href = browsing ? 'workspace.html' : '#knowledge-bases';
    browseLink.textContent = browsing ? 'Workspace' : 'Knowledge Bases';
    document.querySelectorAll('[data-admin-page]').forEach(n => {
      const permission = pagePermissions[n.dataset.adminPage];
      n.hidden = Boolean(permission && !can(permission));
      n.setAttribute('aria-current', n.dataset.adminPage === next ? 'page' : 'false');
    });
    closeNavigation();
    if (browsing) {
      renderKnowledgeBases(knowledgeBaseMessage);
      $('knowledge-bases-title').focus({ preventScroll: true });
    }
    if (['users', 'requests'].includes(next)) render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  async function restoreRoute(route, fallback, historyMode) {
    const previous = activeRoute;
    const allowedPages = isSuper() ? ['dashboard', ...pages, ...superPages]
      : hasManagement() ? ['dashboard', 'workspace', ...pages] : workspacePages;
    const validRoute = route?.owner === user()?.id && allowedPages.includes(route?.page);
    const next = validRoute ? route.page : fallback;
    const account = validRoute && workspacePages.includes(next)
      && (isSuper() || (isAdminAccount() && next === 'workspace')) ? route.account : null;
    if (workspaceAccount()?.id !== account?.id) {
      const switched = await onManageUploads(account, $('admin-sync-status'), next, historyMode);
      if (switched === false && historyMode === 'restore' && previous && route.position !== previous.position) {
        history.go(previous.position - route.position);
      }
    } else {
      navigate(next, { historyMode });
    }
  }
  window.addEventListener('popstate', event => {
    const route = event.state?.queryAssistantRoute;
    if (!landing && user() && route?.owner === user().id) void restoreRoute(route, 'workspace', 'restore');
  });
  async function loadBaseDocuments(domain, details, list, count, requestsForView) {
    list.replaceChildren(el('p', 'Loading documents…'));
    try {
      const [status, uploadRequests] = await Promise.all([
        api(`/domains/${encodeURIComponent(domain.key)}/status`), requestsForView,
      ]);
      if (!details.isConnected || page !== 'knowledge-bases') return;
      const files = new Map();
      for (const [hash, file] of Object.entries(status.pending_files || {})) {
        files.set(hash, { filename: file.name, status: 'Processing incomplete' });
      }
      for (const [hash, file] of Object.entries(status.files || {})) {
        files.set(hash, { filename: file.name, status: 'Ready' });
      }
      for (const request of uploadRequests ?? own.requests) {
        if (request.domain !== domain.key || files.get(request.file_hash)?.status === 'Ready') continue;
        if (request.status === 'pending') files.set(request.file_hash || request.id, { filename: request.filename, status: 'Awaiting approval' });
        if (request.status === 'approved' && ['queued', 'processing', 'retrying', 'failed'].includes(request.job_state)) {
          files.set(request.file_hash, { filename: request.filename, status: request.job_state === 'failed' ? 'Failed' : 'Processing' });
        }
      }
      const pdfs = [...files].filter(([, file]) => /\.pdf$/i.test(file.filename));
      count.textContent = `${pdfs.length} ${pdfs.length === 1 ? 'PDF' : 'PDFs'}`;
      list.replaceChildren();
      if (!pdfs.length) list.append(el('p', 'No PDFs in this knowledge base.'));
      for (const [hash, file] of pdfs) {
        const row = el('div', '', 'knowledge-base-pdf');
        const badge = { Ready: 'approved', 'Awaiting approval': 'pending', Failed: 'rejected' }[file.status] || 'processing-status';
        row.append(el('strong', file.filename), el('span', file.status, `approval-badge ${badge}`));
        if (file.status === 'Ready') row.append(button('View PDF', () => onViewPdf({ domain: domain.key, file_hash: hash, filename: file.filename })));
        list.append(row);
      }
    } catch {
      if (details.isConnected && page === 'knowledge-bases') list.replaceChildren(el('p', 'Could not load PDFs. Close and reopen this knowledge base to retry.'));
    }
  }
  function renderKnowledgeBases(message) {
    if (page !== 'knowledge-bases') return;
    const root = $('knowledge-base-list');
    const domains = knowledgeBases();
    const account = isSuper() ? workspaceAccount() : null;
    const loadCards = [];
    $('knowledge-bases-description').textContent = account
      ? `Knowledge bases and documents for ${account.name || account.email}`
      : 'Browse your knowledge bases and their documents.';
    root.replaceChildren();
    if (message) {
      root.append(el('p', message));
      return;
    }
    if (!domains.length) root.append(el('p', account ? 'This account has no knowledge bases.' : 'No knowledge bases to show. Create one in Workspace.'));
    const requestsForView = account && domains.length
      ? api('/upload-requests').then(data => data.requests || []).catch(() => [])
      : null;
    for (const domain of domains) {
      const card = el('article', '', 'panel knowledge-base-card');
      const details = el('details', '');
      const summary = el('summary', '');
      const icon = el('span', '▤', 'knowledge-base-icon');
      icon.setAttribute('aria-hidden', 'true');
      const count = el('span', '', 'knowledge-base-count');
      count.hidden = true;
      const top = el('span', '', 'knowledge-base-card-top');
      top.append(icon, count);
      const title = el('strong', domain.label, 'knowledge-base-name');
      const browse = el('span', 'View documents', 'knowledge-base-browse');
      const arrow = el('span', '›');
      arrow.setAttribute('aria-hidden', 'true');
      browse.append(arrow);
      summary.append(top, title, browse);
      const list = el('div', '', 'knowledge-base-pdfs');
      list.setAttribute('aria-live', 'polite');
      details.append(summary, list);
      let loading = false;
      const load = async () => {
        if (loading || !card.isConnected || page !== 'knowledge-bases') return;
        loading = true;
        await loadBaseDocuments(domain, details, list, count, requestsForView);
        loading = false;
        count.hidden = !count.textContent;
      };
      loadCards.push(load);
      details.addEventListener('toggle', () => { if (details.open) void load(); });
      const open = button('Open in Workspace', async () => {
        const version = generation;
        const opened = await onOpenBase(domain.key);
        if (version !== generation || !card.isConnected || page !== 'knowledge-bases') return;
        if (!opened) return;
        navigate('workspace');
        $('workspace').scrollIntoView({ block: 'start' });
        $('domain').focus({ preventScroll: true });
      });
      open.classList.add('open-workspace-action');
      card.append(details, open);
      root.append(card);
    }
    void loadKnowledgeBaseCards(loadCards);
  }
  async function loadKnowledgeBaseCards(cards) {
    for (let index = 0; index < cards.length; index += 4) {
      await Promise.all(cards.slice(index, index + 4).map(load => load()));
    }
  }
  const date = value => value ? new Date(value).toLocaleString() : '—';
  async function removeCard(row) {
    if (busy) return;
    const version = generation;
    if (!(await confirmRemoveCard?.(row)) || version !== generation) return;
    busy = true;
    try {
      await api(`/upload-requests/${encodeURIComponent(row.id)}`, {}, 'DELETE');
      if (version !== generation) return;
      await refresh(); onError('Upload card removed. Your PDF and admin record remain saved.');
    } catch (error) { if (version === generation) onError(error.message); }
    finally { if (version === generation) busy = false; }
  }
  function deleteCardButton(row) {
    const remove = button('', () => removeCard(row)); remove.className = 'upload-card-delete';
    remove.setAttribute('aria-label', `Delete upload card for ${row.filename}`); remove.title = 'Delete card';
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('fill','none'); svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','1.6'); svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round'); svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d','M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6');
    svg.append(path); remove.append(svg); return remove;
  }
  function requestCard(r, decisions) {
    const card = el('article', '', 'request-card');
    if (!decisions && !isAdminAccount()) { card.classList.add('user-upload-card'); card.append(deleteCardButton(r)); }
    const person = people.find(p => p.id === r.user_id);
    const active = r.status === 'approved' && ['queued','processing','retrying'].includes(r.job_state);
    if (!decisions && !isAdminAccount() && r.status === 'approved') {
      card.append(el('h3', r.filename), el('span', 'Approved', 'approval-badge approved'));
      const base = el('p', '', 'request-user-details');
      base.append(el('strong', 'Knowledge base: ', 'request-detail-label'), document.createTextNode(r.domain_label)); card.append(base);
      const metadata = el('p', '', 'request-file-details');
      metadata.append(el('strong', 'Pages: ', 'request-detail-label'), document.createTextNode(`${r.pages || 'not recorded'} · `),
        el('strong', 'Size: ', 'request-detail-label'), document.createTextNode(`${(r.size / 1048576).toFixed(2)} MB (${Number(r.size).toLocaleString()} bytes)`));
      card.append(metadata);
      if (r.reason) {
        const note = el('p', '', 'request-message');
        note.append(el('strong', 'Admin message: ', 'request-detail-label'), document.createTextNode(r.reason)); card.append(note);
      }
      if (active) card.append(el('span', 'Processing', 'approval-badge processing-status'));
      if (r.job_state === 'failed') card.append(el('span', 'Failed', 'approval-badge rejected'));
      if (r.file_ready === false) card.append(el('p', 'Select the original file once to finish saving this older request.'));
      const actions = el('div', '', 'admin-actions');
      if (/\.pdf$/i.test(r.filename)) {
        const view = button('View PDF', () => onViewPdf?.(r));
        view.disabled = r.job_state !== 'ready';
        view.title = view.disabled ? 'Available when processing finishes.' : `View ${r.filename}`;
        actions.append(view);
      }
      if (actions.childElementCount) card.append(actions);
      return card;
    }
    const label = r.status === 'pending' ? 'Pending approval' : active ? 'Processing' : r.status === 'approved' && ['ready','failed'].includes(r.job_state) ? r.job_state : r.status;
    const badge = active ? 'processing-status' : label === 'ready' ? 'approved' : label === 'failed' ? 'rejected' : r.status;
    card.append(el('h3', r.filename), el('span', label, `approval-badge ${badge}`),
      el('p', person ? `${person.name} · ${person.email}` : r.user_id === user()?.id ? 'Your upload' : '', 'request-user-details request-user-identity'),
      el('p', '', 'request-file-details'),
      el('p', `Requested ${date(r.created_at)}`));
    card.querySelector('.request-file-details').append(el('strong', 'Pages: ', 'request-detail-label'),
      document.createTextNode(`${r.pages || 'not recorded'} · ${(r.size / 1048576).toFixed(2)} MB (${Number(r.size).toLocaleString()} bytes)`));
    const base = el('p', '', 'request-user-details');
    base.append(el('strong', 'Knowledge base: ', 'request-detail-label'), document.createTextNode(r.domain_label));
    card.insertBefore(base, card.querySelector('.request-file-details'));
    if (r.user_deleted_at) card.append(el('p', `User deleted this card on ${date(r.user_deleted_at)}. Admin record retained.`, 'request-deleted-note'));
    if (r.message) {
      const note = el('p', '', 'request-message'); note.append(el('strong', 'Message: ', 'request-detail-label'),document.createTextNode(r.message)); card.append(note);
    }
    if (r.decided_at) card.append(el('p', `Decision ${date(r.decided_at)}`));
    if (r.reason) card.append(el('p', `Reason: ${r.reason}`));
    if (r.status === 'rejected') card.append(el('p', 'Your upload request was rejected by the administrator. This file will not be processed.'));
    if (r.status === 'approved') card.append(el('p', r.file_ready ? 'Your upload is approved. No re-upload is needed.' : 'Approval granted. Select the original file once to save it for automatic processing.'));
    if (r.job_message && (r.status === 'expired' || ['ready','failed','retrying'].includes(r.job_state))) card.append(el('p', r.job_message));
    if (r.file_ready === false && r.status === 'pending') card.append(el('p', 'The saved file is not available yet. Select the file once to finish uploading.'));
    if (decisions && can('approvals.edit') && r.status === 'pending' && (isAdminAccount() || r.user_id !== user()?.id)) {
      const reason = document.createElement('textarea'); reason.placeholder = 'Reason (optional)'; reason.maxLength = 500;
      reason.setAttribute('aria-label', `Decision reason for ${r.filename}`);
      const actions = el('div', '', 'admin-actions');
      const approve = button('Approve file', () => change(`/admin/upload-requests/${r.id}`, { status: 'approved', reason: reason.value }));
      const reject = button('Reject request', () => change(`/admin/upload-requests/${r.id}`, { status: 'rejected', reason: reason.value }));
      approve.disabled = reject.disabled = r.decision_ready === false;
      actions.append(approve, reject);
      if (r.decision_ready === false) card.append(el('p', 'The file upload is incomplete. Approval actions will become available after the user finishes uploading.'));
      card.append(reason, actions);
    }
    if (decisions && (isSuper() || user()?.permissions?.['approvals.delete'] === true)) {
      const remove = button('Delete request', async () => {
        if (!await confirmApprovalDelete(r)) return;
        remove.disabled = true;
        try {
          await api('/admin/upload-requests/' + encodeURIComponent(r.id), undefined, 'DELETE');
          await refresh();
        } catch (error) { onError(error.message); }
        finally { remove.disabled = false; }
      });
      remove.classList.add('decision-reject');
      card.append(remove);
    }
    return card;
  }

  function approvalForm(person) {
    const details = el('details', '', 'super-role-status');
    details.append(el('summary', 'Add approval request'));
    const form = el('form', '', 'super-admin-form');
    const select = document.createElement('select');
    select.name = 'domain'; select.required = true;
    const file = document.createElement('input');
    file.name = 'file'; file.type = 'file'; file.required = true;
    file.accept = '.pdf,.jpg,.jpeg,.png,.jfif,.webp,.bmp,.tif,.tiff,.avif';
    const submit = el('button', 'Add request', 'button primary');
    submit.disabled = true;
    const feedback = el('p', '', '');
    feedback.setAttribute('role', 'status');
    for (const [caption, control] of [['Knowledge base', select], ['PDF or image', file]]) {
      const label = el('label', caption);
      label.append(control);
      form.append(label);
    }
    form.append(submit);
    details.append(form, feedback);
    details.addEventListener('toggle', async () => {
      if (!details.open || select.options.length) return;
      feedback.textContent = 'Loading knowledge bases…';
      try {
        const bases = await api('/admin/upload-requests/for/' + encodeURIComponent(person.id));
        if (!details.isConnected) return;
        select.replaceChildren(...bases.map(base => new Option(base.label, base.key)));
        submit.disabled = !bases.length;
        feedback.textContent = bases.length ? '' : 'This user has no knowledge bases.';
      } catch (error) { feedback.textContent = error.message; }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        await addApprovalRequest(person.id, new FormData(form));
        await refresh();
      } catch (error) { feedback.textContent = error.message; }
      finally { submit.disabled = false; }
    });
    return details;
  }
  function activityTags(counts, statuses) {
    const row = el('div', '', 'activity-tags');
    for (const [key, label, style] of statuses) {
      if (counts[key]) row.append(el('span', `${label} · ${counts[key]}`, `approval-badge ${style}`));
    }
    return row;
  }
  async function renderActivity(person, panel) {
    panel.append(el('p', 'Loading knowledge base activity…'));
    try {
      const { knowledge_bases: bases } = await api(`/admin/users/${encodeURIComponent(person.id)}/activity`);
      if (!panel.isConnected) return;
      panel.replaceChildren(el('h3', `Knowledge Bases (${bases.length})`));
      if (!bases.length) panel.append(el('p', 'This user has no knowledge bases.'));
      for (const base of bases) {
        const card = el('article', '', 'activity-base');
        card.append(el('h4', base.name), el('p', `${base.pdfs} ${base.pdfs === 1 ? 'PDF' : 'PDFs'} · ${base.images} ${base.images === 1 ? 'image' : 'images'}`));
        const approvals = activityTags(base.approvals, [
          ['approved', 'Approved', 'approved'], ['pending', 'Awaiting approval', 'pending'],
          ['rejected', 'Rejected', 'rejected'], ['expired', 'Expired', ''],
        ]);
        const processing = activityTags(base.processing, [
          ['ready', 'Ready', 'approved'], ['queued', 'Queued', 'processing-status'],
          ['processing', 'Processing', 'processing-status'], ['retrying', 'Retrying', 'processing-status'],
          ['pending', 'Incomplete', 'pending'], ['failed', 'Failed', 'rejected'],
        ]);
        if (approvals.childElementCount) card.append(el('span', 'Upload requests', 'activity-tag-label'), approvals);
        if (processing.childElementCount) card.append(el('span', 'Document processing', 'activity-tag-label'), processing);
        panel.append(card);
      }
    } catch (error) {
      if (panel.isConnected) panel.replaceChildren(el('p', error.message));
    }
  }
  function render() {
    const root = $('admin-content'); root.replaceChildren();
    if (selected) {
      const person = people.find(p => p.id === selected);
      if (!person) { selected = null; render(); return; }
      root.append(button('← All users', () => { selected = null; render(); }), el('h2', person.name || person.email));
      if (user()?.role === 'admin' && user()?.permissions?.['user_uploads.view'] === true && can('bases.view')) {
        root.append(button('Manage uploads', () => onManageUploads(person, $('admin-sync-status'))));
      }
      const tabs = el('div', '', 'admin-actions');
      const visibleTabs = ['overview'];
      if (can('approvals.view')) {
        if (isAdminAccount()) visibleTabs.push('permissions');
        visibleTabs.push('upload requests');
        if (isAdminAccount() && can('bases.view') && can('documents.view')) visibleTabs.push('activity');
      }
      if (!visibleTabs.includes(tab)) tab = 'overview';
      for (const name of visibleTabs) {
        const b = button(name, () => { tab = name; render(); }); b.setAttribute('aria-pressed', String(tab === name)); tabs.append(b);
      }
      root.append(tabs);
      if (tab === 'overview') {
        const details = el('dl', '', 'user-details');
        const fields = [['Name', person.name], ['Email', person.email], ['User ID', person.id], ['Joined', date(person.created_at)]];
        if (can('approvals.view')) fields.push(['Upload policy', person.policy.replaceAll('_', ' ')], ['Pending requests', person.pending]);
        for (const [label, value] of fields) {
          details.append(el('dt', label), el('dd', String(value ?? '—')));
        }
        root.append(details);
      } else if (tab === 'permissions') {
        root.append(el('p', 'Choose whether this user needs approval for each file. Approving one request does not change this policy.'));
        const label = el('label', 'Upload permission'); label.htmlFor = 'user-upload-policy';
        const select = document.createElement('select'); select.id = 'user-upload-policy';
        for (const [value, text] of [['approval_required', 'Approval required'], ['allowed', 'Upload allowed'], ['blocked', 'Upload blocked']]) {
          const option = el('option', text); option.value = value; select.append(option);
        }
        select.value = person.policy;
        select.disabled = !can('approvals.edit');
        root.append(label, select);
        if (can('approvals.edit')) root.append(button('Save permission', () => change(`/admin/users/${person.id}/permissions`, { policy: select.value })));
      } else if (tab === 'activity') {
        const panel = el('section', '', 'user-activity');
        panel.setAttribute('aria-label', 'Knowledge base activity');
        panel.setAttribute('aria-live', 'polite');
        root.append(panel);
        void renderActivity(person, panel);
      } else {
        const items = requests.filter(r => r.user_id === selected);
        if (isSuper() || user()?.permissions?.['approvals.add'] === true) root.append(approvalForm(person));
        if (!items.length) root.append(el('p', 'No upload requests yet.'));
        items.forEach(r => root.append(requestCard(r, true)));
      }
    } else if (page === 'users') {
      root.append(el('h2', 'Users'), el('p', 'View account details and manage uploads with your assigned permissions.'));
      const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search by name or email'; search.setAttribute('aria-label', 'Search users');
      const list = el('div', '', 'admin-user-list');
      const draw = () => {
        list.replaceChildren(); const query = search.value.toLowerCase();
        const matches = people.filter(p => `${p.name} ${p.email}`.toLowerCase().includes(query));
        if (!matches.length) list.append(el('p', 'No users found.'));
        matches.forEach(p => {
          const row = button('', () => { selected = p.id; render(); }); row.className = 'user-row';
          row.append(el('strong', p.name || 'User'), el('span', p.email), el('span', p.policy.replaceAll('_', ' ')), el('span', `${p.pending} pending →`)); list.append(row);
        });
      };
      const headings = el('div', '', 'user-list-heading');
      for (const name of ['Name', 'Email', 'Upload policy', 'Requests']) headings.append(el('span', name));
      search.addEventListener('input', draw); root.append(search, headings, list); draw();
    } else {
      root.append(el('h2', 'Upload requests'), el('p', 'Review file details before allowing processing in the user’s private workspace.'));
      const tabs = el('div', '', 'admin-actions');
      for (const status of ['pending', 'approved', 'rejected', 'expired', 'all']) {
        const b = button(status, () => { filter = status; render(); }); b.setAttribute('aria-pressed', String(filter === status)); tabs.append(b);
      }
      root.append(tabs);
      const items = requests.filter(r => filter === 'all' || r.status === filter);
      if (!items.length) root.append(el('p', 'No requests in this view.'));
      items.forEach(r => root.append(requestCard(r, true)));
    }
  }
  function renderOwn() {
    const root = $('user-upload-status'); root.hidden = false; root.replaceChildren();
    root.append(el('h3', 'Your upload permissions'), el('p', own.policy === 'blocked' ? 'Uploads are blocked. Contact your administrator.' : own.policy === 'allowed' ? 'Upload once. Your saved file will process automatically.' : 'Upload your file once. After admin approval, processing starts automatically.'));
    if (own.policy === 'approval_required' && selectedFile) {
      const label = el('label', 'Message to admin (optional)'); label.htmlFor = 'upload-request-message';
      const input = document.createElement('textarea'); input.id = 'upload-request-message'; input.maxLength = 500; input.rows = 2;
      input.disabled = $('upload').disabled;
      input.placeholder = 'Why would you like to upload this file?'; input.value = message;
      const help = el('p', `For ${selectedFile.name}. This note is sent with Upload & process. Enter adds a new line; Ctrl+Enter submits the file and note.`, 'upload-note-help'); help.id = 'upload-note-help';
      input.setAttribute('aria-describedby','upload-note-help');
      input.addEventListener('input', () => { message = input.value; });
      input.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); if (!$('upload').disabled) $('upload').click(); } });
      root.append(label, input, help);
    }
    const details = document.createElement('details'); details.open = own.requests.length > 0; details.append(el('summary', `Your requests (${own.requests.length})`));
    if (!own.requests.length) details.append(el('p', 'No uploads yet. Select a file and use Upload & process to save it and request approval.'));
    own.requests.forEach(r => details.append(requestCard(r, false))); root.append(details);
  }
  async function prepare(file, domain, useLlm = true) {
    if (isAdminAccount()) return true;
    const version = generation;
    const data = new FormData(); data.append('domain',domain); data.append('file',file);
    data.append('message',message); data.append('use_llm',useLlm);
    let row;
    for (let attempt = 0; attempt < 2; attempt++) {
      try { row = await sendUpload(data); break; }
      catch (error) {
        if (version !== generation) return false;
        if (attempt === 1) throw new Error(`Upload failed after one retry. ${error.message}`);
        if (error.status && error.status < 500) throw error;
        onError('Upload failed. Retrying once using the same selected file…');
      }
    }
    if (version !== generation) return false;
    message = '';
    selectedFile = null;
    await refresh();
    return row;
  }
  async function start(onRouteReady) {
    const version = generation;
    const isAdmin = hasManagement();
    document.body.classList.toggle('admin-layout', isAdmin);
    $('admin-sidebar').hidden = !isAdmin; $('admin-bell').hidden = !isAdmin; $('admin-menu-toggle').hidden = !isAdmin;
    const requestedPage = location.hash.slice(1);
    if (isAdmin) {
      const defaultPage = user()?.role === 'user' || location.pathname.endsWith('/workspace.html') ? 'workspace' : 'dashboard';
      const allowedPages = [...pages, ...(isSuper() ? superPages : [])];
      await restoreRoute(history.state?.queryAssistantRoute, landing ? 'home' : allowedPages.includes(requestedPage) ? requestedPage : defaultPage, 'replace');
    }
    else if (!landing) await restoreRoute(history.state?.queryAssistantRoute, requestedPage === 'knowledge-bases' ? requestedPage : 'workspace', 'replace');
    if (version !== generation) return;
    $('admin-dashboard-entry').textContent = 'Dashboard';
    $('admin-dashboard-entry').href = isAdmin ? 'dashboard.html' : 'workspace.html';
    $('admin-dashboard-entry').hidden = !landing;
    onRouteReady();
    if (page === 'knowledge-bases') $('knowledge-bases-title').focus({ preventScroll: true });
    await refresh(); if (version === generation) timer = setInterval(() => refresh(true), 30000);
  }
  document.querySelectorAll('[data-admin-page]').forEach(n => n.addEventListener('click', () => navigate(n.dataset.adminPage)));
  document.querySelectorAll('[data-super-page]').forEach(n => n.addEventListener('click', () => navigate(n.dataset.superPage)));
  $('knowledge-bases-link').addEventListener('click', event => {
    event.preventDefault();
    navigate(page === 'knowledge-bases' ? 'workspace' : 'knowledge-bases');
  });
  $('admin-bell').addEventListener('click', () => navigate('requests'));
  $('admin-menu-toggle').addEventListener('click', () => {
    if ($('admin-sidebar').classList.contains('is-open')) { closeNavigation(true); return; }
    $('admin-sidebar').classList.add('is-open'); backdrop.hidden = false; $('admin-menu-toggle').setAttribute('aria-expanded', 'true');
    $('admin-sidebar').querySelector('button').focus();
  });
  $('admin-refresh').addEventListener('click', () => refresh());
  document.addEventListener('keydown', event => {
    if (backdrop.hidden) return;
    if (event.key === 'Escape') { closeNavigation(true); return; }
    if (event.key === 'Tab') {
      const items = [...$('admin-sidebar').querySelectorAll('a[href], button:not([hidden])')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  function fileChanged(file, domain) {
    if (file !== selectedFile || domain !== selectedDomain) message = '';
    selectedFile = file; selectedDomain = domain;
    if (user() && !isAdminAccount()) renderOwn();
  }
  return { start, reset, prepare, fileChanged, refresh, navigate, renderKnowledgeBases };
}
