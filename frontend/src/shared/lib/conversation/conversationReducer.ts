import type {
  ConversationWsEvent,
  SoapLifecycleStatus,
  SoapNote,
  TranscriptSegment,
} from "./types";

export const SUPPORTED_CONVERSATION_PROTOCOL_VERSION = 1;
const MAX_SEEN_EVENT_IDS = 500;

export interface ConversationWorkspaceState {
  conversationId: string;
  segments: readonly TranscriptSegment[];
  soap: SoapNote;
  soapStatus: SoapLifecycleStatus;
  hasUnappliedTranscript: boolean;
  soapStatusMessage: string | null;
  changedItemIds: readonly string[];
  lastSequence: number;
  seenEventIds: readonly string[];
  completedReason: string | null;
  serverSyncLost: boolean;
  awaitingSnapshot: boolean;
}

export function createEmptySoapNote(conversationId: string): SoapNote {
  return {
    soap_id: `soap-${conversationId}`,
    conversation_id: conversationId,
    revision: 0,
    processed_transcript_revision: 0,
    sections: {
      S: { revision: 0, items: [] },
      O: { revision: 0, items: [] },
      A: { revision: 0, items: [], derived_from_plan_revision: null },
      P: { revision: 0, items: [] },
    },
  };
}

export function createInitialConversationState(
  conversationId: string,
  soapStatus: SoapLifecycleStatus = "idle",
): ConversationWorkspaceState {
  return {
    conversationId,
    segments: [],
    soap: createEmptySoapNote(conversationId),
    soapStatus,
    hasUnappliedTranscript: false,
    soapStatusMessage: null,
    changedItemIds: [],
    lastSequence: 0,
    seenEventIds: [],
    completedReason: null,
    serverSyncLost: false,
    awaitingSnapshot: false,
  };
}

export function clearSoapHighlights(state: ConversationWorkspaceState): ConversationWorkspaceState {
  if (state.changedItemIds.length === 0) {
    return state;
  }
  return {
    ...state,
    changedItemIds: [],
  };
}

/**
 * 新しい WebSocket セッション接続前に重複・逆順判定用シーケンスを整える。
 * サーバー側状態が復元できない場合は切断前の下書きを保持したまま自動更新を停止扱いにする。
 */
export function prepareStreamReconnect(
  state: ConversationWorkspaceState,
): ConversationWorkspaceState {
  return {
    ...state,
    completedReason: null,
    awaitingSnapshot: true,
  };
}

function recordSeenEvent(seenEventIds: readonly string[], eventId: string): readonly string[] {
  const next = [...seenEventIds, eventId];
  if (next.length > MAX_SEEN_EVENT_IDS) {
    return next.slice(next.length - MAX_SEEN_EVENT_IDS);
  }
  return next;
}

function upsertSegment(
  segments: readonly TranscriptSegment[],
  incoming: TranscriptSegment,
  removed: boolean,
): readonly TranscriptSegment[] {
  const keyMatch = (item: TranscriptSegment) =>
    item.stream_id === incoming.stream_id && item.segment_id === incoming.segment_id;

  if (removed) {
    return segments.filter((item) => !keyMatch(item));
  }

  const existingIndex = segments.findIndex(keyMatch);
  if (existingIndex >= 0) {
    const existing = segments[existingIndex];
    if (incoming.segment_revision < existing.segment_revision) {
      return segments;
    }
    const next = [...segments];
    next[existingIndex] = incoming;
    return next;
  }

  // 同ストリーム内では音声開始時刻に従って差し込み、到着順の逆転を防ぐ
  const next = [...segments];
  let insertAt = next.length;
  for (let idx = next.length - 1; idx >= 0; idx -= 1) {
    const item = next[idx];
    if (item.stream_id !== incoming.stream_id) {
      break;
    }
    if (item.start_sec <= incoming.start_sec) {
      insertAt = idx + 1;
      break;
    }
    insertAt = idx;
  }
  next.splice(insertAt, 0, incoming);
  return next;
}

/**
 * Backend から受信した会話・SOAP イベントを検証し、正当なものだけを状態へ適用する。
 */
export function applyConversationWsEvent(
  state: ConversationWorkspaceState,
  event: ConversationWsEvent,
): ConversationWorkspaceState {
  if (
    event.protocol_version !== SUPPORTED_CONVERSATION_PROTOCOL_VERSION ||
    event.conversation_id !== state.conversationId
  ) {
    return state;
  }

  if (state.serverSyncLost) return state;

  // 接続開始時のスナップショットだけは、前接続の sequence より小さくても復元可否を確認する
  const initialSnapshot = state.awaitingSnapshot && event.type === "ConversationSnapshot";
  if (
    !initialSnapshot &&
    (event.sequence <= state.lastSequence || state.seenEventIds.includes(event.event_id))
  ) {
    return state;
  }

  const nextSeen = recordSeenEvent(state.seenEventIds, event.event_id);

  switch (event.type) {
    case "ConversationSnapshot": {
      // 再接続先サーバーが初期状態で、既にクライアント側に下書きがある場合は上書きしない
      const clientHasDraft = state.segments.length > 0 || state.soap.revision > 0;
      const serverIsEmpty =
        event.segments.length === 0 && event.soap.revision === 0 && event.sequence === 1;
      if (clientHasDraft && serverIsEmpty) {
        return {
          ...state,
          lastSequence: event.sequence,
          seenEventIds: nextSeen,
          serverSyncLost: true,
          awaitingSnapshot: false,
          soapStatus: "error",
          hasUnappliedTranscript: true,
          soapStatusMessage:
            "サーバー側の会話状態を復元できないため、現在の表示を保持し自動更新を停止しています。",
        };
      }

      return {
        ...state,
        segments: event.segments,
        soap: event.soap,
        soapStatus: event.soap_status,
        hasUnappliedTranscript: event.has_unapplied_transcript,
        soapStatusMessage: null,
        lastSequence: event.sequence,
        seenEventIds: nextSeen,
        serverSyncLost: false,
        awaitingSnapshot: false,
      };
    }

    case "TranscriptUpdated":
      return {
        ...state,
        segments: upsertSegment(state.segments, event.segment, Boolean(event.removed)),
        lastSequence: event.sequence,
        seenEventIds: nextSeen,
      };

    case "SoapStatus":
      return {
        ...state,
        soapStatus: event.status,
        hasUnappliedTranscript: event.has_unapplied_transcript,
        soapStatusMessage: event.message ?? null,
        lastSequence: event.sequence,
        seenEventIds: nextSeen,
      };

    case "SoapUpdated": {
      if (event.soap.revision < state.soap.revision) {
        return {
          ...state,
          lastSequence: event.sequence,
          seenEventIds: nextSeen,
        };
      }
      return {
        ...state,
        soap: event.soap,
        changedItemIds: event.changed_item_ids,
        lastSequence: event.sequence,
        seenEventIds: nextSeen,
      };
    }

    case "ConversationCompleted":
      return {
        ...state,
        completedReason: event.reason,
        hasUnappliedTranscript: event.has_unapplied_transcript,
        soapStatusMessage: event.message ?? state.soapStatusMessage,
        soapStatus:
          state.soapStatus === "disabled"
            ? "disabled"
            : event.has_unapplied_transcript && state.soapStatus === "error"
              ? "error"
              : "ready",
        lastSequence: event.sequence,
        seenEventIds: nextSeen,
      };
  }
}

const KNOWN_EVENT_TYPES = new Set([
  "TranscriptUpdated",
  "SoapStatus",
  "SoapUpdated",
  "ConversationSnapshot",
  "ConversationCompleted",
]);

/**
 * WebSocket 生 JSON からバージョン付き会話イベントを安全に抽出する。
 */
export function parseConversationWsEvent(rawData: string): ConversationWsEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { type?: unknown }).type !== "string" ||
    !KNOWN_EVENT_TYPES.has((parsed as { type: string }).type)
  ) {
    return null;
  }

  const candidate = parsed as Partial<ConversationWsEvent>;
  if (
    typeof candidate.protocol_version !== "number" ||
    typeof candidate.conversation_id !== "string" ||
    typeof candidate.event_id !== "string" ||
    typeof candidate.sequence !== "number"
  ) {
    return null;
  }

  return candidate as ConversationWsEvent;
}
