"use client";

import * as stylex from "@stylexjs/stylex";
import {
  type GaugeLabelDetails,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
  Progress as UiProgress,
} from "@ui-sdk/react/progress";
import { progressStyles as s } from "./Progress.styles";

export interface ProgressProps {
  /** 表示ラベル */
  label: string;
  /** 現在値（null の場合は不確定状態として表示） */
  value: number | null;
  /** 最小値（既定 0） */
  min?: number;
  /** 最大値（既定 100） */
  max?: number;
  /** ラベルを視覚的に隠すか（スクリーンリーダーには読み上げられる） */
  hideLabel?: boolean;
  /** 値テキストを表示するか */
  showValue?: boolean;
  /** 自動フォーマット値の代わりに表示するテキスト */
  valueText?: string;
  /** ラベルと数値の配置 */
  layout?: "stacked" | "inline";
  /** バーの高さバリアント */
  size?: "sm" | "md";
  /** スクリーンリーダー向けのカスタムラベル */
  "aria-label"?: string;
  /** 数値表示のフォーマット */
  format?: Intl.NumberFormatOptions | ((value: number) => string);
  /** スクリーンリーダー向けの読み上げテキスト生成 */
  getValueLabel?: (value: number | null, details: GaugeLabelDetails<number | null>) => string;
  /** 追加の StyleX スタイル */
  style?: stylex.StyleXStyles;
}

/**
 * 録音・処理などの進捗状態（確定／不確定）を表示する M3 Progress バー。
 */
export function Progress({
  label,
  value,
  min = 0,
  max = 100,
  hideLabel = false,
  showValue = false,
  valueText,
  layout = "stacked",
  size = "md",
  "aria-label": ariaLabel,
  format,
  getValueLabel,
  style,
}: ProgressProps) {
  const isIndeterminate = value === null;
  const hasExplicitAriaLabel = Boolean(ariaLabel);
  const isInline = layout === "inline";
  const showHeader = !isInline && (!hideLabel || showValue);

  const valueNode = showValue ? (
    <ProgressValue {...stylex.props(s.value)}>{valueText}</ProgressValue>
  ) : null;

  return (
    <UiProgress
      value={value}
      min={min}
      max={max}
      format={format}
      getValueLabel={getValueLabel}
      aria-label={ariaLabel}
      {...stylex.props(s.root, isInline && s.rootInline, style)}
    >
      {!hasExplicitAriaLabel && (hideLabel || isInline) ? (
        <ProgressLabel {...stylex.props(hideLabel ? s.labelHidden : s.label)}>
          {label}
        </ProgressLabel>
      ) : null}

      {showHeader ? (
        <div {...stylex.props(s.header)}>
          {!hideLabel ? (
            hasExplicitAriaLabel ? (
              <span aria-hidden="true" {...stylex.props(s.label)}>
                {label}
              </span>
            ) : (
              <ProgressLabel {...stylex.props(s.label)}>{label}</ProgressLabel>
            )
          ) : null}
          {valueNode}
        </div>
      ) : null}

      <ProgressTrack {...stylex.props(s.track, size === "sm" ? s.trackSm : s.trackMd)}>
        <ProgressIndicator
          {...stylex.props(s.indicator, isIndeterminate && s.indicatorIndeterminate)}
        />
      </ProgressTrack>

      {isInline ? valueNode : null}
    </UiProgress>
  );
}
