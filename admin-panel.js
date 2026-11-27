// Account-scoped administration UI. All authorization remains on the backend.
export function createAdminPanel({ api, user, onError, sendUpload, onReady = () => {}, onApprovedUploads = () => {}, onViewPdf, onViewDocument, confirmRemoveCard, knowledgeBases, workspaceAccount, onOpenBase, onManageUploads, managingUploads, addApprovalRequest, confirmApprovalDelete, onPage = () => {} }) {
  const isAdminAccount = () => ['admin', 'super_admin'].includes(user()?.role);
  const isSuper = () => user()?.role === 'super_admin';
  const can = key => user()?.role === 'user' && /^(accounts|approvals)\./.test(key)
    ? user()?.permissions?.[key] === true : user()?.permissions?.[key] !== false;
  const hasManagement = () => isAdminAccount() || (user() && (can('accounts.view') || can('approvals.view')
    || Object.keys(superPermissions).some(showSuperPage)));
  const pagePermissions = { 'user-details-add': 'accounts.add', workspace: 'bases.view', 'knowledge-bases': 'bases.view', users: 'accounts.view', requests: 'approvals.view' };
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
  let generation = 0, timer, people = [], requests = [], selected = null, tab = 'overview', page = 'dashboard', filter = 'pending', busy = false;
  let own = { policy: 'approval_required', requests: [] };
  let refreshId = 0, activeRefresh = null, lastRefresh = 0, renderedOwn, renderedAdmin;
  let message = '';
  let selectedFile = null, selectedDomain = '';
  let landing = !/\/(workspace|dashboard)\.html$/.test(location.pathname);
  const how = $('how-it-works');
  const footer = document.querySelector('#admin-app footer');
  const help = document.createElement('details'); help.id = 'dashboard-help';
  const helpTitle = el('summary', 'How it works'); help.append(helpTitle, how); footer.prepend(help);
  document.querySelectorAll('#admin-app .brand').forEach(n => { n.href = 'index.html'; });
  const refreshButton = $('admin-refresh');
  const adminDropdown = document.querySelector('#admin-menu .admin-dropdown');
  function applyLayout() {
    document.body.classList.toggle('landing-page', landing);
    document.body.classList.toggle('workspace-page', !landing);
    (landing ? $('admin-sync') : adminDropdown).prepend(refreshButton);
  }
  applyLayout();
  const pages = ['users', 'requests', 'knowledge-bases', 'user-details-add', 'my-account'];
  const superPages = ['roles', 'permission-list', 'permissions', 'user-uploads', 'login-logs', 'revisions', 'workspace'];
  const superPermissions = { roles: 'roles.view', 'user-uploads': 'user_uploads.view', 'permission-list': 'permissions.view', permissions: 'permissions.view',
    'login-logs': 'logs.view', revisions: 'revisions.view' };
  const canAddUser = () => isSuper() || (user()?.permissions?.['accounts.view'] === true
    && user()?.permissions?.['accounts.add'] === true && user()?.account_scope?.includes('role:user'));
  const showSuperPage = page => isSuper() || (Object.hasOwn(superPermissions, page)
    && user()?.permissions?.[superPermissions[page]] === true);
  const scoped = person => isSuper() || (person.id !== user()?.id && (
    user()?.account_scope?.includes(person.id) || user()?.account_scope?.includes('role:' + (person.role || 'user'))));
  const workspacePages = ['workspace', 'knowledge-bases'];
  const canVisit = destination => {
    if (destination === 'user-details-add') return canAddUser();
    const regular = user()?.role === 'user';
    if (destination === 'my-account') return regular;
    if (destination === 'dashboard') return !regular;
    if (superPages.includes(destination) && destination !== 'workspace') return showSuperPage(destination);
    const permission = pagePermissions[destination];
    if (!permission) return destination === 'home';
    return regular && user()?.permissions ? user().permissions[permission] === true : can(permission);
  };
  const defaultRoute = () => user()?.role === 'user'
    ? (['workspace', 'users', 'requests', ...Object.keys(superPermissions)].find(canVisit) || 'home') : 'dashboard';

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
    'user-uploads': 'M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5',
    'login-logs': 'M5 4h10l4 4v12H5z M15 4v5h4 M8 12h8 M8 16h8',
    revisions: 'M3 12a9 9 0 1 1 2.6 6.4 M3 6v6h6 M12 7v5l3 2' };
  const allUsersToggle = $('all-users-toggle');
  const allUsersLinks = $('all-users-links');
  const userWorkspaceLinks = [...allUsersLinks.querySelectorAll('[data-user-workspace-page]')];
  function setAllUsersOpen(open) {
    allUsersToggle.setAttribute('aria-expanded', String(open));
    allUsersLinks.hidden = !open;
  }
  allUsersToggle.addEventListener('click', () => setAllUsersOpen(allUsersLinks.hidden));
  document.querySelectorAll('[data-admin-page], [data-super-page], [data-user-workspace-page], #all-users-toggle').forEach(n => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[n.dataset.adminPage || n.dataset.superPage || n.dataset.userWorkspacePage || 'users']); svg.append(path); n.prepend(svg);
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
    activeRefresh = null;
    lastRefresh = 0;
    renderedOwn = undefined;
    renderedAdmin = undefined;
    document.body.classList.remove('admin-layout');
    $('admin-sidebar').hidden = true; $('admin-overview').hidden = true; $('admin-content').hidden = true;
    $('user-upload-status').hidden = true; $('workspace').hidden = true;
    $('admin-content').replaceChildren(); $('user-upload-status').replaceChildren();
    $('knowledge-bases').hidden = true; $('knowledge-bases-link').hidden = true;
    $('my-account').hidden = true; $('my-account-link').hidden = true;
    $('admin-menu').open = false;
    $('knowledge-base-list').replaceChildren();
    $('admin-bell').hidden = true; $('admin-menu-toggle').hidden = true; $('admin-sync-status').textContent = '';
    $('admin-dashboard-entry').hidden = true; $('admin-sync').hidden = true;
    setAllUsersOpen(false);
    closeNavigation();
  }
  async function refresh(background = false) {
    if (background && activeRefresh !== null) return;
    const version = generation;
    const id = ++refreshId;
    const current = () => version === generation && id === refreshId;
    activeRefresh = id;
    lastRefresh = Date.now();
    try {
      const isAdmin = isAdminAccount();
      const canLoadAdmin = hasManagement() && (can('accounts.view') || can('approvals.view'));
      if (!hasManagement() && !can('documents.view')) return;
      const managed = canLoadAdmin ? await api('/admin/users') : { users: [], requests: [] };
      if (!current()) return;
      $('admin-sync-status').textContent = '';
      if (hasManagement()) {
        people = managed.users; requests = managed.requests;
        const count = requests.filter(r => r.status === 'pending').length;
        $('admin-pending').textContent = count; $('admin-bell').textContent = `Notifications (${count})`;
        $('admin-total-users').textContent = people.length; $('admin-total-pending').textContent = count;
        const hasDraft = Array.from($('admin-content').querySelectorAll('textarea, input[type="search"]')).some(n => n.value);
        const active = document.activeElement;
        const activeFilter = page === 'requests' && active?.hasAttribute('aria-pressed')
          && active.parentElement === $('admin-content').querySelector('.admin-actions') ? active.textContent : null;
        const mayRender = !hasDraft && (activeFilter || !$('admin-content').contains(active));
        if (['users', 'requests'].includes(page) && (!background || (mayRender && adminView() !== renderedAdmin))) {
          render();
          if (activeFilter) [...$('admin-content').querySelectorAll('.admin-actions button[aria-pressed]')]
            .find(button => button.textContent === activeFilter)?.focus({ preventScroll: true });
        }
        if (!landing && !managingUploads() && user()?.id !== 'local-admin' && !isSuper() && user()?.permissions?.['documents.view'] !== false) {
          const saved = await api('/upload-requests');
          if (current()) onApprovedUploads(saved.processing || []);
        }
      } else if (can('documents.view')) {
        const data = await api('/upload-requests');
        if (!current()) return;
        const readyDocuments = data.ready_documents || data.requests.filter(r => r.job_state === 'ready');
        const previousReady = own.ready_documents || own.requests.filter(r => r.job_state === 'ready');
        const becameReady = readyDocuments.some(r => !previousReady.some(old => old.domain === r.domain && old.file_hash === r.file_hash));
        const approved = data.requests.some(r => r.status === 'approved' && own.requests.find(old => old.id === r.id)?.status === 'pending');
        const failed = data.requests.find(r => r.job_state === 'failed' && own.requests.find(old => old.id === r.id)?.job_state !== 'failed');
        own = data;
        if (!landing) onApprovedUploads(data.processing || []);
        const root = $('user-upload-status');
        if (!background || (ownView() !== renderedOwn && !root.contains(document.activeElement))) renderOwn();
        if (becameReady) onReady(readyDocuments);
        if (failed) onError(failed.job_message || 'Processing failed after the single retry. Contact the administrator.');
        else if (becameReady) onError('Your processed document is ready. You can now ask questions and search it.');
        else if (approved) onError('Your upload was approved. It will be processed automatically; no re-upload is needed.');
      }
    } catch (error) { if (version === generation) { if (isAdminAccount()) { $('admin-total-users').textContent = '—'; $('admin-total-pending').textContent = '—'; } $('admin-sync-status').textContent = error.message; onError(error.message); } }
    finally { if (activeRefresh === id) activeRefresh = null; }
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
    if (workspaceAccount() && !workspacePages.includes(next)) {
      void onManageUploads(null, $('admin-sync-status'), next, historyMode);
      return;
    }
    if (!canVisit(next)) { next = defaultRoute(); historyMode = 'replace'; }
    const home = next === 'home';
    const layoutChanged = landing !== home;
    if (layoutChanged) {
      landing = home;
      applyLayout();
    }
    page = next; selected = null; tab = 'overview';
    const browsing = next === 'knowledge-bases';
    const sidebar = Boolean(user());
    const accountPage = next === 'my-account';
    {
      const file = home ? (layoutChanged ? 'index.html' : '') : ['workspace', 'dashboard'].includes(next) ? next + '.html'
        : layoutChanged ? (next === 'my-account' ? 'workspace.html' : 'dashboard.html') : '';
      const path = file ? new URL(file, location.href).pathname : location.pathname;
      const hash = next !== 'workspace' && [...pages, ...superPages.filter(showSuperPage)].includes(next) ? '#' + next : '';
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
    $('dashboard-page-title').textContent = ({ dashboard: 'Dashboard', users: 'Users', 'user-details-add': 'Add User', requests: 'Upload requests', 'knowledge-bases': 'Knowledge Bases', 'my-account': 'My Account', roles: 'Role Management', 'permission-list': 'Permissions List', permissions: 'Permission Matrix', 'login-logs': 'Logs Management', 'user-uploads': 'User Uploads', revisions: 'Revision' })[next] || 'Workspace';
    document.body.classList.toggle('admin-layout', sidebar && !home);
    $('admin-sidebar').hidden = !sidebar || home; $('admin-menu-toggle').hidden = !sidebar || home;
    $('sidebar-role-label').textContent = user()?.role === 'user' ? 'User workspace' : 'Admin workspace';
    $('admin-dashboard-entry').hidden = !home; $('admin-sync').hidden = home || browsing || accountPage;
    $('admin-bell').hidden = !sidebar || home || !canVisit('requests');
    $('workspace').hidden = !canVisit('workspace') || (next !== 'workspace' && (next !== 'dashboard' || isSuper()));
    $('super-workspace-scope').hidden = !(isSuper() || managingUploads())
      || next !== 'workspace' || !$('super-workspace-scope').textContent;
    const grouped = isAdminAccount();
    const accountScoped = grouped && Boolean(workspaceAccount());
    const canOpenUserWorkspace = grouped && canVisit('workspace') && showSuperPage('user-uploads');
    const inAllUsers = ['users', 'user-details-add', 'user-uploads', 'requests'].includes(next) || accountScoped;
    allUsersToggle.hidden = !grouped || !(['users', 'user-uploads', 'requests'].some(canVisit) || canOpenUserWorkspace);
    allUsersLinks.classList.toggle('is-grouped', grouped);
    $('sidebar-users-label').textContent = grouped ? 'User Details' : 'All users';
    setAllUsersOpen(!grouped || (inAllUsers && !allUsersToggle.hidden));
    for (const link of userWorkspaceLinks) {
      link.hidden = !canOpenUserWorkspace;
      link.disabled = !accountScoped;
      link.title = accountScoped ? '' : 'Open an account from User Details or User Uploads first.';
      link.setAttribute('aria-current', accountScoped && link.dataset.userWorkspacePage === next ? 'page' : 'false');
    }
    document.querySelectorAll('[data-super-page]').forEach(button => {
      button.hidden = !canVisit(button.dataset.superPage)
        || (button.dataset.superPage === 'workspace' && (accountScoped || (!isSuper() && user()?.role !== 'user')));
      button.setAttribute('aria-current', button.dataset.superPage === next ? 'page' : 'false');
    });
    $('super-settings-label').hidden = !['permission-list', 'permissions', 'login-logs', 'revisions'].some(canVisit);
    $('user-management-label').hidden = !['users', 'requests', 'roles', 'user-uploads'].some(canVisit);
    $('my-account').hidden = !accountPage;
    $('my-account-link').hidden = !canVisit('my-account');
    onPage(next, layoutChanged);
    if (accountPage) $('my-account-title').focus({ preventScroll: true });
    $('admin-overview').hidden = next !== 'dashboard' || user()?.role !== 'admin';
    $('admin-content').hidden = !['users', 'requests'].includes(next);
    $('knowledge-bases').hidden = !browsing;
    const browseLink = $('knowledge-bases-link');
    browseLink.hidden = hasManagement() || landing || !canVisit('knowledge-bases');
    browseLink.href = browsing ? 'workspace.html' : '#knowledge-bases';
    browseLink.textContent = browsing ? 'Workspace' : 'Knowledge Bases';
    document.querySelectorAll('[data-admin-page]').forEach(n => {
      n.hidden = !canVisit(n.dataset.adminPage) || (accountScoped && n.dataset.adminPage === 'knowledge-bases');
      n.setAttribute('aria-current', n.dataset.adminPage === next ? 'page' : 'false');
    });
    closeNavigation();
    if (browsing) {
      renderKnowledgeBases(knowledgeBaseMessage);
      $('knowledge-bases-title').focus({ preventScroll: true });
    }
    if (['users', 'requests'].includes(next)) render();
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (layoutChanged && !home) void refresh(true);
  }
  async function restoreRoute(route, fallback, historyMode) {
    const previous = activeRoute;
    const validRoute = route?.owner === user()?.id && canVisit(route?.page);
    const next = validRoute ? route.page : fallback;
    const account = validRoute && workspacePages.includes(next)
      && (isSuper() || user()?.permissions?.['user_uploads.view'] === true) ? route.account : null;
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
    if (user() && route?.owner === user().id) void restoreRoute(route, defaultRoute(), 'restore');
  });
  async function loadBaseDocuments(domain, details, list, count, requestsForView) {
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
      const rows = document.createDocumentFragment();
      if (!pdfs.length) rows.append(el('p', 'No PDFs in this knowledge base.'));
      for (const [hash, file] of pdfs) {
        const row = el('div', '', 'knowledge-base-pdf');
        const badge = { Ready: 'approved', 'Awaiting approval': 'pending', Failed: 'rejected' }[file.status] || 'processing-status';
        row.append(el('strong', file.filename), el('span', file.status, `approval-badge ${badge}`));
        if (file.status === 'Ready') row.append(button('View Document', async () => {
          if (!can('documents.view') || !canVisit('workspace')) return;
          const version = generation;
          const opened = await onOpenBase(domain.key);
          if (!opened || version !== generation || !row.isConnected || page !== 'knowledge-bases'
              || !can('documents.view') || !canVisit('workspace')) return;
          navigate('workspace');
          onViewDocument(hash, file.filename);
        }));
        rows.append(row);
      }
      list.replaceChildren(rows);
      return true;
    } catch {
      if (details.isConnected && page === 'knowledge-bases') list.replaceChildren(el('p', 'Could not load PDFs. Close and reopen this knowledge base to retry.'));
    }
  }
  function renderKnowledgeBases(message) {
    if (page !== 'knowledge-bases') return;
    const root = $('knowledge-base-list');
    const domains = knowledgeBases();
    const account = workspaceAccount();
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
    const requestsForView = can('documents.view') && domains.length && (account || !isAdminAccount())
      ? api('/upload-requests').then(data => data.requests || []).catch(() => account ? [] : own.requests)
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
      const browse = el('span', can('documents.view') ? 'View documents' : 'Documents unavailable', 'knowledge-base-browse');
      const arrow = el('span', '›');
      arrow.setAttribute('aria-hidden', 'true');
      browse.append(arrow);
      summary.append(top, title, browse);
      const list = el('div', '', 'knowledge-base-pdfs');
      list.setAttribute('aria-live', 'polite');
      if (can('documents.view')) list.append(el('p', 'Loading documents...'));
      details.append(summary, list);
      let loading = false;
      let loaded = false;
      const load = async () => {
        if (!can('documents.view') || loading || loaded || !card.isConnected || page !== 'knowledge-bases') return;
        if (list.dataset.failed) list.replaceChildren(el('p', 'Loading documents...'));
        loading = true;
        list.setAttribute('aria-busy', 'true');
        try {
          loaded = await loadBaseDocuments(domain, details, list, count, requestsForView);
          list.dataset.failed = loaded ? '' : 'true';
          count.hidden = !count.textContent;
        } finally {
          loading = false;
          list.removeAttribute('aria-busy');
        }
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
    if (!decisions && !isAdminAccount()) {
      card.classList.add('user-upload-card');
      if (can('documents.delete')) card.append(deleteCardButton(r));
    }
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
    if (decisions && can('approvals.edit') && r.status === 'pending' && (isSuper() || r.user_id !== user()?.id)) {
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
        const header = el('header', '', 'activity-base-header');
        header.append(el('h4', base.name),
          el('p', `${base.pdfs} ${base.pdfs === 1 ? 'PDF' : 'PDFs'} \u00b7 ${base.images} ${base.images === 1 ? 'image' : 'images'}`));
        card.append(header);
        const approvals = activityTags(base.approvals, [
          ['approved', 'Approved', 'approved'], ['pending', 'Awaiting approval', 'pending'],
          ['rejected', 'Rejected', 'rejected'], ['expired', 'Expired', ''],
        ]);
        const processing = activityTags(base.processing, [
          ['ready', 'Ready', 'approved'], ['queued', 'Queued', 'processing-status'],
          ['processing', 'Processing', 'processing-status'], ['retrying', 'Retrying', 'processing-status'],
          ['pending', 'Incomplete', 'pending'], ['failed', 'Failed', 'rejected'],
        ]);
        const groups = el('div', '', 'activity-status-groups');
        for (const [label, tags] of [['Upload requests', approvals], ['Document processing', processing]]) {
          if (!tags.childElementCount) continue;
          const group = el('section', '', 'activity-status-group');
          group.append(el('h5', label), tags);
          groups.append(group);
        }
        if (groups.childElementCount) card.append(groups);
        panel.append(card);
      }
    } catch (error) {
      if (panel.isConnected) panel.replaceChildren(el('p', error.message));
    }
  }
  const adminView = () => JSON.stringify([people, requests]);
  function render() {
    renderedAdmin = adminView();
    const root = $('admin-content'); root.replaceChildren();
    if (selected) {
      const person = people.find(p => p.id === selected);
      if (!person) { selected = null; render(); return; }
      root.append(button('← All users', () => { selected = null; render(); }), el('h2', person.name || person.email));
      if (scoped(person) && user()?.permissions?.['user_uploads.view'] === true && can('bases.view')) {
        root.append(button('Manage uploads', () => onManageUploads(person, $('admin-sync-status'))));
      }
      const tabs = el('div', '', 'admin-actions');
      const visibleTabs = ['overview'];
      if (isSuper() || (scoped(person) && user()?.permissions?.['accounts.edit'] === true)) visibleTabs.push('permissions');
      if (can('approvals.view')) {
        visibleTabs.push('upload requests');
        if (can('bases.view') && can('documents.view')) visibleTabs.push('activity');
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
        for (const [value, text] of [['approval_required', 'Approval required'], ...(isSuper() || user()?.permissions?.['user_uploads.add'] === true ? [['allowed', 'Upload allowed']] : []), ['blocked', 'Upload blocked']]) {
          const option = el('option', text); option.value = value; select.append(option);
        }
        select.value = person.policy;
        select.disabled = !isSuper() && user()?.permissions?.['accounts.edit'] !== true;
        root.append(label, select);
        if (!select.disabled) root.append(button('Save permission', () => change(`/admin/users/${person.id}/permissions`, { policy: select.value })));
      } else if (tab === 'activity') {
        const panel = el('section', '', 'user-activity');
        panel.setAttribute('aria-label', 'Knowledge base activity');
        panel.setAttribute('aria-live', 'polite');
        root.append(panel);
        void renderActivity(person, panel);
      } else {
        const items = requests.filter(r => r.user_id === selected);
        if (scoped(person) && (isSuper() || user()?.permissions?.['approvals.add'] === true)) root.append(approvalForm(person));
        if (!items.length) root.append(el('p', 'No upload requests yet.'));
        items.forEach(r => root.append(requestCard(r, true)));
      }
    } else if (page === 'users') {
      if (canAddUser()) root.append(button('Add User', () => navigate('user-details-add')));
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
  const ownView = () => JSON.stringify([own.policy, own.requests]);
  function renderOwn() {
    const root = $('user-upload-status');
    const wasOpen = root.querySelector(':scope > details')?.open;
    const wasEmpty = root.querySelector(':scope > details > summary')?.textContent === 'Your requests (0)';
    root.hidden = false; root.replaceChildren();
    renderedOwn = ownView();
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
    const details = document.createElement('details'); details.open = wasEmpty ? own.requests.length > 0 : (wasOpen ?? own.requests.length > 0); details.append(el('summary', `Your requests (${own.requests.length})`));
    if (!own.requests.length) details.append(el('p', 'No uploads yet. Select a file and use Upload & process to save it and request approval.'));
    own.requests.forEach(r => details.append(requestCard(r, false))); root.append(details);
  }
  async function prepare(file, domain, useLlm = true) {
    if (isSuper() || user()?.id === 'local-admin' || (isAdminAccount() && user()?.permissions?.['user_uploads.add'] === true)) return true;
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
  function poll() {
    if (document.hidden) return;
    const reviewsUploads = !landing && hasManagement() && can('approvals.view');
    const waiting = !landing && !hasManagement() && own.requests.some(row =>
      row.status === 'pending' || (row.status === 'approved' && ['queued', 'processing', 'retrying'].includes(row.job_state)));
    if (Date.now() - lastRefresh >= (reviewsUploads || waiting ? 3000 : 30000)) void refresh(true);
  }
  async function start(onRouteReady, connection) {
    const version = generation;
    const requestedPage = location.hash.slice(1);
    const fallback = landing ? 'home' : canVisit(requestedPage) ? requestedPage
      : location.pathname.endsWith('/workspace.html') && canVisit('workspace') ? 'workspace' : defaultRoute();
    await restoreRoute(history.state?.queryAssistantRoute, fallback, 'replace');
    if (version !== generation) return;
    $('admin-dashboard-entry').textContent = 'Dashboard';
    $('admin-dashboard-entry').href = hasManagement() ? 'dashboard.html' : 'workspace.html';
    $('admin-dashboard-entry').hidden = !landing;
    const regularUser = user()?.role === 'user';
    $('admin-refresh').hidden = regularUser;
    onRouteReady();
    if (page === 'knowledge-bases') $('knowledge-bases-title').focus({ preventScroll: true });
    await connection;
    if (version !== generation) return;
    await refresh();
    if (version === generation) timer = setInterval(poll, 1000);
  }
  document.addEventListener('visibilitychange', () => {
    if (timer && user() && !landing && !document.hidden) void refresh(true);
  });
  document.querySelectorAll('[data-admin-page]').forEach(n => n.addEventListener('click', () => navigate(n.dataset.adminPage)));
  $('admin-dashboard-entry').addEventListener('click', event => {
    if (!user() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(defaultRoute());
  });
  $('my-account-link').addEventListener('click', () => {
    $('admin-menu').open = false;
    navigate('my-account');
  });
  document.querySelectorAll('[data-super-page]').forEach(n => n.addEventListener('click', () => navigate(n.dataset.superPage)));
  for (const link of userWorkspaceLinks) {
    link.addEventListener('click', () => {
      if (workspaceAccount() && canVisit(link.dataset.userWorkspacePage) && showSuperPage('user-uploads')) {
        navigate(link.dataset.userWorkspacePage);
      }
    });
  }
  $('knowledge-bases-link').addEventListener('click', event => {
    event.preventDefault();
    navigate(page === 'knowledge-bases' ? 'workspace' : 'knowledge-bases');
  });
  $('admin-bell').addEventListener('click', () => {
    filter = 'pending';
    navigate('requests');
    if (page === 'requests') void refresh(true);
  });
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
      const items = [...$('admin-sidebar').querySelectorAll('a[href], button:not(:disabled)')]
        .filter(item => !item.closest('[hidden]'));
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
