/**
 * 2チャンネル（L: マイク1, R: マイク2）の音声入力を 16kHz Int16 PCM に変換し、
 * 各チャンネルの RMS 音量とあわせてメインスレッドへ送信する AudioWorkletProcessor。
 */
const TARGET_SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 100;
const TARGET_FRAMES_PER_CHUNK = (TARGET_SAMPLE_RATE * CHUNK_DURATION_MS) / 1000;

class DualPcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.activeChannels = processorOptions.channels === 1 ? 1 : 2;
    this.ratio = sampleRate / TARGET_SAMPLE_RATE;
    this.phase = 0;
    this.bufferedFrames = 0;
    this.pcmBuffer = new Int16Array(TARGET_FRAMES_PER_CHUNK * this.activeChannels);
    this.leftEnergySum = 0;
    this.rightEnergySum = 0;
    this.energySampleCount = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data?.type === "flush") {
        this.flush();
        this.stopped = true;
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  /**
   * Float32 (-1.0〜1.0) を Int16 (-32768〜32767) へクランプ変換する。
   */
  floatToInt16(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
  }

  /** 停止時は100ms未満の末尾音声も送信する。 */
  flush() {
    if (this.bufferedFrames === 0) return;
    const leftRms =
      this.energySampleCount > 0 ? Math.sqrt(this.leftEnergySum / this.energySampleCount) : 0;
    const rightRms =
      this.activeChannels === 2 && this.energySampleCount > 0
        ? Math.sqrt(this.rightEnergySum / this.energySampleCount)
        : 0;

    const payload =
      this.bufferedFrames === TARGET_FRAMES_PER_CHUNK
        ? this.pcmBuffer
        : this.pcmBuffer.slice(0, this.bufferedFrames * this.activeChannels);
    this.port.postMessage(
      {
        type: "audio-frame",
        pcm16: payload.buffer,
        sampleRate: TARGET_SAMPLE_RATE,
        channels: this.activeChannels,
        levels: [Math.min(1, leftRms), Math.min(1, rightRms)],
      },
      [payload.buffer],
    );

    this.pcmBuffer = new Int16Array(TARGET_FRAMES_PER_CHUNK * this.activeChannels);
    this.bufferedFrames = 0;
    this.leftEnergySum = 0;
    this.rightEnergySum = 0;
    this.energySampleCount = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const left = input[0];
    if (!left || left.length === 0) {
      return true;
    }
    const right = this.activeChannels === 2 && input[1] ? input[1] : null;

    // 入力ブロック全体の RMS 計算用にエネルギーを積算する
    for (let i = 0; i < left.length; i += 1) {
      const l = left[i];
      const r = right ? right[i] : 0;
      this.leftEnergySum += l * l;
      this.rightEnergySum += r * r;
      this.energySampleCount += 1;
    }

    // sampleRate -> 16kHz へ線形補間でダウンサンプリング
    while (this.phase < left.length) {
      const index = Math.floor(this.phase);
      const frac = this.phase - index;
      const nextIndex = Math.min(index + 1, left.length - 1);

      const leftSample = left[index] + (left[nextIndex] - left[index]) * frac;
      const rightSample = right ? right[index] + (right[nextIndex] - right[index]) * frac : 0;

      const offset = this.bufferedFrames * this.activeChannels;
      this.pcmBuffer[offset] = this.floatToInt16(leftSample);
      if (this.activeChannels === 2) {
        this.pcmBuffer[offset + 1] = this.floatToInt16(rightSample);
      }

      this.bufferedFrames += 1;
      this.phase += this.ratio;

      if (this.bufferedFrames >= TARGET_FRAMES_PER_CHUNK) {
        this.flush();
      }
    }

    this.phase -= left.length;
    return true;
  }
}

registerProcessor("dual-pcm-processor", DualPcmProcessor);
