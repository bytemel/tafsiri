// Splits one long turn into subtitle-sized chunks at sentence ends, so a long speech shows as
// short blocks the translation can keep pace with. Pure; shared by the overlay and the Node tests.
(function (root) {
  const text = typeof module !== 'undefined' && module.exports ? require('./text.js') : root.TafsiriText;
  const { splitSentences } = text;

  // A run-on with no punctuation is broken at the last space before the limit.
  function hardWrap(s, max) {
    const out = [];
    let rest = s;
    while (rest.length > max * 1.5) {
      let cut = rest.lastIndexOf(' ', max);
      if (cut < max * 0.5) cut = max;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  function splitIntoChunks(input, max = 180) {
    const chunks = [];
    let cur = '';
    for (const sentence of splitSentences(String(input || ''))) {
      for (const piece of hardWrap(sentence, max)) {
        if (cur && cur.length + 1 + piece.length > max) {
          chunks.push(cur);
          cur = piece;
        } else {
          cur = cur ? `${cur} ${piece}` : piece;
        }
      }
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  const api = { splitIntoChunks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TafsiriChunks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
