import { afterEach, describe, expect, it, vi } from "vitest";
import { detectSpeakingChannels, resolveCaptureDevices } from "./dualMicCapture";

afterEach(() => vi.unstubAllGlobals());

describe("resolveCaptureDevices", () => {
  it.each([0, 1, 2])(
    "権限取得後の入力が%d本なら2本だけを許可し、一時入力を解放する",
    async (count) => {
      const stop = vi.fn();
      const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
      const enumerateDevices = vi.fn().mockResolvedValue(
        Array.from({ length: count }, (_, i) => ({
          kind: "audioinput",
          deviceId: `mic-${i}`,
          label: `Mic ${i}`,
        })),
      );
      vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, enumerateDevices } });
      const result = resolveCaptureDevices({ mic1DeviceId: "", mic2DeviceId: "" }, 2);
      if (count === 2) {
        await expect(result).resolves.toEqual({ mic1DeviceId: "mic-0", mic2DeviceId: "mic-1" });
      } else {
        await expect(result).rejects.toThrow("異なる2つ");
      }
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
    },
  );

  it("権限待ち中のキャンセル後に取得した入力を解放する", async () => {
    const controller = new AbortController();
    const stop = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          controller.abort();
          return { getTracks: () => [{ stop }] };
        }),
      },
    });
    await expect(
      resolveCaptureDevices({ mic1DeviceId: "" }, 2, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("1マイクは既定入力を許可し、重複した2マイクは拒否する", async () => {
    await expect(resolveCaptureDevices({ mic1DeviceId: "" }, 1)).resolves.toEqual({
      mic1DeviceId: "",
      mic2DeviceId: undefined,
    });
    await expect(
      resolveCaptureDevices({ mic1DeviceId: "same", mic2DeviceId: "same" }, 2),
    ).rejects.toThrow("異なる入力");
  });
});

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
