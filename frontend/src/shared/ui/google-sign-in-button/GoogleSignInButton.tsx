"use client";

import * as stylex from "@stylexjs/stylex";
import { Button } from "../button";
import { googleSignInButtonStyles as s } from "./GoogleSignInButton.styles";

export interface GoogleSignInButtonProps {
  label: string;
  logoSrc: string;
  disabled?: boolean;
  onClick: () => void;
}

/** Google公式のLightテーマとカラーGロゴで表示する認証ボタン。 */
export function GoogleSignInButton({ label, logoSrc, disabled, onClick }: GoogleSignInButtonProps) {
  return (
    <Button variant="outlined" disabled={disabled} onClick={onClick} style={s.button}>
      {/* biome-ignore lint/performance/noImgElement: 移植可能な共有UIでNext.jsへ依存せず、公式ロゴを固定寸法で表示する。 */}
      <img src={logoSrc} alt="" width={20} height={20} {...stylex.props(s.logo)} />
      <span {...stylex.props(s.label)}>{label}</span>
    </Button>
  );
}
