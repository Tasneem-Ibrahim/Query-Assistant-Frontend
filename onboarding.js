// Completion is saved on the account through the authenticated backend.
export function createWorkspaceGuide({ dialog, close, later, start, error, complete, create }) {
  let epoch = 0, user = null, busy = false;
  const buttons = [close, later, start];
  const setBusy = value => { busy = value; for (const button of buttons) button.disabled = value; };

  function reset() {
    epoch++;
    user = null;
    setBusy(false);
    error.hidden = true;
    if (dialog.open) dialog.close();
  }

  function show(account, domains) {
    if (!account || account.role !== 'user' || account.onboarding_seen || domains.length || dialog.open) return false;
    user = account;
    error.hidden = true;
    dialog.showModal();
    return true;
  }

  async function finish(createBase) {
    if (!user || busy) return;
    const current = epoch, account = user;
    setBusy(true);
    error.hidden = true;
    try {
      await complete();
      if (current !== epoch) return;
      account.onboarding_seen = true;
      dialog.close();
      user = null;
      if (createBase) create();
    } catch {
      if (current !== epoch) return;
      error.textContent = 'We could not save your welcome preference. Please try again.';
      error.hidden = false;
    } finally { if (current === epoch) setBusy(false); }
  }

  close.addEventListener('click', () => finish(false));
  later.addEventListener('click', () => finish(false));
  start.addEventListener('click', () => finish(true));
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
  return { show, reset };
}
