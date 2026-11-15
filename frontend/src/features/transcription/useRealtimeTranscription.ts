"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDualMicAudio } from "@/features/audio/useDualMicAudio";
import type { AudioCaptureFrame } from "@/shared/lib/audio/dualMicCapture";
import { getValidAccessToken, subscribeAuthState } from "@/shared/lib/supabase/client";
import { AudioLevelHistory } from "@/shared/lib/transcription/audioLevelHistory";
import {
  createDeepgramStreamSession,
  type DeepgramStreamSession,
} from "@/shared/lib/transcription/deepgramClient";
import {
  applyDeepgramTranscriptEvent,
  createInitialTranscriptState,
  startTranscriptSession,
} from "@/shared/lib/transcription/transcriptReducer";

type Phase = "connecting" | "streaming" | "stopping";
interface TranscriptionRun {
  controller: AbortController;
  history: AudioLevelHistory;
  phase: Phase;
  invalidated: boolean;
  session?: DeepgramStreamSession;
}

export interface UseRealtimeTranscriptionOptions {
  /** ログアウト等で認証が無効になった際に呼ばれるコールバック */
  onAuthInvalidated?: () => void;
}

const SPEAKER_LABELS: Record<0 | 1, string> = { 0: "話者 A（マイク 1）", 1: "話者 B（マイク 2）" };

/** 認証トークン取得・WebSocket 接続・収音・終了待機を独立したライフサイクルとして管理する。 */
export function useRealtimeTranscription({
  onAuthInvalidated,
}: UseRealtimeTranscriptionOptions = {}) {
  const [transcriptState, setTranscriptState] = useState(createInitialTranscriptState);
  const [phase, setPhase] = useState<Phase | "idle">("idle");
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const runRef = useRef<TranscriptionRun | null>(null);
  const onAuthInvalidatedRef = useRef(onAuthInvalidated);
  onAuthInvalidatedRef.current = onAuthInvalidated;

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
      setTranscriptState(createInitialTranscriptState());
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
    if (runRef.current) return;
    const run: TranscriptionRun = {
      controller: new AbortController(),
      history: new AudioLevelHistory(),
      phase: "connecting",
      invalidated: false,
    };
    runRef.current = run;
    setTranscriptionError(null);
    setTranscriptState(startTranscriptSession);
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

      const session = await createDeepgramStreamSession({
        accessToken,
        channels: audio.mode === "dual" ? 2 : 1,
        language: "ja",
        signal: run.controller.signal,
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
      const started = await audio.startCapture();
      if (runRef.current !== run || run.controller.signal.aborted) return;
      if (!started) {
        runRef.current = null;
        run.controller.abort();
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
  }, [audio.mode, audio.startCapture, audio.stopCapture]);

  const toggleTranscription = useCallback(() => {
    if (runRef.current) void stopTranscription();
    else void startTranscription();
  }, [startTranscription, stopTranscription]);
  const clearTranscripts = useCallback(
    () => setTranscriptState(createInitialTranscriptState()),
    [],
  );
  return {
    audio,
    segments: transcriptState.segments,
    isConnecting: phase === "connecting",
    isStreaming: phase === "streaming",
    isStopping: phase === "stopping",
    error: transcriptionError ?? audio.error,
    toggleTranscription,
    clearTranscripts,
  };
}
