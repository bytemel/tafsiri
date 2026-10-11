// Pure text helpers shared by the caption reader, the overlay and the Node tests.
(function (root) {
  // Meet and Teams rewrite the same caption line as the speaker talks: words get corrected,
  // and long turns lose their oldest words off the top. Keep one growing line per turn.
  // Returns [merged text, whether next continues prev rather than replacing it].
  function merge(prev, next) {
    if (!prev) return [next, true];
    if (!next || next === prev) return [prev, true];
    if (next.startsWith(prev)) return [next, true];

    // Live correction: the start still matches, only the tail changed.
    let p = 0;
    const max = Math.min(prev.length, next.length);
    while (p < max && prev[p] === next[p]) p++;
    if (p >= 12 || p >= max * 0.5) return [next, true];

    // Older words scrolled away and nothing new arrived yet.
    if (prev.includes(next)) return [prev, true];

    // Trimmed from the top: the tail of prev is the head of next.
    for (let k = Math.min(prev.length, next.length); k >= 12; k--) {
      if (prev.endsWith(next.slice(0, k))) return [prev + next.slice(k), true];
    }
    return [next, false];
  }

  const mergeCaption = (prev, next) => merge(prev, next)[0];
  // False when the same caption element now shows an unrelated sentence (a new turn).
  const continuesCaption = (prev, next) => merge(prev, next)[1];

  // Split into sentences so the overlay only re-translates the sentence that is still changing.
  function splitSentences(text) {
    const parts = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g);
    return parts ? parts.map((s) => s.trim()).filter(Boolean) : [];
  }

  // innerText of a caption block, minus button labels and icon-font ligatures like "arrow_downward".
  function cleanLines(rawText, junk) {
    const skip = new Set(junk || []);
    return String(rawText || '')
      .split('\n')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s && !skip.has(s) && !/^[a-z]+(_[a-z]+)+$/.test(s));
  }

  const api = { mergeCaption, continuesCaption, splitSentences, cleanLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TafsiriText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
