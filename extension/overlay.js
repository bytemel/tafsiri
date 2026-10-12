// Content script: the floating Tafsiri window on top of the meeting. Drag it by the title bar,
// resize it from the corner, minimise it, or pop it out into an always-on-top picture-in-picture
// window. Speech comes from the tab's audio (heard by Gemini Nano in the offscreen listener) or from
// the meeting's captions (captions.js). Translation uses Chrome's on-device Translator API, and
// Gemini Nano for languages the translator lacks, such as Swahili.
(() => {
  if (typeof window.__tafsiriOverlayStop === 'function') window.__tafsiriOverlayStop();

  const { splitSentences } = globalThis.TafsiriText;
  const { splitIntoChunks } = globalThis.TafsiriChunks;
  const captions = globalThis.TafsiriCaptions;
  const HOST_ID = 'tafsiri-overlay';

  // Chrome's on-device translator supported these when checked on 2026-10-12 (Chrome 154).
  const LANGS = ['ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'mr', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh', 'zh-Hant'];
  // It lacked these; Gemini Nano translates them where the computer has it (quality varies).
  const NANO_LANGS = ['sw', 'am', 'ha', 'yo', 'ig', 'zu', 'xh', 'so', 'rw', 'lg', 'af', 'fa', 'ur', 'ms', 'fil'];
  const SIZES = [14, 15, 17, 19, 22, 26];
  const CHUNK_CHARS = 170;
  const MIN_W = 280;
  const MIN_H = 220;
  const names = new Intl.DisplayNames(['en'], { type: 'language' });
  const nameOf = (code) => {
    try { return names.of(code) || code; } catch { return code; }
  };

  // Swahili counts clock hours from sunrise; Nano gets this wrong without a hint.
  const SWAHILI_TIME = 'Swahili clock time starts at 6: "saa moja asubuhi" is 7 a.m., "saa nne asubuhi" is 10 a.m., "saa sita mchana" is noon, "saa moja jioni" is 7 p.m. Convert such times.';

  // ---------- storage ----------

  const store = {
    async get(keys) {
      try { return await chrome.storage.local.get(keys); } catch { return {}; }
    },
    set(v) {
      try { chrome.storage.local.set(v); } catch {}
    },
  };

  // ---------- DOM ----------

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(d) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const path of d) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', path);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '1.8');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      svg.append(p);
    }
    return svg;
  }
  // The Tafsiri mark, drawn inline so no page policy can block it.
  function logo() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('class', 'logo');
    svg.setAttribute('aria-hidden', 'true');
    const shapes = [
      ['rect', { width: 32, height: 32, rx: 7, fill: '#0f766e' }],
      ['rect', { x: 4.5, y: 6, width: 16, height: 11, rx: 3.5, fill: '#99f6e4' }],
      ['path', { d: 'M7.5 16.5l-.5 4.2 4.2-3.9z', fill: '#99f6e4' }],
      ['rect', { x: 11.5, y: 13.5, width: 16, height: 11, rx: 3.5, fill: '#ffffff' }],
      ['path', { d: 'M24.5 24l.5 4.2-4.2-3.9z', fill: '#ffffff' }],
      ['rect', { x: 14, y: 16.8, width: 11, height: 1.3, rx: 0.65, fill: '#0f766e' }],
      ['rect', { x: 14, y: 19.8, width: 7.5, height: 1.3, rx: 0.65, fill: '#0f766e' }],
    ];
    for (const [tag, attrs] of shapes) {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.append(el);
    }
    return svg;
  }

  const ICONS = {
    popOut: ['M14 4h6v6', 'M20 4l-8 8', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    popIn: ['M10 14H4v6', 'M4 20l8-8', 'M14 4h5a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-5'],
    min: ['M5 12h14'],
    max: ['M5 5h14v14H5z'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    swap: ['M7 7h11l-3-3', 'M17 17H6l3 3'],
  };

  const host = h('div', { id: HOST_ID });
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', { text: globalThis.TafsiriCSS }));

  const ui = {};
  ui.status = h('span', { class: 'status', role: 'status', 'aria-live': 'polite' });
  ui.pip = h('button', { class: 'icon pip-btn', type: 'button', 'aria-label': 'Pop out', title: 'Pop out: keep it on top of every window' }, icon(ICONS.popOut));
  ui.min = h('button', { class: 'icon min-btn', type: 'button', 'aria-label': 'Minimise', title: 'Minimise' }, icon(ICONS.min));
  ui.close = h('button', { class: 'icon close-btn', type: 'button', 'aria-label': 'Close', title: 'Close (click the Tafsiri icon to bring it back)' }, icon(ICONS.close));
  ui.bar = h('div', { class: 'bar' },
    logo(),
    h('span', { class: 'title', text: 'Tafsiri' }),
    ui.status, ui.pip, ui.min, ui.close);

  ui.modeAudio = h('button', { class: 'seg', type: 'button', 'aria-pressed': 'false', text: 'Hear audio' });
  ui.modeCaptions = h('button', { class: 'seg', type: 'button', 'aria-pressed': 'false', text: 'Read captions' });
  ui.mode = h('div', { class: 'modes', role: 'group', 'aria-label': 'Where Tafsiri gets the speech' }, ui.modeAudio, ui.modeCaptions);
  ui.from = h('select', { id: 'tf-from' });
  ui.to = h('select', { id: 'tf-to' });
  ui.swap = h('button', { class: 'swap', type: 'button', 'aria-label': 'Swap languages', title: 'Swap languages' }, icon(ICONS.swap));
  ui.start = h('button', { class: 'primary', type: 'button', text: 'Start translating' });
  ui.notice = h('p', { class: 'notice', role: 'alert', hidden: true });
  ui.download = h('button', { class: 'secondary', type: 'button', hidden: true });
  ui.controls = h('div', { class: 'controls' },
    ui.mode,
    h('div', { class: 'field' }, h('label', { for: 'tf-from', text: 'Spoken language' }), ui.from),
    ui.swap,
    h('div', { class: 'field' }, h('label', { for: 'tf-to', text: 'Translate into' }), ui.to),
    ui.start);
  ui.alerts = h('div', { class: 'alerts' }, ui.notice, ui.download);

  ui.pair = h('span', { class: 'pair' });
  ui.change = h('button', { class: 'ghost', type: 'button', text: 'Change' });
  ui.pause = h('button', { class: 'ghost accent', type: 'button', text: 'Pause' });
  ui.summary = h('div', { class: 'summary', hidden: true }, ui.pair, ui.change, ui.pause);

  ui.emptyTitle = h('h2');
  ui.emptySteps = h('ol');
  ui.empty = h('div', { class: 'empty' }, ui.emptyTitle, ui.emptySteps,
    h('p', { text: 'Everything runs on this computer. Nothing is sent anywhere and it costs nothing.' }));
  ui.turns = h('ol', { class: 'turns', 'aria-live': 'polite' });
  ui.feed = h('div', { class: 'feed', 'aria-label': 'Translated speech' }, ui.empty, ui.turns);
  ui.jump = h('button', { class: 'jump', type: 'button', text: 'Latest', hidden: true });

  ui.showOriginal = h('input', { type: 'checkbox' });
  ui.smaller = h('button', { class: 'icon', type: 'button', 'aria-label': 'Smaller text', title: 'Smaller text' }, h('span', { class: 'a-sm', text: 'A' }));
  ui.larger = h('button', { class: 'icon', type: 'button', 'aria-label': 'Larger text', title: 'Larger text' }, h('span', { class: 'a-lg', text: 'A' }));
  ui.copy = h('button', { class: 'ghost', type: 'button', text: 'Copy' });
  ui.clear = h('button', { class: 'ghost', type: 'button', text: 'Clear' });
  ui.foot = h('div', { class: 'foot' },
    h('label', { class: 'check' }, ui.showOriginal, 'Original'),
    h('div', { class: 'tools' }, ui.smaller, ui.larger, ui.copy, ui.clear));

  ui.body = h('div', { class: 'body' }, ui.summary, ui.controls, ui.alerts, ui.feed, ui.jump, ui.foot);
  ui.grip = h('div', { class: 'grip', title: 'Drag to resize' });
  ui.win = h('div', { class: 'win', role: 'dialog', 'aria-label': 'Tafsiri live translation', hidden: true }, ui.bar, ui.body, ui.grip);
  root.append(ui.win);
  document.documentElement.append(host);

  // ---------- state ----------

  const settings = { from: 'auto', to: defaultTarget(), showOriginal: false, size: 17, mode: null };
  const box = { x: null, y: 16, w: 380, h: 480, min: false };
  let open = false;
  let running = false;
  let showControls = true;
  let unsubscribe = null;
  let pipWindow = null;
  let readerStatus = { state: 'no-captions', platform: captions.platform };
  // One storage key per site, so tabs on different sites never overwrite each other.
  const HIDDEN_KEY = `hidden:${location.hostname}`;
  let stopped = false; // set when a newer copy of this script takes over the page

  // Gemini Nano, Chrome's on-device model: hears audio and translates languages the translator lacks.
  const nano = { audio: 'unavailable', text: 'unavailable' };
  let nanoBase = null;
  let nanoLoading = null;

  // Audio mode: 'off' | 'starting' | 'listening' | 'waiting-click' | 'error'
  let audioState = 'off';
  let audioTurn = null;
  let audioSeq = 0;
  let audioGen = 0; // bumped on every start, so news from an older start is ignored

  const turns = new Map(); // id -> turn { id, speaker, text, lang, final, chunks: [] }
  const translators = new Map(); // "src>tgt" -> Promise<Translator>
  const engines = new Map(); // "src>tgt" -> Promise<{ kind, tr }>
  const cache = new Map(); // "src>tgt|text" -> translation
  let detector = null;
  let detectorLoading = null;
  let lastLang = 'en';
  let pendingPair = null;
  let recentEls = [];

  function defaultTarget() {
    const base = (navigator.language || 'en').split('-')[0];
    return LANGS.includes(base) ? base : 'en';
  }

  const mode = () => settings.mode || 'captions';
  const nanoTextOk = () => nano.text !== 'unavailable';
  const nanoAudioOk = () => nano.audio !== 'unavailable';

  // ---------- geometry ----------

  function clampBox() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    box.w = Math.max(MIN_W, Math.min(box.w, vw - 16));
    box.h = Math.max(MIN_H, Math.min(box.h, vh - 16));
    if (box.x == null) box.x = vw - box.w - 16;
    box.x = Math.max(8, Math.min(box.x, vw - box.w - 8));
    box.y = Math.max(8, Math.min(box.y, vh - 48));
  }

  function applyBox() {
    if (pipWindow) return;
    clampBox();
    Object.assign(ui.win.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    ui.win.classList.toggle('min', box.min);
    ui.min.replaceChildren(icon(box.min ? ICONS.max : ICONS.min));
    ui.min.setAttribute('aria-label', box.min ? 'Expand' : 'Minimise');
    ui.min.title = box.min ? 'Expand' : 'Minimise';
  }

  const saveBox = () => store.set({ box: { ...box } });

  // Drag by the title bar, resize by the corner. Pointer capture keeps the gesture smooth even when
  // the pointer crosses the meeting's video.
  function dragger(handle, onMove, onTap) {
    handle.addEventListener('pointerdown', (e) => {
      if (pipWindow || e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const start = { px: e.clientX, py: e.clientY, x: box.x, y: box.y, w: box.w, h: box.h };
      let moved = false;
      const move = (ev) => {
        const dx = ev.clientX - start.px;
        const dy = ev.clientY - start.py;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        moved = true;
        onMove(dx, dy, start);
        applyBox();
      };
      const up = (ev) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (moved) saveBox();
        else if (ev.type === 'pointerup' && onTap) onTap();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
  // A tap (no drag) on the slim bar opens it again.
  dragger(ui.bar, (dx, dy, s) => {
    box.x = s.x + dx;
    box.y = s.y + dy;
  }, () => box.min && toggleMin());
  dragger(ui.grip, (dx, dy, s) => {
    box.w = s.w + dx;
    box.h = s.h + dy;
  });

  function onResize() {
    applyBox();
  }
  window.addEventListener('resize', onResize);

  // ---------- show / hide ----------

  function show({ minimised } = {}) {
    if (stopped) return;
    if (typeof minimised === 'boolean') box.min = minimised;
    open = true;
    ui.win.hidden = false;
    applyBox();
    if (!unsubscribe) unsubscribe = captions.subscribe(onCaption);
    store.set({ [HIDDEN_KEY]: false });
  }

  function hide() {
    open = false;
    ui.win.hidden = true;
    pause();
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    store.set({ [HIDDEN_KEY]: true });
  }

  function toggleMin() {
    box.min = !box.min;
    applyBox();
    saveBox();
  }

  // ---------- picture in picture ----------

  async function popOut() {
    if (pipWindow) {
      pipWindow.close();
      return;
    }
    if (!('documentPictureInPicture' in window)) {
      setNotice('Pop out needs a newer version of Chrome.');
      return;
    }
    try {
      pipWindow = await documentPictureInPicture.requestWindow({ width: box.w, height: box.min ? 480 : box.h });
    } catch (e) {
      pipWindow = null;
      setNotice(`Could not pop out: ${e.message || e}`);
      return;
    }
    const doc = pipWindow.document;
    doc.title = 'Tafsiri';
    doc.documentElement.style.cssText = 'height: 100%; margin: 0;';
    doc.body.style.cssText = 'height: 100%; margin: 0; overflow: hidden;';
    ui.win.classList.add('pip');
    ui.win.classList.remove('min');
    ui.pip.replaceChildren(icon(ICONS.popIn));
    ui.pip.setAttribute('aria-label', 'Back to the meeting page');
    ui.pip.title = 'Back to the meeting page';
    doc.body.append(host);
    pipWindow.addEventListener('pagehide', () => {
      pipWindow = null;
      // Closing is async: a copy stopped meanwhile must not come back to the page.
      if (stopped) return;
      ui.win.classList.remove('pip');
      ui.pip.replaceChildren(icon(ICONS.popOut));
      ui.pip.setAttribute('aria-label', 'Pop out');
      ui.pip.title = 'Pop out: keep it on top of every window';
      document.documentElement.append(host);
      applyBox();
      if (stuckToBottom) toBottom();
    });
    if (stuckToBottom) toBottom();
  }

  // ---------- settings ----------

  function fillSelects() {
    const codes = [...LANGS, ...(nanoTextOk() ? NANO_LANGS : [])].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    ui.from.replaceChildren(new Option('Auto detect', 'auto'));
    ui.to.replaceChildren();
    for (const code of codes) {
      ui.from.append(new Option(nameOf(code), code));
      ui.to.append(new Option(nameOf(code), code));
    }
  }

  function applyView() {
    if (!SIZES.includes(settings.size)) settings.size = 17;
    ui.win.style.setProperty('--tr-size', `${settings.size}px`);
    ui.win.classList.toggle('show-original', settings.showOriginal);
    ui.showOriginal.checked = settings.showOriginal;
    ui.smaller.disabled = settings.size === SIZES[0];
    ui.larger.disabled = settings.size === SIZES[SIZES.length - 1];
    ui.swap.disabled = settings.from === 'auto';
    ui.pair.textContent = `${settings.from === 'auto' ? 'Auto detect' : nameOf(settings.from)} to ${nameOf(settings.to)}`;
    ui.pair.title = mode() === 'audio' ? 'Hearing audio' : 'Reading captions';
    ui.controls.hidden = running && !showControls;
    ui.summary.hidden = !running || showControls;
    ui.modeAudio.setAttribute('aria-pressed', String(mode() === 'audio'));
    ui.modeCaptions.setAttribute('aria-pressed', String(mode() === 'captions'));
    ui.modeAudio.disabled = !nanoAudioOk();
    ui.modeAudio.title = nanoAudioOk()
      ? 'Listen to the meeting sound. No captions needed.'
      : "Needs Gemini Nano, Chrome's on-device AI, which this computer does not have.";
    ui.modeCaptions.title = "Read the meeting's own captions. Turn them on in the meeting.";
  }

  const saveSettings = () => store.set({ settings: { ...settings } });

  // ---------- translation ----------

  const pairKey = (src, tgt) => `${src}>${tgt}`;
  const sameLang = (a, b) => a === b || (a.split('-')[0] === b.split('-')[0] && !a.includes('Hant') && !b.includes('Hant'));

  function ensureTranslator(src, tgt) {
    const key = pairKey(src, tgt);
    if (translators.has(key)) return translators.get(key);
    const p = (async () => {
      if (!('Translator' in self)) throw Object.assign(new Error('No translator'), { code: 'unsupported' });
      const availability = await Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
      if (availability === 'unavailable') throw Object.assign(new Error('unsupported pair'), { code: 'unsupported' });
      try {
        return await Translator.create({
          sourceLanguage: src,
          targetLanguage: tgt,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              const pct = Math.round((e.loaded || 0) * 100);
              setNotice(pct < 100 ? `Downloading ${nameOf(src)} to ${nameOf(tgt)}: ${pct}%` : '', 'info');
            });
          },
        });
      } catch (e) {
        // Chrome only downloads a language pack right after a click.
        if (e && e.name === 'NotAllowedError') {
          throw Object.assign(new Error(`Chrome needs one click to download ${nameOf(src)} to ${nameOf(tgt)}.`), { code: 'needs-click', pair: [src, tgt] });
        }
        throw e;
      }
    })();
    translators.set(key, p);
    p.catch((e) => {
      // Only forget this attempt if a newer one has not replaced it.
      if (e.code !== 'unsupported' && translators.get(key) === p) translators.delete(key);
    });
    return p;
  }

  // Load Gemini Nano for text. Call inside a click: Chrome may need to download it first.
  function loadNano() {
    if (nanoBase) return Promise.resolve(nanoBase);
    if (nanoLoading) return nanoLoading;
    if (!nanoTextOk()) return Promise.reject(Object.assign(new Error('no nano'), { code: 'no-nano' }));
    // Ask for audio input too where the computer supports it: this is also what downloads the
    // audio part of the model, and it must happen inside the Start click.
    nanoLoading = LanguageModel.create({
      ...(nanoAudioOk() ? { expectedInputs: [{ type: 'audio' }, { type: 'text' }] } : {}),
      temperature: 0.2,
      topK: 3,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.round((e.loaded || 0) * 100);
          setNotice(pct < 100 ? `Getting Gemini Nano ready (one time): ${pct}%` : '', 'info');
        });
      },
    }).then((s) => {
      nanoBase = s;
      nano.text = 'available';
      if (nanoAudioOk()) nano.audio = 'available';
      return s;
    }).finally(() => {
      nanoLoading = null;
    });
    return nanoLoading;
  }

  async function nanoTranslate(text, src, tgt) {
    const base = await loadNano();
    const session = await base.clone();
    try {
      const hint = src === 'sw' || tgt === 'sw' ? ` ${SWAHILI_TIME}` : '';
      const raw = await session.prompt(
        `Translate the ${nameOf(src)} meeting speech between the markers into ${nameOf(tgt)}. Keep names and numbers. Make it natural.${hint}\n<<<\n${text}\n>>>`,
        { responseConstraint: { type: 'object', properties: { translation: { type: 'string' } }, required: ['translation'] } },
      );
      return (JSON.parse(raw).translation || '').trim();
    } finally {
      session.destroy();
    }
  }

  // The fastest engine that can do this pair: Chrome's translator, else Gemini Nano.
  function engineFor(src, tgt) {
    const key = pairKey(src, tgt);
    if (engines.has(key)) return engines.get(key);
    const p = (async () => {
      try {
        return { kind: 'translator', tr: await ensureTranslator(src, tgt) };
      } catch (e) {
        // A language heard mid-meeting may need a pack download, which needs a click. Keep
        // translating with Gemini Nano meanwhile and offer the faster download.
        if (e.code === 'needs-click' && nanoTextOk()) {
          showDownload(e.pair, `Translating ${nameOf(src)} with Gemini Nano for now. Download the ${nameOf(src)} pack for faster translation.`, 'info');
          return { kind: 'nano' };
        }
        if (e.code !== 'unsupported') throw e;
      }
      if (nanoTextOk()) return { kind: 'nano' };
      throw Object.assign(new Error(`Chrome can't translate ${nameOf(src)} into ${nameOf(tgt)} on this computer.`), { code: 'unsupported' });
    })();
    engines.set(key, p);
    p.catch((e) => {
      if (e.code !== 'unsupported' && engines.get(key) === p) engines.delete(key);
    });
    return p;
  }

  async function translateText(engine, text, src, tgt) {
    const key = `${pairKey(src, tgt)}|${text}`;
    if (cache.has(key)) return cache.get(key);
    let out;
    if (engine.kind === 'translator') {
      const parts = [];
      for (const s of splitSentences(text)) {
        const k = `${pairKey(src, tgt)}|${s}`;
        if (!cache.has(k)) cache.set(k, await engine.tr.translate(s));
        parts.push(cache.get(k));
      }
      out = parts.join(' ');
    } else {
      out = await nanoTranslate(text, src, tgt);
    }
    if (cache.size > 3000) cache.delete(cache.keys().next().value);
    cache.set(key, out);
    return out;
  }

  async function detect(text, turn) {
    if (!detector) return lastLang;
    const words = text.split(/\s+/).length;
    if (turn.lang && (words < 12 || turn.langWords >= 12)) return turn.lang;
    if (words < 4 && !turn.final) return turn.lang || lastLang;
    try {
      const [best] = await detector.detect(text);
      if (best && best.confidence >= 0.5 && best.detectedLanguage !== 'und') {
        turn.lang = best.detectedLanguage;
        turn.langWords = words;
        lastLang = turn.lang;
      }
    } catch {}
    return turn.lang || lastLang;
  }

  async function sourceOf(turn) {
    if (settings.from !== 'auto') return settings.from;
    if (turn.heardLang) return turn.heardLang; // Gemini Nano already said which language it heard
    return detect(turn.text, turn);
  }

  // Split the turn into subtitle chunks and translate any chunk whose text changed.
  async function translateTurn(turn) {
    syncChunks(turn);
    paint(turn);
    const tgt = settings.to;
    const src = await sourceOf(turn);
    turn.srcLabel = settings.from === 'auto' ? nameOf(src) : '';
    if (sameLang(src, tgt)) {
      for (const c of turn.chunks) {
        c.translation = c.text;
        c.done = c.text;
        c.note = '';
      }
      paint(turn);
      return;
    }
    let engine;
    try {
      engine = await engineFor(src, tgt);
    } catch (e) {
      if (e.code === 'needs-click') showDownload(e.pair, e.message);
      if (turn.chunks.length) turn.chunks.at(-1).note = e.message || 'Translation failed.';
      paint(turn);
      return;
    }
    turn.engine = engine.kind;
    for (const c of [...turn.chunks]) {
      if (c.done === c.text) continue;
      const text = c.text;
      try {
        const out = await translateText(engine, text, src, tgt);
        if (c.text === text) {
          c.translation = out;
          c.done = text;
          c.note = '';
        }
      } catch (e) {
        c.note = e.message || 'Translation failed.';
      }
      paint(turn);
    }
  }

  function schedule(turn, delay) {
    // Nano is slower, so wait a little longer for the words to settle.
    const wait = delay ?? (turn.engine === 'nano' ? 900 : 250);
    clearTimeout(turn.timer);
    turn.timer = setTimeout(() => translateTurn(turn), wait);
  }

  function retranslateAll() {
    engines.clear();
    for (const t of turns.values()) {
      t.lang = null;
      for (const c of t.chunks) c.done = null;
      schedule(t, 0);
    }
  }

  // ---------- feed ----------

  let stuckToBottom = true;
  const nearBottom = () => ui.feed.scrollHeight - ui.feed.scrollTop - ui.feed.clientHeight < 60;

  function toBottom() {
    ui.feed.scrollTop = ui.feed.scrollHeight;
    ui.jump.hidden = true;
    stuckToBottom = true;
  }

  function newTurn(id, props) {
    const turn = { id, speaker: '', text: '', lang: null, heardLang: null, final: false, chunks: [], ver: 0, ...props };
    turns.set(id, turn);
    return turn;
  }

  function syncChunks(turn) {
    const texts = splitIntoChunks(turn.text, CHUNK_CHARS);
    texts.forEach((t, i) => {
      const c = turn.chunks[i];
      if (!c) turn.chunks.push({ text: t, translation: null, done: null, note: '', el: null });
      else if (c.text !== t) c.text = t;
    });
    for (const c of turn.chunks.splice(texts.length)) if (c.el) c.el.remove();
  }

  function chunkEl() {
    const el = h('li', { class: 'chunk' },
      h('div', { class: 'meta' }, h('span', { class: 'who' }), h('span', { class: 'lang' })),
      h('p', { class: 'tr' }), h('p', { class: 'orig' }), h('p', { class: 'note', hidden: true }));
    // Tap a line to see the speaker's own words for it.
    el.addEventListener('click', () => el.classList.toggle('expanded'));
    return el;
  }

  function paint(turn) {
    const stick = nearBottom();
    if (!turn.chunks.length) syncChunks(turn);
    turn.chunks.forEach((c, i) => {
      if (!c.el) {
        c.el = chunkEl();
        // Keep a turn's chunks together, in order.
        const prev = i > 0 ? turn.chunks[i - 1].el : null;
        if (prev && prev.isConnected) prev.after(c.el);
        else ui.turns.append(c.el);
        ui.empty.hidden = true;
      }
      const [meta, tr, orig, note] = c.el.children;
      const [who, lang] = meta.children;
      const first = i === 0;
      who.textContent = first ? turn.speaker || '' : '';
      lang.textContent = first && turn.srcLabel ? `${turn.speaker ? ' · ' : ''}${turn.srcLabel}` : '';
      meta.hidden = !first || (!turn.speaker && !turn.srcLabel);
      tr.textContent = c.translation ?? c.text;
      tr.classList.toggle('pending', c.translation == null);
      orig.textContent = c.text;
      orig.hidden = c.translation == null || c.translation === c.text;
      note.textContent = c.note || '';
      note.hidden = !c.note;
      c.el.classList.toggle('live', !turn.final && i === turn.chunks.length - 1);
    });
    trimFeed();
    markRecent();
    if (stick) toBottom();
    else ui.jump.hidden = false;
  }

  // Only the newest lines are big; older ones step back so the current speech stands out.
  function markRecent() {
    const latest = [...ui.turns.children].slice(-2);
    for (const el of recentEls) if (!latest.includes(el)) el.classList.remove('recent');
    for (const el of latest) el.classList.add('recent');
    recentEls = latest;
  }

  function trimFeed() {
    while (ui.turns.children.length > 400) {
      const old = ui.turns.firstElementChild;
      for (const [k, t] of turns) {
        t.chunks = t.chunks.filter((c) => c.el !== old);
        if (!t.chunks.length) turns.delete(k);
      }
      old.remove();
    }
  }

  function setNotice(text, kind = 'warn') {
    ui.notice.textContent = text;
    ui.notice.hidden = !text;
    ui.notice.classList.toggle('info', kind === 'info');
  }

  function showDownload(pair, message, kind = 'warn') {
    pendingPair = pair;
    setNotice(message, kind);
    ui.download.textContent = `Download ${nameOf(pair[0])} to ${nameOf(pair[1])}`;
    ui.download.hidden = false;
  }

  function renderStatus() {
    let text;
    let tone;
    let title;
    let steps;
    if (mode() === 'audio') {
      const map = {
        listening: ['Listening', 'live'],
        starting: ['Starting', ''],
        'waiting-click': ['Needs one click', 'warn'],
        error: ['Not listening', 'warn'],
        off: [running ? 'Not listening' : 'Ready', running ? 'warn' : ''],
      };
      [text, tone] = map[audioState] || map.off;
      if (audioState === 'waiting-click') {
        title = 'One click to let Tafsiri hear this tab';
        steps = ["Click the Tafsiri icon in Chrome's toolbar (pin it from the puzzle-piece menu), or press Alt+Shift+T."];
      } else if (audioState === 'listening') {
        title = 'Listening';
        steps = ['Translations appear a few seconds after someone speaks.'];
      } else {
        title = 'Hear the meeting, translated';
        steps = ['Pick your languages and press Start translating.', 'Tafsiri listens to this tab, so captions are not needed.'];
      }
    } else {
      const { state, platform } = readerStatus;
      const live = state === 'listening';
      text = live ? (running ? 'Live' : 'Captions found') : 'Captions are off';
      tone = live ? (running ? 'live' : '') : 'warn';
      title = live && running ? 'Waiting for someone to speak' : 'Live captions, translated';
      steps = live
        ? (running ? [] : ['Pick your languages and press Start translating.'])
        : captions.known
          ? [`Turn on captions in ${platform}: the CC button at the bottom of the call.`, 'Pick your languages and press Start translating.']
          : ['Join the meeting in Chrome: Google Meet, or Teams and Zoom on the web.', "Turn on the meeting's captions (the CC button).", 'Pick your languages and press Start translating.'];
    }
    ui.status.textContent = text;
    ui.status.classList.toggle('live', tone === 'live');
    ui.status.classList.toggle('warn', tone === 'warn');
    ui.emptyTitle.textContent = title;
    // One step reads better as a sentence than as a numbered list.
    ui.emptySteps.replaceChildren(...steps.map((s) => h('li', { text: s })));
    ui.emptySteps.classList.toggle('single', steps.length === 1);
    ui.emptySteps.hidden = steps.length === 0;
  }

  // Warn about a pair nothing on this computer can translate, before the user presses Start.
  let pairCheck = 0;
  async function checkPair() {
    const gen = ++pairCheck;
    ui.download.hidden = true;
    if (!('Translator' in self) && !nanoTextOk()) {
      setNotice('Tafsiri needs Chrome 138 or newer on a desktop computer.');
      ui.start.disabled = true;
      return;
    }
    if (settings.from === 'auto' || sameLang(settings.from, settings.to)) {
      setNotice('');
      ui.start.disabled = false;
      return;
    }
    let a = 'unavailable';
    try {
      if ('Translator' in self) a = await Translator.availability({ sourceLanguage: settings.from, targetLanguage: settings.to });
    } catch {}
    if (gen !== pairCheck) return; // the user picked another pair meanwhile
    const ok = a !== 'unavailable' || nanoTextOk();
    ui.start.disabled = !ok;
    if (!ok) setNotice(`Chrome can't translate ${nameOf(settings.from)} into ${nameOf(settings.to)} on this computer. Pick another pair.`);
    else if (a === 'unavailable') setNotice(`Gemini Nano translates ${nameOf(settings.from)} to ${nameOf(settings.to)}. It is a little slower and quality varies.`, 'info');
    else setNotice('');
  }

  // ---------- speech in: captions ----------

  function onCaption(msg) {
    if (msg.type === 'status') {
      readerStatus = msg;
      renderStatus();
      return;
    }
    if (!running || mode() !== 'captions') return;
    const id = `c${msg.id}`;
    if (msg.type === 'caption') {
      const turn = turns.get(id) || newTurn(id);
      turn.speaker = msg.speaker;
      turn.text = msg.text;
      turn.final = false;
      paint(turn);
      schedule(turn);
      quietLater(turn);
    } else if (msg.type === 'final') {
      const turn = turns.get(id);
      if (turn) {
        turn.final = true;
        schedule(turn, 0);
      }
    }
  }

  // Meetings leave the last lines on screen; drop the live marker once the speaker pauses.
  function quietLater(turn) {
    clearTimeout(turn.quiet);
    turn.quiet = setTimeout(() => {
      turn.final = true;
      paint(turn);
    }, 2500);
  }

  // ---------- speech in: audio ----------

  // Lines heard close together, in the same language, read as one turn.
  const stale = (msg) => msg.gen != null && msg.gen !== audioGen;

  function onAudioLine(line) {
    if (!running || mode() !== 'audio' || stale(line)) return;
    const lang = line.lang || null;
    // The listener already translated this line: show it as it is, one line per block.
    if (line.translation != null) {
      const turn = newTurn(`a${++audioSeq}`, { heardLang: lang, text: line.text });
      const same = lang && sameLang(lang, settings.to);
      turn.chunks = [{ text: line.text, translation: same || !line.translation ? line.text : line.translation, done: line.text, note: '', el: null }];
      turn.srcLabel = settings.from === 'auto' && lang ? nameOf(lang) : '';
      turn.endMs = line.endMs;
      audioTurn = turn;
      paint(turn);
      quietLater(turn);
      return;
    }
    const joins = audioTurn && turns.has(audioTurn.id) && line.startMs - audioTurn.endMs < 1500 && audioTurn.heardLang === lang && audioTurn.text.length < 700;
    if (joins) {
      // A sentence cut in two by a pause: "the launch" + "Plan for..." reads "the launch plan for...".
      const midSentence = !/[.!?\u3002\uff01\uff1f]$/.test(audioTurn.text);
      const next = midSentence && /^[A-Z][a-z]/.test(line.text) ? line.text[0].toLowerCase() + line.text.slice(1) : line.text;
      audioTurn.text = `${audioTurn.text} ${next}`;
    } else {
      audioTurn = newTurn(`a${++audioSeq}`, { heardLang: lang });
      audioTurn.text = line.text;
    }
    audioTurn.endMs = line.endMs;
    audioTurn.final = false;
    paint(audioTurn);
    schedule(audioTurn, 0);
    quietLater(audioTurn);
  }

  function onAudioState(msg) {
    if (stale(msg)) return;
    if (msg.state === 'listening') {
      if (!running || mode() !== 'audio') return;
      audioState = 'listening';
      setNotice('');
    } else if (msg.state === 'warn') {
      setNotice(msg.message, 'info');
      return;
    } else if (msg.state === 'stopped') {
      const was = running && mode() === 'audio';
      audioState = 'off';
      if (was) {
        setNotice(msg.message || 'Tafsiri stopped listening.', 'info');
        pause({ keepAudio: true });
      }
    } else if (msg.state === 'error') {
      audioState = msg.code === 'needs-click' ? 'waiting-click' : 'error';
      if (msg.code === 'needs-click') setNotice('Chrome needs one click on the Tafsiri icon before it lets Tafsiri hear this tab. Click it in the toolbar, or press Alt+Shift+T.', 'info');
      else if (msg.code === 'no-nano') {
        nano.audio = 'unavailable';
        setNotice("Gemini Nano is not available on this computer, so Tafsiri can't hear audio here. Switched to reading captions.");
        setMode('captions');
      } else if (msg.code === 'nano-not-ready') setNotice('Gemini Nano is still getting ready on this computer. Try again in a few minutes, or read captions for now.');
      else setNotice(`Could not hear this tab: ${msg.message || 'unknown error'}`);
    }
    renderStatus();
  }

  // For targets Chrome's translator lacks, the listener translates while it transcribes.
  const listenerTranslates = () => NANO_LANGS.includes(settings.to);
  const audioOptions = () => ({
    spokenHint: settings.from === 'auto' ? '' : nameOf(settings.from),
    translateTo: listenerTranslates() ? nameOf(settings.to) : '',
  });

  async function requestAudio() {
    audioState = 'starting';
    renderStatus();
    const gen = ++audioGen;
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'audio-start', gen, ...audioOptions() });
    } catch (e) {
      res = { ok: false, code: 'error', message: e.message };
    }
    if (!running || mode() !== 'audio' || gen !== audioGen) return;
    if (!res || !res.ok) onAudioState({ state: 'error', gen, code: res && res.code, message: res && res.message });
  }

  function stopAudio() {
    if (audioState === 'off') return;
    audioState = 'off';
    audioGen++; // anything still on its way from this listener is now stale
    try {
      chrome.runtime.sendMessage({ type: 'audio-stop' }).catch(() => {});
    } catch {}
  }

  // ---------- start / pause ----------

  // Start right away; models and language packs download in the background with progress shown.
  function start() {
    if (!('Translator' in self) && !nanoTextOk()) return;
    setNotice('');
    ui.download.hidden = true;
    running = true;
    showControls = false;
    applyView();
    prepareEngines();

    if (mode() === 'audio') {
      // Gemini Nano must be ready before the listener can use it.
      const go = () => running && mode() === 'audio' && requestAudio();
      if (nano.audio === 'available') go();
      else loadNano().then(go, () => onAudioState({ state: 'error', gen: audioGen, code: 'nano-not-ready' }));
    } else if (unsubscribe) {
      // Pick up whatever is already on screen.
      unsubscribe();
      unsubscribe = captions.subscribe(onCaption);
    }
    renderStatus();
  }

  // Load what this language choice needs. Call inside a click: Chrome may need to download it.
  function prepareEngines() {
    const needNano = mode() === 'audio' || NANO_LANGS.includes(settings.to) || NANO_LANGS.includes(settings.from);
    if (nanoTextOk() && (nano.text === 'available' || needNano)) loadNano().catch(() => {});

    if (mode() === 'captions' && settings.from === 'auto' && !detector && !detectorLoading) {
      detectorLoading = ('LanguageDetector' in self
        ? LanguageDetector.create({
            monitor(m) {
              m.addEventListener('downloadprogress', (e) => {
                const pct = Math.round((e.loaded || 0) * 100);
                setNotice(pct < 100 ? `Getting auto detect ready: ${pct}%. Treating speech as English until then.` : '', 'info');
              });
            },
          })
        : Promise.reject(new Error('no detector')))
        .then((d) => {
          detector = d;
          retranslateAll();
        })
        .catch(() => setNotice('Auto detect is not available right now, so speech is treated as English. Pick the spoken language to be sure.'))
        .finally(() => (detectorLoading = null));
    }
    const src = settings.from === 'auto' ? 'en' : settings.from;
    if (!sameLang(src, settings.to)) warm(src, settings.to);
  }

  function warm(src, tgt) {
    engineFor(src, tgt).catch((e) => {
      if (e.code === 'needs-click') showDownload(e.pair, e.message);
      else setNotice(e.message || 'Could not start translating.');
      if (e.code === 'unsupported' && settings.from !== 'auto') pause();
    });
  }

  function pause({ keepAudio } = {}) {
    running = false;
    showControls = true;
    if (!keepAudio) stopAudio();
    applyView();
    renderStatus();
  }

  function setMode(m) {
    if (m === 'audio' && !nanoAudioOk()) return;
    const wasRunning = running;
    if (wasRunning) pause();
    settings.mode = m;
    audioTurn = null;
    saveSettings();
    applyView();
    renderStatus();
    if (wasRunning) start();
  }

  async function languagesChanged() {
    applyView();
    saveSettings();
    await checkPair();
    if (!running) return;
    if (mode() === 'audio' && audioState !== 'off' && audioState !== 'error') {
      // Keep hearing the tab; just tell the listener about the new languages.
      prepareEngines();
      try {
        chrome.runtime.sendMessage({ type: 'audio-update', ...audioOptions() }).catch(() => {});
      } catch {}
    } else {
      start();
    }
    retranslateAll();
  }

  // ---------- wiring ----------

  ui.start.addEventListener('click', start);
  ui.pause.addEventListener('click', () => pause());
  ui.change.addEventListener('click', () => {
    showControls = true;
    applyView();
    ui.from.focus();
  });
  ui.modeAudio.addEventListener('click', () => setMode('audio'));
  ui.modeCaptions.addEventListener('click', () => setMode('captions'));
  ui.pip.addEventListener('click', popOut);
  ui.min.addEventListener('click', toggleMin);
  ui.close.addEventListener('click', () => {
    if (pipWindow) pipWindow.close();
    hide();
  });

  ui.download.addEventListener('click', async () => {
    if (!pendingPair) return;
    const [src, tgt] = pendingPair;
    ui.download.hidden = true;
    translators.delete(pairKey(src, tgt));
    engines.delete(pairKey(src, tgt));
    try {
      await ensureTranslator(src, tgt);
      setNotice('');
      retranslateAll();
    } catch (e) {
      setNotice(e.message || 'Download failed.');
    }
  });

  ui.from.addEventListener('change', () => {
    settings.from = ui.from.value;
    languagesChanged();
  });
  ui.to.addEventListener('change', () => {
    settings.to = ui.to.value;
    languagesChanged();
  });
  ui.swap.addEventListener('click', () => {
    if (settings.from === 'auto') return;
    [settings.from, settings.to] = [settings.to, settings.from];
    ui.from.value = settings.from;
    ui.to.value = settings.to;
    languagesChanged();
  });

  ui.showOriginal.addEventListener('change', () => {
    settings.showOriginal = ui.showOriginal.checked;
    applyView();
    saveSettings();
  });

  function resizeText(step) {
    const i = SIZES.indexOf(settings.size);
    settings.size = SIZES[Math.min(SIZES.length - 1, Math.max(0, i + step))];
    applyView();
    saveSettings();
  }
  ui.smaller.addEventListener('click', () => resizeText(-1));
  ui.larger.addEventListener('click', () => resizeText(1));

  ui.copy.addEventListener('click', async () => {
    const lines = [...turns.values()]
      .filter((t) => t.chunks.some((c) => c.el && c.el.isConnected))
      .map((t) => {
        const said = t.chunks.map((c) => c.translation ?? c.text).join(' ');
        const line = t.speaker ? `${t.speaker}: ${said}` : said;
        return settings.showOriginal && said !== t.text ? `${line}\n  (${t.text})` : line;
      });
    try {
      // While popped out, the picture-in-picture window has focus, not the meeting page.
      await (pipWindow || window).navigator.clipboard.writeText(lines.join('\n'));
      ui.copy.textContent = lines.length ? 'Copied' : 'Nothing yet';
    } catch {
      ui.copy.textContent = 'Failed';
    }
    setTimeout(() => (ui.copy.textContent = 'Copy'), 1500);
  });

  ui.clear.addEventListener('click', () => {
    turns.clear();
    audioTurn = null;
    recentEls = [];
    ui.turns.textContent = '';
    ui.empty.hidden = false;
    ui.jump.hidden = true;
  });

  ui.jump.addEventListener('click', toBottom);
  ui.feed.addEventListener('scroll', () => {
    stuckToBottom = nearBottom();
    if (stuckToBottom) ui.jump.hidden = true;
  });

  // Keys pressed inside the overlay must not reach the meeting's own shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    ui.win.addEventListener(type, (e) => e.stopPropagation());
  }

  function onMessage(msg, _sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'audio-line') return onAudioLine(msg);
    if (msg.type === 'audio-state') return onAudioState(msg);
    if (msg.type === 'open') return show({ minimised: false });
    // Toolbar icon. If Tafsiri was waiting for this click to hear the tab, open and listen.
    // Otherwise: expand a minimised bar, hide an open window, show a hidden one.
    if (msg.type === 'icon' || msg.type === 'toggle') {
      const wantAudio = running && mode() === 'audio' && audioState !== 'listening' && audioState !== 'starting';
      if (wantAudio) {
        show({ minimised: false });
        audioState = 'starting';
        renderStatus();
        sendResponse({ wantAudio: true, gen: ++audioGen, ...audioOptions() });
        return;
      }
      if (pipWindow) {
        hide();
        pipWindow.close();
      } else if (open && !box.min) hide();
      else show({ minimised: false });
      sendResponse({ wantAudio: false });
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  window.__tafsiriOverlayStop = () => {
    stopped = true;
    if (running) stopAudio();
    running = false;
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
    window.removeEventListener('resize', onResize);
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (pipWindow) pipWindow.close();
    host.remove();
  };

  // ---------- boot ----------

  async function probeNano() {
    if (!('LanguageModel' in self)) return;
    try {
      nano.text = await LanguageModel.availability();
      nano.audio = await LanguageModel.availability({ expectedInputs: [{ type: 'audio' }] });
    } catch {}
  }

  Promise.all([store.get(['settings', 'box', HIDDEN_KEY]), probeNano()]).then(([saved]) => {
    if (stopped) return;
    Object.assign(settings, saved.settings || {});
    Object.assign(box, saved.box || {});
    // Hearing audio is the default wherever Gemini Nano can do it.
    if (!settings.mode || (settings.mode === 'audio' && !nanoAudioOk())) settings.mode = nanoAudioOk() ? 'audio' : 'captions';
    fillSelects();
    ui.from.value = settings.from;
    ui.to.value = settings.to;
    if (!ui.to.value) ui.to.value = settings.to = 'en';
    if (!ui.from.value) ui.from.value = settings.from = 'auto';
    applyView();
    renderStatus();
    checkPair();
    // On meeting sites, start as a small bar in the corner so people find it without the toolbar.
    if (captions.known && !saved[HIDDEN_KEY]) show({ minimised: true });
  });
})();
