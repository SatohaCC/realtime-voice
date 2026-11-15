import { describe, expect, it } from "vitest";
import {
  applyConversationSegmentDeleted,
  applyConversationWsEvent,
  createInitialConversationState,
  parseConversationWsEvent,
  prepareStreamReconnect,
} from "./conversationReducer";
import { formatSoapNoteAsText } from "./soapClipboard";
import type { SoapNote } from "./types";

describe("conversationReducer", () => {
  it("異なる会話ID・重複イベント・逆順シーケンスを無視する", () => {
    const initial = createInitialConversationState("conv-1");

    const wrongConv = applyConversationWsEvent(initial, {
      protocol_version: 1,
      conversation_id: "conv-other",
      event_id: "ev-1",
      sequence: 1,
      type: "SoapStatus",
      status: "updating",
      has_unapplied_transcript: true,
      pending_from_transcript_revision: 1,
    });
    expect(wrongConv).toBe(initial);

    const applied = applyConversationWsEvent(initial, {
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "ev-2",
      sequence: 2,
      type: "SoapStatus",
      status: "updating",
      has_unapplied_transcript: true,
      pending_from_transcript_revision: 1,
    });
    expect(applied.soapStatus).toBe("updating");

    const duplicate = applyConversationWsEvent(applied, {
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "ev-2",
      sequence: 3,
      type: "SoapStatus",
      status: "ready",
      has_unapplied_transcript: false,
      pending_from_transcript_revision: null,
    });
    expect(duplicate).toBe(applied);

    const outOfOrder = applyConversationWsEvent(applied, {
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "ev-older",
      sequence: 1,
      type: "SoapStatus",
      status: "ready",
      has_unapplied_transcript: false,
      pending_from_transcript_revision: null,
    });
    expect(outOfOrder).toBe(applied);
  });

  it("同時発話の音声時刻順維持と回り込み削除を処理する", () => {
    let state = createInitialConversationState("conv-1");
    state = applyConversationWsEvent(state, {
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "ev-1",
      sequence: 1,
      type: "TranscriptUpdated",
      segment: {
        stream_id: "s1",
        segment_id: "seg-1",
        segment_revision: 1,
        transcript_revision: 1,
        channel_index: 0,
        speaker_role: "pharmacist",
        speaker_label: "薬剤師",
        text: "お薬を説明します。",
        status: "final",
        start_sec: 2.0,
        end_sec: 3.0,
        confidence: 0.95,
      },
    });
    state = applyConversationWsEvent(state, {
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "ev-2",
      sequence: 2,
      type: "TranscriptUpdated",
      segment: {
        stream_id: "s1",
        segment_id: "seg-2",
        segment_revision: 1,
        transcript_revision: 2,
        channel_index: 1,
        speaker_role: "patient",
        speaker_label: "患者",
        text: "昨日から咳が出ます。",
        status: "interim",
        start_sec: 0.5,
        end_sec: 1.5,
        confidence: 0.85,
      },
    });
    expect(state.segments.map((s) => s.segment_id)).toEqual(["seg-2", "seg-1"]);

    state = applyConversationWsEvent(state, {
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "ev-3",
      sequence: 3,
      type: "TranscriptUpdated",
      removed: true,
      segment: {
        stream_id: "s1",
        segment_id: "seg-2",
        segment_revision: 1,
        transcript_revision: 2,
        channel_index: 1,
        speaker_role: "patient",
        speaker_label: "患者",
        text: "昨日から咳が出ます。",
        status: "interim",
        start_sec: 0.5,
        end_sec: 1.5,
        confidence: 0.85,
      },
    });
    expect(state.segments.map((s) => s.segment_id)).toEqual(["seg-1"]);
  });

  it("再接続先サーバーが空状態のとき既存下書きを上書きしない", () => {
    const soap: SoapNote = {
      soap_id: "soap-conv-1",
      conversation_id: "conv-1",
      revision: 1,
      processed_transcript_revision: 1,
      sections: {
        S: {
          revision: 1,
          items: [
            {
              item_id: "soap-S-1",
              item_revision: 1,
              text: "喉の痛み",
              evidence: [
                {
                  stream_id: "s1",
                  segment_id: "seg-1",
                  segment_revision: 1,
                  quote: "喉が痛い",
                  speaker_role: "patient",
                },
              ],
              origin: "conversation",
              derived_from_plan_items: [],
              stale_after_plan_update: false,
              verification_status: "reported",
            },
          ],
        },
        O: { revision: 0, items: [] },
        A: { revision: 0, items: [], derived_from_plan_revision: null },
        P: { revision: 0, items: [] },
      },
    };
    const withDraft = {
      ...createInitialConversationState("conv-1"),
      soap,
      lastSequence: 5,
    };

    const reconnected = applyConversationWsEvent(prepareStreamReconnect(withDraft), {
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "snap-1",
      sequence: 1,
      type: "ConversationSnapshot",
      segments: [],
      soap: createInitialConversationState("conv-1").soap,
      soap_status: "idle",
      has_unapplied_transcript: false,
    });
    // 前接続より小さい sequence でも復元失敗を検出する
    expect(reconnected.soap.sections.S.items).toHaveLength(1);
    expect(reconnected.serverSyncLost).toBe(true);
    expect(reconnected.soapStatus).toBe("error");
    const ignored = applyConversationWsEvent(reconnected, {
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "after-loss",
      sequence: 100,
      type: "SoapStatus",
      status: "ready",
      has_unapplied_transcript: false,
      pending_from_transcript_revision: null,
    });
    expect(ignored).toBe(reconnected);

    const fresh = applyConversationWsEvent(
      { ...createInitialConversationState("conv-1"), soap },
      {
        protocol_version: 1,
        conversation_id: "conv-1",
        event_id: "snap-2",
        sequence: 1,
        type: "ConversationSnapshot",
        segments: [],
        soap: createInitialConversationState("conv-1").soap,
        soap_status: "idle",
        has_unapplied_transcript: false,
      },
    );
    expect(fresh.serverSyncLost).toBe(true);
    expect(fresh.soap.sections.S.items).toHaveLength(1);
  });

  it("復元済みスナップショットで再開し、接続内の古いスナップショットは適用しない", () => {
    const state = { ...createInitialConversationState("conv-1"), lastSequence: 12 };
    const snapshot = {
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "restored",
      sequence: 13,
      type: "ConversationSnapshot" as const,
      segments: [],
      soap: state.soap,
      soap_status: "ready" as const,
      has_unapplied_transcript: false,
    };
    const restored = applyConversationWsEvent(prepareStreamReconnect(state), snapshot);
    expect(restored.serverSyncLost).toBe(false);
    expect(restored.lastSequence).toBe(13);
    expect(applyConversationWsEvent(restored, { ...snapshot, event_id: "late", sequence: 1 })).toBe(
      restored,
    );
  });

  it("parseConversationWsEvent と formatSoapNoteAsText が正しく動作する", () => {
    const raw = JSON.stringify({
      protocol_version: 1,
      conversation_id: "conv-1",
      event_id: "ev-1",
      sequence: 1,
      type: "SoapStatus",
      status: "ready",
      has_unapplied_transcript: false,
      pending_from_transcript_revision: null,
    });
    expect(parseConversationWsEvent(raw)?.type).toBe("SoapStatus");
    expect(parseConversationWsEvent('{"type":"Results"}')).toBeNull();

    const text = formatSoapNoteAsText(createInitialConversationState("conv-1").soap);
    expect(text).toContain("S (主観的情報)\n（未抽出）");
    expect(text).toContain("P (計画)\n（未抽出）");
  });

  it("applyConversationSegmentDeleted が削除セグメントと依存SOAP根拠を整合する", () => {
    const initial = {
      ...createInitialConversationState("conv-1"),
      segments: [
        {
          stream_id: "s1",
          segment_id: "seg-1",
          segment_revision: 1,
          transcript_revision: 1,
          channel_index: 1 as const,
          speaker_role: "patient" as const,
          speaker_label: "患者",
          text: "喉が痛い",
          status: "final" as const,
          start_sec: 0,
          end_sec: 1,
          confidence: 0.9,
        },
        {
          stream_id: "s1",
          segment_id: "seg-2",
          segment_revision: 1,
          transcript_revision: 2,
          channel_index: 1 as const,
          speaker_role: "patient" as const,
          speaker_label: "患者",
          text: "喉が痛い",
          status: "final" as const,
          start_sec: 0.1,
          end_sec: 1.1,
          confidence: 0.9,
        },
      ],
      soap: {
        soap_id: "soap-conv-1",
        conversation_id: "conv-1",
        revision: 1,
        processed_transcript_revision: 2,
        sections: {
          S: {
            revision: 1,
            items: [
              {
                item_id: "soap-S-1",
                item_revision: 1,
                text: "喉の痛み",
                evidence: [
                  {
                    stream_id: "s1",
                    segment_id: "seg-2",
                    segment_revision: 1,
                    quote: "喉が痛い",
                    speaker_role: "patient" as const,
                  },
                ],
                origin: "conversation" as const,
                derived_from_plan_items: [],
                stale_after_plan_update: false,
                verification_status: "reported" as const,
              },
            ],
          },
          O: { revision: 0, items: [] },
          A: { revision: 0, items: [], derived_from_plan_revision: null },
          P: { revision: 0, items: [] },
        },
      },
    };

    const next = applyConversationSegmentDeleted(initial, { streamId: "s1", segmentId: "seg-2" });
    expect(next.segments.map((s) => s.segment_id)).toEqual(["seg-1"]);
    expect(next.soap.sections.S.items).toEqual([]);
  });
});
