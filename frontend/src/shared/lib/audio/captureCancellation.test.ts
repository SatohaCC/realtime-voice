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
