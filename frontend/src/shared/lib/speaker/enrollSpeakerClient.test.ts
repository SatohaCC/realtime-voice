import { describe, expect, it, vi } from "vitest";
import { enrollPharmacistVoice } from "./enrollSpeakerClient";

describe("enrollPharmacistVoice", () => {
  it("5秒時点で有効音声が2.1秒でも収音を継続し、3秒に達してから停止する", async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn(async () => {});
      const fetchFn = vi.fn(async () => new Response(JSON.stringify({ embedding: [1] })));
      const progress: number[] = [];
      const task = enrollPharmacistVoice({
        accessToken: "token",
        micDeviceId: "mic",
        durationMs: 10000,
        minVoicedSeconds: 3,
        onProgress: (value) => progress.push(value),
        captureFactory: async ({ onAudioFrame }) => {
          const first = new Int16Array(80000);
          first.fill(3000, 46400);
          setTimeout(
            () =>
              onAudioFrame({
                pcm16: first.buffer,
                channels: 1,
                sampleRate: 16000,
                levels: [0.1, 0],
              }),
            5000,
          );
          setTimeout(
            () =>
              onAudioFrame({
                pcm16: new Int16Array(14400).fill(3000).buffer,
                channels: 1,
                sampleRate: 16000,
                levels: [0.1, 0],
              }),
            7000,
          );
          return { stop };
        },
        fetchFn,
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(progress.at(-1)).toBeCloseTo(0.7);
      expect(stop).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2000);
      await task;
      expect(progress.at(-1)).toBe(1);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("有効音声が集まらなくても上限10秒で停止し、サーバーの品質エラーを返す", async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn(async () => {});
      const task = enrollPharmacistVoice({
        accessToken: "token",
        micDeviceId: "mic",
        durationMs: 10000,
        minVoicedSeconds: 3,
        captureFactory: async ({ onAudioFrame }) => {
          onAudioFrame({
            pcm16: new Int16Array(160000).buffer,
            channels: 1,
            sampleRate: 16000,
            levels: [0, 0],
          });
          return { stop };
        },
        fetchFn: async () =>
          new Response(JSON.stringify({ detail: "有効音声が不足しています。" }), { status: 422 }),
      });
      const rejected = expect(task).rejects.toThrow("有効音声が不足しています。");
      await vi.advanceTimersByTimeAsync(9999);
      expect(stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

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
      durationMs: 1000,
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
        durationMs: 1000,
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

  it("3回の録音を区切り付きで送信し、各マイクを停止する", async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn(async () => {});
      const samples: number[] = [];
      const progress: number[] = [];
      const fetchFn = vi.fn(async () => new Response(JSON.stringify({ embedding: [1] })));
      const task = enrollPharmacistVoice({
        accessToken: "token",
        micDeviceId: "mic",
        sampleCount: 3,
        durationMs: 1000,
        onSample: (index) => samples.push(index),
        onProgress: (value) => progress.push(value),
        captureFactory: async ({ onAudioFrame, autoGainControl }) => {
          expect(autoGainControl).toBe(false);
          onAudioFrame({
            pcm16: new Int16Array(17000).buffer,
            channels: 1,
            sampleRate: 16000,
            levels: [0.1, 0],
          });
          return { stop };
        },
        fetchFn,
      });
      await vi.runAllTimersAsync();
      await task;
      expect(samples).toEqual([0, 1, 2]);
      expect(progress).toEqual([1 / 3, 2 / 3, 1]);
      expect(stop).toHaveBeenCalledTimes(3);
      const [url, request] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(
        "/api/speakers/enroll?sample_rate=16000&sample_frames=16000&sample_frames=16000&sample_frames=16000",
      );
      expect((request.body as Blob).size).toBe(16000 * 2 * 3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("2回目で中止するとマイクを停止し、登録APIには送信しない", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const stop = vi.fn(async () => {});
      const fetchFn = vi.fn();
      const task = enrollPharmacistVoice({
        accessToken: "token",
        micDeviceId: "mic",
        sampleCount: 3,
        durationMs: 1000,
        signal: controller.signal,
        onSample: (index) => {
          if (index === 1) controller.abort();
        },
        captureFactory: async ({ onAudioFrame }) => {
          onAudioFrame({
            pcm16: new Int16Array(16000).buffer,
            channels: 1,
            sampleRate: 16000,
            levels: [0.1, 0],
          });
          return { stop };
        },
        fetchFn,
      });
      const rejection = expect(task).rejects.toMatchObject({ name: "AbortError" });
      await vi.runAllTimersAsync();
      await rejection;
      expect(stop).toHaveBeenCalledTimes(1);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
