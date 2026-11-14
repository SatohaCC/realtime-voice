import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  DualMicCaptureOptions,
  DualMicCaptureSession,
} from "@/shared/lib/audio/dualMicCapture";
import { useDualMicAudio } from "./useDualMicAudio";

const mocks = vi.hoisted(() => ({
  create: vi.fn<(options: DualMicCaptureOptions) => Promise<DualMicCaptureSession>>(),
}));
vi.mock("@/shared/lib/audio/dualMicCapture", () => ({
  createDualMicCapture: mocks.create,
  listAudioInputDevices: async () => [],
  detectSpeakingChannels: () => [false, false],
}));
beforeEach(() => vi.resetAllMocks());

it.each(["stop", "unmount"])(
  "初期化中に%sすると、遅れて作成されたマイクを停止する",
  async (operation) => {
    let finish: (session: DualMicCaptureSession) => void = () => {};
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const hook = renderHook(() => useDualMicAudio());
    let starting: Promise<boolean> = Promise.resolve(false);
    act(() => {
      starting = hook.result.current.startCapture();
    });
    const signal = mocks.create.mock.calls[0][0].signal;
    if (operation === "stop")
      await act(async () => {
        await hook.result.current.stopCapture();
      });
    else hook.unmount();
    expect(signal?.aborted).toBe(true);
    const stop = vi.fn(async () => {});
    let started: boolean | undefined;
    await act(async () => {
      finish({ stop });
      started = await starting;
    });
    expect(started).toBe(false);
    expect(stop).toHaveBeenCalledOnce();
  },
);
