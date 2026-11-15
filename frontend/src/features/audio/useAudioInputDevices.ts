"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AudioInputDeviceInfo,
  listAudioInputDevices,
} from "@/shared/lib/audio/dualMicCapture";

export interface UseAudioInputDevicesOptions {
  /** デバイス一覧取得後に呼ばれるコールバック */
  onDevicesLoaded?: (devices: AudioInputDeviceInfo[]) => void;
  /** デバイス一覧取得失敗時に呼ばれるコールバック */
  onError?: (message: string) => void;
}

export interface UseAudioInputDevicesResult {
  devices: AudioInputDeviceInfo[];
  error: string | null;
  refreshDevices: (requestPermission?: boolean) => Promise<void>;
}

/**
 * 利用可能な音声入力デバイス一覧の取得と `devicechange` イベント監視を行う Hook。
 */
export function useAudioInputDevices(
  options?: UseAudioInputDevicesOptions,
): UseAudioInputDevicesResult {
  const [devices, setDevices] = useState<AudioInputDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onDevicesLoadedRef = useRef(options?.onDevicesLoaded);
  const onErrorRef = useRef(options?.onError);
  onDevicesLoadedRef.current = options?.onDevicesLoaded;
  onErrorRef.current = options?.onError;

  const refreshDevices = useCallback(async (requestPermission = false) => {
    try {
      if (requestPermission) {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("このブラウザはマイク入力に対応していません。");
        }
        // 利用者の操作時だけ権限を要求し、確認用の音声ストリームは即時解放する。
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        for (const track of stream.getTracks()) track.stop();
      }
      const list = await listAudioInputDevices();
      setDevices(list);
      setError(null);
      onDevicesLoadedRef.current?.(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : "マイク一覧の取得に失敗しました。";
      setError(message);
      onErrorRef.current?.(message);
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

  return { devices, error, refreshDevices };
}
