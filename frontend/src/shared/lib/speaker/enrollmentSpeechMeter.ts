/** Backendと同じ20ms単位の音量・音割れ条件で、登録の有効音声を概算する。 */
export class EnrollmentSpeechMeter {
  private pending = new Int16Array(0);
  private voicedFrames = 0;

  append(pcm16: ArrayBuffer): number {
    const input = new Int16Array(pcm16);
    const samples = new Int16Array(this.pending.length + input.length);
    samples.set(this.pending);
    samples.set(input, this.pending.length);
    const frameSize = 320;
    let offset = 0;
    for (; offset + frameSize <= samples.length; offset += frameSize) {
      let energy = 0;
      let clipped = 0;
      for (let index = offset; index < offset + frameSize; index += 1) {
        const value = samples[index] / 32768;
        energy += value * value;
        if (Math.abs(value) >= 0.98) clipped += 1;
      }
      if (energy / frameSize >= 0.01 ** 2 && clipped / frameSize < 0.01) {
        this.voicedFrames += frameSize;
      }
    }
    this.pending = samples.slice(offset);
    return this.voicedFrames / 16000;
  }
}
