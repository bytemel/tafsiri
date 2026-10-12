// Dev only: a stand-in for the few chrome.* APIs the content scripts use, so the overlay runs on a
// normal localhost page. window.__tafsiriToolbar() plays the part of the toolbar button, and
// audio-start/stop run the real listener on a test clip (see meeting.html).
(() => {
  const listeners = [];
  const store = {};
  const dispatch = (msg) => new Promise((resolve) => listeners.forEach((fn) => fn(msg, {}, resolve)));
  window.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn), removeListener() {} },
      sendMessage: async (msg) => {
        if (msg.type === 'audio-start') return window.__devAudioStart(msg, dispatch);
        if (msg.type === 'audio-stop') return window.__devAudioStop();
        return undefined;
      },
      getURL: (p) => `../extension/${p}`,
    },
    storage: {
      local: {
        get: async () => JSON.parse(JSON.stringify(store)),
        set: async (v) => Object.assign(store, v),
      },
    },
  };
  window.__tafsiriToolbar = () => dispatch({ type: 'icon' });
  window.__tafsiriDispatch = dispatch;
})();
