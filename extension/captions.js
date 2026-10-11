// Content script: reads the meeting's own live captions and hands each caption turn to the overlay.
// It never touches audio. The user must switch captions on in the meeting.
(() => {
  // A newer copy (after an extension update or reinstall) replaces any older one in this page.
  if (typeof window.__tafsiriStop === 'function') window.__tafsiriStop();

  const { cleanLines } = globalThis.TafsiriText;
  const SKIP = 'button, [role="button"], [aria-hidden="true"], i, .material-icons, .material-icons-extended, .google-symbols';
  const CAPTION_LABEL = /caption|subtitle|untertitel|sous-titre|subt[ií]tulo|legenda|sottotitol/i;

  // Largest ancestor of `img` (below `stop`) that still holds only this one avatar: one speaker turn.
  function turnOf(img, stop) {
    let el = img;
    while (el.parentElement && el.parentElement !== stop && el.parentElement.querySelectorAll('img').length === 1) {
      el = el.parentElement;
    }
    return el;
  }

  function linesOf(el) {
    const junk = [...el.querySelectorAll(SKIP)].map((n) => (n.innerText || '').trim()).filter(Boolean);
    return cleanLines(el.innerText, junk);
  }

  // Speaker on the first line, caption text on the rest. `key` identifies the turn across scans.
  // In a named turn, a single line is the speaker's name before any words arrive: skip it.
  function blockFromLines(el, key = el, named = false) {
    const lines = linesOf(el);
    if (lines.length === 0 || (named && lines.length === 1)) return null;
    if (lines.length === 1) return { key, speaker: '', text: lines[0] };
    return { key, speaker: lines[0], text: lines.slice(1).join(' ') };
  }

  // One turn per speaker avatar; with no avatars, the whole box is one turn. The avatar img is the
  // key because the element around it can change as other speakers' turns come and go.
  function avatarBlocks(box) {
    const imgs = [...box.querySelectorAll('img')];
    if (imgs.length === 0) {
      const b = blockFromLines(box);
      return b ? [b] : [];
    }
    return imgs.map((img) => blockFromLines(turnOf(img, box), img, true)).filter(Boolean);
  }

  // The page plus any same-origin frames (Zoom's web client runs inside one).
  function docs() {
    const out = [document];
    for (const f of document.querySelectorAll('iframe')) {
      try {
        if (f.contentDocument) out.push(f.contentDocument);
      } catch {}
    }
    return out;
  }

  const platforms = [
    {
      name: 'Google Meet',
      match: () => location.hostname === 'meet.google.com',
      container: (doc) =>
        doc.querySelector('[role="region"][aria-label="Captions"]') ||
        [...doc.querySelectorAll('[role="region"][aria-label]')].find((n) => CAPTION_LABEL.test(n.getAttribute('aria-label'))) ||
        doc.querySelector('.a4cQT'),
      blocks: avatarBlocks,
    },
    {
      name: 'Microsoft Teams',
      match: () => /(^|\.)teams\.(microsoft|live)\.com$|^teams\.cloud\.microsoft$/.test(location.hostname),
      container: (doc) =>
        doc.querySelector('[data-tid="closed-caption-v2-window-wrapper"]') ||
        doc.querySelector('[data-tid="closed-captions-renderer"]') ||
        doc.querySelector('[data-tid="closed-caption-text"]')?.closest('[role="log"], [aria-live], div[class*="caption" i]') ||
        null,
      blocks(box) {
        const texts = [...box.querySelectorAll('[data-tid="closed-caption-text"]')];
        return texts
          .map((t) => {
            const turn = t.closest('.fui-ChatMessageCompact') || t.parentElement?.parentElement || t;
            const author = turn.querySelector('[data-tid="author"]');
            const text = cleanLines(t.innerText).join(' ');
            return text ? { key: turn, speaker: author ? author.innerText.trim() : '', text } : null;
          })
          .filter(Boolean);
      },
    },
    {
      name: 'Zoom',
      match: () => /(^|\.)zoom\.(us|com)$/.test(location.hostname),
      container: (doc) =>
        doc.querySelector('#live-transcription-subtitle') ||
        doc.querySelector('.live-transcription-subtitle__box') ||
        doc.querySelector('[class*="live-transcription-subtitle"]'),
      blocks(box) {
        const items = [...box.querySelectorAll('.live-transcription-subtitle__item')];
        const els = items.length ? items : [box];
        return els
          .map((el) => {
            const text = cleanLines(el.innerText).join(' ');
            return text ? { key: el, speaker: '', text } : null;
          })
          .filter(Boolean);
      },
    },
  ];

  // Any other meeting site: look for a region labelled as captions.
  const generic = {
    name: 'this site',
    container: (doc) =>
      [...doc.querySelectorAll('[aria-label]')].find(
        (n) => CAPTION_LABEL.test(n.getAttribute('aria-label')) && (n.innerText || '').trim().length > 0,
      ) || null,
    blocks: avatarBlocks,
  };

  const platform = platforms.find((p) => p.match()) || generic;

  const listeners = new Set();
  const emit = (msg) => listeners.forEach((fn) => fn(msg));
  const tracker = globalThis.TafsiriTracker.createTracker(emit);
  let lastStatus = '';
  let timer = 0;

  function find() {
    for (const doc of docs()) {
      const box = platform.container(doc);
      if (box) return box;
    }
    return null;
  }

  function scan() {
    const box = find();
    const s = box ? 'listening' : 'no-captions';
    if (s !== lastStatus) {
      lastStatus = s;
      emit({ type: 'status', state: s, platform: platform.name });
    }
    if (box) tracker.update(platform.blocks(box));
  }

  function stop() {
    clearInterval(timer);
    timer = 0;
    listeners.clear();
  }

  window.__tafsiriStop = stop;

  // The overlay subscribes when it opens; scanning only runs while someone listens.
  globalThis.TafsiriCaptions = {
    platform: platform.name,
    known: platform !== generic,
    subscribe(fn) {
      listeners.add(fn);
      if (!timer) timer = setInterval(scan, 400);
      fn({ type: 'status', state: lastStatus || 'no-captions', platform: platform.name });
      tracker.replay();
      return () => {
        listeners.delete(fn);
        if (!listeners.size) {
          clearInterval(timer);
          timer = 0;
        }
      };
    },
  };
})();
