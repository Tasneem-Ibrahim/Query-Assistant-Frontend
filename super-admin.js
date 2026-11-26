export function createSuperAdminPanel({ api, user, openWorkspace, openKnowledgeBases, confirmDeletion, confirmRevision, exportLogs }) {
  const root = document.getElementById('super-admin-panel');
  const roleNames = { super_admin: 'Super Admin', admin: 'Admin', user: 'User' };
  const actions = ['view', 'add', 'edit', 'delete'];
  let revision = 0;
  let selected = '';
  let role = 'admin';
  let mode = '';
  let snapshot;
  let status;
  let invitation = '';
  let logBefore = {};
  const emptyLogFilters = { from: '', to: '', search: '', outcome: '' };
  const logOutcomes = { signed_in: 'Signed in', signed_out: 'Signed out', invalid_code: 'Invalid code', invalid_credentials: 'Invalid credentials' };
  let logFilters = { ...emptyLogFilters };
  let logAccounts = null;
  let revisionBefore = null;
  let auditBefore = null;
  let auditData = null;
  let showArchived = false;
  let journalOpen = false;
  const logSections = [
    ['login', 'Login / Logout Logs'],
    ['user-details', 'User Details Logs'],
    ['knowledge-base', 'Knowledge Base Logs'],
    ['role-management', 'Role Management Logs'],
  ];
  const settingsPages = ['permission-list', 'permissions'];
  const pagePermissions = { 'user-details-add': 'accounts.add', roles: 'roles.view', 'user-uploads': 'user_uploads.view', 'permission-list': 'permissions.view', permissions: 'permissions.view',
    'login-logs': 'logs.view', revisions: 'revisions.view' };
  const isSuper = () => user()?.role === 'super_admin';
  const can = key => isSuper() || user()?.permissions?.[key] === true;
  const titles = {
    dashboard: 'Super Admin dashboard', 'user-details-add': 'Add User', roles: 'Role Management',
    'permission-list': 'Permissions List', permissions: 'Permission Matrix', 'login-logs': 'Logs Management', 'user-uploads': 'User Uploads', revisions: 'Revision',
  };

  function element(tag, text, className) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function button(text, action, className = 'button secondary') {
    const item = element('button', text, className);
    item.type = 'button';
    item.addEventListener('click', action);
    return item;
  }

  function table(headers) {
    const wrapper = element('div', '', 'super-table-wrap');
    const grid = element('table');
    const head = grid.createTHead().insertRow();
    for (const header of headers) {
      const title = element('th', header);
      title.scope = 'col';
      head.append(title);
    }
    wrapper.append(grid);
    return [wrapper, grid.createTBody()];
  }

  function date(value) {
    return value ? new Date(value).toLocaleString() : '—';
  }

  async function load() {
    const current = ++revision;
    status.textContent = 'Loading account information…';
    try {
      const cursor = new URLSearchParams(Object.entries(revisionBefore || {}).filter(([, value]) => value != null));
      const path = mode === 'revisions' ? '/super-admin/revisions' + (cursor.size ? '?' + cursor : '')
        : settingsPages.includes(mode) ? '/super-admin/permission-settings'
          : mode === 'roles' ? '/super-admin/role-accounts'
            : mode === 'user-uploads' ? '/super-admin/workspace-accounts' : '/super-admin/overview';
      const data = mode === 'user-details-add' ? {} : mode === 'login-logs' ? await loadLogs(current) : await api(path);
      if (current !== revision) return;
      const resource = mode === 'login-logs' ? 'logs' : mode === 'revisions' ? 'revisions' : null;
      const journal = resource ? await loadAudit(resource, data).catch(() => null) : null;
      if (current !== revision) return;
      auditData = journal;
      snapshot = data;
      if (settingsPages.includes(mode) && !Object.hasOwn(snapshot.defaults, role)) role = 'user';
      render();
    } catch (error) {
      if (current === revision) status.textContent = error.message;
    }
  }

  function logReference(key, row) {
    return key === 'login' ? 'login:' + row.id : 'activity:' + key + ':' + row.id;
  }

  function revisionReference(item) {
    const match = /^RV-([LC])([0-9]+)$/.exec(item.revision_id);
    return match ? 'revision:' + match[1] + ':' + match[2].replace(/^0+/, '') : null;
  }

  async function loadAudit(resource, data) {
    const endpoint = '/super-admin/audit-journal/' + resource;
    const canManage = ['add', 'edit', 'delete'].some(action => can(resource + '.' + action));
    const [history, scope] = await Promise.all([
      api(endpoint + (auditBefore ? '?before=' + auditBefore : '')),
      canManage ? api('/super-admin/audit-subjects/' + resource).catch(() => ({ accounts: [] })) : { accounts: [] },
    ]);
    const originalRefs = resource === 'logs' ? data.flatMap((result, index) => result.status === 'fulfilled'
      ? result.value.events.map(row => logReference(logSections[index][0], row)) : [])
      : data.revisions.map(revisionReference).filter(Boolean);
    const manualRefs = history.entries.filter(entry => entry.operation === 'add').map(entry => 'manual:' + entry.id);
    const refs = [...originalRefs, ...manualRefs];
    const annotations = refs.length ? await api(endpoint + '/annotations', 'POST', { references: refs }) : {};
    return { ...history, annotations, accounts: scope.accounts, subjects: new Set(scope.accounts.map(account => account.id)) };
  }

  async function loadLogs(current) {
    const filters = { ...logFilters, search: logFilters.search.toLocaleLowerCase() };
    const cursors = { ...logBefore };
    const signedIn = user();
    const directory = logAccounts ? Promise.resolve(logAccounts) : api('/super-admin/permission-settings').then(data => {
      const accounts = new Map([signedIn, ...(data.accounts || [])].map(account => [account.id, account]));
      if (current === revision) logAccounts = accounts;
      return accounts;
    }).catch(() => new Map([[signedIn.id, signedIn]]));
    return Promise.allSettled(logSections.map(async ([key]) => {
      const endpoint = key === 'login' ? 'login-logs' : `activity-logs/${key}`;
      let before = cursors[key];
      let result;
      const from = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
      const until = filters.to ? new Date(`${filters.to}T00:00:00`) : null;
      if (until) until.setDate(until.getDate() + 1);
      for (let page = 0; page < 5; page++) {
        const pending = api('/super-admin/' + endpoint + (before ? '?before=' + before : ''));
        const [data, accounts] = await Promise.all([pending, directory]);
        const events = data.events.map(row => ({
          ...row,
          account: accounts.get(row.account_id || row.actor_id),
          targetAccount: accounts.get(row.target),
        })).filter(row => {
          const time = new Date(row.created_at);
          if ((from && time < from) || (until && time >= until)) return false;
          if (key === 'login' && filters.outcome && row.outcome !== filters.outcome) return false;
          if (!filters.search) return true;
          const fields = [row.account_id, row.actor_id, row.account?.name, row.account?.email, row.target,
            row.targetAccount?.name, row.targetAccount?.email, roleNames[row.role || row.account?.role], row.action, logOutcomes[row.outcome]];
          return fields.some(value => value?.toLocaleLowerCase().includes(filters.search));
        });
        result = { events, next: data.next };
        if (current !== revision || events.length || !data.next || data.next === before) break;
        before = data.next;
      }
      return result;
    }));
  }

  async function change(control, job) {
    const current = revision;
    control.disabled = true;
    status.textContent = '';
    try {
      await job();
      if (current === revision) await load();
    } catch (error) {
      if (current === revision) status.textContent = error.message;
    } finally {
      control.disabled = false;
    }
  }

  function update(person, data) {
    return api('/super-admin/accounts/' + encodeURIComponent(person.id), 'PATCH', data);
  }

  function metricIcon(pathData) {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', pathData);
    icon.append(path);
    return icon;
  }

  function overview() {
    const stats = element('dl', '', 'super-kpi-grid');
    stats.setAttribute('aria-label', 'Account totals');
    const operations = element('dl', '', 'super-operations-stats');
    operations.setAttribute('aria-label', 'Document and approval totals');
    const people = snapshot.accounts;
    const metrics = [
      ['Super Admins', people.filter(person => person.role === 'super_admin').length, 'M12 3l8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3z M9 12l2 2 4-4'],
      ['Admins', people.filter(person => person.role === 'admin').length, 'M12 3l8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3z'],
      ['Users', people.filter(person => person.role === 'user').length, 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M22 21v-2a4 4 0 0 0-3-4 M16 3a4 4 0 0 1 0 8'],
      ['Inactive accounts', people.filter(person => person.status !== 'active').length, 'M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M16 11h6'],
      ['Pending approvals', snapshot.pending, 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2'],
      ['Knowledge bases', snapshot.bases, 'M12 7C9 4 5 4 3 5v14c3-1 6-1 9 2 3-3 6-3 9-2V5c-2-1-6-1-9 2v14'],
      ['PDFs', snapshot.pdfs, 'M14 3H5v18h14V8l-5-5v5h5 M8 12h8 M8 16h6'],
    ];
    for (const [index, [label, count, iconPath]] of metrics.entries()) {
      const card = element('div', '', 'super-kpi-card');
      const term = element('dt', label);
      term.prepend(metricIcon(iconPath));
      card.append(term, element('dd', String(count)));
      (index < 4 ? stats : operations).append(card);
    }

    const processing = element('section', '', 'super-overview-section');
    const processingTitle = element('h3', 'Document Processing');
    processingTitle.id = 'super-processing-title';
    processing.setAttribute('aria-labelledby', processingTitle.id);
    processing.append(processingTitle, operations);
    const states = Object.entries(snapshot.processing);
    if (states.length) {
      const list = element('dl', '', 'super-processing-states');
      for (const [state, count] of states) {
        const row = element('div');
        const label = state.replace(/_/g, ' ');
        row.append(element('dt', label.charAt(0).toUpperCase() + label.slice(1)), element('dd', String(count)));
        list.append(row);
      }
      processing.append(list);
    } else {
      processing.append(element('p', 'No processing activity.', 'super-overview-empty'));
    }

    const activity = element('section', '', 'super-overview-section');
    const activityTitle = element('h3', 'Recent Management Activity');
    activityTitle.id = 'super-activity-title';
    activity.setAttribute('aria-labelledby', activityTitle.id);
    activity.append(activityTitle);
    if (snapshot.audit.length) {
      const history = element('ol', '', 'super-activity-feed');
      for (const row of snapshot.audit) {
        const entry = element('li');
        const account = row.target ? people.find(person => person.id === row.target)?.name || 'Deleted account' : 'Admin role';
        const timestamp = element('time', date(row.created_at));
        if (row.created_at) timestamp.dateTime = row.created_at;
        const action = row.action.replace(/_/g, ' ');
        entry.append(element('strong', action.charAt(0).toUpperCase() + action.slice(1)), element('span', account), timestamp);
        history.append(entry);
      }
      activity.append(history);
    } else {
      activity.append(element('p', 'No management activity yet.', 'super-overview-empty'));
    }

    const details = element('div', '', 'super-overview-details');
    details.append(processing, activity);
    root.append(stats, details);
  }

  function accountForm(userDetails = false) {
    const form = element('form', '', 'super-admin-form super-account-form');
    const fields = element('div', '', 'super-admin-form');
    const choices = element('select');
    choices.name = 'role';
    choices.add(new Option('User', 'user'));
    const admin = new Option('Admin', 'admin');
    admin.disabled = snapshot.admin_role_active === false;
    choices.add(admin);
    const method = element('select');
    method.name = 'method';
    method.add(new Option('Create with password', 'create'));
    method.add(new Option('Generate invitation link', 'invite'));
    for (const [title, select] of [['Role', choices], ['Account setup', method]]) {
      const label = element('label', title);
      label.append(select);
      fields.append(label);
    }
    const inputs = {};
    for (const [name, title, type, maxLength] of [
      ['name', 'Name', 'text', 80], ['email', 'Email', 'email', 254], ['password', 'Initial password', 'password', 256],
    ]) {
      const label = element('label', title);
      const input = element('input');
      Object.assign(input, { name, type, required: true, maxLength });
      if (name === 'password') { input.minLength = 8; input.autocomplete = 'new-password'; }
      label.append(input);
      fields.append(label);
      inputs[name] = input;
    }
    const permissions = element('div');
    let changes = {};
    function showPermissions() {
      changes = {};
      permissions.replaceChildren(permissionGrid(choices.value, {}, changes));
    }
    const submit = element('button', 'Create account', 'button primary');
    submit.type = 'submit';
    if (isSuper() && !userDetails) choices.addEventListener('change', showPermissions);
    method.addEventListener('change', () => {
      const invite = method.value === 'invite';
      const password = inputs.password;
      password.parentElement.hidden = invite;
      password.disabled = invite;
      password.required = !invite;
      if (invite) password.value = '';
      submit.textContent = invite ? 'Generate invitation link' : 'Create account';
    });
    if (isSuper() && !userDetails) {
      showPermissions();
      form.append(fields, element('h3', 'Assigned permissions'), permissions, submit);
    } else {
      choices.replaceChildren(new Option('User', 'user'));
      if (!userDetails && snapshot.can_create_admin) choices.add(new Option('Admin', 'admin'));
      form.append(fields, submit);
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      const current = revision;
      change(submit, async () => {
        const data = { ...Object.fromEntries(new FormData(form)), permissions: changes };
        const result = await api(userDetails ? '/super-admin/user-details' : '/super-admin/accounts', 'POST', data);
        if (revision === current && userDetails && !result.invite_token) invitation = 'created';
        if (revision === current && result.invite_token) {
          const url = new URL('index.html', location.href);
          url.hash = new URLSearchParams({ qa_invite: result.invite_token }).toString();
          invitation = url.href;
        }
      });
    });
    return form;
  }

  function roleStatus() {
    const active = snapshot.admin_role_active !== false;
    const group = element('div', '', 'super-role-status');
    const label = element('label', 'Admin role active');
    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.checked = active;
    label.prepend(toggle);
    const save = button('Save role status', () => change(save, () =>
      api('/super-admin/roles/admin', 'PUT', { active: toggle.checked })));
    group.append(label, save, element('p', 'Deactivating this role blocks managed Admin access until reactivation or reassignment. The original Admin sign-in stays available.'));
    return group;
  }

  function inviteResult() {
    const box = element('div', '', 'super-role-status');
    const label = element('label', 'Invitation link');
    const link = element('input');
    Object.assign(link, { type: 'url', readOnly: true, value: invitation });
    label.append(link);
    const copy = button('Copy invitation link', async () => {
      try { await navigator.clipboard.writeText(link.value); status.textContent = 'Invitation link copied.'; }
      catch { link.select(); status.textContent = 'Copy the selected link to share it.'; }
    });
    box.append(label, copy, element('p', 'Share this one-time link privately with the invitee.'));
    return box;
  }

  function adminAccessControls(person, cell) {
    const original = person.id === 'local-admin';
    if (original) {
      const active = person.status !== 'active';
      const toggle = button(active ? 'Resume workspace access' : 'Pause workspace access',
        () => change(toggle, () => api('/super-admin/original-admin/status', 'PUT',
          { active, revision: person.status_revision })),
        active ? 'button secondary outline-action' : 'button secondary super-danger');
      cell.append(toggle);
    }
    const policy = original ? undefined : snapshot.admin_policy;
    const approval = ['approvals.view', 'approvals.edit'].map(key =>
      person.permissions?.[key] ?? policy?.actions?.[key] ?? true);
    for (const active of [true, false]) {
      if (approval.every(value => value === active)) continue;
      const control = button(active ? 'Grant upload approval' : 'Revoke upload approval',
        () => change(control, () => api('/super-admin/accounts/' + encodeURIComponent(person.id) + '/upload-approval',
          'PUT', { active })),
        active ? 'button secondary outline-action' : 'button secondary super-danger');
      cell.append(control);
    }
    if (policy?.modules?.approvals === false) {
      cell.append(element('small', 'Upload approvals module is disabled for managed Admins.'));
    }
  }

  function accounts() {
    if (can('roles.add')) {
      const add = element('details', '', 'super-account-disclosure');
      add.append(element('summary', 'Create or invite an account'), accountForm());
      root.append(add);
    }
    const [grid, body] = table(['Account', 'Role', 'Status', 'Created', 'Updated', 'Actions']);
    grid.classList.add('super-directory');
    for (const person of snapshot.accounts) {
      const tr = body.insertRow();
      const identity = tr.insertCell();
      identity.append(element('strong', person.name || person.email), element('small', person.email || 'Protected sign-in'));
      const roleCell = tr.insertCell();
      if (person.protected || person.status === 'deleting' || person.role_choices?.length === 0 || (!can('roles.edit') && !(person.role === 'admin' && can('roles.delete')))) {
        roleCell.textContent = roleNames[person.role];
      } else {
        const select = element('select');
        select.setAttribute('aria-label', 'Role for ' + person.name);
        for (const value of ['admin', 'user']) {
          const option = new Option(roleNames[value], value, false, person.role === value);
          option.disabled = value !== person.role && (person.role_choices
            ? !person.role_choices.includes(value) : value === 'admin' && snapshot.admin_role_active === false);
          select.add(option);
        }
        const save = button('Save role', () => change(save, () => update(person, { role: select.value })));
        save.disabled = true;
        select.addEventListener('change', () => { save.disabled = select.value === person.role; });
        const roleControls = element('div', '', 'super-row-controls');
        roleControls.append(select, save);
        roleCell.append(roleControls);
      }
      const accountState = element('span', { active: 'Active', inactive: 'Inactive', deleting: 'Deletion pending' }[person.status], 'super-account-state');
      accountState.dataset.state = person.status;
      tr.insertCell().append(accountState);
      tr.insertCell().textContent = date(person.created_at);
      tr.insertCell().textContent = date(person.updated_at);
      const actionsCell = tr.insertCell();
      const actions = element('div', '', 'super-directory-actions');
      actionsCell.append(actions);
      if (person.status !== 'deleting' && (isSuper() || (person.status === 'active'
          && can('bases.view') && can('user_uploads.view')))) {
        actions.append(
          button('Open Workspace', () => openWorkspace(person, status), 'button secondary open-workspace-action'),
          button('Knowledge Bases', () => openKnowledgeBases(person, status), 'button secondary open-workspace-action'),
        );
      }
      const cell = element('div', '', 'super-row-controls');
      if (isSuper() && person.role === 'admin' && person.status !== 'deleting') adminAccessControls(person, cell);
      if (can('accounts.view') && can('accounts.edit') && !person.protected && person.status !== 'deleting') {
        const next = person.status === 'active' ? 'inactive' : 'active';
        const toggle = button(next === 'inactive' ? 'Deactivate' : 'Reactivate',
          () => change(toggle, () => update(person, { status: next })),
          next === 'inactive' ? 'button secondary super-danger' : 'button secondary outline-action');
        cell.append(toggle);
      }
      if (can('accounts.view') && can('accounts.delete') && !person.protected && person.status !== 'active') {
        const remove = button('Delete permanently', async () => {
          if (!await confirmDeletion('Delete ' + person.name + '?',
            'After deletion, this account and its data cannot be recovered.', 'Delete permanently')) return;
          await change(remove, () => api('/super-admin/accounts/' + encodeURIComponent(person.id) + '?confirmation=DELETE', 'DELETE'));
        }, 'button secondary super-danger');
        cell.append(remove);
      }
      if (cell.childElementCount) {
        const disclosure = element('details', '', 'super-directory-disclosure');
        const summary = element('summary', 'Manage access');
        summary.setAttribute('aria-label', 'Manage access for ' + (person.name || person.email));
        disclosure.append(summary, cell);
        actions.append(disclosure);
      }
    }
    if (isSuper()) root.prepend(roleStatus());
    if (invitation) root.append(inviteResult());
    root.append(grid);
  }

  function uploads() {
    const [grid, body] = table(['Account', 'Workspace']);
    for (const person of snapshot.accounts) {
      const row = body.insertRow();
      row.insertCell().textContent = person.name || person.email;
      const cell = row.insertCell();
      if (isSuper() || user()?.permissions?.['bases.view'] === true) {
        cell.append(button('Open Workspace', () => openWorkspace(person, status)));
        cell.append(button('Knowledge Bases', () => openKnowledgeBases(person, status)));
      }
    }
    if (!snapshot.accounts.length) root.append(element('p', 'No accounts in your upload scope.'));
    else root.append(grid);
  }

  function permissionGrid(role, overrides, changes, policy = {}, manageSettings = false) {
    const [grid, body] = table(['Permission', 'View', 'Add', 'Edit', 'Delete']);
    const values = { ...snapshot.defaults[role], ...policy.actions, ...overrides };
    for (const [key, label] of Object.entries(snapshot.resources)) {
      const row = body.insertRow();
      const heading = element('th', label);
      heading.scope = 'row';
      row.append(heading);
      for (const action of actions) {
        const permission = key + '.' + action;
        const cell = row.insertCell();
        const allowed = snapshot.assignable[role]?.includes(permission);
        const optIn = snapshot.opt_in_modules?.[role]?.includes(key);
        const moduleEnabled = policy.modules?.[key] !== false
          && (overrides?.['module:' + key] ?? policy.modules?.[key] ?? !optIn);
        const supported = allowed || (role === 'super_admin' && snapshot.assignable.admin?.includes(permission));
        const delegated = snapshot.delegation_scope == null || snapshot.delegation_scope.includes(permission);
        const locks = selected ? snapshot.accounts.find(account => account.id === selected)?.delegated_overrides
          : policy.delegated_actions;
        const current = selected ? overrides?.[permission] : policy.actions?.[permission];
        const canWrite = !manageSettings || can(current === undefined ? 'permissions.add' : 'permissions.edit');
        const restricted = policy.actions?.[permission] === false && !policy.delegated_actions?.includes(permission);
        const locked = !isSuper() && ((current === false && !locks?.includes(permission)) || restricted
          || (!selected && !['bases','documents'].includes(key)));
        const configured = values[permission] || (optIn && (snapshot.opt_in_actions?.[role] || []).includes(permission)
          && overrides?.[permission] === undefined && policy.actions?.[permission] === undefined);
        const value = configured && !(selected && restricted && locks?.includes(permission));
        if (!supported) {
          cell.textContent = 'Unsupported';
        } else if (changes && allowed && delegated && !locked && canWrite) {
          const toggle = element('input');
          toggle.type = 'checkbox';
          if (key === 'user_uploads') toggle.className = 'upload-permission-checkbox';
          else toggle.setAttribute('role', 'switch');
          toggle.setAttribute('aria-label', action + ' ' + label.toLowerCase());
          toggle.checked = value;
          if (!moduleEnabled) toggle.title = 'Saved setting. This module is disabled.';
          toggle.addEventListener('change', () => { changes[permission] = toggle.checked; });
          cell.append(toggle);
          if (manageSettings && current === undefined) {
            const explicit = button('Set explicitly', () => {
              changes[permission] = toggle.checked;
              explicit.textContent = 'Explicit on save';
              explicit.disabled = true;
            }, 'button secondary outline-action');
            explicit.setAttribute('aria-label', 'Add explicit ' + action + ' setting for ' + label.toLowerCase());
            cell.append(explicit);
          }
        } else {
          const enabled = role === 'super_admin' ? value : allowed && moduleEnabled && value;
          cell.append(element('span', enabled ? 'Enabled' : 'Disabled', enabled ? 'security-enabled' : ''));
        }
        if (manageSettings && changes && allowed && delegated && !locked && current !== undefined
            && can('permissions.delete')) {
          const reset = button('Inherit', () => {
            delete changes[permission];
            cell.replaceChildren(element('span', 'Inherits on save'));
          }, 'button secondary outline-action');
          reset.setAttribute('aria-label', 'Remove explicit ' + action + ' setting for ' + label.toLowerCase());
          cell.append(reset);
        }
      }
    }
    return grid;
  }

  function roleTabs() {
    const roles = element('div', '', 'super-roles');
    for (const [key, name] of Object.entries(roleNames)) {
      if (!Object.hasOwn(snapshot.defaults, key)) continue;
      const tab = button(name, () => {
        role = key;
        selected = '';
        render();
        root.querySelector('.super-roles [aria-pressed="true"]').focus({ preventScroll: true });
      });
      tab.setAttribute('aria-pressed', String(key === role));
      roles.append(tab);
    }
    return roles;
  }

  function savePolicy(policy, changes) {
    return api('/super-admin/permission-settings/' + role, 'PUT', { ...policy, ...changes });
  }

  function accountPicker() {
    const candidates = snapshot.accounts.filter(person => person.role === role && person.status !== 'deleting');
    const person = candidates.find(item => item.id === selected);
    if (!person) selected = '';
    const picker = element('select');
    picker.setAttribute('aria-label', 'Account to configure');
    picker.add(new Option('Role defaults', ''));
    for (const item of candidates) picker.add(new Option(item.email || item.name, item.id, false, item.id === selected));
    picker.addEventListener('change', () => { selected = picker.value; render(); });
    return { person, picker };
  }

  function saveOverrides(person, permissions) {
    if (person.id === 'local-admin') return api('/super-admin/original-admin/permissions', 'PUT',
      { permissions, revision: person.permissions_revision });
    return update(person, { permissions, expected_permissions: person.permissions });
  }

  function permissionList() {
    const { person, picker } = accountPicker();
    const policy = snapshot.policies[role];
    const modules = { ...policy?.modules };
    const overrides = { ...person?.permissions };
    const editable = can('permissions.edit') && policy && snapshot.editable !== false
      && (Boolean(person) || !snapshot.editable_roles || snapshot.editable_roles.includes(role));
    const optInModules = snapshot.opt_in_modules?.[role] || [];
    const [grid, body] = table(['Module', 'Enable', 'Disable']);
    for (const [key, label] of Object.entries(snapshot.resources)) {
      const row = body.insertRow();
      const heading = element('th', label);
      heading.scope = 'row';
      row.append(heading);
      const applicable = snapshot.assignable[role].filter(permission => permission.startsWith(key + '.'));
      const inherited = modules[key] ?? !optInModules.includes(key);
      const overrideKey = 'module:' + key;
      const scope = snapshot.delegation_scope;
      const current = person ? overrides[overrideKey] : modules[key];
      const locked = scope != null && (person
        ? current === false && !person.delegated_overrides?.includes(overrideKey)
        : current === false && !policy.delegated_modules?.includes(key));
      const scoped = scope == null || applicable.every(permission => scope.includes(permission));
      for (const enabled of [true, false]) {
        const cell = row.insertCell();
        const input = element('input');
        input.type = 'radio';
        input.name = 'module-' + key;
        input.checked = enabled === (role === 'super_admin' || (applicable.length > 0 && modules[key] !== false && (person ? current ?? inherited : inherited)));
        input.disabled = !editable || !applicable.length || !scoped || locked || Boolean(person && modules[key] === false)
          || (!isSuper() && !person && !['bases','documents'].includes(key));
        input.setAttribute('aria-label', (enabled ? 'Enable ' : 'Disable ') + label);
        input.addEventListener('change', () => {
          if (person) {
            if (enabled && inherited) delete overrides[overrideKey];
            else overrides[overrideKey] = enabled;
          } else modules[key] = enabled;
        });
        cell.append(input);
      }
    }
    root.append(roleTabs(), picker, element('p', policy
      ? 'Disabling a module pauses its actions and preserves their settings. Role-level module settings apply to every account.'
      : 'Super Admin access is protected.'), grid);
    if (editable) {
      const save = button('Save module permissions', () => change(save,
        () => person ? saveOverrides(person, overrides) : savePolicy(policy, { modules })), 'button primary glass-action');
      root.append(save);
    }
  }

  function accountScope(person) {
    const fieldset = element('fieldset', '', 'super-role-status');
    fieldset.append(element('legend', 'Delegated account scope'));
    fieldset.append(element('p', 'Choose which accounts this person may administer when granted the matching actions.'));
    const values = { ...person.permissions };
    const options = [
      ['role:user', 'All User accounts'], ['role:admin', 'All managed Admin accounts'],
      ['policy:user', 'User knowledge base and document defaults'],
      ['policy:admin', 'Admin knowledge base and document defaults'],
      ...snapshot.accounts.filter(item => !item.protected && item.id !== person.id && item.status !== 'deleting')
        .map(item => [item.id, item.email || item.name]),
    ];
    for (const [target, labelText] of options) {
      const key = 'scope:' + target;
      const row = element('div');
      const label = element('label', labelText);
      const toggle = element('input');
      toggle.type = 'checkbox';
      toggle.checked = values[key] === true;
      toggle.addEventListener('change', () => {
        if (toggle.checked) values[key] = true;
        else delete values[key];
      });
      label.prepend(toggle);
      row.append(label);
      fieldset.append(row);
    }
    const save = button('Save delegated scope', () => change(save, () => saveOverrides(person, values)), 'button secondary');
    fieldset.append(save);
    return fieldset;
  }

  function matrix() {
    const { person, picker } = accountPicker();
    const policy = snapshot.policies[role];
    const editable = policy && snapshot.editable !== false
      && (Boolean(person) || !snapshot.editable_roles || snapshot.editable_roles.includes(role));
    const changes = editable ? { ...(person ? person.permissions : policy.actions) } : null;
    const grid = permissionGrid(role, person?.permissions, changes, policy, true);
    root.append(roleTabs(), picker);
    if (editable) root.append(element('p', person
      ? 'Account settings apply within enabled modules. Inherit removes an explicit setting when saved.'
      : 'These defaults apply to accounts without an override.'));
    root.append(grid);
    if (isSuper() && person) root.append(accountScope(person));
    if (editable) {
      const savePermissions = permissions => person
        ? saveOverrides(person, permissions) : savePolicy(policy, { actions: permissions });
      const save = button('Save permissions', () => change(save, () => savePermissions(changes)), 'button primary glass-action');
      root.append(save);
      if (isSuper()) {
        const reset = button(person ? 'Restore role action defaults' : 'Restore original action defaults',
          () => change(reset, () => savePermissions(Object.fromEntries(
            Object.entries(changes).filter(([key]) => key.startsWith('module:') || key.startsWith('scope:'))))), 'button secondary outline-action');
        root.append(reset);
      }
    }
  }

  function logCalendar(input, label) {
    if (!('showPopover' in HTMLElement.prototype)) return input;
    const wrapper = element('div', '', 'log-date-field');
    const calendar = element('div', '', 'log-calendar');
    calendar.id = `log-calendar-${input.name}`;
    calendar.popover = 'auto';
    calendar.setAttribute('role', 'dialog');
    calendar.setAttribute('aria-label', `${label} calendar`);
    const trigger = element('button', '', 'log-calendar-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', `Open ${label.toLowerCase()} calendar`);
    trigger.popoverTargetElement = calendar;
    wrapper.append(input, trigger, calendar);
    const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
    const dayLabel = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });
    let month;
    const dateValue = date => [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    const choose = value => {
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      calendar.hidePopover();
      trigger.focus();
    };
    function draw() {
      calendar.replaceChildren();
      const header = element('div', '', 'log-calendar-header');
      const monthTitle = element('strong', monthLabel.format(month));
      monthTitle.setAttribute('aria-live', 'polite');
      const step = (amount, label, glyph) => {
        const control = button(glyph, () => {
          month.setMonth(month.getMonth() + amount);
          draw();
          calendar.querySelector(`[data-month-step="${amount}"]`).focus();
        }, 'log-calendar-button');
        control.dataset.monthStep = amount;
        control.setAttribute('aria-label', label);
        return control;
      };
      header.append(step(-1, 'Previous month', '‹'), monthTitle, step(1, 'Next month', '›'));
      const grid = element('div', '', 'log-calendar-days');
      for (const weekday of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) grid.append(element('span', weekday));
      for (let gap = 0; gap < month.getDay(); gap++) grid.append(element('span'));
      const totalDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const today = dateValue(new Date());
      for (let day = 1; day <= totalDays; day++) {
        const date = new Date(month);
        date.setDate(day);
        const value = dateValue(date);
        const control = button(String(day), () => choose(value), 'log-calendar-button');
        control.setAttribute('aria-label', dayLabel.format(date));
        control.setAttribute('aria-pressed', String(value === input.value));
        if (value === today) control.setAttribute('aria-current', 'date');
        control.disabled = Boolean(input.min && value < input.min);
        grid.append(control);
      }
      const footer = element('div', '', 'log-calendar-footer');
      const todayButton = button('Today', () => choose(today), 'log-calendar-button');
      todayButton.disabled = Boolean(input.min && today < input.min);
      footer.append(button('Clear', () => choose(''), 'log-calendar-button'), todayButton);
      calendar.append(header, grid, footer);
    }
    calendar.addEventListener('beforetoggle', event => {
      if (event.newState !== 'open') return;
      const start = input.value || input.min;
      month = start ? new Date(`${start}T00:00:00`) : new Date();
      month.setDate(1);
      draw();
      const anchor = input.getBoundingClientRect();
      calendar.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - 298))}px`;
      calendar.style.top = `${anchor.bottom + 6}px`;
    });
    calendar.addEventListener('toggle', event => {
      if (event.newState !== 'open') return;
      const anchor = input.getBoundingClientRect();
      if (calendar.getBoundingClientRect().bottom > innerHeight - 8) {
        calendar.style.top = `${Math.max(8, anchor.top - calendar.offsetHeight - 6)}px`;
      }
    });
    return wrapper;
  }

  function logFilterForm() {
    const form = element('form', '', 'log-filters');
    const controls = element('div', '', 'log-filter-fields');
    const field = (name, label, control) => {
      control.name = name;
      control.value = logFilters[name];
      const wrapper = element('div', '', 'log-filter-field');
      const caption = element('label', label);
      control.id = `logs-${name}`;
      caption.htmlFor = control.id;
      wrapper.append(caption, control.type === 'date' ? logCalendar(control, label) : control);
      controls.append(wrapper);
      return control;
    };
    const from = element('input'); from.type = 'date';
    const to = element('input'); to.type = 'date';
    field('from', 'From', from);
    field('to', 'To', to);
    const search = element('input'); search.type = 'search'; search.placeholder = 'Name, email, role, or activity';
    field('search', 'Search', search);
    const outcome = element('select');
    outcome.append(new Option('All statuses', ''), ...Object.entries(logOutcomes).map(([value, label]) => new Option(label, value)));
    field('outcome', 'Login status', outcome);
    const apply = element('button', 'Apply', 'button primary glass-action');
    apply.type = 'submit';
    const reset = button('Reset', () => {
      logFilters = { ...emptyLogFilters };
      logBefore = {};
      load();
    }, 'button secondary outline-action');
    controls.append(apply, reset);
    form.append(controls);
    to.min = from.value;
    from.addEventListener('change', () => { to.min = from.value; });
    form.addEventListener('submit', event => {
      event.preventDefault();
      logFilters = { from: from.value, to: to.value, search: search.value.trim(), outcome: outcome.value };
      logBefore = {};
      load();
    });
    return form;
  }

  function showLogDetail(row, title, login) {
    const dialog = element('dialog', '', 'management-detail-dialog log-detail-dialog');
    const header = element('header', '', 'log-detail-header');
    const heading = element('h3', title);
    heading.id = 'log-detail-title';
    dialog.setAttribute('aria-labelledby', heading.id);
    header.append(heading, button('Close', () => dialog.close(), 'button secondary management-dismiss'));
    const description = element('dl', '', 'user-details');
    const fields = [
      ['Name', row.account?.name], ['Email', row.account?.email],
      [login ? 'User ID' : 'Actor ID', row.account_id || row.actor_id],
      ['Role', roleNames[row.role || row.account?.role]],
      ['Time', date(row.created_at)],
      [login ? 'Status' : 'Action', login ? logOutcomes[row.outcome] || row.outcome : row.action],
      ...(login ? [['IP address', row.ip_address], ['Failed attempts', row.failed_attempts]]
        : [['Target', row.target], ['Target account', row.targetAccount?.name], ['Target email', row.targetAccount?.email]]),
    ];
    for (const [label, value] of fields) {
      const detail = element('dd');
      if (label === 'Status' && value) {
        const badge = element('span', value, 'log-detail-status');
        badge.dataset.outcome = row.outcome;
        detail.append(badge);
      } else {
        detail.textContent = String(value ?? '—');
      }
      description.append(element('dt', label), detail);
    }
    dialog.append(header, description);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    root.append(dialog);
    dialog.showModal();
  }

  function auditForm(resource, operation, reference = null) {
    const title = { add: resource === 'logs' ? 'Add manual log' : 'Add manual revision',
      correct: 'Add correction', archive: 'Archive from active view', restore: 'Restore to active view' }[operation];
    const dialog = element('dialog', '', 'management-detail-dialog log-detail-dialog');
    const heading = element('h3', title);
    heading.id = 'audit-operation-title';
    dialog.setAttribute('aria-labelledby', heading.id);
    const form = element('form', '', 'audit-entry-form');
    const subject = element('select');
    if (operation === 'add') {
      const label = element('label', 'Account');
      subject.add(new Option(isSuper() ? 'Global note' : 'Select an account', ''));
      for (const person of auditData.accounts) subject.add(new Option(person.name || person.email || person.id, person.id));
      subject.required = !isSuper();
      label.append(subject);
      form.append(label);
    }
    const label = element('label', operation === 'add' ? 'Note' : 'Reason');
    const note = element('textarea');
    note.required = true;
    note.maxLength = 2000;
    note.rows = 3;
    label.append(note);
    const message = element('p');
    message.setAttribute('role', 'status');
    const submit = element('button', title, 'button primary glass-action');
    submit.type = 'submit';
    form.append(label, message, button('Cancel', () => dialog.close()), submit);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const current = revision;
      submit.disabled = true;
      const endpoint = '/super-admin/audit-journal/' + resource;
      const path = reference ? endpoint + '/' + encodeURIComponent(reference) : endpoint;
      const method = { add: 'POST', correct: 'PATCH', archive: 'DELETE', restore: 'POST' }[operation];
      try {
        await api(path + (operation === 'restore' ? '/restore' : ''), method,
          { note: note.value, ...(operation === 'add' && subject.value ? { subject: subject.value } : {}) });
        dialog.close();
        if (revision === current) await load();
      } catch (error) {
        message.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
    dialog.append(heading, form);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    root.append(dialog);
    dialog.showModal();
  }

  function auditState(reference) {
    return auditData?.annotations?.[reference] || {};
  }

  function auditRecordControls(resource, reference, subject) {
    const controls = element('div', '', 'super-row-controls');
    const state = auditState(reference);
    if (state.archived) controls.append(element('span', 'Archived'));
    if (state.correction) controls.append(element('p',
      'Correction by ' + state.correction.actor_id + ' ? ' + date(state.correction.created_at) + ' ? ' + state.correction.note));
    if (auditData && reference && (isSuper() || auditData.subjects.has(subject?.split(' / ', 1)[0]))) {
      if (resource === 'logs' && can('logs.edit')) controls.append(
        button('Add correction', () => auditForm(resource, 'correct', reference)));
      if (can(resource + '.delete')) {
        const operation = state.archived ? 'restore' : 'archive';
        controls.append(button(state.archived ? 'Restore' : 'Archive',
          () => auditForm(resource, operation, reference)));
      }
    }
    return controls;
  }

  function auditPanel(resource) {
    if (!auditData) {
      root.append(element('p', 'Audit administration is unavailable.'));
      return;
    }
    const toolbar = element('div', '', 'security-actions');
    if (can(resource + '.add') && (isSuper() || auditData.accounts.length)) toolbar.append(button(resource === 'logs' ? 'Add manual log' : 'Add manual revision',
      () => auditForm(resource, 'add')));
    const label = element('label', 'Include archived');
    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.checked = showArchived;
    toggle.addEventListener('change', () => { showArchived = toggle.checked; render(); });
    label.prepend(toggle);
    toolbar.append(label);
    root.append(toolbar);
    const journal = element('details', '', 'log-accordion');
    journal.open = journalOpen;
    journal.addEventListener('toggle', () => { if (journal.isConnected) journalOpen = journal.open; });
    const content = element('div', '', 'log-accordion-content');
    journal.append(element('summary', 'Manual entries and audit administration history'), content);
    const [grid, rows] = table(['Time', 'Actor', 'Account or record', 'Operation', 'Note']);
    for (const entry of auditData.entries) {
      const row = rows.insertRow();
      const reference = 'manual:' + entry.id;
      const archived = entry.operation === 'add' && auditState(reference).archived;
      if (archived && !showArchived) { row.remove(); continue; }
      const operation = entry.operation === 'add'
        ? resource === 'logs' ? 'Manual log' : 'Manual revision (record only)' : entry.operation;
      for (const value of [date(entry.created_at), entry.actor_id, entry.reference || entry.subject || 'Global',
        operation, entry.note]) row.insertCell().textContent = value;
      if (entry.operation === 'add') row.cells[4].append(auditRecordControls(resource, reference, entry.subject));
    }
    content.append(rows.rows.length ? grid : element('p', 'No journal entries in this batch.'));
    if (auditBefore) content.append(button('Latest journal entries', () => { auditBefore = null; load(); }));
    if (auditData.next) content.append(button('Older journal entries', () => { auditBefore = auditData.next; load(); }));
    root.append(journal);
  }

  function logs(openSections) {
    root.append(logFilterForm());
    auditPanel('logs');
    for (const [index, [key, title]] of logSections.entries()) {
      const section = element('details', '', 'log-accordion');
      section.dataset.logSection = key;
      section.open = openSections.has(key);
      const content = element('div', '', 'log-accordion-content');
      const heading = element('summary');
      heading.append(element('span', title));
      section.append(heading, content);
      root.append(section);
      const result = snapshot[index];
      if (result.status === 'rejected') {
        content.append(element('p', 'Could not load these logs. Use Refresh to try again.'));
        continue;
      }
      const { next } = result.value;
      const events = result.value.events.filter(row => showArchived || !auditState(logReference(key, row)).archived);
      heading.append(element('span', `${events.length} shown`, 'log-entry-count'));
      const login = key === 'login';
      const [grid, body] = table(login ? ['User', 'Login / attempt time', 'Logout time', 'IP address', 'Status', 'Failed attempts', 'Details']
        : ['Account', 'Time', 'Action', 'Target', 'Details']);
      for (const row of events) {
        const tr = body.insertRow();
        const userId = row.account_id || row.actor_id;
        const identity = tr.insertCell();
        identity.append(element('strong', row.account?.name || (userId ? 'Account' : 'Unidentified account')));
        const metadata = [userId, row.account?.email, roleNames[row.role || row.account?.role]].filter(Boolean).join(' · ');
        if (metadata) identity.append(element('small', metadata));
        const values = login ? [row.outcome !== 'signed_out' ? date(row.created_at) : null,
          row.outcome === 'signed_out' ? date(row.created_at) : null, row.ip_address, logOutcomes[row.outcome] || row.outcome, row.failed_attempts]
          : [date(row.created_at), row.action, row.targetAccount?.name || row.target];
        for (const value of values) tr.insertCell().textContent = value ?? '—';
        if (login && row.outcome === 'signed_in') tr.cells[4].className = 'security-enabled';
        const view = button('View', () => showLogDetail(row, title, login), 'button secondary outline-action');
        view.setAttribute('aria-label', `View ${row.account?.name || userId || 'unidentified account'} log from ${date(row.created_at)}`);
        const detail = tr.insertCell();
        detail.append(view, auditRecordControls('logs', logReference(key, row), login ? row.account_id : row.target));
      }
      const filtered = Object.values(logFilters).some(Boolean);
      content.append(events.length ? grid : element('p', filtered ? 'No matching events in this batch.' : 'No events recorded yet.'));
      if (logBefore[key]) content.append(button('Latest events', () => { delete logBefore[key]; load(); }));
      if (next) content.append(button('Older events', () => { logBefore[key] = next; load(); }));
    }
  }

  async function download(control) {
    const current = revision;
    control.disabled = true;
    try {
      const file = await exportLogs();
      if (current !== revision) return;
      const url = URL.createObjectURL(file);
      const link = element('a');
      link.href = url;
      link.download = 'login-logs.csv';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (current === revision) status.textContent = error.message;
    } finally {
      control.disabled = false;
    }
  }

  function diffRows(before, after, prefix = '') {
    const rows = [];
    const nested = value => value && typeof value === 'object' && !Array.isArray(value);
    for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const oldValue = before[field], newValue = after[field];
      const label = prefix + field.replaceAll('_', ' ').replaceAll('.', ' / ');
      if (nested(oldValue) || nested(newValue)) {
        rows.push(...diffRows(oldValue ?? {}, newValue ?? {}, label + ' / '));
      } else if (oldValue !== newValue) {
        rows.push([label, oldValue, newValue]);
      }
    }
    return rows;
  }

  function revisionHistory() {
    auditPanel('revisions');
    if (snapshot.cloud_available === false) root.append(element('p', 'Supabase revision history is unavailable.'));
    const revisions = snapshot.revisions.filter(item => showArchived || !auditState(revisionReference(item)).archived);
    if (!revisions.length) root.append(element('p', 'No revisions in this view.'));
    const kinds = { 'account-created': 'Account creation', account: 'Account details, role and permissions', 'admin-role': 'Admin role', 'upload-policy': 'Account upload policy' };
    for (const item of revisions) {
      const reference = revisionReference(item);
      const section = element('section', '', 'super-log-section revision-entry');
      const heading = element('h3', item.revision_id);
      const time = element('time', date(item.created_at));
      time.dateTime = item.created_at;
      const metadata = element('div', '', 'revision-meta');
      metadata.append(heading, time);
      const targetLabels = { 'policy:admin': 'Admin role permissions', 'policy:user': 'User role permissions',
        'account:local-admin': 'Original Admin permissions', 'status:local-admin': 'Original Admin access status' };
      const target = item.kind === 'security' ? targetLabels[item.target] : `${kinds[item.kind]} · ${item.target}`;
      section.append(metadata, element('p', target), element('p', `Changed by ${item.actor_id}`));
      if (item.reversed_revision) section.append(element('p', `Reversed ${item.reversed_revision}`));
      const details = element('details');
      details.append(element('summary', 'Diff View'));
      const [grid, body] = table(['Setting', 'Before', 'After']);
      const format = value => value === undefined ? 'Default' : typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : String(value);
      for (const [label, before, after] of diffRows(item.before_state, item.after_state)) {
        const row = body.insertRow();
        for (const value of [label, format(before), format(after)]) row.insertCell().textContent = value;
      }
      const reverse = button('Reverse', async () => {
        const current = revision;
        const confirmed = await confirmRevision(`Reverse ${item.revision_id}?`,
          'This restores the values in the Before column and records the reversal in history.');
        if (!confirmed || current !== revision) return;
        reverse.disabled = true;
        try {
          const result = await api(`/super-admin/revisions/${encodeURIComponent(item.revision_id)}/reverse`, 'POST');
          if (current !== revision) return;
          revisionBefore = null;
          await load();
          if (mode === 'revisions' && revision === current + 1) status.textContent = `Reversed ${item.revision_id}. Recorded as ${result.revision_id}.`;
        } catch (error) {
          if (current === revision) status.textContent = error.message;
        } finally { reverse.disabled = false; }
      }, 'button secondary outline-action');
      details.append(grid);
      if ((isSuper() && item.kind !== 'account-created' && item.after_state.status !== 'deleting')
          || item.can_reverse === true) details.append(reverse);
      section.append(details, auditRecordControls('revisions', reference, item.target));
      root.append(section);
    }
    if (revisionBefore) root.append(button('Latest revisions', () => { revisionBefore = null; load(); }));
    if (snapshot.next) root.append(button('Older revisions', () => { revisionBefore = snapshot.next; load(); }));
  }

  function header() {
    root.replaceChildren();
    root.hidden = false;
    root.classList.toggle('super-dashboard-view', mode === 'dashboard');
    const heading = element('div', '', 'security-heading');
    heading.append(element('h2', titles[mode]));
    const buttons = element('div', '', 'security-actions');
    buttons.append(button('Refresh', load, 'button secondary outline-action'));
    if (mode === 'login-logs') {
      const exportButton = button('Export CSV', () => download(exportButton), 'button primary glass-action');
      buttons.append(exportButton);
    }
    heading.append(buttons);
    root.append(heading);
    status = element('p');
    status.setAttribute('role', 'status');
    root.append(status);
  }

  function render() {
    const openSections = new Set([...root.querySelectorAll('.log-accordion[open]')].map(section => section.dataset.logSection));
    header();
    ({ dashboard: overview, 'user-details-add': () => {
      root.append(accountForm(true));
      if (invitation === 'created') status.textContent = 'User account created.';
      else if (invitation) root.append(inviteResult());
    }, roles: accounts, 'user-uploads': uploads, 'permission-list': permissionList, permissions: matrix, 'login-logs': () => logs(openSections), revisions: revisionHistory })[mode]();
  }

  function show(page) {
    if (page !== 'roles' && page !== 'user-details-add') invitation = '';
    if (page !== mode) {
      logBefore = {}; revisionBefore = null; auditBefore = null; auditData = null; showArchived = false; journalOpen = false; logAccounts = null; logFilters = { ...emptyLogFilters };
    }
    mode = page;
    if (!Object.hasOwn(titles, page) || (!isSuper() && (!Object.hasOwn(pagePermissions, page) || !can(pagePermissions[page])))) {
      ++revision;
      root.hidden = true;
      root.replaceChildren();
      return;
    }
    header();
    load();
  }

  function reset() {
    show('');
    snapshot = undefined;
    selected = '';
    role = 'admin';
  }
  return { show, reset };
}
