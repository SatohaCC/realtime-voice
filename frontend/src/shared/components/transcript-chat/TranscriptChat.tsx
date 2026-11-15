"use client";

import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, IconButton, Select } from "@/shared/ui";
import { transcriptChatStyles as s } from "./TranscriptChat.styles";

export type TranscriptSpeakerRole = "pharmacist" | "patient" | "unknown";

export interface TranscriptSpeakerOption {
  value: TranscriptSpeakerRole;
  label: string;
}

export interface TranscriptChatSegment {
  streamId: string;
  segmentId: string;
  channelIndex: 0 | 1;
  align?: "left" | "right";
  speakerRole?: TranscriptSpeakerRole;
  roleName: string;
  micLabel?: string;
  timeLabel: string;
  text: string;
  status: "interim" | "final" | "refined";
  statusLabel: string;
  disabled?: boolean;
}

export interface TranscriptChatProps {
  title: string;
  countLabel?: string;
  segments: readonly TranscriptChatSegment[];
  emptyMessage: string;
  scrollToBottomLabel: string;
  highlightedSegmentKey?: string | null;
  speakerOptions?: readonly TranscriptSpeakerOption[];
  getSpeakerSelectLabel?: (turn: { timeLabel: string; roleName: string }) => string;
  onChangeSegmentSpeaker?: (
    streamId: string,
    segmentId: string,
    speakerRole: TranscriptSpeakerRole,
  ) => void;
  getSegmentToggleLabel?: (segment: {
    timeLabel: string;
    text: string;
    disabled: boolean;
  }) => string;
  onSetSegmentEnabled?: (streamId: string, segmentId: string, enabled: boolean) => void;
  segmentActionsDisabled?: boolean;
}

interface GroupedTurn {
  turnKey: string;
  channelIndex: 0 | 1;
  align: "left" | "right";
  speakerRole?: TranscriptSpeakerRole;
  roleName: string;
  micLabel?: string;
  timeLabel: string;
  isInterim: boolean;
  statusLabel: string;
  items: readonly TranscriptChatSegment[];
}

/**
 * 同じ話者の連続した確定発話を表示上 1 つの吹き出しへまとめる（別話者や interim は分割）。
 */
export function groupTranscriptTurns(
  segments: readonly TranscriptChatSegment[],
): readonly GroupedTurn[] {
  const groups: GroupedTurn[] = [];
  for (const segment of segments) {
    const key = `${segment.streamId}:${segment.segmentId}`;
    const isInterim = segment.status === "interim";
    const align: "left" | "right" =
      segment.align ?? (segment.channelIndex === 0 ? "right" : "left");
    const last = groups.at(-1);
    if (
      last &&
      !isInterim &&
      !last.isInterim &&
      last.channelIndex === segment.channelIndex &&
      last.align === align &&
      last.speakerRole === segment.speakerRole &&
      last.roleName === segment.roleName
    ) {
      groups[groups.length - 1] = {
        ...last,
        items: [...last.items, segment],
      };
      continue;
    }
    groups.push({
      turnKey: key,
      channelIndex: segment.channelIndex,
      align,
      speakerRole: segment.speakerRole,
      roleName: segment.roleName,
      micLabel: segment.micLabel,
      timeLabel: segment.timeLabel,
      isInterim,
      statusLabel: segment.statusLabel,
      items: [segment],
    });
  }
  return groups;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 2話者固定配置のチャット形式リアルタイム文字起こしビュー。
 */
export function TranscriptChat({
  title,
  countLabel,
  segments,
  emptyMessage,
  scrollToBottomLabel,
  highlightedSegmentKey = null,
  speakerOptions,
  getSpeakerSelectLabel,
  onChangeSegmentSpeaker,
  getSegmentToggleLabel,
  onSetSegmentEnabled,
  segmentActionsDisabled = false,
}: TranscriptChatProps) {
  const scrollerRef = useRef<HTMLElement>(null);
  const segmentRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const isAtBottomRef = useRef(true);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);

  const turns = groupTranscriptTurns(segments);
  const lastSegment = segments.at(-1);
  const lastSignal = lastSegment
    ? `${segments.length}:${lastSegment.streamId}:${lastSegment.segmentId}:${lastSegment.text}`
    : "";

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
    isAtBottomRef.current = nearBottom;
    if (nearBottom) {
      setHasUnreadBelow(false);
    }
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !lastSignal) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setHasUnreadBelow(false);
    } else {
      setHasUnreadBelow(true);
    }
  }, [lastSignal]);

  useEffect(() => {
    if (!highlightedSegmentKey) return;
    const target = segmentRefs.current.get(highlightedSegmentKey);
    if (!target) return;
    isAtBottomRef.current = false;
    target.scrollIntoView?.({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [highlightedSegmentKey]);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    isAtBottomRef.current = true;
    setHasUnreadBelow(false);
    if (typeof el.scrollTo === "function") {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  return (
    <div {...stylex.props(s.root)}>
      <div data-pane-header {...stylex.props(s.header)}>
        <div {...stylex.props(s.titleGroup)}>
          <h2 {...stylex.props(s.title)}>{title}</h2>
          {countLabel ? <Badge tone="neutral">{countLabel}</Badge> : null}
        </div>
      </div>

      <div {...stylex.props(s.scrollerWrap)}>
        <section
          ref={scrollerRef}
          aria-label={title}
          tabIndex={turns.length > 0 ? 0 : undefined}
          onScroll={handleScroll}
          data-testid="transcript-chat-scroller"
          {...stylex.props(s.scroller)}
        >
          {turns.length === 0 ? (
            <p {...stylex.props(s.emptyState)}>{emptyMessage}</p>
          ) : (
            <ul aria-label={title} {...stylex.props(s.turnList)}>
              {turns.map((turn) => {
                const isRight = turn.align === "right";
                const isUnknown = turn.speakerRole === "unknown";
                const roleChipStyle = isUnknown
                  ? s.roleChipUnknown
                  : isRight
                    ? s.roleChipRight
                    : s.roleChipLeft;
                const bubbleAlignStyle = isUnknown
                  ? s.bubbleUnknown
                  : isRight
                    ? s.bubbleRight
                    : s.bubbleLeft;
                const canChangeSpeaker =
                  Boolean(onChangeSegmentSpeaker) &&
                  !turn.isInterim &&
                  Boolean(turn.speakerRole) &&
                  Boolean(speakerOptions && speakerOptions.length > 0);
                return (
                  <li
                    key={turn.turnKey}
                    data-align={turn.align}
                    data-speaker-role={turn.speakerRole}
                    {...stylex.props(s.turnRow, isRight ? s.turnRowRight : s.turnRowLeft)}
                  >
                    <div {...stylex.props(s.turnMeta)}>
                      {canChangeSpeaker && turn.speakerRole && speakerOptions ? (
                        <Select
                          size="sm"
                          hideLabel
                          label={
                            getSpeakerSelectLabel?.({
                              timeLabel: turn.timeLabel,
                              roleName: turn.roleName,
                            }) ?? `${turn.timeLabel} (${turn.roleName})`
                          }
                          options={speakerOptions}
                          value={turn.speakerRole}
                          disabled={segmentActionsDisabled}
                          onValueChange={(nextValue) => {
                            if (!nextValue || !onChangeSegmentSpeaker) return;
                            const nextRole = nextValue as TranscriptSpeakerRole;
                            for (const item of turn.items) {
                              onChangeSegmentSpeaker(item.streamId, item.segmentId, nextRole);
                            }
                          }}
                          triggerStyle={[s.roleSelectTrigger, roleChipStyle]}
                        />
                      ) : (
                        <span {...stylex.props(roleChipStyle)}>{turn.roleName}</span>
                      )}
                      {turn.micLabel ? (
                        <span {...stylex.props(s.micText)}>{turn.micLabel}</span>
                      ) : null}
                      <span {...stylex.props(s.timeText)}>{turn.timeLabel}</span>
                      {turn.isInterim ? <Badge tone="neutral">{turn.statusLabel}</Badge> : null}
                    </div>
                    <div
                      aria-live={turn.isInterim ? "off" : undefined}
                      {...stylex.props(
                        s.bubble,
                        bubbleAlignStyle,
                        turn.isInterim && s.bubbleInterim,
                      )}
                    >
                      <div {...stylex.props(s.segmentStack)}>
                        {turn.items.map((segment) => {
                          const segKey = `${segment.streamId}:${segment.segmentId}`;
                          const isHighlighted = highlightedSegmentKey === segKey;
                          const canSetSegmentEnabled =
                            Boolean(onSetSegmentEnabled) && segment.status !== "interim";
                          return (
                            <div key={segKey} {...stylex.props(s.segmentRow)}>
                              <span
                                ref={(node) => {
                                  if (node) {
                                    segmentRefs.current.set(segKey, node);
                                  } else {
                                    segmentRefs.current.delete(segKey);
                                  }
                                }}
                                data-segment-key={segKey}
                                data-disabled={segment.disabled ? "true" : undefined}
                                data-highlighted={isHighlighted ? "true" : undefined}
                                {...stylex.props(
                                  s.segmentText,
                                  segment.status === "interim" && s.segmentTextInterim,
                                  segment.disabled && s.segmentTextDisabled,
                                  isHighlighted && s.segmentTextHighlighted,
                                )}
                              >
                                {segment.disabled ? <s>{segment.text}</s> : segment.text}
                              </span>
                              {canSetSegmentEnabled && onSetSegmentEnabled ? (
                                <IconButton
                                  variant="standard"
                                  size="sm"
                                  disabled={segmentActionsDisabled}
                                  pressed={Boolean(segment.disabled)}
                                  aria-label={
                                    getSegmentToggleLabel?.({
                                      timeLabel: segment.timeLabel,
                                      text: segment.text,
                                      disabled: Boolean(segment.disabled),
                                    }) ?? `${segment.timeLabel} ${segment.text}`
                                  }
                                  onClick={() =>
                                    onSetSegmentEnabled(
                                      segment.streamId,
                                      segment.segmentId,
                                      Boolean(segment.disabled),
                                    )
                                  }
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d={
                                        segment.disabled
                                          ? "M3 10h11a6 6 0 0 1 0 12M3 10l6-6M3 10l6 6"
                                          : "M5 12h14"
                                      }
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </IconButton>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {hasUnreadBelow ? (
          <div {...stylex.props(s.jumpBannerWrap)}>
            <Button variant="filled" size="sm" onClick={scrollToBottom} style={s.jumpButton}>
              {scrollToBottomLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
