// Cuts a live audio stream into speech segments at natural pauses, so each piece can be transcribed
// on its own. Pure: feed it Float32 samples, it calls onSegment(Float32Array at 16 kHz, info).
// Shared by the offscreen listener and the Node tests.
(function (root) {
  const OUT_RATE = 16000;
  const FRAME = 320; // 20 ms at 16 kHz

  // Linear resampling is plenty for speech recognition.
  function resample(input, fromRate, toRate = OUT_RATE) {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const out = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio;
      const j = Math.floor(pos);
      const frac = pos - j;
      const a = input[j] || 0;
      const b = input[j + 1] ?? a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  function rms(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / frame.length);
  }

  function concat(frames) {
    const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
    let o = 0;
    for (const f of frames) {
      out.set(f, o);
      o += f.length;
    }
    return out;
  }

  function createSegmenter({
    onSegment,
    sampleRate = OUT_RATE,
    startMs = 200, // this much voice starts a segment
    endSilenceMs = 600, // this much quiet ends it
    maxMs = 7000, // never longer than this, so subtitles keep up
    minVoiceMs = 300, // shorter blips (coughs, clicks) are dropped
    prerollMs = 200,
  } = {}) {
    const msPerFrame = (FRAME / OUT_RATE) * 1000;
    let pending = new Float32Array(0);
    // Meeting audio arrives already noise-suppressed, so the room starts near silent. Starting
    // high, or learning from every quiet frame, taught the floor a soft voice and then never
    // heard it again (seen on a live Meet call, 2026-10-26).
    let noise = 0.002;
    let speaking = false;
    let frames = []; // { data, voiced }
    let preroll = [];
    let voicedRun = 0;
    let silentRun = 0;
    let clock = 0; // ms of audio seen

    const threshold = () => Math.max(0.004, noise * 3);

    function emit(list) {
      const voiced = list.filter((f) => f.voiced).length * msPerFrame;
      if (voiced < minVoiceMs) return;
      const endMs = clock;
      const durMs = list.length * msPerFrame;
      onSegment(concat(list.map((f) => f.data)), { startMs: endMs - durMs, endMs, voicedMs: voiced });
    }

    function onFrame(data) {
      clock += msPerFrame;
      const level = rms(data);
      const voiced = level > threshold();
      if (!speaking) {
        // Track the room's background level while nobody talks: only frames near the floor teach
        // it; louder ones (a voice) just let it creep up slowly, in case the background got louder.
        if (level < noise * 2) noise = Math.max(0.001, noise * 0.97 + level * 0.03);
        else noise = Math.min(noise * 1.002, 0.05);
        preroll.push({ data, voiced });
        if (preroll.length > prerollMs / msPerFrame + startMs / msPerFrame) preroll.shift();
        voicedRun = voiced ? voicedRun + 1 : 0;
        if (voicedRun * msPerFrame >= startMs) {
          speaking = true;
          frames = preroll;
          preroll = [];
          silentRun = 0;
        }
        return;
      }

      frames.push({ data, voiced });
      silentRun = voiced ? 0 : silentRun + 1;
      if (silentRun * msPerFrame >= endSilenceMs) {
        // Keep a little of the pause, drop the rest.
        emit(frames.slice(0, frames.length - silentRun + Math.round(150 / msPerFrame)));
        speaking = false;
        frames = [];
        voicedRun = 0;
        return;
      }
      if (frames.length * msPerFrame >= maxMs) {
        // Too long without a pause: cut at the quietest frame in the last second.
        const look = Math.round(1000 / msPerFrame);
        let cut = frames.length;
        let best = Infinity;
        for (let i = frames.length - look; i < frames.length; i++) {
          const l = rms(frames[i].data);
          if (l < best) {
            best = l;
            cut = i + 1;
          }
        }
        const rest = frames.slice(cut);
        clock -= rest.length * msPerFrame;
        emit(frames.slice(0, cut));
        clock += rest.length * msPerFrame;
        frames = rest;
      }
    }

    return {
      // Samples at `sampleRate`; any length.
      push(samples) {
        const s = resample(samples, sampleRate);
        const merged = new Float32Array(pending.length + s.length);
        merged.set(pending);
        merged.set(s, pending.length);
        let i = 0;
        for (; i + FRAME <= merged.length; i += FRAME) onFrame(merged.slice(i, i + FRAME));
        pending = merged.slice(i);
      },
      // End of stream: send whatever speech is in flight.
      flush() {
        if (speaking) emit(frames);
        speaking = false;
        frames = [];
      },
    };
  }

  const api = { createSegmenter, resample, OUT_RATE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TafsiriSegmenter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
