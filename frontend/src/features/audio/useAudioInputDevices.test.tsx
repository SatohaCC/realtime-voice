import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAudioInputDevices } from "./useAudioInputDevices";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockMediaDevices() {
  let allowed = false;
  const stop = vi.fn();
  const getUserMedia = vi.fn(async () => {
    allowed = true;
    return { getTracks: () => [{ stop }] };
  });
  const enumerateDevices = vi.fn(async () => [
    { kind: "audioinput", deviceId: allowed ? "mic-1" : "", label: allowed ? "マイク" : "" },
  ]);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia,
      enumerateDevices,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  return { getUserMedia, enumerateDevices, stop };
}

it("初回表示では権限要求せず、利用者の再取得操作でIDを取得して確認用マイクを解放する", async () => {
  const { getUserMedia, stop } = mockMediaDevices();
  const { result } = renderHook(() => useAudioInputDevices());
  await waitFor(() => expect(result.current.devices).toHaveLength(1));
  expect(result.current.devices[0].deviceId).toBe("");
  expect(getUserMedia).not.toHaveBeenCalled();

  await act(() => result.current.refreshDevices(true));

  expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
  expect(result.current.devices[0].deviceId).toBe("mic-1");
  expect(stop).toHaveBeenCalledOnce();
});

it("権限拒否は画面へ返し、再操作で回復できる", async () => {
  const { getUserMedia } = mockMediaDevices();
  const { result } = renderHook(() => useAudioInputDevices());
  await waitFor(() => expect(result.current.devices).toHaveLength(1));
  getUserMedia.mockRejectedValueOnce(new Error("マイクの利用が拒否されました。"));
  await act(() => result.current.refreshDevices(true));
  expect(result.current.error).toBe("マイクの利用が拒否されました。");

  await act(() => result.current.refreshDevices(true));
  expect(result.current.error).toBeNull();
  expect(result.current.devices[0].deviceId).toBe("mic-1");
});

it("権限取得後の一覧取得が失敗しても確認用マイクを残さない", async () => {
  const { enumerateDevices, stop } = mockMediaDevices();
  const { result } = renderHook(() => useAudioInputDevices());
  await waitFor(() => expect(result.current.devices).toHaveLength(1));
  enumerateDevices.mockRejectedValueOnce(new Error("一覧の取得に失敗しました。"));
  await act(() => result.current.refreshDevices(true));
  expect(result.current.error).toBe("一覧の取得に失敗しました。");
  expect(stop).toHaveBeenCalledOnce();
});
