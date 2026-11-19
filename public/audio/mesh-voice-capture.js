// Independent 100ms, 16kHz PCM frames: no MediaRecorder container dependency.
class MeshVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(1600);
    this.index = 0;
    this.phase = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const value of input) {
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      this.samples[this.index++] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
      if (this.index === 1600) {
        this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
        this.samples = new Int16Array(1600);
        this.index = 0;
      }
    }
    return true;
  }
}
registerProcessor('mesh-voice-capture', MeshVoiceCapture);