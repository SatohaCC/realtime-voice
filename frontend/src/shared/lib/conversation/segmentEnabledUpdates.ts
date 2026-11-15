import type { SoapLifecycleStatus, SoapNote, TranscriptSegment } from "./types";

export interface SegmentEnabledUpdate {
  conversation_id: string;
  segment: TranscriptSegment;
  soap: SoapNote;
  changed_item_ids?: string[];
  soap_status?: SoapLifecycleStatus;
  has_unapplied_transcript?: boolean;
}

/** 確定通知とSOAP更新を到着順に読み、HTTP応答全体の完了を待たずに反映する。 */
export async function readSegmentEnabledUpdates(
  response: Response,
  onUpdate: (update: SegmentEnabledUpdate) => void,
): Promise<void> {
  if (!response.headers?.get("content-type")?.includes("application/x-ndjson")) {
    onUpdate((await response.json()) as SegmentEnabledUpdate);
    return;
  }
  if (!response.body) throw new Error("発話の更新応答を取得できませんでした。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let received = false;
  const apply = (line: string) => {
    if (!line.trim()) return;
    onUpdate(JSON.parse(line) as SegmentEnabledUpdate);
    received = true;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) apply(line);
      if (done) break;
    }
    apply(pending);
    if (!received) throw new Error("発話の更新応答が空でした。");
  } finally {
    reader.releaseLock();
  }
}
