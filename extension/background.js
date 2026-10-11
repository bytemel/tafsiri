// Toolbar icon (or Alt+Shift+T) shows or hides the Tafsiri overlay on the current tab.
const FILES = ['lib/text.js', 'lib/tracker.js', 'captions.js', 'overlay-css.js', 'overlay.js'];

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle' });
  } catch {
    // Tafsiri is not on this page yet (another site, or a tab opened before install): add it.
    // The click grants activeTab, so this works on any normal web page.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
      await chrome.tabs.sendMessage(tab.id, { type: 'open' });
    } catch {
      // Chrome's own pages (chrome://, the Web Store) cannot be scripted.
    }
  }
});

// Chrome only injects content scripts into pages loaded after install. Add Tafsiri to meetings
// that are already open, so nobody has to reload (and drop out of) a call.
// On update the old copies are orphaned, so always add the new one (it stops the old). On a fresh
// install, skip tabs where the declared content script already ran, so two copies never race.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  for (const cs of chrome.runtime.getManifest().content_scripts) {
    const tabs = await chrome.tabs.query({ url: cs.matches }).catch(() => []);
    for (const tab of tabs) {
      try {
        if (reason !== 'update') {
          const [{ result: present }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => typeof window.__tafsiriOverlayStop === 'function',
          });
          if (present) continue;
        }
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js });
      } catch {}
    }
  }
});
