export function createSuperAdminPanel({ api, user, openWorkspace, openKnowledgeBases, confirmDeletion, exportLogs }) {
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
  let revisionBefore = null;
  const logSections = [
    ['login', 'Login / Logout Logs'],
    ['user-details', 'User Details Logs'],
    ['knowledge-base', 'Knowledge Base Logs'],
    ['role-management', 'Role Management Logs'],
  ];
  const settingsPages = ['permission-list', 'permissions'];
  const titles = {
    dashboard: 'Super Admin dashboard', roles: 'Role Management',
    'permission-list': 'Permissions List', permissions: 'Permission Matrix', 'login-logs': 'Logs Management', revisions: 'Revision',
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
        : settingsPages.includes(mode) ? '/super-admin/permission-settings' : '/super-admin/overview';
      const data = mode === 'login-logs' ? await Promise.allSettled(logSections.map(([key]) => {
        const endpoint = key === 'login' ? 'login-logs' : `activity-logs/${key}`;
        return api('/super-admin/' + endpoint + (logBefore[key] ? '?before=' + logBefore[key] : ''));
      })) : await api(path);
      if (current !== revision) return;
      snapshot = data;
      render();
    } catch (error) {
      if (current === revision) status.textContent = error.message;
    }
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

  function accountForm() {
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
    choices.addEventListener('change', showPermissions);
    method.addEventListener('change', () => {
      const invite = method.value === 'invite';
      const password = inputs.password;
      password.parentElement.hidden = invite;
      password.disabled = invite;
      password.required = !invite;
      if (invite) password.value = '';
      submit.textContent = invite ? 'Generate invitation link' : 'Create account';
    });
    showPermissions();
    form.append(fields, element('h3', 'Assigned permissions'), permissions, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const current = revision;
      change(submit, async () => {
        const data = { ...Object.fromEntries(new FormData(form)), permissions: changes };
        const result = await api('/super-admin/accounts', 'POST', data);
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
    const form = accountForm();
    const add = element('details', '', 'super-account-disclosure');
    add.append(element('summary', 'Create or invite an account'), form);
    const [grid, body] = table(['Account', 'Role', 'Status', 'Created', 'Updated', 'Actions']);
    grid.classList.add('super-directory');
    for (const person of snapshot.accounts) {
      const tr = body.insertRow();
      const identity = tr.insertCell();
      identity.append(element('strong', person.name || person.email), element('small', person.email || 'Protected sign-in'));
      const roleCell = tr.insertCell();
      if (person.protected || person.status === 'deleting') {
        roleCell.textContent = roleNames[person.role];
      } else {
        const select = element('select');
        select.setAttribute('aria-label', 'Role for ' + person.name);
        for (const value of ['admin', 'user']) {
          const option = new Option(roleNames[value], value, false, person.role === value);
          option.disabled = value === 'admin' && person.role !== 'admin' && snapshot.admin_role_active === false;
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
      if (person.status !== 'deleting') {
        actions.append(
          button('Open Workspace', () => openWorkspace(person, status), 'button secondary open-workspace-action'),
          button('Knowledge Bases', () => openKnowledgeBases(person, status), 'button secondary open-workspace-action'),
        );
      }
      const cell = element('div', '', 'super-row-controls');
      if (person.role === 'admin' && person.status !== 'deleting') adminAccessControls(person, cell);
      if (!person.protected && person.status !== 'deleting') {
        const next = person.status === 'active' ? 'inactive' : 'active';
        const toggle = button(next === 'inactive' ? 'Deactivate' : 'Reactivate',
          () => change(toggle, () => update(person, { status: next })),
          next === 'inactive' ? 'button secondary super-danger' : 'button secondary outline-action');
        cell.append(toggle);
      }
      if (!person.protected && person.status !== 'active') {
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
    root.append(roleStatus());
    if (invitation) root.append(inviteResult());
    root.append(add, grid);
  }

  function permissionGrid(role, overrides, changes, policy = {}) {
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
        const moduleDisabled = policy.modules?.[key] === false;
        if (key === 'user_uploads' && changes && allowed) {
          const checkbox = element('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'upload-permission-checkbox';
          checkbox.checked = !moduleDisabled && values[permission];
          checkbox.disabled = moduleDisabled;
          checkbox.setAttribute('aria-label', action + ' user uploads');
          if (moduleDisabled) cell.title = 'Enable User uploads in Permissions List first.';
          checkbox.addEventListener('change', () => {
            changes[permission] = checkbox.checked;
          });
          cell.append(checkbox);
        } else if (moduleDisabled) {
          cell.textContent = 'Disabled';
        } else if (changes && allowed) {
          const toggle = element('input');
          toggle.type = 'checkbox';
          toggle.setAttribute('role', 'switch');
          toggle.setAttribute('aria-label', action + ' ' + label.toLowerCase());
          toggle.checked = values[permission];
          toggle.addEventListener('change', () => { changes[permission] = toggle.checked; });
          cell.append(toggle);
        } else {
          cell.append(element('span', values[permission] ? 'Enabled' : 'Disabled',
            values[permission] ? 'security-enabled' : ''));
        }
      }
    }
    return grid;
  }

  function roleTabs() {
    const roles = element('div', '', 'super-roles');
    for (const [key, name] of Object.entries(roleNames)) {
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

  function permissionList() {
    const policy = snapshot.policies[role];
    const modules = { ...policy?.modules };
    const optInModules = snapshot.opt_in_modules?.[role] || [];
    const [grid, body] = table(['Module', 'Enable', 'Disable']);
    for (const [key, label] of Object.entries(snapshot.resources)) {
      const row = body.insertRow();
      const heading = element('th', label);
      heading.scope = 'row';
      row.append(heading);
      const optIn = optInModules.includes(key);
      const available = optIn || snapshot.assignable[role].some(permission => permission.startsWith(key + '.'));
      for (const enabled of [true, false]) {
        const cell = row.insertCell();
        const input = element('input');
        input.type = 'radio';
        input.name = 'module-' + key;
        input.checked = enabled === (role === 'super_admin' || (available && (optIn ? modules[key] === true : modules[key] !== false)));
        input.disabled = !policy || !available;
        input.setAttribute('aria-label', (enabled ? 'Enable ' : 'Disable ') + label);
        input.addEventListener('change', () => { modules[key] = enabled; });
        cell.append(input);
      }
    }
    root.append(roleTabs(), element('p', policy ? 'Disabling a module blocks all its actions for the managed role.' : 'Super Admin access is protected.'), grid);
    if (policy) {
      const save = button('Save module permissions', () => change(save, () => savePolicy(policy, { modules })), 'button primary glass-action');
      root.append(save);
    }
  }

  function matrix() {
    const candidates = snapshot.accounts.filter(person => person.role === role && person.status !== 'deleting');
    const person = candidates.find(item => item.id === selected);
    const picker = element('select');
    picker.setAttribute('aria-label', 'Account to configure');
    picker.add(new Option('Role defaults', ''));
    for (const item of candidates) picker.add(new Option(item.email || item.name, item.id, false, item.id === selected));
    picker.addEventListener('change', () => { selected = picker.value; render(); });
    const policy = snapshot.policies[role];
    const originalAdmin = person?.id === 'local-admin';
    const editable = policy && (!person?.protected || originalAdmin);
    const changes = editable ? { ...(person ? person.permissions : policy.actions) } : null;
    const grid = permissionGrid(role, person?.permissions, changes, person?.protected ? {} : policy);
    root.append(roleTabs(), picker);
    if (originalAdmin) root.append(element('p', 'These permissions control the original Admin account’s workspace and admin tools. Its sign-in stays available.'));
    else if (editable) root.append(element('p', person ? 'Account overrides apply within enabled modules.' : 'These defaults apply to accounts without an override.'));
    root.append(grid);
    if (editable) {
      const savePermissions = permissions => {
        if (originalAdmin) return api('/super-admin/original-admin/permissions', 'PUT',
          { permissions, revision: person.permissions_revision });
        if (person) return update(person, { permissions });
        return savePolicy(policy, { actions: permissions });
      };
      const save = button('Save permissions', () => change(save, () => savePermissions(changes)), 'button primary glass-action');
      const reset = button(person && !originalAdmin ? 'Restore role defaults' : 'Restore original defaults',
        () => change(reset, () => savePermissions({})), 'button secondary outline-action');
      root.append(save, reset);
    }
  }

  function logs(openSections) {
    const labels = { signed_in: 'Signed in', signed_out: 'Signed out', invalid_code: 'Invalid code', invalid_credentials: 'Invalid credentials' };
    for (const [index, [key, title]] of logSections.entries()) {
      const section = element('details', '', 'log-accordion');
      section.dataset.logSection = key;
      section.open = openSections.has(key);
      const content = element('div', '', 'log-accordion-content');
      section.append(element('summary', title), content);
      root.append(section);
      const result = snapshot[index];
      if (result.status === 'rejected') {
        content.append(element('p', 'Could not load these logs. Use Refresh to try again.'));
        continue;
      }
      const { events, next } = result.value;
      const login = key === 'login';
      const [grid, body] = table(login ? ['User ID', 'Time', 'Role', 'Outcome'] : ['Time', 'Actor ID', 'Action', 'Target']);
      for (const row of events) {
        const tr = body.insertRow();
        const values = login ? [row.account_id, date(row.created_at), roleNames[row.role], labels[row.outcome] || row.outcome]
          : [date(row.created_at), row.actor_id, row.action, row.target];
        for (const value of values) tr.insertCell().textContent = value || '—';
        if (row.outcome === 'signed_in') tr.lastElementChild.className = 'security-enabled';
      }
      content.append(events.length ? grid : element('p', 'No events recorded yet.'));
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
    if (snapshot.cloud_available === false) root.append(element('p', 'Supabase revision history is unavailable.'));
    if (!snapshot.revisions.length) root.append(element('p', 'No revisions recorded yet.'));
    const kinds = { account: 'Account details, role and permissions', 'admin-role': 'Admin role', 'upload-policy': 'Account upload policy' };
    for (const item of snapshot.revisions) {
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
        const confirmed = await confirmDeletion(`Reverse ${item.revision_id}?`,
          'This restores the values in the Before column and records the reversal in history.', 'Reverse');
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
      details.append(grid, reverse);
      section.append(details);
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
    ({ dashboard: overview, roles: accounts, 'permission-list': permissionList, permissions: matrix, 'login-logs': () => logs(openSections), revisions: revisionHistory })[mode]();
  }

  function show(page) {
    if (page !== 'roles') invitation = '';
    if (page !== mode) { logBefore = {}; revisionBefore = null; }
    mode = page;
    if (user()?.role !== 'super_admin' || !Object.hasOwn(titles, page)) {
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
