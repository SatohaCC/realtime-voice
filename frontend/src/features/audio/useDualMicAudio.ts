"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AudioCaptureFrame,
  type CaptureDevices,
  createDualMicCapture,
  type DualMicCaptureSession,
  detectSpeakingChannels,
  resolveCaptureDevices,
} from "@/shared/lib/audio/dualMicCapture";
import { useAudioInputDevices } from "./useAudioInputDevices";

export type MicCaptureMode = "single" | "dual";

export interface UseDualMicAudioOptions {
  /** Step 2 以降のストリーミング送信向けに各 PCM フレームを受け取るコールバック */
  onAudioFrame?: (frame: AudioCaptureFrame) => void;
}

/**
 * 1本または2本のマイクからの AudioWorklet 収音とデバイス一覧・音量レベルを管理する Hook。
 */
export function useDualMicAudio(options?: UseDualMicAudioOptions) {
  const [mode, setMode] = useState<MicCaptureMode>("dual");
  const [mic1DeviceId, setMic1DeviceId] = useState("");
  const [mic2DeviceId, setMic2DeviceId] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [levels, setLevels] = useState<readonly [number, number]>([0, 0]);
  const [frameCount, setFrameCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<DualMicCaptureSession | null>(null);
  const captureRunRef = useRef<AbortController | null>(null);
  const onAudioFrameRef = useRef(options?.onAudioFrame);
  onAudioFrameRef.current = options?.onAudioFrame;

  const { devices, refreshDevices } = useAudioInputDevices({
    onDevicesLoaded: (list) => {
      setMic1DeviceId((current) => {
        if (current && list.some((device) => device.deviceId === current)) {
          return current;
        }
        return list[0]?.deviceId ?? "";
      });
      setMic2DeviceId((current) => {
        if (current && list.some((device) => device.deviceId === current)) {
          return current;
        }
        return list[1]?.deviceId ?? list[0]?.deviceId ?? "";
      });
    },
    onError: setError,
  });

  const stopCapture = useCallback(async () => {
    const controller = captureRunRef.current;
    controller?.abort();
    const active = sessionRef.current;
    sessionRef.current = null;
    if (!active) captureRunRef.current = null;
    setIsCapturing(false);
    setLevels([0, 0]);
    if (active) {
      try {
        await active.stop();
      } finally {
        if (captureRunRef.current === controller) {
          captureRunRef.current = null;
          setLevels([0, 0]);
        }
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      captureRunRef.current?.abort();
      captureRunRef.current = null;
      void sessionRef.current?.stop();
      sessionRef.current = null;
    };
  }, []);

  const hasDuplicateDevices =
    mode === "dual" && Boolean(mic1DeviceId && mic2DeviceId && mic1DeviceId === mic2DeviceId);

  const selectMode = useCallback((nextMode: MicCaptureMode) => {
    setMode(nextMode);
    setError(null);
  }, []);

  const selectMic1DeviceId = useCallback(
    (deviceId: string) => {
      if (mode === "dual" && deviceId && deviceId === mic2DeviceId) {
        setError("患者用と薬剤師用に同じデバイスは指定できません。");
        return;
      }
      setError(null);
      setMic1DeviceId(deviceId);
    },
    [mic2DeviceId, mode],
  );

  const selectMic2DeviceId = useCallback(
    (deviceId: string) => {
      if (mode === "dual" && deviceId && deviceId === mic1DeviceId) {
        setError("患者用と薬剤師用に同じデバイスは指定できません。");
        return;
      }
      setError(null);
      setMic2DeviceId(deviceId);
    },
    [mic1DeviceId, mode],
  );

  const prepareCapture = useCallback(
    async (signal?: AbortSignal) => {
      const selection = await resolveCaptureDevices(
        { mic1DeviceId, mic2DeviceId },
        mode === "dual" ? 2 : 1,
        signal,
      );
      signal?.throwIfAborted();
      setMic1DeviceId(selection.mic1DeviceId);
      setMic2DeviceId(selection.mic2DeviceId ?? "");
      void refreshDevices();
      return selection;
    },
    [mic1DeviceId, mic2DeviceId, mode, refreshDevices],
  );

  const startCapture = useCallback(
    async (selection?: CaptureDevices) => {
      if (captureRunRef.current) return false;
      if (mode === "dual" && mic1DeviceId && mic2DeviceId && mic1DeviceId === mic2DeviceId) {
        setError("患者用と薬剤師用に同じデバイスは指定できません。");
        return false;
      }
      const controller = new AbortController();
      captureRunRef.current = controller;
      setError(null);
      setFrameCount(0);

      try {
        const resolved = selection ?? (await prepareCapture(controller.signal));
        const session = await createDualMicCapture({
          signal: controller.signal,
          ...resolved,
          onAudioFrame: (frame) => {
            if (captureRunRef.current !== controller) return;
            setLevels(frame.levels);
            setFrameCount((count) => count + 1);
            onAudioFrameRef.current?.(frame);
          },
          onError: (captureError) => {
            if (captureRunRef.current !== controller) return;
            setError(captureError.message);
            void stopCapture();
          },
        });
        if (captureRunRef.current !== controller || controller.signal.aborted) {
          await session.stop();
          return false;
        }
        sessionRef.current = session;
        setIsCapturing(true);
        // 権限付与後に実デバイス名を取得するため一覧を再同期する
        void refreshDevices();
        return true;
      } catch (err) {
        if (captureRunRef.current !== controller) return false;
        captureRunRef.current = null;
        setError(err instanceof Error ? err.message : "マイクの収音を開始できませんでした。");
        setIsCapturing(false);
        return false;
      }
    },
    [mic1DeviceId, mic2DeviceId, mode, prepareCapture, refreshDevices, stopCapture],
  );

  const toggleCapture = useCallback(() => {
    if (isCapturing) {
      void stopCapture();
    } else {
      void startCapture();
    }
  }, [isCapturing, startCapture, stopCapture]);

  const [isLeftSpeaking, isRightSpeaking] = isCapturing
    ? detectSpeakingChannels(levels)
    : [false, false];

  return {
    devices,
    mode,
    setMode: selectMode,
    mic1DeviceId,
    setMic1DeviceId: selectMic1DeviceId,
    mic2DeviceId,
    setMic2DeviceId: selectMic2DeviceId,
    hasDuplicateDevices,
    isCapturing,
    levels,
    speaking: [isLeftSpeaking, isRightSpeaking] as const,
    frameCount,
    error,
    refreshDevices,
    prepareCapture,
    startCapture,
    stopCapture,
    toggleCapture,
  };
}
