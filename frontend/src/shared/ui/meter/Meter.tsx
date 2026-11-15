"use client";

import * as stylex from "@stylexjs/stylex";
import {
  MeterIndicator,
  MeterLabel,
  type MeterLabelDetails,
  MeterTrack,
  MeterValue,
  Meter as UiMeter,
} from "@ui-sdk/react/meter";
import { meterStyles as s } from "./Meter.styles";

export interface MeterProps {
  /** 表示ラベル */
  label: string;
  /** 現在値 */
  value: number;
  /** 最小値（既定 0） */
  min?: number;
  /** 最大値（既定 100） */
  max?: number;
  /** ラベルを視覚的に隠すか（スクリーンリーダーには読み上げられる） */
  hideLabel?: boolean;
  /** 整形済み数値を表示するか */
  showValue?: boolean;
  /** 塗り色のロール */
  tone?: "primary" | "tertiary";
  /** バーの高さバリアント */
  size?: "sm" | "md";
  /** スクリーンリーダー向けのカスタムラベル（指定時は表示ラベルと別に指定できる） */
  "aria-label"?: string;
  /** 数値表示のフォーマット */
  format?: Intl.NumberFormatOptions | ((value: number) => string);
  /** スクリーンリーダー向けの読み上げテキスト生成 */
  getValueLabel?: (value: number, details: MeterLabelDetails) => string;
  /** 追加の StyleX スタイル */
  style?: stylex.StyleXStyles;
}

/**
 * 音声レベルや使用量など、既知の範囲内の計測値を表示する M3 Meter バー。
 */
export function Meter({
  label,
  value,
  min = 0,
  max = 100,
  hideLabel = false,
  showValue = false,
  tone = "primary",
  size = "md",
  "aria-label": ariaLabel,
  format,
  getValueLabel,
  style,
}: MeterProps) {
  const hasExplicitAriaLabel = Boolean(ariaLabel);
  const showHeader = !hideLabel || showValue;

  return (
    <UiMeter
      value={value}
      min={min}
      max={max}
      format={format}
      getValueLabel={getValueLabel}
      aria-label={ariaLabel}
      {...stylex.props(s.root, style)}
    >
      {!hasExplicitAriaLabel && hideLabel ? (
        <MeterLabel {...stylex.props(s.labelHidden)}>{label}</MeterLabel>
      ) : null}

      {showHeader ? (
        <div {...stylex.props(s.header)}>
          {!hideLabel ? (
            hasExplicitAriaLabel ? (
              <span aria-hidden="true" {...stylex.props(s.label)}>
                {label}
              </span>
            ) : (
              <MeterLabel {...stylex.props(s.label)}>{label}</MeterLabel>
            )
          ) : null}
          {showValue ? <MeterValue {...stylex.props(s.value)} /> : null}
        </div>
      ) : null}

      <MeterTrack {...stylex.props(s.track, size === "sm" ? s.trackSm : s.trackMd)}>
        <MeterIndicator
          {...stylex.props(
            s.indicator,
            tone === "tertiary" ? s.indicatorTertiary : s.indicatorPrimary,
          )}
        />
      </MeterTrack>
    </UiMeter>
  );
}
