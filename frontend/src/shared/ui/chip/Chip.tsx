"use client";

import * as stylex from "@stylexjs/stylex";
import { Button as UiButton } from "@ui-sdk/react/button";
import type { ComponentProps } from "react";
import { chipStyles as s } from "./Chip.styles";

export interface ChipProps extends Omit<ComponentProps<typeof UiButton>, "className" | "style"> {
  /** フィルタ等で選択中状態を表すか（指定時は aria-pressed を付与） */
  selected?: boolean;
  /** 追加の StyleX スタイル */
  style?: stylex.StyleXStyles;
}

/**
 * 選択候補やフィルタ操作に使う M3 チップ部品。
 */
export function Chip({
  selected,
  disabled,
  type = "button",
  style,
  children,
  ...props
}: ChipProps) {
  return (
    <UiButton
      type={type}
      disabled={disabled}
      aria-pressed={selected !== undefined ? selected : undefined}
      {...stylex.props(s.base, selected && s.selected, disabled && s.disabled, style)}
      {...props}
    >
      {children}
    </UiButton>
  );
}
