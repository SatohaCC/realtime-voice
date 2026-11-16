"use client";

import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { checkboxStyles as s } from "./Checkbox.styles";

export interface CheckboxProps {
  /** チェック状態 */
  checked: boolean;
  /** チェック状態変更時のコールバック */
  onChange: (checked: boolean) => void;
  /** 無効状態 */
  disabled?: boolean;
  /** ラベルテキスト */
  children: ReactNode;
  /** 追加の StyleX スタイル */
  style?: stylex.StyleXStyles;
}

/**
 * ラベルと一体化した M3 チェックボックス部品。
 */
export function Checkbox({ checked, onChange, disabled = false, children, style }: CheckboxProps) {
  return (
    <label {...stylex.props(s.label, disabled && s.labelDisabled, style)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        {...stylex.props(s.input)}
      />
      <span>{children}</span>
    </label>
  );
}
