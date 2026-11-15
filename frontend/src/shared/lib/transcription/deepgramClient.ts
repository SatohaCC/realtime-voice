import { parseConversationWsEvent } from "../conversation/conversationReducer";
import type { ConversationWsEvent } from "../conversation/types";

export interface DeepgramStreamOptions {
  accessToken: string;
  channels: 1 | 2;
  language?: string;
  sampleRate?: number;
  endpointingMs?: number;
  baseUrl?: string;
  connectTimeoutMs?: number;
  stopTimeoutMs?: number;
  enableSoap?: boolean;
  conversationId?: string;
  signal?: AbortSignal;
  onAuthOk?: (info: { expiresAt: number; sessionExpiresAt: number }) => void;
  onTranscript?: (event: DeepgramTranscriptEvent) => void;
  onConversationEvent?: (event: ConversationWsEvent) => void;
  onError?: (error: Error) => void;
  onClose?: (event: { code: number; reason: string }) => void;
}

export interface DeepgramTranscriptEvent {
  channelIndex: 0 | 1;
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
  startSec: number;
  endSec: number;
  confidence: number;
}

export interface DeepgramStreamSession {
  sendAudio: (pcm16: ArrayBuffer) => void;
  close: () => Promise<void>;
}

interface DeepgramRawResponse {
  type?: string;
  code?: string;
  message?: string;
  description?: string;
  expires_at?: number;
  session_expires_at?: number;
  channel_index?: number[];
  start?: number;
  duration?: number;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
    }>;
  };
}

/**
 * 実行環境に応じて FastAPI 文字起こし中継 WebSocket のベース URL を解決する。
 */
export function resolveTranscriptionWsBaseUrl(baseUrl?: string): string {
  const configured = baseUrl?.trim() || process.env.NEXT_PUBLIC_BACKEND_WS_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const { hostname, host, port, protocol } = window.location;
    // ローカル next dev (:3000) の HTTP rewrite は WebSocket upgrade を行わないため :8000 へ直接接続する
    if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "3000") {
      return `ws://${hostname}:8000`;
    }
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${host}`;
  }

  return "ws://localhost:8000";
}

/**
 * Backend 中継 WebSocket (`/api/transcriptions/ws`) の接続 URL を組み立てる。
 */
export function buildDeepgramWebSocketUrl({
  channels,
  language = "ja",
  sampleRate = 16000,
  endpointingMs = 300,
  baseUrl,
  enableSoap = false,
  conversationId,
}: {
  channels: 1 | 2;
  language?: string;
  sampleRate?: number;
  endpointingMs?: number;
  baseUrl?: string;
  enableSoap?: boolean;
  conversationId?: string;
}): string {
  const params = new URLSearchParams({
    channels: String(channels),
    language,
    sample_rate: String(sampleRate),
    endpointing: String(endpointingMs),
  });
  if (enableSoap) {
    params.set("soap", "true");
  }
  if (conversationId?.trim()) {
    params.set("conversation_id", conversationId.trim());
  }

  const resolvedBase = resolveTranscriptionWsBaseUrl(baseUrl);
  return `${resolvedBase}/api/transcriptions/ws?${params.toString()}`;
}

/**
 * FastAPI から届いた AuthOk イベントの有効期限情報を抽出する。
 */
export function parseDeepgramAuthOk(
  rawData: string,
): { expiresAt: number; sessionExpiresAt: number } | null {
  let parsed: DeepgramRawResponse;
  try {
    parsed = JSON.parse(rawData) as DeepgramRawResponse;
  } catch {
    return null;
  }

  if (
    parsed.type !== "AuthOk" ||
    typeof parsed.expires_at !== "number" ||
    typeof parsed.session_expires_at !== "number"
  ) {
    return null;
  }

  return {
    expiresAt: parsed.expires_at,
    sessionExpiresAt: parsed.session_expires_at,
  };
}

/**
 * FastAPI / Deepgram から届いた Error イベントのメッセージを抽出する。
 */
export function parseDeepgramErrorMessage(rawData: string): string | null {
  let parsed: DeepgramRawResponse;
  try {
    parsed = JSON.parse(rawData) as DeepgramRawResponse;
  } catch {
    return null;
  }

  if (parsed.type !== "Error") {
    return null;
  }

  const detail = parsed.message?.trim() || parsed.description?.trim();
  return detail || "文字起こしサーバーでエラーが発生しました。";
}

/**
 * Deepgram WebSocket から受信した JSON メッセージを解析する。
 */
export function parseDeepgramMessage(rawData: string): DeepgramTranscriptEvent | null {
  let parsed: DeepgramRawResponse;
  try {
    parsed = JSON.parse(rawData) as DeepgramRawResponse;
  } catch {
    return null;
  }

  if (parsed.type !== "Results") {
    return null;
  }

  const alternative = parsed.channel?.alternatives?.[0];
  const text = alternative?.transcript?.trim() ?? "";
  if (!text) {
    return null;
  }

  const rawChannel = parsed.channel_index?.[0] ?? 0;
  const channelIndex: 0 | 1 = rawChannel === 1 ? 1 : 0;
  const startSec = typeof parsed.start === "number" ? parsed.start : 0;
  const durationSec = typeof parsed.duration === "number" ? parsed.duration : 0;

  return {
    channelIndex,
    text,
    isFinal: Boolean(parsed.is_final),
    speechFinal: Boolean(parsed.speech_final),
    startSec,
    endSec: startSec + durationSec,
    confidence: typeof alternative?.confidence === "number" ? alternative.confidence : 0,
  };
}

/**
 * Deepgram 中継 WebSocket セッションを開き、Auth ハンドシェイク後に PCM 送信と受信処理を行う。
 */
export function createDeepgramStreamSession({
  accessToken,
  channels,
  language = "ja",
  sampleRate = 16000,
  endpointingMs = 300,
  baseUrl,
  connectTimeoutMs = 15000,
  stopTimeoutMs,
  enableSoap = false,
  conversationId,
  onAuthOk,
  onTranscript,
  onConversationEvent,
  onError,
  onClose,
  signal,
}: DeepgramStreamOptions): Promise<DeepgramStreamSession> {
  if (!accessToken.trim()) {
    return Promise.reject(new Error("文字起こしを開始するにはログインが必要です。"));
  }
  if (signal?.aborted) {
    return Promise.reject(new DOMException("接続をキャンセルしました。", "AbortError"));
  }

  const url = buildDeepgramWebSocketUrl({
    channels,
    language,
    sampleRate,
    endpointingMs,
    baseUrl,
    enableSoap,
    conversationId,
  });
  const effectiveStopTimeoutMs = stopTimeoutMs ?? (enableSoap ? 22000 : 6000);
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let closing = false;
  let closed = false;
  let closedManually = false;
  let finishClose: () => void = () => {};
  const closePromise = new Promise<void>((resolve) => {
    finishClose = resolve;
  });

  return new Promise<DeepgramStreamSession>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearInterval(keepAliveTimer);
      clearTimeout(connectTimer);
      clearTimeout(closeTimer);
      signal?.removeEventListener("abort", abort);
    };
    const forceClose = () => {
      closing = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        socket.close(1000, "client closed");
      cleanup();
      finishClose();
    };
    const abort = () => {
      closedManually = true;
      if (!settled) {
        settled = true;
        reject(new DOMException("接続をキャンセルしました。", "AbortError"));
      }
      forceClose();
    };
    signal?.addEventListener("abort", abort, { once: true });

    connectTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      closedManually = true;
      reject(new Error("文字起こしサーバーへの接続・認証がタイムアウトしました。"));
      forceClose();
    }, connectTimeoutMs);

    const buildSession = (): DeepgramStreamSession => ({
      sendAudio: (pcm16) => {
        if (!settled || closing || socket.readyState !== WebSocket.OPEN) return;
        socket.send(pcm16);
      },
      close: () => {
        if (closing || closed) return closePromise;
        closing = true;
        closedManually = true;
        clearInterval(keepAliveTimer);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "CloseStream" }));
          // 既定は STT 待機(6秒)、SOAP 有効時は STT 5秒 + LLM 最終更新 15秒 + 余裕 2秒(22秒)待つ
          closeTimer = setTimeout(() => {
            onError?.(new Error("文字起こしの最終結果の待機がタイムアウトしました。"));
            forceClose();
          }, effectiveStopTimeoutMs);
        } else forceClose();
        return closePromise;
      },
    });

    socket.onopen = () => {
      // 接続直後に Auth フレームを送信し、AuthOk を受け取るまで接続完了とみなさない
      socket.send(JSON.stringify({ type: "Auth", access_token: accessToken }));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;

      if (!settled) {
        const authOk = parseDeepgramAuthOk(event.data);
        if (authOk) {
          settled = true;
          clearTimeout(connectTimer);
          keepAliveTimer = setInterval(() => {
            if (!closing && socket.readyState === WebSocket.OPEN)
              socket.send(JSON.stringify({ type: "KeepAlive" }));
          }, 8000);
          onAuthOk?.(authOk);
          resolve(buildSession());
          return;
        }

        const errorMessage = parseDeepgramErrorMessage(event.data);
        if (errorMessage) {
          settled = true;
          closedManually = true;
          reject(new Error(errorMessage));
          forceClose();
        }
        return;
      }

      const errorMessage = parseDeepgramErrorMessage(event.data);
      if (errorMessage) {
        onError?.(new Error(errorMessage));
        return;
      }
      const conversationEvent = parseConversationWsEvent(event.data);
      if (conversationEvent) {
        onConversationEvent?.(conversationEvent);
        return;
      }

      const parsed = parseDeepgramMessage(event.data);
      if (parsed) onTranscript?.(parsed);
    };

    socket.onerror = () => {
      const error = new Error("Deepgram WebSocket 接続でエラーが発生しました。");
      if (!settled) {
        settled = true;
        closedManually = true;
        reject(error);
        forceClose();
      } else onError?.(error);
    };

    socket.onclose = (event) => {
      closed = true;
      cleanup();
      finishClose();
      if (!settled) {
        settled = true;
        reject(new Error(`Deepgram WebSocket 接続が開始前に終了しました (code: ${event.code})。`));
      } else if (!closedManually) onClose?.({ code: event.code, reason: event.reason });
    };
  });
}
