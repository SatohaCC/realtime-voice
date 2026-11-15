"use client";

import * as stylex from "@stylexjs/stylex";
import { Button as UiButton } from "@ui-sdk/react/button";
import type { ComponentProps } from "react";
import { iconButtonStyles as s } from "./IconButton.styles";

export type IconButtonVariant = "standard" | "filled" | "tonal" | "outlined";

export interface IconButtonProps
  extends Omit<ComponentProps<typeof UiButton>, "className" | "style" | "aria-label"> {
  /** スクリーンリーダー向けの必須ラベル */
  "aria-label": string;
  /** M3 IconButton バリアント */
  variant?: IconButtonVariant;
  /** サイズバリアント */
  size?: "sm" | "md";
  /** トグル状態（指定時は aria-pressed を設定） */
  pressed?: boolean;
  /** 追加の StyleX スタイル */
  style?: stylex.StyleXStyles;
}

/**
 * M3 準拠の円形アイコンボタン。
 */
export function IconButton({
  variant = "standard",
  size = "md",
  pressed,
  style,
  type = "button",
  disabled,
  ...props
}: IconButtonProps) {
  return (
    <UiButton
      type={type}
      disabled={disabled}
      aria-pressed={pressed}
      {...stylex.props(
        s.base,
        s[size],
        s[variant],
        pressed && variant === "standard" && s.pressedStandard,
        disabled && s.disabled,
        disabled && (variant === "filled" || variant === "tonal") && s.disabledContainer,
        disabled && variant === "outlined" && s.disabledOutline,
        style,
      )}
      {...props}
    />
  );
}
