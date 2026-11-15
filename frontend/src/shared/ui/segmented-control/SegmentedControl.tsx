"use client";

import * as stylex from "@stylexjs/stylex";
import {
  SegmentedControlIndicator,
  SegmentedControlItem,
  SegmentedControl as UiSegmentedControl,
} from "@ui-sdk/react/segmented-control";
import type { ComponentProps, ReactNode } from "react";
import { segmentedControlStyles as s } from "./SegmentedControl.styles";

export interface SegmentedControlOption<T extends string = string> {
  /** 選択時の値 */
  value: T;
  /** 表示ラベル */
  label: string;
  /** ラベル横に添える任意アイコン */
  icon?: ReactNode;
  /** 個別選択肢の無効化 */
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  /** 選択肢一覧（M3 Single-select segmented button の範囲として 2〜5 項目を想定） */
  items: readonly SegmentedControlOption<T>[];
  /** スクリーンリーダー向けのグループ名 */
  "aria-label": string;
  /** 制御された選択値 */
  value?: T | null;
  /** 非制御時の初期選択値 */
  defaultValue?: T | null;
  /** 選択変更ハンドラ */
  onValueChange?: (value: T) => void;
  /** サイズバリアント */
  size?: "sm" | "md";
  /** グループ全体の無効化 */
  disabled?: boolean;
  /** 選択中の項目に M3 仕様のチェックアイコンを表示するか */
  showCheckIcon?: boolean;
  /** 呼び出し側のレイアウト調整用スタイル */
  style?: stylex.StyleXStyles;
}

/**
 * 排他選択（ラジオグループ相当の ARIA/キーボード契約）を持つ M3 SegmentedControl。
 */
export function SegmentedControl<T extends string = string>({
  items,
  "aria-label": ariaLabel,
  value,
  defaultValue,
  onValueChange,
  size = "md",
  disabled = false,
  showCheckIcon = true,
  style,
}: SegmentedControlProps<T>) {
  const handleValueChange: ComponentProps<typeof UiSegmentedControl<T>>["onValueChange"] = (
    nextValue,
  ) => {
    if (nextValue != null) {
      onValueChange?.(nextValue);
    }
  };

  return (
    <UiSegmentedControl<T>
      aria-label={ariaLabel}
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      onValueChange={handleValueChange}
      {...stylex.props(s.root, disabled && s.rootDisabled, style)}
    >
      <SegmentedControlIndicator
        data-segmented-indicator=""
        aria-hidden="true"
        {...stylex.props(s.indicator, disabled && s.indicatorDisabled)}
      />
      {items.map((item) => (
        <SegmentedControlItem
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          className={({ checked, disabled: itemDisabled }) =>
            stylex.props(s.item, s[size], checked && s.itemChecked, itemDisabled && s.itemDisabled)
              .className
          }
        >
          {({ checked }) => (
            <>
              {showCheckIcon && checked ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  {...stylex.props(s.checkIcon)}
                >
                  <path d="M9.55 18 3.85 12.3l1.425-1.425L9.55 15.15l9.175-9.175L20.15 7.4z" />
                </svg>
              ) : (
                item.icon
              )}
              <span>{item.label}</span>
            </>
          )}
        </SegmentedControlItem>
      ))}
    </UiSegmentedControl>
  );
}
