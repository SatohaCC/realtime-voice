"use client";

import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import { Badge } from "@/shared/ui/badge/Badge";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/Card";
import { transcriptFeedStyles as s } from "./TranscriptFeed.styles";

export interface TranscriptFeedItem {
  id: string;
  channelIndex: 0 | 1;
  speakerLabel: string;
  text: string;
  status: "interim" | "final" | "refined";
  statusLabel: string;
  timeLabel: string;
}

export interface TranscriptFeedProps {
  title: string;
  countLabel?: string;
  segments: readonly TranscriptFeedItem[];
  emptyMessage: string;
  clearLabel: string;
  canClear: boolean;
  onClear: () => void;
}

/**
 * 話者別・ステータス別にリアルタイム文字起こし結果を表示するタイムライン。
 */
export function TranscriptFeed({
  title,
  countLabel,
  segments,
  emptyMessage,
  clearLabel,
  canClear,
  onClear,
}: TranscriptFeedProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const lastSegment = segments.at(-1);
  const scrollSignal = lastSegment ? `${segments.length}:${lastSegment.text}` : "";

  useEffect(() => {
    const list = listRef.current;
    if (!list || !scrollSignal) return;
    list.scrollTop = list.scrollHeight;
  }, [scrollSignal]);

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.header)}>
        <div {...stylex.props(s.titleGroup)}>
          <h3 {...stylex.props(s.title)}>{title}</h3>
          {countLabel ? <Badge tone="neutral">{countLabel}</Badge> : null}
        </div>

        <Button variant="text" size="sm" onClick={onClear} disabled={!canClear}>
          {clearLabel}
        </Button>
      </div>

      {segments.length === 0 ? (
        <p {...stylex.props(s.empty)}>{emptyMessage}</p>
      ) : (
        <ul ref={listRef} aria-label={title} {...stylex.props(s.list)}>
          {segments.map((segment) => {
            const isInterim = segment.status === "interim";
            const badgeTone =
              segment.status === "refined"
                ? "success"
                : segment.status === "final"
                  ? "neutral"
                  : "neutral";

            return (
              <Card
                as="li"
                key={segment.id}
                variant="outlined"
                style={[s.item, isInterim && s.itemInterim]}
              >
                <div {...stylex.props(s.itemMeta)}>
                  <div {...stylex.props(s.speakerGroup)}>
                    <span
                      {...stylex.props(
                        s.speakerTag,
                        segment.channelIndex === 0 ? s.speakerPrimary : s.speakerSecondary,
                      )}
                    >
                      {segment.speakerLabel}
                    </span>
                    <Badge tone={badgeTone}>{segment.statusLabel}</Badge>
                  </div>
                  <span {...stylex.props(s.timeLabel)}>{segment.timeLabel}</span>
                </div>
                <p {...stylex.props(s.text, isInterim && s.textInterim)}>{segment.text}</p>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
