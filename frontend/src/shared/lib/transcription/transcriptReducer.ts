import type { DeepgramTranscriptEvent } from "./deepgramClient";

export type TranscriptStatus = "interim" | "final" | "refined";

export interface TranscriptSegment {
  id: string;
  channelIndex: 0 | 1;
  speakerLabel: string;
  text: string;
  status: TranscriptStatus;
  startSec: number;
  endSec: number;
  confidence: number;
  disabled?: boolean;
}

export interface TranscriptFeedState {
  segments: readonly TranscriptSegment[];
  /** チャンネルごとに現在更新中の interim セグメント ID */
  activeInterimIds: Record<0 | 1, string | null>;
  nextSequence: number;
  sessionStartIndex: number;
}

export function createInitialTranscriptState(): TranscriptFeedState {
  return {
    segments: [],
    activeInterimIds: { 0: null, 1: null },
    nextSequence: 1,
    sessionStartIndex: 0,
  };
}

export function startTranscriptSession(state: TranscriptFeedState): TranscriptFeedState {
  return {
    ...state,
    activeInterimIds: { 0: null, 1: null },
    sessionStartIndex: state.segments.length,
  };
}

/**
 * 2マイク環境での回り込みによる二重確定を簡易的に判定する。
 * 同時刻帯に別チャンネルで同一の確定テキストがあり、
 * 発話区間の RMS に十分な音量差がある場合だけ重複とみなす。
 */
export function isCrosstalkDuplicate(
  segments: readonly TranscriptSegment[],
  event: DeepgramTranscriptEvent,
  recentChannelLevels: readonly [number, number],
  dominanceRatio = 1.35,
): boolean {
  if (!event.isFinal) return false;

  const selfLevel = recentChannelLevels[event.channelIndex];
  const otherIndex: 0 | 1 = event.channelIndex === 0 ? 1 : 0;
  const otherLevel = recentChannelLevels[otherIndex];

  if (otherLevel < 0.025 || otherLevel <= selfLevel * dominanceRatio) {
    return false;
  }

  const normalized = event.text.replace(/\s+/g, "");
  if (!normalized) return false;

  return segments.some((segment) => {
    if (segment.channelIndex !== otherIndex || segment.status === "interim") {
      return false;
    }
    const timeOverlap =
      Math.min(segment.endSec, event.endSec) > Math.max(segment.startSec, event.startSec);
    if (!timeOverlap) return false;

    const otherText = segment.text.replace(/\s+/g, "");
    return otherText === normalized;
  });
}

/**
 * Deepgram の受信イベントをトランスクリプト状態へ反映する純粋関数。
 */
export function applyDeepgramTranscriptEvent(
  state: TranscriptFeedState,
  event: DeepgramTranscriptEvent,
  speakerLabels: Record<0 | 1, string>,
  recentChannelLevels: readonly [number, number] = [0, 0],
): TranscriptFeedState {
  const channel = event.channelIndex;
  const currentInterimId = state.activeInterimIds[channel];

  if (
    event.isFinal &&
    isCrosstalkDuplicate(state.segments.slice(state.sessionStartIndex), event, recentChannelLevels)
  ) {
    if (!currentInterimId) {
      return state;
    }
    return {
      ...state,
      segments: state.segments.filter((segment) => segment.id !== currentInterimId),
      activeInterimIds: { ...state.activeInterimIds, [channel]: null },
    };
  }

  const nextStatus: TranscriptStatus = event.isFinal ? "final" : "interim";

  if (currentInterimId) {
    const updatedSegments = state.segments.map((segment) =>
      segment.id === currentInterimId
        ? {
            ...segment,
            text: event.text,
            status: nextStatus,
            startSec: event.startSec,
            endSec: event.endSec,
            confidence: event.confidence,
          }
        : segment,
    );

    return {
      ...state,
      segments: updatedSegments,
      activeInterimIds: {
        ...state.activeInterimIds,
        [channel]: event.isFinal ? null : currentInterimId,
      },
    };
  }

  const id = `seg-${state.nextSequence}`;
  const created: TranscriptSegment = {
    id,
    channelIndex: channel,
    speakerLabel: speakerLabels[channel],
    text: event.text,
    status: nextStatus,
    startSec: event.startSec,
    endSec: event.endSec,
    confidence: event.confidence,
  };

  return {
    ...state,
    segments: [...state.segments, created],
    activeInterimIds: {
      ...state.activeInterimIds,
      [channel]: event.isFinal ? null : id,
    },
    nextSequence: state.nextSequence + 1,
  };
}

/**
 * 1マイク表示などで重複・不要な確定発話をローカル配列から削除する。
 */
export function setTranscriptSegmentEnabled(
  state: TranscriptFeedState,
  segmentId: string,
  enabled: boolean,
): TranscriptFeedState {
  return {
    ...state,
    segments: state.segments.map((segment) =>
      segment.id === segmentId ? { ...segment, disabled: !enabled } : segment,
    ),
  };
}
