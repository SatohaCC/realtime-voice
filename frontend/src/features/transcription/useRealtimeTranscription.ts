"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDualMicAudio } from "@/features/audio/useDualMicAudio";
import type { AudioCaptureFrame } from "@/shared/lib/audio/dualMicCapture";
import type { ConversationWorkspaceState } from "@/shared/lib/conversation/conversationReducer";
import {
  applyConversationSegmentEnabled,
  applyConversationWsEvent,
  clearSoapHighlights,
  createInitialConversationState,
  prepareStreamReconnect,
} from "@/shared/lib/conversation/conversationReducer";
import { readSegmentEnabledUpdates } from "@/shared/lib/conversation/segmentEnabledUpdates";
import type { SpeakerRole } from "@/shared/lib/conversation/types";
import { getValidAccessToken, subscribeAuthState } from "@/shared/lib/supabase/client";
import { AudioLevelHistory } from "@/shared/lib/transcription/audioLevelHistory";
import type {
  DeepgramSpeakerProfilePayload,
  DeepgramStreamSession,
} from "@/shared/lib/transcription/deepgramClient";
import { createDeepgramStreamSession } from "@/shared/lib/transcription/deepgramClient";
import {
  applyDeepgramTranscriptEvent,
  createInitialTranscriptState,
  setTranscriptSegmentEnabled,
  startTranscriptSession,
} from "@/shared/lib/transcription/transcriptReducer";

type Phase = "connecting" | "streaming" | "stopping";
interface TranscriptionRun {
  controller: AbortController;
  history: AudioLevelHistory;
  phase: Phase;
  invalidated: boolean;
  conversationState: ConversationWorkspaceState;
  session?: DeepgramStreamSession;
}

function createConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `conv-${crypto.randomUUID().slice(0, 12)}`;
  }
  return `conv-${Date.now().toString(36)}`;
}

export interface UseRealtimeTranscriptionOptions {
  /** ログアウト等で認証が無効になった際に呼ばれるコールバック */
  onAuthInvalidated?: () => void;
  /** 端末ローカル保存済みの事前登録薬剤師声紋（2マイク会話時に送信） */
  speakerProfile?: DeepgramSpeakerProfilePayload | null;
  /** サーバー側で声紋モデルの不一致等で拒否された際のコールバック */
  onSpeakerProfileRejected?: (reason: string | null | undefined) => void;
}

const SPEAKER_LABELS: Record<0 | 1, string> = { 0: "薬剤師", 1: "患者" };

/** 認証トークン取得・WebSocket 接続・収音・SOAP会話同期を管理する Hook。 */
export function useRealtimeTranscription({
  onAuthInvalidated,
  speakerProfile = null,
  onSpeakerProfileRejected,
}: UseRealtimeTranscriptionOptions = {}) {
  const [transcriptState, setTranscriptState] = useState(createInitialTranscriptState);
  const [conversationState, setConversationState] = useState<ConversationWorkspaceState>(() =>
    createInitialConversationState("conv-initial"),
  );
  const [phase, setPhase] = useState<Phase | "idle">("idle");
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const runRef = useRef<TranscriptionRun | null>(null);
  const [isSegmentUpdatePending, setIsSegmentUpdatePending] = useState(false);
  const segmentUpdateRef = useRef<symbol | null>(null);
  const latestSegmentUpdateRef = useRef(new Map<string, symbol>());
  const conversationStateRef = useRef(conversationState);
  conversationStateRef.current = conversationState;
  const conversationIdRef = useRef<string>("conv-initial");
  const onAuthInvalidatedRef = useRef(onAuthInvalidated);
  onAuthInvalidatedRef.current = onAuthInvalidated;
  const speakerProfileRef = useRef<DeepgramSpeakerProfilePayload | null>(speakerProfile);
  speakerProfileRef.current = speakerProfile;
  const onSpeakerProfileRejectedRef = useRef(onSpeakerProfileRejected);
  onSpeakerProfileRejectedRef.current = onSpeakerProfileRejected;

  useEffect(() => {
    const generated = createConversationId();
    conversationIdRef.current = generated;
    setConversationState((current) =>
      current.segments.length === 0 && current.soap.revision === 0
        ? createInitialConversationState(generated)
        : current,
    );
  }, []);

  useEffect(() => {
    if (conversationState.changedItemIds.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setConversationState((current) => clearSoapHighlights(current));
    }, 2400);
    return () => {
      clearTimeout(timer);
    };
  }, [conversationState.changedItemIds]);

  const handleAudioFrame = useCallback((frame: AudioCaptureFrame) => {
    const run = runRef.current;
    if (!run || run.invalidated) return;
    run.history.append(frame);
    run.session?.sendAudio(frame.pcm16);
  }, []);
  const audio = useDualMicAudio({ onAudioFrame: handleAudioFrame });

  const stopTranscription = useCallback(async () => {
    const run = runRef.current;
    if (!run || run.phase === "stopping") return;
    const wasConnecting = run.phase === "connecting";
    run.phase = "stopping";
    setPhase("stopping");
    // 開始途中は即座にキャンセルし、収音中は最終結果を受信し終えてから解放する。
    if (wasConnecting) run.controller.abort();
    try {
      await audio.stopCapture();
      await run.session?.close();
    } finally {
      run.controller.abort();
      if (runRef.current === run) {
        runRef.current = null;
        setPhase("idle");
      }
    }
  }, [audio.stopCapture]);

  useEffect(() => {
    let activeUserId: string | null = null;
    const resetAndStop = () => {
      const run = runRef.current;
      if (run) {
        // 認証変更後は終了待機中でも旧接続の音声送信と受信結果を破棄する。
        run.invalidated = true;
        run.controller.abort();
        void stopTranscription();
      }
      const nextConversationId = createConversationId();
      conversationIdRef.current = nextConversationId;
      setTranscriptState(createInitialTranscriptState());
      setConversationState(createInitialConversationState(nextConversationId));
      setTranscriptionError(null);
    };

    const unsubscribe = subscribeAuthState({
      onSignedOut: () => {
        activeUserId = null;
        resetAndStop();
        onAuthInvalidatedRef.current?.();
      },
      onUserChanged: (user) => {
        const nextUserId = user?.userId ?? null;
        if (activeUserId !== null && nextUserId !== activeUserId) {
          resetAndStop();
          if (nextUserId === null) {
            onAuthInvalidatedRef.current?.();
          }
        }
        activeUserId = nextUserId;
      },
    });

    return () => {
      unsubscribe();
    };
  }, [stopTranscription]);

  useEffect(
    () => () => {
      const run = runRef.current;
      runRef.current = null;
      run?.controller.abort();
    },
    [],
  );

  const startTranscription = useCallback(async () => {
    if (runRef.current || segmentUpdateRef.current) return;
    if (audio.hasDuplicateDevices) {
      setTranscriptionError(
        "患者用と薬剤師用に同じデバイスは指定できません。別のマイクを選ぶか「1マイク」へ切り替えてください。",
      );
      return;
    }

    const enableSoap = audio.mode === "dual";
    if (enableSoap && conversationState.serverSyncLost) {
      setTranscriptionError(
        "会話を復元できません。下書きをコピーしてから新しい会話を開始してください。",
      );
      return;
    }
    const activeConversationId = conversationIdRef.current;
    const run: TranscriptionRun = {
      controller: new AbortController(),
      history: new AudioLevelHistory(),
      phase: "connecting",
      invalidated: false,
      conversationState: prepareStreamReconnect(conversationState),
    };
    runRef.current = run;
    setTranscriptionError(null);
    setTranscriptState(startTranscriptSession);
    if (enableSoap) {
      setConversationState(run.conversationState);
    }
    setPhase("connecting");
    let streamErrorMessage: string | null = null;
    const labels =
      audio.mode === "single" ? { 0: "話者（モノラル）", 1: SPEAKER_LABELS[1] } : SPEAKER_LABELS;
    try {
      const accessToken = await getValidAccessToken();
      if (runRef.current !== run || run.controller.signal.aborted) {
        return;
      }
      if (!accessToken) {
        runRef.current = null;
        setPhase("idle");
        setTranscriptionError("文字起こしを開始するにはログインが必要です。");
        return;
      }

      const captureDevices = await audio.prepareCapture(run.controller.signal);
      if (runRef.current !== run || run.controller.signal.aborted) return;
      const session = await createDeepgramStreamSession({
        accessToken,
        channels: enableSoap ? 2 : 1,
        language: "ja",
        enableSoap,
        conversationId: enableSoap ? activeConversationId : undefined,
        speakerProfile: enableSoap ? speakerProfileRef.current : null,
        signal: run.controller.signal,
        onSpeakerProfileAck: (ack) => {
          if (runRef.current !== run || run.invalidated) return;
          if (!ack.accepted) {
            onSpeakerProfileRejectedRef.current?.(ack.reason);
          }
        },
        onConversationEvent: (event) => {
          if (runRef.current !== run || run.invalidated) return;
          const next = applyConversationWsEvent(run.conversationState, event);
          run.conversationState = next;
          setConversationState((current) => applyConversationWsEvent(current, event));
          if (next.serverSyncLost) {
            // 旧下書きを残し、復元できない会話への送信・受信を即時に止める
            run.invalidated = true;
            run.controller.abort();
            void stopTranscription();
          }
        },
        onTranscript: (event) => {
          if (runRef.current !== run || run.invalidated) return;
          setTranscriptState((current) =>
            applyDeepgramTranscriptEvent(
              current,
              event,
              labels,
              run.history.levelsFor(event.startSec, event.endSec),
            ),
          );
        },
        onError: (error) => {
          if (runRef.current !== run || run.invalidated) return;
          streamErrorMessage = error.message;
          setTranscriptionError(error.message);
        },
        onClose: ({ code, reason }) => {
          if (runRef.current !== run || run.invalidated || run.phase === "stopping") return;
          runRef.current = null;
          run.controller.abort();
          void audio.stopCapture();
          setPhase("idle");
          if (code !== 1000 && !streamErrorMessage)
            setTranscriptionError(
              `Deepgram 接続が切断されました (code: ${code}${reason ? `, ${reason}` : ""})。`,
            );
        },
      });
      if (runRef.current !== run || run.controller.signal.aborted) {
        void session.close();
        return;
      }
      run.session = session;
      const started = await audio.startCapture(captureDevices);
      if (runRef.current !== run || run.controller.signal.aborted) return;
      if (!started) {
        runRef.current = null;
        run.controller.abort();
        void session.close();
        setPhase("idle");
        return;
      }
      run.phase = "streaming";
      setPhase("streaming");
    } catch (error) {
      if (runRef.current !== run || run.invalidated) return;
      runRef.current = null;
      run.controller.abort();
      void audio.stopCapture();
      setPhase("idle");
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setTranscriptionError(
          error instanceof Error ? error.message : "リアルタイム文字起こしの開始に失敗しました。",
        );
    }
  }, [
    audio.hasDuplicateDevices,
    audio.mode,
    audio.prepareCapture,
    audio.startCapture,
    audio.stopCapture,
    conversationState,
    stopTranscription,
  ]);

  const toggleTranscription = useCallback(() => {
    if (runRef.current) void stopTranscription();
    else void startTranscription();
  }, [startTranscription, stopTranscription]);

  const clearTranscripts = useCallback(() => {
    setTranscriptState(createInitialTranscriptState());
  }, []);

  const startNewConversation = useCallback(() => {
    if (runRef.current) return;
    const nextConversationId = createConversationId();
    conversationIdRef.current = nextConversationId;
    setTranscriptState(createInitialTranscriptState());
    setConversationState(createInitialConversationState(nextConversationId));
    setTranscriptionError(null);
  }, []);

  const updateSegmentSpeaker = useCallback(
    (streamId: string, segmentId: string, speakerRole: SpeakerRole) => {
      const run = runRef.current;
      if (!run || run.invalidated || run.phase !== "streaming") return;
      run.session?.updateSegmentSpeaker(streamId, segmentId, speakerRole);
    },
    [],
  );

  const setSegmentEnabled = useCallback(
    (streamId: string, segmentId: string, enabled: boolean) => {
      if (audio.mode === "single") {
        setTranscriptState((current) => setTranscriptSegmentEnabled(current, segmentId, enabled));
        return;
      }
      const run = runRef.current;
      if (run && !run.invalidated && run.phase === "streaming") {
        run.session?.setSegmentEnabled(streamId, segmentId, enabled);
        return;
      }
      if (run || segmentUpdateRef.current) return;
      const targetConvId = conversationIdRef.current;
      const original = conversationStateRef.current.segments.find(
        (segment) => segment.stream_id === streamId && segment.segment_id === segmentId,
      );
      if (!original) return;
      const requestId = Symbol();
      const requestKey = `${targetConvId}:${streamId}:${segmentId}`;
      latestSegmentUpdateRef.current.set(requestKey, requestId);
      segmentUpdateRef.current = requestId;
      let applied = false;
      setConversationState((current) =>
        current.conversationId !== targetConvId
          ? current
          : {
              ...current,
              segments: current.segments.map((segment) =>
                segment.stream_id === streamId && segment.segment_id === segmentId
                  ? { ...segment, disabled: !enabled }
                  : segment,
              ),
            },
      );
      setIsSegmentUpdatePending(true);
      setTranscriptionError(null);
      void (async () => {
        try {
          const token = await getValidAccessToken();
          if (conversationIdRef.current !== targetConvId) return;
          if (!token) throw new Error("発話の有効性を変更するにはログインが必要です。");
          const res = await fetch(
            `/api/transcriptions/conversations/${encodeURIComponent(targetConvId)}/segments?stream=true`,
            {
              method: "PATCH",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "SetSegmentEnabled",
                stream_id: streamId,
                segment_id: segmentId,
                enabled,
              }),
            },
          );
          if (conversationIdRef.current !== targetConvId) return;
          if (!res.ok)
            throw new Error("発話の有効性を変更できませんでした。もう一度お試しください。");
          await readSegmentEnabledUpdates(res, (data) => {
            if (segmentUpdateRef.current === requestId) {
              segmentUpdateRef.current = null;
              setIsSegmentUpdatePending(false);
            }
            if (
              conversationIdRef.current !== targetConvId ||
              latestSegmentUpdateRef.current.get(requestKey) !== requestId
            )
              return;
            applied = true;
            setConversationState((current) =>
              applyConversationSegmentEnabled(current, {
                conversationId: data.conversation_id,
                segment: data.segment,
                soap: data.soap,
                changedItemIds: data.changed_item_ids,
                soapStatus: data.soap_status,
                hasUnappliedTranscript: data.has_unapplied_transcript,
              }),
            );
          });
        } catch (err) {
          if (
            conversationIdRef.current === targetConvId &&
            latestSegmentUpdateRef.current.get(requestKey) === requestId
          ) {
            if (!applied) {
              setConversationState((current) =>
                current.conversationId !== targetConvId
                  ? current
                  : {
                      ...current,
                      segments: current.segments.map((segment) =>
                        segment.stream_id === streamId &&
                        segment.segment_id === segmentId &&
                        segment.segment_revision === original.segment_revision
                          ? { ...segment, disabled: original.disabled }
                          : segment,
                      ),
                    },
              );
            }
            setTranscriptionError(
              applied
                ? "発話の変更は反映しましたが、SOAPの更新を取得できませんでした。"
                : err instanceof Error
                  ? err.message
                  : "発話の有効性を変更できませんでした。",
            );
          }
        } finally {
          if (segmentUpdateRef.current === requestId) {
            segmentUpdateRef.current = null;
            setIsSegmentUpdatePending(false);
          }
        }
      })();
    },
    [audio.mode],
  );

  return {
    audio,
    isSegmentUpdatePending,
    segments: transcriptState.segments,
    conversation: conversationState,
    isConnecting: phase === "connecting",
    isStreaming: phase === "streaming",
    isStopping: phase === "stopping",
    error: transcriptionError ?? audio.error,
    toggleTranscription,
    clearTranscripts,
    startNewConversation,
    updateSegmentSpeaker,
    setSegmentEnabled,
  };
}
