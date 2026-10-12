// The audio listener: takes a MediaStream (the meeting tab's sound), keeps it audible, cuts it at
// pauses and asks Gemini Nano (Chrome's on-device model) what was said and in which language.
// Runs in the offscreen document; the dev preview runs it on a normal page.
(function (root) {
  const { createSegmenter, OUT_RATE } = root.TafsiriSegmenter;

  const SCHEMA = {
    type: 'object',
    properties: {
      language: { type: 'string', description: 'ISO 639-1 code of the spoken language, or "" if no speech' },
      transcript: { type: 'string' },
    },
    required: ['language', 'transcript'],
  };

  const SCHEMA_WITH_TRANSLATION = {
    type: 'object',
    properties: { ...SCHEMA.properties, translation: { type: 'string' } },
    required: ['language', 'transcript', 'translation'],
  };

  // Swahili counts clock hours from sunrise.
  const SWAHILI_TIME = 'Swahili clock time starts at 6: "saa moja asubuhi" is 7 a.m., "saa nne asubuhi" is 10 a.m., "saa moja jioni" is 7 p.m.';

  // Phrases a speech model tends to invent from noise or music.
  const NOISE = /^(\W*|\[.*\]|\(.*\)|thank you\.?|thanks for watching\.?|music|applause)$/i;

  // translateTo: a language name. When set, Nano also translates each line in the same call,
  // which halves the work for languages Chrome's translator lacks (such as Swahili).
  async function startListening(stream, { workletUrl, spokenHint, translateTo, onLine, onState, playback = true }) {
    const opts = { spokenHint, translateTo };
    if (!('LanguageModel' in root)) throw Object.assign(new Error('Gemini Nano is not available in this Chrome.'), { code: 'no-nano' });
    const availability = await LanguageModel.availability({ expectedInputs: [{ type: 'audio' }] });
    if (availability !== 'available') {
      throw Object.assign(new Error(`Gemini Nano is ${availability} on this computer.`), { code: availability === 'unavailable' ? 'no-nano' : 'nano-not-ready' });
    }
    // Start hearing right away; speech is queued while the model loads, so the first words are kept.
    const baseP = LanguageModel.create({ expectedInputs: [{ type: 'audio' }], temperature: 0.1, topK: 1 });
    baseP.catch((e) => {
      onState({ state: 'error', code: 'nano-not-ready', message: String((e && e.message) || e) });
      stop('Gemini Nano could not load on this computer. Try Read captions instead.');
    });
    // The first prompt after loading is slow. Spend that time now, before anyone speaks.
    const warm = (async () => {
      try {
        const s = await (await baseP).clone();
        const quiet = new AudioBuffer({ length: OUT_RATE / 2, sampleRate: OUT_RATE, numberOfChannels: 1 });
        try {
          await s.prompt([{ role: 'user', content: [{ type: 'text', value: 'Transcribe this audio.' }, { type: 'audio', value: quiet }] }], { responseConstraint: SCHEMA });
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
    const startedAt = Date.now();

    async function transcribe(samples, info) {
      const audio = new AudioBuffer({ length: samples.length, sampleRate: OUT_RATE, numberOfChannels: 1 });
      audio.copyToChannel(samples, 0);
      const { spokenHint, translateTo } = opts; // read per piece, so a language change applies at once
      const hint = spokenHint ? ` The speech is in ${spokenHint}.` : '';
      const also = translateTo
        ? ` Then translate the transcript into ${translateTo}, naturally, keeping names and numbers.${/swahili/i.test(translateTo) ? ` ${SWAHILI_TIME}` : ''}`
        : '';
      const session = await (await baseP).clone();
      try {
        const raw = await session.prompt(
          [{ role: 'user', content: [
            { type: 'text', value: `Transcribe this meeting audio exactly, in the language it is spoken in (the transcript is never translated). Give the ISO 639-1 language code.${hint}${also} If there is no clear speech, return empty strings.` },
            { type: 'audio', value: audio },
          ] }],
          { responseConstraint: translateTo ? SCHEMA_WITH_TRANSLATION : SCHEMA },
        );
        const { language, transcript, translation } = JSON.parse(raw);
        const text = (transcript || '').trim();
        if (text && !NOISE.test(text)) {
          onLine({
            seg: ++seq,
            text,
            lang: (language || '').toLowerCase().split(/[-_]/)[0],
            translation: translateTo ? (translation || '').trim() : null,
            startMs: info.startMs,
            endMs: info.endMs,
            at: startedAt + info.endMs,
          });
        }
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
          item = { samples: joined, info: { startMs: parts[0].info.startMs, endMs: parts.at(-1).info.endMs } };
        }
        try {
          await transcribe(item.samples, item.info);
        } catch (e) {
          onState({ state: 'warn', message: `Could not transcribe a moment of speech: ${e.message || e}` });
        }
      }
      busy = false;
    }

    const seg = createSegmenter({
      sampleRate: ctx.sampleRate,
      maxMs: 5000,
      endSilenceMs: 500,
      onSegment: (samples, info) => {
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
        if ('translateTo' in next) opts.translateTo = next.translateTo || '';
      },
    };
  }

  root.TafsiriListener = { startListening };
})(globalThis);
