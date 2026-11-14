import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type {
  DeepgramStreamOptions,
  DeepgramStreamSession,
} from "@/shared/lib/transcription/deepgramClient";
import { useRealtimeTranscription } from "./useRealtimeTranscription";

const mocks = vi.hoisted(() => ({
  audio: {
    mode: "dual",
    isCapturing: false,
    startCapture: vi.fn<() => Promise<boolean>>(),
    stopCapture: vi.fn<() => Promise<void>>(),
  },
  connect: vi.fn<(options: DeepgramStreamOptions) => Promise<DeepgramStreamSession>>(),
}));
vi.mock("@/features/audio/useDualMicAudio", () => ({ useDualMicAudio: () => mocks.audio }));
vi.mock("@/shared/lib/transcription/deepgramClient", () => ({
  createDeepgramStreamSession: mocks.connect,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.audio.startCapture.mockResolvedValue(true);
  mocks.audio.stopCapture.mockResolvedValue(undefined);
});
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const session = () => ({ sendAudio: vi.fn(), close: vi.fn(async () => {}) });

it("マイク開始待ちで切断されても、遅れた完了で接続状態へ戻さない", async () => {
  const capture = deferred<boolean>();
  mocks.audio.startCapture.mockReturnValue(capture.promise);
  mocks.connect.mockResolvedValue(session());
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(mocks.audio.startCapture).toHaveBeenCalledOnce());
  const options = mocks.connect.mock.calls[0][0];
  act(() => options.onClose?.({ code: 1006, reason: "disconnected" }));
  await act(async () => capture.resolve(true));
  expect(hook.result.current.isStreaming).toBe(false);
  expect(options.signal?.aborted).toBe(true);
  expect(mocks.audio.stopCapture).toHaveBeenCalledOnce();
});

it("接続待ちで離脱した場合はキャンセルし、遅れた接続でマイクを開始しない", async () => {
  const connection = deferred<DeepgramStreamSession>();
  mocks.connect.mockReturnValue(connection.promise);
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => hook.result.current.toggleTranscription());
  const options = mocks.connect.mock.calls[0][0];
  hook.unmount();
  expect(options.signal?.aborted).toBe(true);
  const stream = session();
  await act(async () => connection.resolve(stream));
  expect(mocks.audio.startCapture).not.toHaveBeenCalled();
  expect(stream.close).toHaveBeenCalledOnce();
});

it("終了待機中の最終結果を残し、完了まで再開せず、旧接続のイベントは無視する", async () => {
  const drain = deferred<void>();
  const stream = session();
  stream.close.mockReturnValue(drain.promise);
  mocks.connect.mockResolvedValue(stream);
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
  const options = mocks.connect.mock.calls[0][0];
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(stream.close).toHaveBeenCalledOnce());
  expect(hook.result.current.isStopping).toBe(true);
  act(() => hook.result.current.toggleTranscription());
  expect(mocks.connect).toHaveBeenCalledOnce();
  act(() =>
    options.onTranscript({
      channelIndex: 0,
      text: "最終結果",
      isFinal: true,
      speechFinal: true,
      startSec: 0,
      endSec: 1,
      confidence: 1,
    }),
  );
  expect(hook.result.current.segments[0].text).toBe("最終結果");
  await act(async () => drain.resolve());
  expect(hook.result.current.isStopping).toBe(false);
  mocks.connect.mockResolvedValue(session());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
  act(() => options.onClose?.({ code: 1006, reason: "old" }));
  expect(hook.result.current.isStreaming).toBe(true);
});
