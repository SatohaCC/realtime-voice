import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { bannerStyles as s } from "./Banner.styles";

export type BannerTone = "info" | "danger" | "success" | "neutral";

export interface BannerProps {
  /** バナーの意味ロール */
  tone?: BannerTone;
  /** 余白と文字サイズのバリアント */
  size?: "sm" | "md";
  /** ライブリージョン種別（未指定時は danger -> alert、info/success -> status） */
  role?: "status" | "alert";
  /** 再試行ボタン等のアクションスロット */
  actions?: ReactNode;
  /** 追加の StyleX スタイル */
  style?: stylex.StyleXStyles;
  /** 本文 */
  children: ReactNode;
}

/**
 * インラインの案内・警告・エラー・完了通知を表示する M3 バナー。
 */
export function Banner({
  tone = "info",
  size = "md",
  role,
  actions,
  style,
  children,
}: BannerProps) {
  const resolvedRole =
    role ??
    (tone === "danger" ? "alert" : tone === "info" || tone === "success" ? "status" : undefined);

  return (
    <div role={resolvedRole} {...stylex.props(s.root, s[size], s[tone], style)}>
      <div {...stylex.props(s.content)}>{children}</div>
      {actions ? <div {...stylex.props(s.actions)}>{actions}</div> : null}
    </div>
  );
}
