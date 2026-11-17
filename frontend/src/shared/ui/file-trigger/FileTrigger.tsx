"use client";

import * as stylex from "@stylexjs/stylex";
import type { ChangeEvent } from "react";
import { useRef } from "react";
import type { ButtonVariant } from "../button";
import { Button } from "../button";
import { fileTriggerStyles as s } from "./FileTrigger.styles";

export interface FileTriggerProps {
  /** トリガーボタンおよび file input のアクセシブルラベル */
  label: string;
  /** 受け入れるファイル拡張子または MIME タイプ */
  accept?: string;
  /** 無効状態 */
  disabled?: boolean;
  /** ボタンバリアント */
  variant?: ButtonVariant;
  /** ファイル選択時のコールバック */
  onSelectFile: (file: File | null) => void;
  /** 追加の StyleX スタイル */
  style?: stylex.StyleXStyles;
}

/**
 * 隠し file input と M3 Button を連携させたファイル選択部品。
 */
export function FileTrigger({
  label,
  accept,
  disabled = false,
  variant = "outlined",
  onSelectFile,
  style,
}: FileTriggerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    onSelectFile(file);
  };

  return (
    <div {...stylex.props(s.root, style)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        aria-label={label}
        onChange={handleChange}
        {...stylex.props(s.visuallyHiddenInput)}
      />
      <Button variant={variant} disabled={disabled} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
    </div>
  );
}
