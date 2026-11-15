import { describe, expect, it } from "vitest";
import {
  buildDeepgramWebSocketUrl,
  parseDeepgramErrorMessage,
  parseDeepgramMessage,
} from "./deepgramClient";
import { applyDeepgramTranscriptEvent, createInitialTranscriptState } from "./transcriptReducer";

describe("deepgramClient", () => {
  it("2チャンネル用の FastAPI 中継 WebSocket URL を正しく組み立てる", () => {
    const url = buildDeepgramWebSocketUrl({
      channels: 2,
      language: "ja",
      sampleRate: 16000,
      endpointingMs: 300,
      baseUrl: "ws://localhost:8000",
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe("ws://localhost:8000");
    expect(parsed.pathname).toBe("/api/transcriptions/ws");
    expect(parsed.searchParams.get("channels")).toBe("2");
    expect(parsed.searchParams.get("language")).toBe("ja");
    expect(parsed.searchParams.get("sample_rate")).toBe("16000");
    expect(parsed.searchParams.get("endpointing")).toBe("300");
  });

  it("Error イベントからエラーメッセージを抽出する", () => {
    expect(
      parseDeepgramErrorMessage(
        JSON.stringify({ type: "Error", message: "DEEPGRAM_KEY が設定されていません。" }),
      ),
    ).toBe("DEEPGRAM_KEY が設定されていません。");
    expect(parseDeepgramErrorMessage(JSON.stringify({ type: "Results" }))).toBeNull();
  });

  it("Results JSON からチャンネル・確定状態・テキストを抽出する", () => {
    const parsed = parseDeepgramMessage(
      JSON.stringify({
        type: "Results",
        channel_index: [1, 2],
        start: 1.5,
        duration: 2.0,
        is_final: true,
        speech_final: true,
        channel: {
          alternatives: [{ transcript: "昨日から喉が痛いです。", confidence: 0.96 }],
        },
      }),
    );

    expect(parsed).toEqual({
      channelIndex: 1,
      text: "昨日から喉が痛いです。",
      isFinal: true,
      speechFinal: true,
      startSec: 1.5,
      endSec: 3.5,
      confidence: 0.96,
    });
  });

  it("空テキストや非 Results メッセージは無視する", () => {
    expect(parseDeepgramMessage(JSON.stringify({ type: "Metadata" }))).toBeNull();
    expect(
      parseDeepgramMessage(
        JSON.stringify({
          type: "Results",
          channel_index: [0, 2],
          channel: { alternatives: [{ transcript: "   " }] },
        }),
      ),
    ).toBeNull();
  });
});

describe("transcriptReducer", () => {
  const speakers = { 0: "話者 A", 1: "話者 B" } as const;

  it("interim を更新し、is_final で同じセグメントを確定する", () => {
    let state = createInitialTranscriptState();

    state = applyDeepgramTranscriptEvent(
      state,
      {
        channelIndex: 0,
        text: "こんにちは",
        isFinal: false,
        speechFinal: false,
        startSec: 0,
        endSec: 0.8,
        confidence: 0.7,
      },
      speakers,
    );
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0].status).toBe("interim");

    state = applyDeepgramTranscriptEvent(
      state,
      {
        channelIndex: 0,
        text: "こんにちは、今日はどうされましたか？",
        isFinal: true,
        speechFinal: true,
        startSec: 0,
        endSec: 2.1,
        confidence: 0.95,
      },
      speakers,
    );
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0].status).toBe("final");
    expect(state.segments[0].text).toBe("こんにちは、今日はどうされましたか？");
  });

  it("別チャンネルへの回り込みによる同一文の重複確定を除外する", () => {
    let state = createInitialTranscriptState();

    state = applyDeepgramTranscriptEvent(
      state,
      {
        channelIndex: 0,
        text: "昨日から熱があります",
        isFinal: true,
        speechFinal: true,
        startSec: 3.0,
        endSec: 4.5,
        confidence: 0.94,
      },
      speakers,
      [0.4, 0.08],
    );

    state = applyDeepgramTranscriptEvent(
      state,
      {
        channelIndex: 1,
        text: "昨日から熱があります",
        isFinal: true,
        speechFinal: true,
        startSec: 3.1,
        endSec: 4.5,
        confidence: 0.85,
      },
      speakers,
      [0.4, 0.08],
    );

    expect(state.segments).toHaveLength(1);
    expect(state.segments[0].channelIndex).toBe(0);
  });

  it("parseSpeakerProfileAck でサーバーからの声紋受理応答を解釈する", async () => {
    const { parseSpeakerProfileAck } = await import("./deepgramClient");
    expect(
      parseSpeakerProfileAck(
        JSON.stringify({
          type: "SpeakerProfileAck",
          accepted: true,
          model_id: "campp-v1",
          reason: null,
        }),
      ),
    ).toEqual({
      accepted: true,
      modelId: "campp-v1",
      reason: null,
    });
    expect(parseSpeakerProfileAck('{"type":"Results"}')).toBeNull();
  });

  it("updateSegmentSpeaker が接続済みセッションで UpdateSegmentSpeaker フレームを送信する", async () => {
    const sent: string[] = [];
    class MockWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = MockWebSocket.OPEN;
      binaryType = "arraybuffer";
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      constructor() {
        setTimeout(() => {
          this.onopen?.();
          this.onmessage?.({
            data: JSON.stringify({ type: "AuthOk", expires_at: 200, session_expires_at: 300 }),
          });
        }, 0);
      }
      send(data: string | ArrayBuffer) {
        if (typeof data === "string") {
          sent.push(data);
          if (JSON.parse(data).type === "CloseStream") {
            setTimeout(() => this.onclose?.({ code: 1000, reason: "" }), 0);
          }
        }
      }
      close() {
        this.onclose?.({ code: 1000, reason: "" });
      }
    }

    const originalWs = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    try {
      const { createDeepgramStreamSession } = await import("./deepgramClient");
      const session = await createDeepgramStreamSession({
        accessToken: "token",
        channels: 2,
        baseUrl: "ws://localhost:8000",
      });
      session.updateSegmentSpeaker("stream-1", "seg-2", "patient");
      session.deleteSegment("stream-1", "seg-3");
      expect(sent.map((item) => JSON.parse(item))).toContainEqual({
        type: "UpdateSegmentSpeaker",
        stream_id: "stream-1",
        segment_id: "seg-2",
        speaker_role: "patient",
      });
      expect(sent.map((item) => JSON.parse(item))).toContainEqual({
        type: "DeleteSegment",
        stream_id: "stream-1",
        segment_id: "seg-3",
      });
      await session.close();
    } finally {
      globalThis.WebSocket = originalWs;
    }
  });
});
