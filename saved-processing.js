// Runs only in the open User Dashboard. Page progress/retries stay on the server.
export function createSavedProcessor({ canRun, process, onStart, onFinish, onError }) {
  let generation = 0, running = false, scheduled = false, active = null;
  const queue = new Map();
  function reset() { generation++; queue.clear(); running = false; scheduled = false; active = null; }
  function enqueue(rows) {
    const ids = new Set(rows.map(row => row.id));
    for (const id of queue.keys()) if (!ids.has(id)) queue.delete(id);
    for (const row of rows) if (row.id !== active) queue.set(row.id, row);
    kick();
  }
  function kick() {
    if (scheduled || running || !queue.size) return;
    scheduled = true;
    const version = generation;
    queueMicrotask(() => {
      if (version !== generation) return;
      scheduled = false;
      if (!canRun() || running || !queue.size) return;
      void advance(version);
    });
  }
  async function advance(version) {
    const [id, row] = queue.entries().next().value; queue.delete(id);
    active = id; running = true;
    const current = () => version === generation;
    let result;
    try { onStart(row); result = await process(row, current); }
    catch (error) { if (current()) onError(error); }
    finally {
      if (current()) {
        try { await onFinish(row, result, current); }
        catch (error) { if (current()) onError(error); }
        if (current()) { active = null; running = false; kick(); }
      }
    }
  }
  return { enqueue, kick, reset };
}
