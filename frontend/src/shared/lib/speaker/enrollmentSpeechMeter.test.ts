import { expect, it } from "vitest";
import { EnrollmentSpeechMeter } from "./enrollmentSpeechMeter";

it("無音・低音量・音割れを除外し、チャンク境界を跨いで有効音声を計測する", () => {
  const meter = new EnrollmentSpeechMeter();
  for (const amplitude of [0, 100, 32767]) {
    expect(meter.append(new Int16Array(16000).fill(amplitude).buffer)).toBe(0);
  }
  expect(meter.append(new Int16Array(157).fill(3000).buffer)).toBe(0);
  expect(meter.append(new Int16Array(15843).fill(3000).buffer)).toBe(1);
});
