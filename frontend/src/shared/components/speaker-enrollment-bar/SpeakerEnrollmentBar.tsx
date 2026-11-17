"use client";

import * as stylex from "@stylexjs/stylex";
import type { BadgeProps } from "@/shared/ui";
import { Badge, Banner, Button, Progress } from "@/shared/ui";
import { speakerEnrollmentBarStyles as s } from "./SpeakerEnrollmentBar.styles";

export interface SpeakerEnrollmentBarProps {
  title: string;
  badgeText: string;
  badgeTone: NonNullable<BadgeProps["tone"]>;
  descriptionText?: string;
  actionLabel: string;
  cancelLabel?: string;
  clearLabel?: string;
  isEnrolling: boolean;
  canEnroll: boolean;
  canClear: boolean;
  progressRatio?: number;
  progressLabel?: string;
  warningMessages?: readonly string[];
  errorMessage?: string | null;
  onEnroll: () => void;
  onCancel?: () => void;
  onClear?: () => void;
}

/**
 * 事前声紋の登録状態・録音進捗・再登録／削除操作を表示する汎用バー。
 */
export function SpeakerEnrollmentBar({
  title,
  badgeText,
  badgeTone,
  descriptionText,
  actionLabel,
  cancelLabel,
  clearLabel,
  isEnrolling,
  canEnroll,
  canClear,
  progressRatio = 0,
  progressLabel,
  warningMessages = [],
  errorMessage,
  onEnroll,
  onCancel,
  onClear,
}: SpeakerEnrollmentBarProps) {
  const clampedPercent = Math.round(Math.max(0, Math.min(1, progressRatio)) * 100);

  return (
    <section aria-label={title} {...stylex.props(s.root)}>
      <div {...stylex.props(s.mainRow)}>
        <div {...stylex.props(s.infoGroup)}>
          <h4 {...stylex.props(s.title)}>{title}</h4>
          <Badge tone={badgeTone}>{badgeText}</Badge>
          {descriptionText ? <span {...stylex.props(s.description)}>{descriptionText}</span> : null}
        </div>

        <div {...stylex.props(s.actionsGroup)}>
          {isEnrolling && onCancel && cancelLabel ? (
            <Button variant="outlined" size="sm" onClick={onCancel}>
              {cancelLabel}
            </Button>
          ) : (
            <Button variant="outlined" size="sm" onClick={onEnroll} disabled={!canEnroll}>
              {actionLabel}
            </Button>
          )}
          {canClear && onClear && clearLabel ? (
            <Button variant="outlined" size="sm" onClick={onClear} disabled={isEnrolling}>
              {clearLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {isEnrolling ? (
        <Progress
          label={title}
          hideLabel
          value={clampedPercent}
          showValue={Boolean(progressLabel)}
          valueText={progressLabel}
          layout="inline"
          size="sm"
        />
      ) : null}

      {warningMessages.length > 0 ? (
        <Banner tone="info" size="sm">
          {warningMessages.join(" ")}
        </Banner>
      ) : null}

      {errorMessage ? (
        <Banner tone="danger" size="sm" role="alert">
          {errorMessage}
        </Banner>
      ) : null}
    </section>
  );
}
