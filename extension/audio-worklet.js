// Audio worklet: hands the meeting's sound to the listener in batches of about 100 ms.
class TafsiriTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.len = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const frames = input[0].length;
      for (let i = 0; i < frames; i++) {
        // Mix all channels down to mono.
        let v = 0;
        for (let c = 0; c < input.length; c++) v += input[c][i];
        this.buf[this.len++] = v / input.length;
        if (this.len === this.buf.length) {
          this.port.postMessage(this.buf);
          this.buf = new Float32Array(4096);
          this.len = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('tafsiri-tap', TafsiriTap);
