import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  DualMicCaptureOptions,
  DualMicCaptureSession,
} from "@/shared/lib/audio/dualMicCapture";
import { useDualMicAudio } from "./useDualMicAudio";

const mocks = vi.hoisted(() => ({
  create: vi.fn<(options: DualMicCaptureOptions) => Promise<DualMicCaptureSession>>(),
  listDevices: vi.fn<() => Promise<Array<{ deviceId: string; label: string }>>>(),
}));
vi.mock("@/shared/lib/audio/dualMicCapture", () => ({
  createDualMicCapture: mocks.create,
  listAudioInputDevices: mocks.listDevices,
  detectSpeakingChannels: () => [false, false],
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listDevices.mockResolvedValue([]);
});

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

it("2マイクモードで同一デバイスの重複選択と開始を拒否する", async () => {
  mocks.listDevices.mockResolvedValue([
    { deviceId: "mic-a", label: "マイク A" },
    { deviceId: "mic-b", label: "マイク B" },
  ]);
  const hook = renderHook(() => useDualMicAudio());

  await act(async () => {
    await hook.result.current.refreshDevices();
  });

  expect(hook.result.current.mic1DeviceId).toBe("mic-a");
  expect(hook.result.current.mic2DeviceId).toBe("mic-b");
  expect(hook.result.current.hasDuplicateDevices).toBe(false);

  act(() => {
    hook.result.current.setMic2DeviceId("mic-a");
  });

  expect(hook.result.current.mic2DeviceId).toBe("mic-b");
  expect(hook.result.current.error).toContain("同じデバイスは指定できません");

  // 1本しかデバイスが見つからない環境では重複警告になり、2マイクで開始できない
  mocks.listDevices.mockResolvedValue([{ deviceId: "only-mic", label: "唯一のマイク" }]);
  const singleDeviceHook = renderHook(() => useDualMicAudio());
  await act(async () => {
    await singleDeviceHook.result.current.refreshDevices();
  });

  expect(singleDeviceHook.result.current.hasDuplicateDevices).toBe(true);
  let started = true;
  await act(async () => {
    started = await singleDeviceHook.result.current.startCapture();
  });
  expect(started).toBe(false);
  expect(mocks.create).not.toHaveBeenCalled();
});
