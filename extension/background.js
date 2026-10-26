// Toolbar icon (or Alt+Shift+T) opens Tafsiri on the current tab and, in audio mode, lets it hear
// that tab. Chrome only allows tab audio capture after such a click, so the click is what starts
// listening. Lines from the offscreen listener are relayed to the overlay on the right tab.
//
// Only one tab is heard at a time. Which one is kept in chrome.storage.session, because the
// service worker can be stopped at any moment and must not forget it.
const FILES = ['lib/text.js', 'lib/tracker.js', 'lib/chunks.js', 'captions.js', 'overlay-css.js', 'overlay.js'];

// ---------- the active listener ----------

async function getActive() {
  const { active = null } = await chrome.storage.session.get('active');
  return active; // { tabId, gen, state: 'starting' | 'listening' } or null
}
const setActive = (active) => chrome.storage.session.set({ active });

async function hasOffscreen() {
  try {
    return await chrome.offscreen.hasDocument();
  } catch {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return ctx.length > 0;
  }
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Hear the meeting tab so its speech can be transcribed and translated on this computer.',
  });
}

async function closeOffscreen() {
  try {
    if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  } catch {}
}

const toOffscreen = (msg) => chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => false);
const toTab = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

async function startAudio(tabId, opts = {}) {
  const { spokenHint = '', gen = 0 } = opts;
  try {
    const active = await getActive();
    // Already hearing this tab: just apply the new options and say so again.
    if (active && active.tabId === tabId && (await hasOffscreen())) {
      if (await toOffscreen({ type: 'update', tabId, gen, spokenHint })) {
        await setActive({ ...active, gen });
        return { ok: true };
      }
      // That listener is gone or shutting down: start over.
      await setActive(null);
      await closeOffscreen();
    }
    // Hearing another tab: tell it, and let the new tab take over.
    if (active && active.tabId !== tabId) {
      await toOffscreen({ type: 'stop', tabId: active.tabId });
      toTab(active.tabId, { type: 'audio-state', state: 'stopped', gen: active.gen, message: 'Tafsiri is now listening to another tab.' });
      await setActive(null);
      await closeOffscreen();
    }

    let streamId;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (e) {
      const msg = String(e && e.message);
      if (/invoked|activeTab/i.test(msg)) return { ok: false, code: 'needs-click' };
      if (/active stream/i.test(msg)) return { ok: false, code: 'error', message: "Chrome is still holding this tab's sound from before. Reload the meeting tab and try again." };
      return { ok: false, code: 'error', message: msg };
    }
    await setActive({ tabId, gen, state: 'starting' });
    await ensureOffscreen();
    // The new document may still be loading its scripts; retry briefly until it answers.
    for (let i = 0; i < 20; i++) {
      if (await toOffscreen({ type: 'start', streamId, tabId, gen, spokenHint })) return { ok: true };
      await new Promise((r) => setTimeout(r, 100));
    }
    await setActive(null);
    await closeOffscreen();
    return { ok: false, code: 'error', message: 'The listener did not start.' };
  } catch (e) {
    return { ok: false, code: 'error', message: String((e && e.message) || e) };
  }
}

// Ask the listener on this tab (and only this tab) to stop. The document closes once it reports back.
async function stopAudio(tabId) {
  const active = await getActive();
  if (!active || active.tabId !== tabId) return;
  if (!(await toOffscreen({ type: 'stop', tabId }))) {
    // No answer: the document is gone or stuck. Clean up anyway.
    await setActive(null);
    await closeOffscreen();
  }
}

// ---------- messages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;

  // From the offscreen listener: pass lines and state on to that tab's overlay.
  if (msg.target === 'background') {
    toTab(msg.tabId, msg);
    if (msg.type === 'audio-state') {
      (async () => {
        const active = await getActive();
        // Only news from the current listener counts; an older start may still be shutting down.
        if (!active || active.tabId !== msg.tabId || (msg.gen != null && active.gen != null && msg.gen !== active.gen)) return;
        if (msg.state === 'listening') await setActive({ ...active, state: 'listening' });
        if (msg.state === 'stopped' || msg.state === 'error') {
          await setActive(null);
          await closeOffscreen();
        }
      })();
    }
    return;
  }

  // From an overlay.
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return;
  if (msg.type === 'audio-start') {
    startAudio(tabId, msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'audio-update') {
    (async () => {
      const active = await getActive();
      if (active && active.tabId === tabId) await toOffscreen({ type: 'update', tabId, spokenHint: msg.spokenHint });
    })();
    return;
  }
  if (msg.type === 'audio-stop') stopAudio(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => stopAudio(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) stopAudio(tabId);
});

// ---------- toolbar icon ----------

chrome.action.onClicked.addListener(async (tab) => {
  let reply;
  try {
    reply = await chrome.tabs.sendMessage(tab.id, { type: 'icon' });
  } catch {
    // Tafsiri is not on this page yet (another site, or a tab opened before install): add it.
    // The click grants activeTab, so this works on any normal web page.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
      await chrome.tabs.sendMessage(tab.id, { type: 'open' });
    } catch {
      // Chrome's own pages (chrome://, the Web Store) cannot be scripted.
    }
    return;
  }
  // The overlay was waiting for this click to start hearing the tab.
  if (reply && reply.wantAudio) {
    const res = await startAudio(tab.id, reply);
    if (!res.ok) toTab(tab.id, { type: 'audio-state', state: 'error', gen: reply.gen, code: res.code, message: res.message || '' });
  }
});

// ---------- install ----------

// On update the old copies are orphaned, so always add the new one (it stops the old). On a fresh
// install, skip tabs where the declared content script already ran, so two copies never race.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await setActive(null);
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
