// Dev only: a stand-in for the few chrome.* APIs the content scripts use, so the overlay runs on a
// normal localhost page. window.__tafsiriToolbar() plays the part of the toolbar button.
(() => {
  const listeners = [];
  const store = {};
  window.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn), removeListener() {} },
      sendMessage: () => Promise.resolve(),
    },
    storage: {
      local: {
        get: async () => JSON.parse(JSON.stringify(store)),
        set: async (v) => Object.assign(store, v),
      },
    },
  };
  window.__tafsiriToolbar = () => listeners.forEach((fn) => fn({ type: 'toggle' }, {}));
})();
