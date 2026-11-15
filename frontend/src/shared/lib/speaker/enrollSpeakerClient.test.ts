import { describe, expect, it, vi } from "vitest";
import { enrollPharmacistVoice } from "./enrollSpeakerClient";

describe("enrollPharmacistVoice", () => {
  it("収音した 16kHz PCM を /api/speakers/enroll へ送信し、抽出結果を返す", async () => {
    const pcmChunk = new Int16Array(16000).buffer;
    const stopSpy = vi.fn(async () => {});
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          model_id: "campp-v1",
          embedding_dim: 4,
          embedding: [0.5, 0.5, 0.5, 0.5],
          duration_sec: 1.0,
          voiced_sec: 1.0,
          rms_level: 0.1,
          peak_level: 0.2,
          quality_warnings: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await enrollPharmacistVoice({
      accessToken: "tok-1",
      micDeviceId: "mic-1",
      durationMs: 20,
      captureFactory: async ({ onAudioFrame }) => {
        onAudioFrame({
          pcm16: pcmChunk,
          sampleRate: 16000,
          channels: 1,
          levels: [0.15, 0],
        });
        return { stop: stopSpy };
      },
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/speakers/enroll?sample_rate=16000");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect(result.model_id).toBe("campp-v1");
    expect(result.embedding).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it("Backend の品質エラー (422 等) の detail メッセージをそのまま返す", async () => {
    const pcmChunk = new Int16Array(16000).buffer;
    await expect(
      enrollPharmacistVoice({
        accessToken: "tok-1",
        micDeviceId: "mic-1",
        durationMs: 10,
        captureFactory: async ({ onAudioFrame }) => {
          onAudioFrame({
            pcm16: pcmChunk,
            sampleRate: 16000,
            channels: 1,
            levels: [0.01, 0],
          });
          return { stop: async () => {} };
        },
        fetchFn: (async () =>
          new Response(JSON.stringify({ detail: "有効な発声時間が短すぎます。" }), {
            status: 422,
          })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("有効な発声時間が短すぎます。");
  });
});
