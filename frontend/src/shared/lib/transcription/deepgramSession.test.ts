import { afterEach, expect, it, vi } from "vitest";
import { createDeepgramStreamSession } from "./deepgramClient";

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static latest: FakeSocket;
  readyState = 0;
  binaryType = "";
  onopen?: () => void;
  onclose?: (event: { code: number; reason: string }) => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "closed" });
  });
  constructor() {
    FakeSocket.latest = this;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("停止要求後も最終結果を受け取り、サーバー切断を待って終了する", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  const onTranscript = vi.fn();
  const pending = createDeepgramStreamSession({ channels: 1, onTranscript });
  const socket = FakeSocket.latest;
  socket.open();
  const session = await pending;
  const closing = session.close();
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "CloseStream" }));
  expect(socket.close).not.toHaveBeenCalled();
  socket.onmessage?.({
    data: JSON.stringify({
      type: "Results",
      is_final: true,
      channel: { alternatives: [{ transcript: "最後の発話" }] },
    }),
  });
  expect(onTranscript).toHaveBeenCalledWith(
    expect.objectContaining({ text: "最後の発話", isFinal: true }),
  );
  session.sendAudio(new ArrayBuffer(2));
  expect(socket.send).toHaveBeenCalledTimes(1);
  socket.onclose?.({ code: 1000, reason: "done" });
  await closing;
});

it("最終結果の待機は期限付きで、停止の再呼び出しも同じ完了を待つ", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  const pending = createDeepgramStreamSession({ channels: 1, onTranscript: vi.fn() });
  FakeSocket.latest.open();
  const session = await pending;
  const closing = session.close();
  expect(session.close()).toBe(closing);
  await vi.advanceTimersByTimeAsync(6000);
  await closing;
  expect(FakeSocket.latest.close).toHaveBeenCalledOnce();
});

it("接続待ちをキャンセルするとソケットを閉じて開始を中止する", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  const controller = new AbortController();
  const pending = createDeepgramStreamSession({
    channels: 1,
    onTranscript: vi.fn(),
    signal: controller.signal,
  });
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejection;
  expect(FakeSocket.latest.close).toHaveBeenCalledOnce();
});
