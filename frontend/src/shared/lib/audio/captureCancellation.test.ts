import { afterEach, expect, it, vi } from "vitest";
import { createDualMicCapture } from "./dualMicCapture";

afterEach(() => vi.unstubAllGlobals());
it("権限待ちで中止しても、後から許可されたマイクを解放する", async () => {
  let allow: (stream: MediaStream) => void = () => {};
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            allow = resolve;
          }),
      ),
    },
  });
  const controller = new AbortController();
  const capture = createDualMicCapture({
    mic1DeviceId: "mic",
    onAudioFrame: vi.fn(),
    signal: controller.signal,
  });
  const rejected = expect(capture).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  allow({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await rejected;
  expect(stop).toHaveBeenCalledOnce();
});

it.each([1, 2] as const)(
  "%dマイク時の入力を確保し、2マイク時だけ自動ゲイン調整を無効にする",
  async (channels) => {
    const controller = new AbortController();
    const stop = vi.fn();
    let acquired = 0;
    const getUserMedia = vi.fn(async () => {
      acquired += 1;
      if (acquired === channels) controller.abort();
      return { getTracks: () => [{ stop }] };
    });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    await expect(
      createDualMicCapture({
        mic1DeviceId: "pharmacist",
        mic2DeviceId: channels === 2 ? "patient" : undefined,
        onAudioFrame: vi.fn(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getUserMedia).toHaveBeenCalledTimes(channels);
    for (const [index, call] of getUserMedia.mock.calls.entries()) {
      expect(call).toEqual([
        {
          audio: {
            deviceId: { exact: index === 0 ? "pharmacist" : "patient" },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: channels === 1,
          },
          video: false,
        },
      ]);
    }
    expect(stop).toHaveBeenCalled();
  },
);
