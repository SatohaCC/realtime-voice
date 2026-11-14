import type { AudioCaptureFrame } from "../audio/dualMicCapture";

/** 送信音声の時刻に対応するRMSを保持し、認識遅延後も同じ発話区間を参照する。 */
export class AudioLevelHistory {
  private endSec = 0;
  private chunks: { start: number; end: number; levels: readonly [number, number] }[] = [];

  append(frame: AudioCaptureFrame) {
    const start = this.endSec;
    this.endSec += frame.pcm16.byteLength / (2 * frame.channels * frame.sampleRate);
    this.chunks.push({ start, end: this.endSec, levels: frame.levels });
    while (this.chunks[0] && this.chunks[0].end < this.endSec - 120) this.chunks.shift();
  }

  levelsFor(start: number, end: number): readonly [number, number] {
    if (end <= start) return [0, 0];
    let coverage = 0;
    const energy = [0, 0];
    for (const chunk of this.chunks) {
      const overlap = Math.max(0, Math.min(end, chunk.end) - Math.max(start, chunk.start));
      coverage += overlap;
      energy[0] += chunk.levels[0] ** 2 * overlap;
      energy[1] += chunk.levels[1] ** 2 * overlap;
    }
    // 音量履歴が欠けた区間は推測で発話を削除しない。
    if (coverage < end - start - 0.000001) return [0, 0];
    return [Math.sqrt(energy[0] / coverage), Math.sqrt(energy[1] / coverage)];
  }
}
