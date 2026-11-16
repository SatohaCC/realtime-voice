"use client";

import * as stylex from "@stylexjs/stylex";
import { Input as UiInput } from "@ui-sdk/react/input";
import type { ChangeEvent, ComponentProps } from "react";
import { textFieldStyles as s } from "./TextField.styles";

export interface TextFieldProps
  extends Omit<ComponentProps<typeof UiInput>, "className" | "style" | "onChange"> {
  /** 入力値変更時のコールバック */
  onChange?: (value: string) => void;
  /** 追加の StyleX スタイル */
  style?: stylex.StyleXStyles;
}

/**
 * 検索・テキスト入力向けの M3 テキストフィールド部品。
 */
export function TextField({ onChange, style, ...props }: TextFieldProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange?.(event.target.value);
  };

  return <UiInput onChange={handleChange} {...stylex.props(s.input, style)} {...props} />;
}
