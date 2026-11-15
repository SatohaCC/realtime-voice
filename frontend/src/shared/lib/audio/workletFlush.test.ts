import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

interface Processor {
  port: { onmessage: (event: { data: { type: string } }) => void };
  process: (inputs: Float32Array[][]) => boolean;
}
it("停止時は100ms未満の音声も送信し、その後の入力は送信しない", () => {
  let create: new (options: { processorOptions: { channels: number } }) => Processor = class {
    port = { onmessage: () => {} };
    process = () => false;
  };
  const postMessage = vi.fn();
  runInNewContext(readFileSync("public/worklets/dual-pcm-processor.js", "utf8"), {
    sampleRate: 16000,
    AudioWorkletProcessor: class {
      port = { postMessage, onmessage: () => {} };
    },
    registerProcessor: (_name: string, processor: typeof create) => {
      create = processor;
    },
  });
  const processor = new create({ processorOptions: { channels: 1 } });
  processor.process([[new Float32Array(128).fill(0.5)]]);
  expect(postMessage).not.toHaveBeenCalled();
  processor.port.onmessage({ data: { type: "flush" } });
  expect(postMessage.mock.calls[0][0].pcm16.byteLength).toBe(256);
  expect(postMessage.mock.calls[1][0]).toEqual({ type: "flushed" });
  expect(processor.process([[new Float32Array(128).fill(0.5)]])).toBe(false);
  expect(postMessage).toHaveBeenCalledTimes(2);
});
