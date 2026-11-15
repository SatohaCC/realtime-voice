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
  authOk(expiresAt = 2_000_000_000, sessionExpiresAt = 2_000_000_000) {
    this.onmessage?.({
      data: JSON.stringify({
        type: "AuthOk",
        expires_at: expiresAt,
        session_expires_at: sessionExpiresAt,
      }),
    });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("接続直後に Auth フレームを送信し、AuthOk までセッション解決を抑止する", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  const onAuthOk = vi.fn();
  let resolved = false;
  const pending = createDeepgramStreamSession({
    accessToken: "jwt-token-1",
    channels: 2,
    onAuthOk,
    onTranscript: vi.fn(),
  }).then((s) => {
    resolved = true;
    return s;
  });

  const socket = FakeSocket.latest;
  socket.open();
  await Promise.resolve();

  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ type: "Auth", access_token: "jwt-token-1" }),
  );
  expect(resolved).toBe(false);

  socket.authOk(1_800_000_100, 1_800_000_050);
  const session = await pending;
  expect(resolved).toBe(true);
  expect(onAuthOk).toHaveBeenCalledWith({
    expiresAt: 1_800_000_100,
    sessionExpiresAt: 1_800_000_050,
  });

  const pcm = new ArrayBuffer(4);
  session.sendAudio(pcm);
  expect(socket.send).toHaveBeenCalledWith(pcm);
});

it("AuthOk 前に Error・タイムアウト・キャンセルが発生すると拒否してソケットを閉じる", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);

  const errPending = createDeepgramStreamSession({
    accessToken: "bad-jwt",
    channels: 1,
    onTranscript: vi.fn(),
  });
  const errSocket = FakeSocket.latest;
  errSocket.open();
  errSocket.onmessage?.({
    data: JSON.stringify({ type: "Error", code: "AUTH_EXPIRED", message: "期限切れです" }),
  });
  await expect(errPending).rejects.toThrow("期限切れです");
  expect(errSocket.close).toHaveBeenCalledOnce();

  vi.useFakeTimers();
  const timeoutPending = createDeepgramStreamSession({
    accessToken: "jwt-timeout",
    channels: 1,
    connectTimeoutMs: 500,
    onTranscript: vi.fn(),
  });
  FakeSocket.latest.open();
  const timeoutAssert = expect(timeoutPending).rejects.toThrow("タイムアウトしました");
  await vi.advanceTimersByTimeAsync(500);
  await timeoutAssert;
  vi.useRealTimers();

  const controller = new AbortController();
  const cancelPending = createDeepgramStreamSession({
    accessToken: "jwt-cancel",
    channels: 1,
    onTranscript: vi.fn(),
    signal: controller.signal,
  });
  const cancelSocket = FakeSocket.latest;
  const rejection = expect(cancelPending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejection;
  expect(cancelSocket.close).toHaveBeenCalledOnce();
});

it("停止要求後も最終結果を受け取り、サーバー切断を待って終了する", async () => {
  vi.stubGlobal("WebSocket", FakeSocket);
  const onTranscript = vi.fn();
  const pending = createDeepgramStreamSession({
    accessToken: "jwt-ok",
    channels: 1,
    onTranscript,
  });
  const socket = FakeSocket.latest;
  socket.open();
  socket.authOk();
  const session = await pending;
  const sendCountAfterAuth = socket.send.mock.calls.length;
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
  expect(socket.send).toHaveBeenCalledTimes(sendCountAfterAuth + 1);
  socket.onclose?.({ code: 1000, reason: "done" });
  await closing;
});

it("最終結果の待機は期限付きで、停止の再呼び出しも同じ完了を待つ", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  const pending = createDeepgramStreamSession({
    accessToken: "jwt-ok",
    channels: 1,
    onTranscript: vi.fn(),
  });
  FakeSocket.latest.open();
  FakeSocket.latest.authOk();
  const session = await pending;
  const closing = session.close();
  expect(session.close()).toBe(closing);
  await vi.advanceTimersByTimeAsync(6000);
  await closing;
  expect(FakeSocket.latest.close).toHaveBeenCalledOnce();
});
