// Browser speech recognition with explicit user-controlled recording sessions.
export function createVoiceInput({ Recognition, read, write, changed }) {
  let phase = 'idle', recognizer = null, original = '', message = '', interim = '';
  let completion = null;
  function settle(ok) { const resolve = completion; completion = null; if (resolve) resolve(ok); }
  const snapshot = () => ({ supported: Boolean(Recognition), phase, pending: Boolean(recognizer) && phase !== 'listening', message, interim });
  const notify = () => changed(snapshot());
  function end(next) {
    if (!recognizer) { phase = next; notify(); return; }
    phase = next; interim = ''; notify();
    try { recognizer.stop(); } catch { recognizer = null; settle(false); notify(); }
  }
  function start(language = 'en-US') {
    if (!Recognition || recognizer || phase === 'listening') return;
    if (phase === 'idle') original = read();
    const prefix = read().trimEnd();
    const current = new Recognition();
    recognizer = current; phase = 'listening'; message = ''; interim = '';
    current.lang = language; current.continuous = true; current.interimResults = true;
    current.onresult = event => {
      if (recognizer !== current) return;
      const final = [], partial = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        (result.isFinal ? final : partial).push(result[0].transcript.trim());
      }
      const text = [prefix, ...final].filter(Boolean).join(' ');
      write(text.slice(0, 12000));
      interim = partial.join(' ');
      if (text.length >= 12000) { message = 'Question limit reached. Review your text.'; end('idle'); }
      notify();
    };
    current.onerror = event => {
      if (recognizer !== current) return;
      const errors = {
        'not-allowed': 'Microphone access was denied. Allow it in your browser settings and try again.',
        'service-not-allowed': 'Speech recognition is unavailable in this browser. Try a supported browser or type your query.',
        'audio-capture': 'No microphone was found. Connect a microphone and try again.',
        'network': 'Voice recognition could not connect. Check your internet connection and try again.',
        'no-speech': 'No speech detected. Resume when you are ready.',
        'language-not-supported': 'This speech language is unavailable. Choose another language or type your query.'
      };
      message = errors[event.error] || 'Voice recognition stopped. Review your text and try again.';
      phase = event.error === 'no-speech' ? 'paused' : 'idle'; interim = '';
      // Ignore late results from a failed session; keep confirmed text.
      recognizer = null; current.abort(); settle(false); notify();
    };
    current.onend = () => {
      if (recognizer !== current) return;
      recognizer = null; interim = '';
      if (phase === 'listening') { phase = 'paused'; message = 'Microphone paused. Select Resume to continue.'; }
      settle(true);
      notify();
    };
    notify();
    try { current.start(); }
    catch { recognizer = null; phase = 'idle'; message = 'Could not start the microphone. Try again or type your query.'; notify(); }
  }
  function cancel({ restore = true } = {}) {
    const current = recognizer;
    recognizer = null;
    const active = phase !== 'idle' || Boolean(current);
    phase = 'idle'; interim = ''; message = '';
    if (current) current.abort();
    settle(false);
    if (active && restore) write(original);
    notify();
  }
  return {
    snapshot, start,
    finish() {
      if (!recognizer) { phase = 'idle'; notify(); return Promise.resolve(true); }
      return new Promise(resolve => {
        if (completion) { resolve(false); return; }
        completion = resolve;
        message = 'Finishing voice input before sending...';
        if (phase === 'listening') end('idle');
        else { phase = 'idle'; notify(); }
      });
    },
    pause(reason = '') { if (phase === 'listening') { message = reason; end('paused'); } },
    stop() { if (phase !== 'idle') { message = 'Voice input ready. Review your query before sending.'; end('idle'); } },
    cancel
  };
}
