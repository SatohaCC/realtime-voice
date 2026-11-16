"use client";

import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Fragment } from "react";
import { Banner, Button, Card } from "@/shared/ui";
import { loginCardStyles as s } from "./LoginCard.styles";

export interface LoginProviderOption {
  /** プロバイダ識別子 */
  id: string;
  /** 通常時のボタン表示ラベル */
  label: string;
  /** 認証開始中の表示ラベル */
  pendingLabel?: string;
}

export interface LoginCardProps {
  /** カード見出し */
  title: string;
  /** 説明文 */
  description: string;
  /** 表示する認証プロバイダ一覧 */
  providers: readonly LoginProviderOption[];
  /** 現在認証処理中のプロバイダ ID */
  pendingProviderId?: string | null;
  /** エラーメッセージ */
  errorMessage?: string | null;
  /** エラー時の再試行ボタンラベル */
  retryLabel?: string;
  /** プロバイダ選択時のコールバック */
  onSelectProvider: (providerId: string) => void;
  /** 再試行押下時のコールバック */
  onRetry?: () => void;
  /** 補足テキスト */
  footerNote?: string;
  /** ブランド規定のある認証ボタンを外から注入する。 */
  renderProviderButton?: (props: {
    provider: LoginProviderOption;
    disabled: boolean;
    isPending: boolean;
    onClick: () => void;
  }) => ReactNode;
}

/**
 * 外部 OAuth プロバイダによるログイン操作を提供する共有カードコンポーネント。
 */
export function LoginCard({
  title,
  description,
  providers,
  pendingProviderId = null,
  errorMessage = null,
  retryLabel,
  onSelectProvider,
  onRetry,
  footerNote,
  renderProviderButton,
}: LoginCardProps) {
  const isBusy = pendingProviderId !== null;

  return (
    <Card as="section" variant="outlined" aria-busy={isBusy} style={s.card}>
      <div {...stylex.props(s.header)}>
        <h1 {...stylex.props(s.title)}>{title}</h1>
        <p {...stylex.props(s.description)}>{description}</p>
      </div>

      {errorMessage ? (
        <Banner
          tone="danger"
          role="alert"
          style={s.errorBanner}
          actions={
            retryLabel && onRetry ? (
              <Button variant="outlined" size="sm" onClick={onRetry} disabled={isBusy}>
                {retryLabel}
              </Button>
            ) : undefined
          }
        >
          <p {...stylex.props(s.errorText)}>{errorMessage}</p>
        </Banner>
      ) : null}

      <div {...stylex.props(s.actions)}>
        {providers.map((provider, index) => {
          const isPending = pendingProviderId === provider.id;
          if (renderProviderButton) {
            return (
              <Fragment key={provider.id}>
                {renderProviderButton({
                  provider,
                  disabled: isBusy,
                  isPending,
                  onClick: () => onSelectProvider(provider.id),
                })}
              </Fragment>
            );
          }
          return (
            <Button
              key={provider.id}
              variant={index === 0 ? "filled" : "tonal"}
              disabled={isBusy}
              onClick={() => onSelectProvider(provider.id)}
              style={s.providerButton}
            >
              {isPending ? (provider.pendingLabel ?? provider.label) : provider.label}
            </Button>
          );
        })}
      </div>

      {footerNote ? <p {...stylex.props(s.footerNote)}>{footerNote}</p> : null}
    </Card>
  );
}
