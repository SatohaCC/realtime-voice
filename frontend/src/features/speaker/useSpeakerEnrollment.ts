"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { enrollPharmacistVoice } from "@/shared/lib/speaker/enrollSpeakerClient";
import {
  deletePharmacistVoiceprint,
  loadPharmacistVoiceprint,
  type PharmacistVoiceprintRecord,
  savePharmacistVoiceprint,
} from "@/shared/lib/speaker/voiceprintStore";
import {
  getBrowserAuthUser,
  getValidAccessToken,
  subscribeAuthState,
} from "@/shared/lib/supabase/client";

export interface UseSpeakerEnrollmentResult {
  userId: string | null;
  voiceprint: PharmacistVoiceprintRecord | null;
  isEnrolling: boolean;
  progressRatio: number;
  sampleIndex: number;
  warnings: readonly string[];
  error: string | null;
  enroll: (micDeviceId: string) => Promise<void>;
  cancel: () => void;
  clear: () => Promise<void>;
  reportProfileRejected: (reason: string | null | undefined) => void;
}

/**
 * ログイン中のアカウント（userId）に紐づけて端末ローカル（IndexedDB）の薬剤師声紋を管理する Hook。
 */
export function useSpeakerEnrollment(): UseSpeakerEnrollmentResult {
  const [userId, setUserId] = useState<string | null>(null);
  const [voiceprint, setVoiceprint] = useState<PharmacistVoiceprintRecord | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [progressRatio, setProgressRatio] = useState(0);
  const [sampleIndex, setSampleIndex] = useState(0);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const loadForUser = async (targetUserId: string | null) => {
      activeUserIdRef.current = targetUserId;
      setUserId(targetUserId);
      setWarnings([]);
      setError(null);
      if (!targetUserId) {
        setVoiceprint(null);
        return;
      }
      try {
        const stored = await loadPharmacistVoiceprint(targetUserId);
        if (!disposed && activeUserIdRef.current === targetUserId) {
          setVoiceprint(stored);
        }
      } catch (err) {
        if (!disposed && activeUserIdRef.current === targetUserId) {
          setVoiceprint(null);
          setError(err instanceof Error ? err.message : "声紋データの読込に失敗しました。");
        }
      }
    };

    void getBrowserAuthUser().then((user) => {
      if (!disposed) {
        void loadForUser(user?.userId ?? null);
      }
    });

    const unsubscribe = subscribeAuthState({
      onSignedOut: () => {
        abortRef.current?.abort();
        void loadForUser(null);
      },
      onUserChanged: (nextUser) => {
        const nextId = nextUser?.userId ?? null;
        if (nextId !== activeUserIdRef.current) {
          abortRef.current?.abort();
          void loadForUser(nextId);
        }
      },
    });

    return () => {
      disposed = true;
      abortRef.current?.abort();
      unsubscribe();
    };
  }, []);

  const enroll = useCallback(async (micDeviceId: string) => {
    if (abortRef.current) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setIsEnrolling(true);
    setProgressRatio(0);
    setSampleIndex(0);
    setWarnings([]);
    setError(null);

    try {
      const [token, authUser] = await Promise.all([getValidAccessToken(), getBrowserAuthUser()]);
      controller.signal.throwIfAborted();
      const targetUserId = authUser?.userId ?? activeUserIdRef.current;
      if (!token || !targetUserId) {
        throw new Error("声紋登録を行うにはログインが必要です。");
      }

      const apiResult = await enrollPharmacistVoice({
        accessToken: token,
        micDeviceId,
        durationMs: 10000,
        minVoicedSeconds: 3,
        sampleCount: 3,
        onSample: setSampleIndex,
        signal: controller.signal,
        onProgress: setProgressRatio,
      });
      controller.signal.throwIfAborted();

      const record: PharmacistVoiceprintRecord = {
        userId: targetUserId,
        modelId: apiResult.model_id,
        embeddingDim: apiResult.embedding_dim,
        embedding: apiResult.embedding,
        voicedSec: apiResult.voiced_sec,
        updatedAt: new Date().toISOString(),
      };
      const saved = await savePharmacistVoiceprint(record);
      if (!saved) {
        throw new Error("このブラウザ環境では端末ローカル（IndexedDB）保存が利用できません。");
      }
      if (activeUserIdRef.current === targetUserId || activeUserIdRef.current === null) {
        activeUserIdRef.current = targetUserId;
        setUserId(targetUserId);
        setVoiceprint(record);
      }
      setWarnings(apiResult.quality_warnings);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "声紋登録に失敗しました。");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsEnrolling(false);
      setProgressRatio(0);
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(async () => {
    const targetUserId = activeUserIdRef.current;
    if (!targetUserId) {
      setVoiceprint(null);
      return;
    }
    try {
      await deletePharmacistVoiceprint(targetUserId);
      setVoiceprint(null);
      setWarnings([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "声紋データの削除に失敗しました。");
    }
  }, []);

  const reportProfileRejected = useCallback((reason: string | null | undefined) => {
    setError(reason || "保存済みの声紋がサーバー側モデルと一致しないため再登録してください。");
  }, []);

  return {
    userId,
    voiceprint,
    isEnrolling,
    progressRatio,
    sampleIndex,
    warnings,
    error,
    enroll,
    cancel,
    clear,
    reportProfileRejected,
  };
}
