import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AudioCaptureFrame } from "@/shared/lib/audio/dualMicCapture";
import { createEmptySoapNote } from "@/shared/lib/conversation/conversationReducer";
import type {
  DeepgramStreamOptions,
  DeepgramStreamSession,
} from "@/shared/lib/transcription/deepgramClient";
import { useRealtimeTranscription } from "./useRealtimeTranscription";

const mocks = vi.hoisted(() => ({
  audio: {
    mode: "dual",
    hasDuplicateDevices: false,
    isCapturing: false,
    error: null,
    prepareCapture: vi.fn(),
    startCapture: vi.fn<() => Promise<boolean>>(),
    stopCapture: vi.fn<() => Promise<void>>(),
  },
  connect: vi.fn<(options: DeepgramStreamOptions) => Promise<DeepgramStreamSession>>(),
  getValidAccessToken: vi.fn<() => Promise<string | null>>(),
  subscribeAuthState:
    vi.fn<
      (callbacks: {
        onSignedOut?: () => void;
        onUserChanged?: (user: { userId: string; email: string | null } | null) => void;
      }) => () => void
    >(),
  authCallbacks: {} as {
    onSignedOut?: () => void;
    onUserChanged?: (user: { userId: string; email: string | null } | null) => void;
  },
  onAudioFrame: undefined as ((frame: AudioCaptureFrame) => void) | undefined,
}));
vi.mock("@/features/audio/useDualMicAudio", () => ({
  useDualMicAudio: (options: { onAudioFrame: (frame: AudioCaptureFrame) => void }) => {
    mocks.onAudioFrame = options.onAudioFrame;
    return mocks.audio;
  },
}));
vi.mock("@/shared/lib/transcription/deepgramClient", () => ({
  createDeepgramStreamSession: mocks.connect,
}));
vi.mock("@/shared/lib/supabase/client", () => ({
  getValidAccessToken: mocks.getValidAccessToken,
  subscribeAuthState: mocks.subscribeAuthState,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authCallbacks = {};
  mocks.audio.mode = "dual";
  mocks.audio.hasDuplicateDevices = false;
  mocks.audio.prepareCapture.mockResolvedValue({ mic1DeviceId: "mic-a", mic2DeviceId: "mic-b" });
  mocks.audio.startCapture.mockResolvedValue(true);
  mocks.audio.stopCapture.mockResolvedValue(undefined);
  mocks.getValidAccessToken.mockResolvedValue("valid-access-token");
  mocks.subscribeAuthState.mockImplementation((callbacks) => {
    mocks.authCallbacks = callbacks;
    return () => {};
  });
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const session = () => ({
  sendAudio: vi.fn(),
  updateSegmentSpeaker: vi.fn(),
  close: vi.fn(async () => {}),
});

it("入力デバイスの確定前に接続せず、確定した2入力で収音する", async () => {
  const selection = deferred<{ mic1DeviceId: string; mic2DeviceId: string }>();
  mocks.audio.prepareCapture.mockReturnValue(selection.promise);
  mocks.connect.mockResolvedValue(session());
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(mocks.audio.prepareCapture).toHaveBeenCalledOnce());
  expect(mocks.connect).not.toHaveBeenCalled();
  const devices = { mic1DeviceId: "mic-a", mic2DeviceId: "mic-b" };
  await act(async () => selection.resolve(devices));
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
  expect(mocks.connect.mock.calls[0][0].channels).toBe(2);
  expect(mocks.audio.startCapture).toHaveBeenCalledWith(devices);
});

it("2入力の確定に失敗した場合は接続と収音を開始しない", async () => {
  mocks.audio.prepareCapture.mockRejectedValue(new Error("異なる2つの入力が必要です"));
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.error).toContain("異なる2つ"));
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.audio.startCapture).not.toHaveBeenCalled();
});

it("入力の権限待ちで停止すると、確定後も接続しない", async () => {
  const selection = deferred<{ mic1DeviceId: string; mic2DeviceId: string }>();
  mocks.audio.prepareCapture.mockReturnValue(selection.promise);
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(mocks.audio.prepareCapture).toHaveBeenCalledOnce());
  act(() => hook.result.current.toggleTranscription());
  await act(async () => selection.resolve({ mic1DeviceId: "mic-a", mic2DeviceId: "mic-b" }));
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.audio.startCapture).not.toHaveBeenCalled();
});

it.each([false, true])(
  "復元失敗時は下書きを保持して収音と更新を停止する（接続確定前: %s）",
  async (beforeConnected) => {
    mocks.connect.mockResolvedValue(session());
    const hook = renderHook(() => useRealtimeTranscription());
    act(() => hook.result.current.toggleTranscription());
    await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
    const oldOptions = mocks.connect.mock.calls[0][0];
    const conversationId = oldOptions.conversationId ?? "";
    const draft = { ...createEmptySoapNote(conversationId), revision: 5 };
    act(() =>
      oldOptions.onConversationEvent?.({
        type: "SoapUpdated",
        protocol_version: 1,
        conversation_id: conversationId,
        event_id: "draft",
        sequence: 12,
        soap: draft,
        changed_item_ids: [],
        retracted_item_ids: [],
      }),
    );
    act(() => hook.result.current.toggleTranscription());
    await waitFor(() => expect(hook.result.current.isStopping).toBe(false));

    const stream = session();
    const connection = deferred<DeepgramStreamSession>();
    mocks.connect.mockReturnValue(connection.promise);
    act(() => hook.result.current.toggleTranscription());
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(2));
    const options = mocks.connect.mock.calls[1][0];
    if (!beforeConnected) {
      await act(async () => connection.resolve(stream));
      await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
    }
    const capturesBeforeLoss = mocks.audio.startCapture.mock.calls.length;
    act(() =>
      options.onConversationEvent?.({
        type: "ConversationSnapshot",
        protocol_version: 1,
        conversation_id: conversationId,
        event_id: "empty",
        sequence: 1,
        segments: [],
        soap: createEmptySoapNote(conversationId),
        soap_status: "idle",
        has_unapplied_transcript: false,
      }),
    );
    if (beforeConnected) await act(async () => connection.resolve(stream));
    await waitFor(() => expect(hook.result.current.isStopping).toBe(false));
    expect(hook.result.current.isStreaming).toBe(false);
    expect(options.signal?.aborted).toBe(true);
    expect(mocks.audio.startCapture).toHaveBeenCalledTimes(capturesBeforeLoss);
    expect(hook.result.current.conversation.serverSyncLost).toBe(true);
    expect(hook.result.current.conversation.soap).toEqual(draft);
    expect(hook.result.current.conversation.soapStatus).toBe("error");
    act(() => {
      mocks.onAudioFrame?.({
        pcm16: new ArrayBuffer(4),
        sampleRate: 16000,
        channels: 2,
        levels: [0, 0],
      });
      options.onConversationEvent?.({
        type: "SoapUpdated",
        protocol_version: 1,
        conversation_id: conversationId,
        event_id: "late",
        sequence: 100,
        soap: { ...draft, revision: 99 },
        changed_item_ids: [],
        retracted_item_ids: [],
      });
    });
    expect(stream.sendAudio).not.toHaveBeenCalled();
    expect(hook.result.current.conversation.soap).toEqual(draft);
    act(() => hook.result.current.toggleTranscription());
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.startNewConversation());
    expect(hook.result.current.conversation.serverSyncLost).toBe(false);
    expect(hook.result.current.conversation.conversationId).not.toBe(conversationId);
    hook.unmount();
  },
);

it.each([
  { event: "ログアウト", stopping: false },
  { event: "ユーザー切替", stopping: false },
  { event: "ログアウト", stopping: true },
  { event: "ユーザー切替", stopping: true },
])("$event 時は旧接続を即座に無効化する（終了待機中: $stopping）", async ({ event, stopping }) => {
  const drain = deferred<void>();
  const stream = session();
  stream.close.mockReturnValue(drain.promise);
  mocks.connect.mockResolvedValue(stream);
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => mocks.authCallbacks.onUserChanged?.({ userId: "user-a", email: null }));
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
  const options = mocks.connect.mock.calls[0][0];
  const frame: AudioCaptureFrame = {
    pcm16: new ArrayBuffer(2),
    sampleRate: 16000,
    channels: 2,
    levels: [0.1, 0.1],
  };
  act(() => mocks.onAudioFrame?.(frame));
  expect(stream.sendAudio).toHaveBeenCalledOnce();
  const oldResult = {
    channelIndex: 0 as const,
    text: "前ユーザーの確定結果",
    isFinal: true,
    speechFinal: true,
    startSec: 0,
    endSec: 1,
    confidence: 1,
  };
  act(() => options.onTranscript?.(oldResult));
  expect(hook.result.current.segments).toHaveLength(1);
  if (stopping) {
    act(() => hook.result.current.toggleTranscription());
    await waitFor(() => expect(stream.close).toHaveBeenCalledOnce());
  }

  act(() => {
    if (event === "ログアウト") mocks.authCallbacks.onSignedOut?.();
    else mocks.authCallbacks.onUserChanged?.({ userId: "user-b", email: null });
  });
  expect(options.signal?.aborted).toBe(true);
  act(() => {
    mocks.onAudioFrame?.(frame);
    options.onTranscript?.(oldResult);
    options.onError?.(new Error("旧接続のエラー"));
    options.onClose?.({ code: 1006, reason: "old" });
  });
  expect(hook.result.current.segments).toHaveLength(0);
  expect(hook.result.current.error).toBeNull();
  expect(stream.sendAudio).toHaveBeenCalledOnce();
  await waitFor(() => expect(stream.close).toHaveBeenCalledOnce());
  act(() => hook.result.current.toggleTranscription());
  expect(mocks.connect).toHaveBeenCalledOnce();
  await act(async () => drain.resolve());
  expect(hook.result.current.segments).toHaveLength(0);

  mocks.connect.mockResolvedValue(session());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
  act(() => options.onTranscript?.(oldResult));
  expect(hook.result.current.segments).toHaveLength(0);
  hook.unmount();
});

it("認証待ちのユーザー切替でも旧接続を中断し、マイクを開始しない", async () => {
  const connection = deferred<DeepgramStreamSession>();
  mocks.connect.mockReturnValue(connection.promise);
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => mocks.authCallbacks.onUserChanged?.({ userId: "user-a", email: null }));
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
  const options = mocks.connect.mock.calls[0][0];
  act(() => mocks.authCallbacks.onUserChanged?.({ userId: "user-b", email: null }));
  expect(options.signal?.aborted).toBe(true);
  const stream = session();
  await act(async () => connection.resolve(stream));
  expect(mocks.audio.startCapture).not.toHaveBeenCalled();
  expect(stream.close).toHaveBeenCalledOnce();
  hook.unmount();
});

it("ユーザー切替後に旧トークン取得が失敗してもエラーや停止状態を上書きしない", async () => {
  const token = deferred<string | null>();
  const captureStop = deferred<void>();
  mocks.getValidAccessToken.mockReturnValue(token.promise);
  mocks.audio.stopCapture.mockReturnValue(captureStop.promise);
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => mocks.authCallbacks.onUserChanged?.({ userId: "user-a", email: null }));
  act(() => hook.result.current.toggleTranscription());
  act(() => mocks.authCallbacks.onUserChanged?.({ userId: "user-b", email: null }));
  await act(async () => token.reject(new Error("旧ユーザーのトークン取得失敗")));
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.isStopping).toBe(true);
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.audio.startCapture).not.toHaveBeenCalled();
  await act(async () => captureStop.resolve());
  expect(hook.result.current.isStopping).toBe(false);
  hook.unmount();
});

it("未認証（アクセストークン未取得）では WebSocket もマイクも開始しない", async () => {
  mocks.getValidAccessToken.mockResolvedValue(null);
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => hook.result.current.toggleTranscription());

  await waitFor(() =>
    expect(hook.result.current.error).toBe("文字起こしを開始するにはログインが必要です。"),
  );
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.audio.startCapture).not.toHaveBeenCalled();
  expect(hook.result.current.isConnecting).toBe(false);
});

it("マイク開始待ちで切断されても、遅れた完了で接続状態へ戻さない", async () => {
  const capture = deferred<boolean>();
  mocks.audio.startCapture.mockReturnValue(capture.promise);
  mocks.connect.mockResolvedValue(session());
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(mocks.audio.startCapture).toHaveBeenCalledOnce());
  const options = mocks.connect.mock.calls[0][0];
  expect(options.accessToken).toBe("valid-access-token");
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
  await waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
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
    options.onTranscript?.({
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

it("期限終了時は確定履歴を残して同一ユーザーが再開でき、ログアウト通知時は履歴を破棄して停止する", async () => {
  const stream = session();
  mocks.connect.mockResolvedValue(stream);
  const onAuthInvalidated = vi.fn();
  const hook = renderHook(() => useRealtimeTranscription({ onAuthInvalidated }));

  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
  const options = mocks.connect.mock.calls[0][0];

  act(() =>
    options.onTranscript?.({
      channelIndex: 0,
      text: "残すべき確定結果",
      isFinal: true,
      speechFinal: true,
      startSec: 0,
      endSec: 1,
      confidence: 0.99,
    }),
  );
  expect(hook.result.current.segments).toHaveLength(1);

  // 同一ユーザーのセッション期限到達
  act(() => {
    options.onError?.(new Error("セッションの上限時間に達しました。"));
    options.onClose?.({ code: 1000, reason: "session expired" });
  });
  expect(hook.result.current.isStreaming).toBe(false);
  expect(hook.result.current.segments).toHaveLength(1);
  expect(onAuthInvalidated).not.toHaveBeenCalled();

  // 更新トークンで再接続可能
  mocks.getValidAccessToken.mockResolvedValue("refreshed-access-token");
  mocks.connect.mockResolvedValue(session());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
  expect(mocks.connect.mock.calls[1][0].accessToken).toBe("refreshed-access-token");

  // 別タブ等からのログアウト通知
  act(() => {
    mocks.authCallbacks.onSignedOut?.();
  });
  await waitFor(() => expect(onAuthInvalidated).toHaveBeenCalledOnce());
  expect(hook.result.current.segments).toHaveLength(0);
});

it("会話イベント受信・新しい会話開始・重複デバイス遮断・マイク開始失敗時のクローズを処理する", async () => {
  mocks.audio.hasDuplicateDevices = true;
  const hook = renderHook(() => useRealtimeTranscription());
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.error).toContain("同じデバイスは指定できません"));
  expect(mocks.connect).not.toHaveBeenCalled();

  mocks.audio.hasDuplicateDevices = false;
  const streamFailCapture = session();
  mocks.connect.mockResolvedValue(streamFailCapture);
  mocks.audio.startCapture.mockResolvedValue(false);
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(streamFailCapture.close).toHaveBeenCalledOnce());
  expect(hook.result.current.isStreaming).toBe(false);

  const streamOk = session();
  mocks.connect.mockResolvedValue(streamOk);
  mocks.audio.startCapture.mockResolvedValue(true);
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));

  const options = mocks.connect.mock.calls[1][0];
  expect(options.enableSoap).toBe(true);
  const firstConversationId = options.conversationId;
  expect(firstConversationId).toBeTruthy();

  act(() => {
    options.onConversationEvent?.({
      type: "TranscriptUpdated",
      protocol_version: 1,
      conversation_id: firstConversationId ?? "",
      event_id: "evt-1",
      sequence: 1,
      segment: {
        stream_id: "s1",
        segment_id: "seg-1",
        segment_revision: 1,
        transcript_revision: 1,
        channel_index: 1,
        speaker_role: "patient",
        speaker_label: "患者",
        text: "頭が痛いです",
        status: "final",
        start_sec: 1.0,
        end_sec: 2.0,
        confidence: 0.96,
      },
    });
    options.onConversationEvent?.({
      type: "SoapUpdated",
      protocol_version: 1,
      conversation_id: firstConversationId ?? "",
      event_id: "evt-2",
      sequence: 2,
      changed_item_ids: ["item-s1"],
      retracted_item_ids: [],
      soap: {
        soap_id: "soap-1",
        conversation_id: firstConversationId ?? "",
        revision: 1,
        processed_transcript_revision: 1,
        sections: {
          S: {
            revision: 1,
            items: [
              {
                item_id: "item-s1",
                item_revision: 1,
                text: "頭痛がある",
                evidence: [
                  {
                    stream_id: "s1",
                    segment_id: "seg-1",
                    segment_revision: 1,
                    quote: "頭が痛いです",
                    speaker_role: "patient",
                  },
                ],
                origin: "conversation",
                derived_from_plan_items: [],
                stale_after_plan_update: false,
                verification_status: "reported",
              },
            ],
          },
          O: { revision: 0, items: [] },
          A: { revision: 0, items: [], derived_from_plan_revision: null },
          P: { revision: 0, items: [] },
        },
      },
    });
  });

  expect(hook.result.current.conversation.segments).toHaveLength(1);
  expect(hook.result.current.conversation.soap.sections.S.items[0].text).toBe("頭痛がある");
  expect(hook.result.current.conversation.changedItemIds).toEqual(["item-s1"]);

  // 新しい会話を開始すると別の conversationId が採番され、履歴と SOAP がクリアされる
  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(false));
  act(() => hook.result.current.startNewConversation());
  expect(hook.result.current.conversation.segments).toHaveLength(0);
  expect(hook.result.current.conversation.soap.sections.S.items).toHaveLength(0);

  act(() => hook.result.current.toggleTranscription());
  await waitFor(() => expect(hook.result.current.isStreaming).toBe(true));
  expect(mocks.connect.mock.calls[2][0].conversationId).not.toBe(firstConversationId);
  act(() => hook.result.current.updateSegmentSpeaker("stream-3", "seg-1", "patient"));
  const activeSession = await mocks.connect.mock.results[2].value;
  expect(activeSession.updateSegmentSpeaker).toHaveBeenCalledWith("stream-3", "seg-1", "patient");
  hook.unmount();
});
