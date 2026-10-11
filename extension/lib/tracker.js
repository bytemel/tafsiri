// Turns caption snapshots into stable turn ids. Shared by the content script and the Node tests.
// Each scan passes blocks of { key, speaker, text }, where key is a stable object for one speaker
// turn (the avatar img in Meet). send() receives { type: 'caption' | 'final', ... } messages.
(function (root) {
  const text = typeof module !== 'undefined' && module.exports ? require('./text.js') : root.TafsiriText;
  const { mergeCaption, continuesCaption } = text;
  const KEEP_GONE_MS = 4000;

  function related(prev, next) {
    if (!prev || !next) return false;
    if (next.startsWith(prev) || prev.startsWith(next)) return true;
    return Math.min(prev.length, next.length) >= 12 && continuesCaption(prev, next);
  }

  function createTracker(send, now = () => Date.now()) {
    let nextId = 1;
    const byKey = new WeakMap(); // key -> rec { id, speaker, text }
    let live = new Map(); // id -> rec
    let gone = []; // { rec, at, finalSent } turns that vanished recently

    // A new element that carries on a turn that just vanished keeps that turn's id.
    function adopt(block, taken) {
      const match = gone.find(
        (g) => !taken.has(g.rec.id) && g.rec.speaker === block.speaker && related(g.rec.text, block.text),
      );
      if (match) {
        gone = gone.filter((g) => g !== match);
        return match.rec;
      }
      return { id: nextId++, speaker: block.speaker, text: '' };
    }

    function update(blocks) {
      const t = now();
      gone = gone.filter((g) => t - g.at < KEEP_GONE_MS);

      // Pass 1: turns whose element vanished go to `gone` before any new element is adopted,
      // so a turn Meet re-rendered between two scans keeps its id.
      const present = new Set();
      for (const b of blocks) {
        const rec = byKey.get(b.key);
        if (rec) present.add(rec.id);
      }
      for (const [id, rec] of live) if (!present.has(id)) gone.push({ rec, at: t, finalSent: false });

      // Pass 2: match, merge and send changes.
      const nowLive = new Map();
      for (const b of blocks) {
        let rec = byKey.get(b.key);
        if (!rec || nowLive.has(rec.id)) {
          rec = adopt(b, nowLive);
          byKey.set(b.key, rec);
        } else if (rec.text && !continuesCaption(rec.text, b.text)) {
          // Same element, unrelated sentence (Zoom reuses its subtitle line): close the old turn.
          send({ type: 'final', id: rec.id });
          rec = { id: nextId++, speaker: b.speaker, text: '' };
          byKey.set(b.key, rec);
        }
        const merged = mergeCaption(rec.text, b.text);
        if (merged !== rec.text || (b.speaker && b.speaker !== rec.speaker)) {
          rec.text = merged;
          rec.speaker = b.speaker || rec.speaker;
          send({ type: 'caption', id: rec.id, speaker: rec.speaker, text: rec.text });
        }
        nowLive.set(rec.id, rec);
      }

      for (const g of gone) {
        if (!g.finalSent && !nowLive.has(g.rec.id)) {
          g.finalSent = true;
          send({ type: 'final', id: g.rec.id });
        }
      }
      live = nowLive;
    }

    // Resend every turn still on screen, so an overlay opened mid-meeting catches up.
    function replay() {
      for (const rec of live.values()) send({ type: 'caption', id: rec.id, speaker: rec.speaker, text: rec.text });
    }

    return { update, replay };
  }

  const api = { createTracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TafsiriTracker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
