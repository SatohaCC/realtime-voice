"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AudioCaptureFrame,
  type AudioInputDeviceInfo,
  createDualMicCapture,
  type DualMicCaptureSession,
  detectSpeakingChannels,
  listAudioInputDevices,
} from "@/shared/lib/audio/dualMicCapture";

export type MicCaptureMode = "single" | "dual";

export interface UseDualMicAudioOptions {
  /** Step 2 以降のストリーミング送信向けに各 PCM フレームを受け取るコールバック */
  onAudioFrame?: (frame: AudioCaptureFrame) => void;
}

/**
 * 1本または2本のマイクからの AudioWorklet 収音とデバイス一覧・音量レベルを管理する Hook。
 */
export function useDualMicAudio(options?: UseDualMicAudioOptions) {
  const [devices, setDevices] = useState<AudioInputDeviceInfo[]>([]);
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

  const refreshDevices = useCallback(async () => {
    try {
      const list = await listAudioInputDevices();
      setDevices(list);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "マイク一覧の取得に失敗しました。");
    }
  }, []);

  useEffect(() => {
    void refreshDevices();

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.addEventListener) {
      return;
    }

    const handleDeviceChange = () => {
      void refreshDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshDevices]);

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

  const startCapture = useCallback(async () => {
    if (captureRunRef.current) return false;
    const controller = new AbortController();
    captureRunRef.current = controller;
    setError(null);
    setFrameCount(0);

    try {
      const session = await createDualMicCapture({
        signal: controller.signal,
        mic1DeviceId,
        mic2DeviceId: mode === "dual" ? mic2DeviceId : undefined,
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
  }, [mic1DeviceId, mic2DeviceId, mode, refreshDevices, stopCapture]);

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
    setMode,
    mic1DeviceId,
    setMic1DeviceId,
    mic2DeviceId,
    setMic2DeviceId,
    isCapturing,
    levels,
    speaking: [isLeftSpeaking, isRightSpeaking] as const,
    frameCount,
    error,
    refreshDevices,
    startCapture,
    stopCapture,
    toggleCapture,
  };
}
