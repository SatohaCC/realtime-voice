import { describe, expect, it } from "vitest";
import { detectSpeakingChannels } from "./dualMicCapture";

describe("detectSpeakingChannels", () => {
  it("両チャンネルがノイズフロア未満の場合は無音と判定する", () => {
    expect(detectSpeakingChannels([0.01, 0.02])).toEqual([false, false]);
  });

  it("一方のチャンネルが閾値以上で優位な場合はそのチャンネルのみ発話中と判定する", () => {
    expect(detectSpeakingChannels([0.3, 0.1])).toEqual([true, false]);
    expect(detectSpeakingChannels([0.08, 0.25])).toEqual([false, true]);
  });

  it("両チャンネルが同程度の音量で閾値以上の場合は両方とも発話中と判定する", () => {
    expect(detectSpeakingChannels([0.2, 0.19])).toEqual([true, true]);
  });
});
