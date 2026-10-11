// Content script: the floating Tafsiri window on top of the meeting. Drag it by the title bar,
// resize it from the corner, minimise it, or pop it out into an always-on-top picture-in-picture
// window. Captions come from captions.js; translation uses Chrome's on-device Translator API.
(() => {
  if (typeof window.__tafsiriOverlayStop === 'function') window.__tafsiriOverlayStop();

  const { splitSentences } = globalThis.TafsiriText;
  const captions = globalThis.TafsiriCaptions;
  const HOST_ID = 'tafsiri-overlay';

  // Targets Chrome's on-device translator supported when checked on 2026-10-12 (Chrome 154).
  // Swahili and most African languages were "unavailable" then.
  const LANGS = ['ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'mr', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh', 'zh-Hant'];
  const SIZES = [14, 15, 17, 19, 22, 26];
  const MIN_W = 280;
  const MIN_H = 220;
  const names = new Intl.DisplayNames(['en'], { type: 'language' });
  const nameOf = (code) => {
    try { return names.of(code) || code; } catch { return code; }
  };

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

  ui.from = h('select', { id: 'tf-from' });
  ui.to = h('select', { id: 'tf-to' });
  ui.swap = h('button', { class: 'swap', type: 'button', 'aria-label': 'Swap languages', title: 'Swap languages' }, icon(ICONS.swap));
  ui.start = h('button', { class: 'primary', type: 'button', text: 'Start translating' });
  ui.notice = h('p', { class: 'notice', role: 'alert', hidden: true });
  ui.download = h('button', { class: 'secondary', type: 'button', hidden: true });
  ui.controls = h('div', { class: 'controls' },
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
  ui.win = h('div', { class: 'win show-original', role: 'dialog', 'aria-label': 'Tafsiri live translation', hidden: true }, ui.bar, ui.body, ui.grip);
  root.append(ui.win);
  document.documentElement.append(host);

  // ---------- state ----------

  const settings = { from: 'auto', to: defaultTarget(), showOriginal: true, size: 17 };
  const box = { x: null, y: 16, w: 360, h: 460, min: false };
  let open = false;
  let running = false;
  let showControls = true;
  let unsubscribe = null;
  let pipWindow = null;
  let readerStatus = { state: 'no-captions', platform: captions.platform };
  // One storage key per site, so tabs on different sites never overwrite each other.
  const HIDDEN_KEY = `hidden:${location.hostname}`;
  let stopped = false; // set when a newer copy of this script takes over the page

  const turns = new Map(); // caption id -> turn
  const translators = new Map(); // "src>tgt" -> Promise<Translator>
  const cache = new Map(); // "src>tgt|sentence" -> translation
  let detector = null;
  let detectorLoading = null;
  let lastLang = 'en';
  let pendingPair = null;

  function defaultTarget() {
    const base = (navigator.language || 'en').split('-')[0];
    return LANGS.includes(base) ? base : 'en';
  }

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
      pipWindow = await documentPictureInPicture.requestWindow({ width: box.w, height: box.min ? 460 : box.h });
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
    const sorted = [...LANGS].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    ui.from.append(new Option('Auto detect', 'auto'));
    for (const code of sorted) {
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
    ui.controls.hidden = running && !showControls;
    ui.summary.hidden = !running || showControls;
  }

  const saveSettings = () => store.set({ settings: { ...settings } });

  // ---------- translation ----------

  const pairKey = (src, tgt) => `${src}>${tgt}`;
  const sameLang = (a, b) => a === b || (a.split('-')[0] === b.split('-')[0] && !a.includes('Hant') && !b.includes('Hant'));

  function ensureTranslator(src, tgt) {
    const key = pairKey(src, tgt);
    if (translators.has(key)) return translators.get(key);
    const p = (async () => {
      const availability = await Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
      if (availability === 'unavailable') {
        const err = new Error(`Chrome can't translate ${nameOf(src)} into ${nameOf(tgt)} on this computer yet.`);
        err.code = 'unsupported';
        throw err;
      }
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
          const err = new Error(`Chrome needs one click to download ${nameOf(src)} to ${nameOf(tgt)}.`);
          err.code = 'needs-click';
          err.pair = [src, tgt];
          throw err;
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

  async function translateTurn(turn) {
    const ver = ++turn.ver;
    const text = turn.text;
    const tgt = settings.to;
    const auto = settings.from === 'auto';
    const src = auto ? await detect(text, turn) : settings.from;
    let out = text;
    let note = '';

    if (!sameLang(src, tgt)) {
      try {
        const tr = await ensureTranslator(src, tgt);
        const parts = [];
        for (const s of splitSentences(text)) {
          const key = `${pairKey(src, tgt)}|${s}`;
          if (!cache.has(key)) {
            if (cache.size > 3000) cache.delete(cache.keys().next().value);
            cache.set(key, await tr.translate(s));
          }
          parts.push(cache.get(key));
        }
        out = parts.join(' ');
      } catch (e) {
        note = e.message || 'Translation failed.';
        if (e.code === 'needs-click') showDownload(e.pair, e.message);
      }
    }

    if (ver < turn.shown) return;
    turn.shown = ver;
    turn.translation = out;
    turn.note = note;
    turn.srcLabel = auto ? nameOf(src) : '';
    paint(turn);
  }

  function schedule(turn, delay = 250) {
    clearTimeout(turn.timer);
    turn.timer = setTimeout(() => translateTurn(turn), delay);
  }

  function retranslateAll() {
    for (const t of turns.values()) {
      t.lang = null;
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

  function paint(turn) {
    const stick = nearBottom();
    if (!turn.el) {
      turn.el = h('li', { class: 'turn' },
        h('div', { class: 'meta' }, h('span', { class: 'who' }), h('span', { class: 'lang' })),
        h('p', { class: 'tr' }), h('p', { class: 'orig' }), h('p', { class: 'note', hidden: true }));
      ui.turns.append(turn.el);
      ui.empty.hidden = true;
      while (ui.turns.children.length > 300) {
        const old = ui.turns.firstElementChild;
        for (const [k, t] of turns) if (t.el === old) turns.delete(k);
        old.remove();
      }
    }
    const [meta, tr, orig, note] = turn.el.children;
    const [who, lang] = meta.children;
    who.textContent = turn.speaker || '';
    lang.textContent = turn.srcLabel ? `${turn.speaker ? ' · ' : ''}from ${turn.srcLabel}` : '';
    meta.hidden = !turn.speaker && !turn.srcLabel;
    tr.textContent = turn.translation ?? turn.text;
    tr.classList.toggle('pending', turn.translation == null);
    orig.textContent = turn.text;
    orig.hidden = turn.translation == null || turn.translation === turn.text;
    note.textContent = turn.note || '';
    note.hidden = !turn.note;
    turn.el.classList.toggle('live', !turn.final);
    if (stick) toBottom();
    else ui.jump.hidden = false;
  }

  function setNotice(text, kind = 'warn') {
    ui.notice.textContent = text;
    ui.notice.hidden = !text;
    ui.notice.classList.toggle('info', kind === 'info');
  }

  function showDownload(pair, message) {
    pendingPair = pair;
    setNotice(message);
    ui.download.textContent = `Download ${nameOf(pair[0])} to ${nameOf(pair[1])}`;
    ui.download.hidden = false;
  }

  function renderStatus() {
    const { state, platform } = readerStatus;
    const live = state === 'listening';
    ui.status.classList.toggle('live', live && running);
    ui.status.classList.toggle('warn', !live);
    ui.status.textContent = live ? (running ? 'Live' : 'Captions found') : 'Captions are off';

    const steps = live
      ? (running ? [] : ['Pick your languages and press Start translating.'])
      : captions.known
        ? [`Turn on captions in ${platform}: the CC button at the bottom of the call.`, 'Pick your languages and press Start translating.']
        : ['Join the meeting in Chrome: Google Meet, or Teams and Zoom on the web.', "Turn on the meeting's captions (the CC button).", 'Pick your languages and press Start translating.'];
    ui.emptyTitle.textContent = live && running ? 'Waiting for someone to speak' : 'Live captions, translated';
    // One step reads better as a sentence than as a numbered list.
    ui.emptySteps.replaceChildren(...steps.map((s) => h('li', { text: s })));
    ui.emptySteps.classList.toggle('single', steps.length === 1);
    ui.emptySteps.hidden = steps.length === 0;
  }

  // Warn about a pair Chrome cannot translate before the user presses Start.
  let pairCheck = 0;
  async function checkPair() {
    const gen = ++pairCheck;
    ui.download.hidden = true;
    if (!('Translator' in self)) {
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
      a = await Translator.availability({ sourceLanguage: settings.from, targetLanguage: settings.to });
    } catch {}
    if (gen !== pairCheck) return; // the user picked another pair meanwhile
    const ok = a !== 'unavailable';
    ui.start.disabled = !ok;
    setNotice(ok ? '' : `Chrome can't translate ${nameOf(settings.from)} into ${nameOf(settings.to)} on this computer yet. Pick another pair.`);
  }

  // ---------- captions in ----------

  function onCaption(msg) {
    if (msg.type === 'status') {
      readerStatus = msg;
      renderStatus();
      return;
    }
    if (!running) return;
    if (msg.type === 'caption') {
      let turn = turns.get(msg.id);
      if (!turn) {
        turn = { ver: 0, shown: 0, final: false };
        turns.set(msg.id, turn);
      }
      turn.speaker = msg.speaker;
      turn.text = msg.text;
      turn.final = false;
      paint(turn);
      schedule(turn);
      // Meetings leave the last lines on screen; drop the live marker once the speaker pauses.
      clearTimeout(turn.quiet);
      turn.quiet = setTimeout(() => {
        turn.final = true;
        paint(turn);
      }, 2500);
    } else if (msg.type === 'final') {
      const turn = turns.get(msg.id);
      if (turn) {
        turn.final = true;
        schedule(turn, 0);
      }
    }
  }

  // ---------- start / pause ----------

  // Start right away; language packs download in the background with progress in the notice.
  function start() {
    if (!('Translator' in self)) return;
    setNotice('');
    ui.download.hidden = true;
    running = true;
    showControls = false;
    applyView();
    renderStatus();

    // Begin these inside the click so Chrome allows any download.
    if (settings.from === 'auto') {
      if (!detector && !detectorLoading) {
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
      if (!sameLang('en', settings.to)) warm('en', settings.to);
    } else if (!sameLang(settings.from, settings.to)) {
      warm(settings.from, settings.to);
    }
    // Pick up whatever is already on screen.
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = captions.subscribe(onCaption);
    }
  }

  function warm(src, tgt) {
    ensureTranslator(src, tgt).catch((e) => {
      if (e.code === 'needs-click') showDownload(e.pair, e.message);
      else setNotice(e.message || 'Could not start translating.');
      if (e.code === 'unsupported' && settings.from !== 'auto') pause();
    });
  }

  function pause() {
    running = false;
    showControls = true;
    applyView();
    renderStatus();
  }

  async function languagesChanged() {
    applyView();
    saveSettings();
    await checkPair();
    if (running) {
      start();
      retranslateAll();
    }
  }

  // ---------- wiring ----------

  ui.start.addEventListener('click', start);
  ui.pause.addEventListener('click', pause);
  ui.change.addEventListener('click', () => {
    showControls = true;
    applyView();
    ui.from.focus();
  });
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
      .filter((t) => t.el && t.el.isConnected)
      .map((t) => {
        const said = t.translation ?? t.text;
        const line = t.speaker ? `${t.speaker}: ${said}` : said;
        return settings.showOriginal && t.translation && t.translation !== t.text ? `${line}\n  (${t.text})` : line;
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

  function onMessage(msg) {
    if (!msg) return;
    // Toolbar icon: expand a minimised bar, hide an open window, show a hidden one.
    if (msg.type === 'toggle') {
      if (pipWindow) {
        hide();
        pipWindow.close();
      } else if (open && !box.min) hide();
      else show({ minimised: false });
    }
    if (msg.type === 'open') show({ minimised: false });
  }
  chrome.runtime.onMessage.addListener(onMessage);

  window.__tafsiriOverlayStop = () => {
    stopped = true;
    running = false;
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch {}
    window.removeEventListener('resize', onResize);
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (pipWindow) pipWindow.close();
    host.remove();
  };

  // ---------- boot ----------

  fillSelects();
  store.get(['settings', 'box', HIDDEN_KEY]).then((saved) => {
    if (stopped) return;
    Object.assign(settings, saved.settings || {});
    Object.assign(box, saved.box || {});
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
