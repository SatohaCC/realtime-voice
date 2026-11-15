export type SpeakerRole = "pharmacist" | "patient" | "unknown";
export type SoapSectionKey = "S" | "O" | "A" | "P";
export type SoapItemOrigin = "conversation" | "plan_inference";
export type SoapVerificationStatus = "reported" | "confirmed" | "draft_inference";
export type TranscriptStatus = "interim" | "final" | "refined";
export type SoapLifecycleStatus = "idle" | "pending" | "updating" | "ready" | "error" | "disabled";

export interface TranscriptSegment {
  stream_id: string;
  segment_id: string;
  segment_revision: number;
  transcript_revision: number;
  channel_index: 0 | 1;
  speaker_role: SpeakerRole;
  speaker_label: string;
  text: string;
  status: TranscriptStatus;
  start_sec: number;
  end_sec: number;
  confidence: number;
  speech_final?: boolean;
}

export interface SoapEvidence {
  stream_id: string;
  segment_id: string;
  segment_revision: number;
  quote: string;
  speaker_role: SpeakerRole;
}

export interface PlanItemRef {
  item_id: string;
  item_revision: number;
}

export interface SoapItem {
  item_id: string;
  item_revision: number;
  text: string;
  evidence: readonly SoapEvidence[];
  origin: SoapItemOrigin;
  derived_from_plan_items: readonly PlanItemRef[];
  stale_after_plan_update: boolean;
  verification_status: SoapVerificationStatus;
}

export interface SoapSection {
  revision: number;
  items: readonly SoapItem[];
}

export interface SoapAssessmentSection extends SoapSection {
  derived_from_plan_revision: number | null;
}

export interface SoapNote {
  soap_id: string;
  conversation_id: string;
  revision: number;
  processed_transcript_revision: number;
  sections: {
    S: SoapSection;
    O: SoapSection;
    A: SoapAssessmentSection;
    P: SoapSection;
  };
}

interface BaseConversationEvent {
  protocol_version: number;
  conversation_id: string;
  event_id: string;
  sequence: number;
}

export interface TranscriptUpdatedEvent extends BaseConversationEvent {
  type: "TranscriptUpdated";
  segment: TranscriptSegment;
  removed?: boolean;
}

export interface SoapStatusEvent extends BaseConversationEvent {
  type: "SoapStatus";
  status: SoapLifecycleStatus;
  has_unapplied_transcript: boolean;
  pending_from_transcript_revision: number | null;
  message?: string | null;
}

export interface SoapUpdatedEvent extends BaseConversationEvent {
  type: "SoapUpdated";
  soap: SoapNote;
  changed_item_ids: readonly string[];
  retracted_item_ids: readonly string[];
}

export interface ConversationSnapshotEvent extends BaseConversationEvent {
  type: "ConversationSnapshot";
  segments: readonly TranscriptSegment[];
  soap: SoapNote;
  soap_status: SoapLifecycleStatus;
  has_unapplied_transcript: boolean;
}

export interface ConversationCompletedEvent extends BaseConversationEvent {
  type: "ConversationCompleted";
  reason: "stopped" | "session_limit" | "auth_expired" | "upstream_closed";
  final_transcript_revision: number;
  soap_revision: number;
  has_unapplied_transcript: boolean;
  message?: string | null;
}

export type ConversationWsEvent =
  | TranscriptUpdatedEvent
  | SoapStatusEvent
  | SoapUpdatedEvent
  | ConversationSnapshotEvent
  | ConversationCompletedEvent;
