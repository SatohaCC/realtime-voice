import * as stylex from "@stylexjs/stylex";
import { Badge, type BadgeProps } from "@/shared/ui/badge/Badge";
import { Button } from "@/shared/ui/button/Button";
import { Card } from "@/shared/ui/card/Card";
import { statusCardStyles } from "./StatusCard.styles";

export interface StatusCardProps {
  label: string;
  badgeText: string;
  badgeTone: NonNullable<BadgeProps["tone"]>;
  actionLabel: string;
  isActionDisabled?: boolean;
  onAction: () => void;
}

export function StatusCard({
  label,
  badgeText,
  badgeTone,
  actionLabel,
  isActionDisabled = false,
  onAction,
}: StatusCardProps) {
  return (
    <Card style={statusCardStyles.root}>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={isActionDisabled}
        {...stylex.props(statusCardStyles.row)}
      >
        <span {...stylex.props(statusCardStyles.label)}>{label}</span>
        <Badge tone={badgeTone}>{badgeText}</Badge>
      </div>
      <div>
        <Button onClick={onAction} disabled={isActionDisabled}>
          {actionLabel}
        </Button>
      </div>
    </Card>
  );
}
