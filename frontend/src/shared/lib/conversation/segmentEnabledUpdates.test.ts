import { expect, it } from "vitest";
import { readSegmentEnabledUpdates } from "./segmentEnabledUpdates";

it("分割された日本語JSONと複数行を逐次通知し、応答終了を待たない", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start: (value) => {
      controller = value;
    },
  });
  const response = new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
  const updates: unknown[] = [];
  let notified!: () => void;
  const first = new Promise<void>((resolve) => {
    notified = resolve;
  });
  const task = readSegmentEnabledUpdates(response, (update) => {
    updates.push(update);
    notified();
  });
  const bytes = new TextEncoder().encode('{"text":"患者"}\n');
  controller.enqueue(bytes.slice(0, 11));
  controller.enqueue(bytes.slice(11));
  await first;
  expect(updates).toEqual([{ text: "患者" }]);
  controller.enqueue(new TextEncoder().encode('{"text":"SOAP更新"}'));
  controller.close();
  await task;
  expect(updates).toEqual([{ text: "患者" }, { text: "SOAP更新" }]);
});

it("空のストリームは更新成功として扱わない", async () => {
  const response = new Response("", { headers: { "content-type": "application/x-ndjson" } });
  await expect(readSegmentEnabledUpdates(response, () => {})).rejects.toThrow("空");
});
