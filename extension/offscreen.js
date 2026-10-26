// Offscreen document: holds the meeting tab's audio stream while Tafsiri listens, and reports each
// transcribed line to the background, which forwards it to the overlay on that tab. Every report
// carries the overlay's generation number, so the overlay can drop news from an older start.
let current = null; // { tabId, gen, listener, stream }

function report(state, msg) {
  chrome.runtime.sendMessage({ ...msg, target: 'background', tabId: state.tabId, gen: state.gen }).catch(() => {});
}

async function start({ streamId, tabId, gen, spokenHint }) {
  stop();
  const st = { tabId, gen, listener: null, stream: null };
  current = st;
  try {
    st.stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    });
    if (current !== st) throw new Error('stopped');
    const listener = await TafsiriListener.startListening(st.stream, {
      workletUrl: chrome.runtime.getURL('audio-worklet.js'),
      spokenHint,
      onLine: (line) => report(st, { type: 'audio-line', ...line }),
      onState: (s) => report(st, { type: 'audio-state', ...s }),
      onStats: (s) => report(st, { type: 'audio-stats', ...s }),
    });
    // A stop that arrived while the model was loading wins.
    if (current !== st) {
      listener.stop();
      return;
    }
    st.listener = listener;
  } catch (e) {
    if (st.stream) st.stream.getTracks().forEach((t) => t.stop());
    if (current === st) {
      current = null;
      if (e.message !== 'stopped') report(st, { type: 'audio-state', state: 'error', code: e.code || '', message: e.message || String(e) });
    }
  }
}

function stop() {
  const st = current;
  current = null;
  if (!st) return;
  if (st.listener) st.listener.stop();
  else if (st.stream) st.stream.getTracks().forEach((t) => t.stop());
  // Without a listener yet, nobody else reports the stop.
  if (!st.listener) report(st, { type: 'audio-state', state: 'stopped', message: '' });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  const mine = !!current && (msg.tabId == null || current.tabId === msg.tabId);
  if (msg.type === 'start') {
    start(msg);
    sendResponse(true);
  } else if (msg.type === 'stop') {
    // False tells the background there was nothing to stop, so it cleans up itself.
    if (mine) stop();
    sendResponse(mine);
  } else if (msg.type === 'update') {
    // Answer false when no live listener took the update, so the background starts a fresh one.
    const live = mine && !!current.listener;
    if (live) {
      if (msg.gen != null) current.gen = msg.gen;
      current.listener.setOptions({ spokenHint: msg.spokenHint });
      report(current, { type: 'audio-state', state: 'listening' });
    }
    sendResponse(live);
  }
});
