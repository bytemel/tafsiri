// The audio listener: takes a MediaStream (the meeting tab's sound), keeps it audible, cuts it at
// pauses and asks Gemini Nano (Chrome's on-device model) what was said and in which language.
// Translation happens afterwards in the overlay. Runs in the offscreen document; the dev preview
// runs it on a normal page.
(function (root) {
  const { createSegmenter, OUT_RATE } = root.TafsiriSegmenter;

  // The spoken languages Gemini Nano accepts as audio. Chrome 155 (checked 2026-10-26) refuses
  // the rest, Swahili included; asking for them makes it guess.
  const HEARD = ['en', 'es', 'de', 'fr', 'ja'];
  const MODEL_OPTIONS = {
    expectedInputs: [{ type: 'audio', languages: HEARD }, { type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: HEARD }],
  };

  const SCHEMA = {
    type: 'object',
    properties: {
      language: { type: 'string', description: 'ISO 639-1 code of the spoken language, or "" if no speech' },
      transcript: { type: 'string' },
    },
    required: ['language', 'transcript'],
  };

  // Phrases a speech model tends to invent from noise or music.
  const NOISE = /^(\W*|\[.*\]|\(.*\)|thank you\.?|thanks for watching\.?|music|applause)$/i;

  // Gemini Nano is shared by the whole browser and sometimes stops answering. Never wait forever.
  function withTimeout(promise, ms, controller) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(Object.assign(new Error('Gemini Nano did not answer in time.'), { code: 'timeout' }));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // A speech model fed noise or music can invent a whole paragraph. Real speech fits its length:
  // about 3 words a second (CJK about 8 characters), so anything far past that was made up.
  function plausible(text, voicedMs) {
    const secs = Math.max(voicedMs, 300) / 1000;
    const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
    if (cjk) return cjk <= secs * 12 + 8;
    return text.split(/\s+/).filter(Boolean).length <= secs * 4.5 + 4;
  }

  async function startListening(stream, { workletUrl, spokenHint, onLine, onState, onStats, playback = true }) {
    const opts = { spokenHint };
    if (!('LanguageModel' in root)) throw Object.assign(new Error('Gemini Nano is not available in this Chrome.'), { code: 'no-nano' });
    const availability = await LanguageModel.availability(MODEL_OPTIONS);
    if (availability !== 'available') {
      throw Object.assign(new Error(`Gemini Nano is ${availability} on this computer.`), { code: availability === 'unavailable' ? 'no-nano' : 'nano-not-ready' });
    }
    // Start hearing right away; speech is queued while the model loads, so the first words are kept.
    const baseP = withTimeout(LanguageModel.create({ ...MODEL_OPTIONS, temperature: 0.1, topK: 1 }), 60000);
    baseP.catch((e) => {
      const stuck = e && e.code === 'timeout';
      onState({ state: 'error', code: stuck ? 'nano-stuck' : 'nano-not-ready', message: String((e && e.message) || e) });
      stop(stuck ? 'Gemini Nano is busy or stuck. Close other tabs that use Chrome AI, or restart Chrome.' : 'Gemini Nano could not load on this computer. Try Read captions instead.');
    });
    // The first prompt after loading is slow. Spend that time now, before anyone speaks.
    const warm = (async () => {
      try {
        const s = await (await baseP).clone();
        const quiet = new AudioBuffer({ length: OUT_RATE / 2, sampleRate: OUT_RATE, numberOfChannels: 1 });
        const ac = new AbortController();
        try {
          await withTimeout(s.prompt([{ role: 'user', content: [{ type: 'text', value: 'Transcribe this audio.' }, { type: 'audio', value: quiet }] }], { responseConstraint: SCHEMA, signal: ac.signal }), 30000, ac);
        } finally {
          s.destroy();
        }
      } catch {}
    })();

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    // Capturing a tab silences it, so play the meeting back to the speakers.
    if (playback) source.connect(ctx.destination);
    await ctx.audioWorklet.addModule(workletUrl);
    const tap = new AudioWorkletNode(ctx, 'tafsiri-tap', { numberOfOutputs: 0 });
    source.connect(tap);

    let stopped = false;
    let seq = 0;
    let queue = [];
    let busy = false;
    let timeouts = 0;
    const startedAt = Date.now();
    // What the overlay shows while nothing is written yet, so a silent failure is visible.
    const stats = { heard: 0, written: 0, dropped: 0 };
    const tell = () => onStats && onStats({ ...stats });

    async function transcribe(samples, info) {
      const audio = new AudioBuffer({ length: samples.length, sampleRate: OUT_RATE, numberOfChannels: 1 });
      audio.copyToChannel(samples, 0);
      const { spokenHint } = opts; // read per piece, so a language change applies at once
      const hint = spokenHint ? ` The speech is in ${spokenHint}.` : '';
      const session = await (await baseP).clone();
      const ac = new AbortController();
      try {
        // Nano runs at about 0.7x real time; four times the clip length means it is stuck.
        const raw = await withTimeout(session.prompt(
          [{ role: 'user', content: [
            { type: 'text', value: `Transcribe this meeting audio word for word, in the language it is spoken in (never translate). Give the ISO 639-1 language code.${hint} Write only words you clearly hear. If there is no clear speech, return empty strings.` },
            { type: 'audio', value: audio },
          ] }],
          { responseConstraint: SCHEMA, signal: ac.signal },
        ), Math.max(15000, ((info.endMs - info.startMs) || 0) * 4), ac);
        timeouts = 0;
        const { language, transcript } = JSON.parse(raw);
        const text = (transcript || '').trim();
        const lang = (language || '').toLowerCase().split(/[-_]/)[0];
        if (!text || NOISE.test(text)) return;
        if (!plausible(text, info.voicedMs) || (lang && !HEARD.includes(lang))) {
          stats.dropped++;
          tell();
          return;
        }
        stats.written++;
        tell();
        onLine({ seg: ++seq, text, lang, startMs: info.startMs, endMs: info.endMs, at: startedAt + info.endMs });
      } finally {
        session.destroy();
      }
    }

    // One prompt at a time. If Nano falls behind, join the waiting pieces into one.
    async function drain() {
      if (busy || stopped) return;
      busy = true;
      await warm;
      while (queue.length && !stopped) {
        let item = queue.shift();
        // Far behind: join waiting pieces (up to 9 s) to catch up. A small backlog (such as the
        // first words while the model loads) is left alone: joined pieces can mix languages.
        if (queue.length >= 4) {
          const parts = [item];
          let total = item.samples.length;
          while (queue.length && total + queue[0].samples.length <= OUT_RATE * 9) {
            total += queue[0].samples.length;
            parts.push(queue.shift());
          }
          const len = parts.reduce((n, p) => n + p.samples.length, 0);
          const joined = new Float32Array(len);
          let o = 0;
          for (const p of parts) {
            joined.set(p.samples, o);
            o += p.samples.length;
          }
          const voicedMs = parts.reduce((n, p) => n + (p.info.voicedMs || 0), 0);
          item = { samples: joined, info: { startMs: parts[0].info.startMs, endMs: parts.at(-1).info.endMs, voicedMs } };
        }
        try {
          await transcribe(item.samples, item.info);
        } catch (e) {
          if (e.code === 'timeout' && ++timeouts >= 2) {
            onState({ state: 'error', code: 'nano-stuck', message: e.message });
            stop('Gemini Nano stopped answering. Close other tabs that use Chrome AI, or restart Chrome, then start again.');
            break;
          }
          onState({ state: 'warn', message: `Could not write down a moment of speech: ${e.message || e}` });
        }
      }
      busy = false;
    }

    const seg = createSegmenter({
      sampleRate: ctx.sampleRate,
      maxMs: 5000,
      endSilenceMs: 500,
      onSegment: (samples, info) => {
        stats.heard++;
        tell();
        queue.push({ samples, info });
        drain();
      },
    });
    tap.port.onmessage = (e) => seg.push(e.data);

    const track = stream.getAudioTracks()[0];
    if (track) track.addEventListener('ended', () => stop('The meeting tab stopped sending sound.'));

    function stop(reason) {
      if (stopped) return;
      stopped = true;
      // Speech still in flight is dropped: the model is being freed.
      try { tap.disconnect(); source.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      baseP.then((b) => b.destroy(), () => {});
      onState({ state: 'stopped', message: reason || '' });
    }

    onState({ state: 'listening' });
    return {
      stop,
      setOptions(next) {
        if ('spokenHint' in next) opts.spokenHint = next.spokenHint || '';
      },
    };
  }

  root.TafsiriListener = { startListening, HEARD, plausible };
})(globalThis);
