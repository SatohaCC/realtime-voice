"use client";

import { useCallback, useState } from "react";
import { LoginCard, type LoginProviderOption } from "@/shared/components";
import { type OAuthProviderName, signInWithOAuthProvider } from "@/shared/lib/supabase/client";
import { GoogleSignInButton } from "@/shared/ui";

const LOGIN_PROVIDERS: readonly LoginProviderOption[] = [
  { id: "google", label: "Google でログイン", pendingLabel: "Google へ移動中..." },
];

const ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: "認証がキャンセルされたか拒否されました。再度お試しください。",
  signup_disabled:
    "このアカウントは登録されていません。新規登録は制限されているため、管理者による招待が必要です。",
  missing_code: "認証コードが見つかりませんでした。もう一度ログインしてください。",
  auth_callback_failed: "ログイン処理の完了に失敗しました。時間をおいて再度お試しください。",
  auth_not_configured: "認証設定が構成されていません。管理者へお問い合わせください。",
};

export interface LoginContainerProps {
  /** URL クエリ等で渡された既知のエラーコード */
  initialErrorCode?: string | null;
  /** ログイン完了後の安全な遷移先パス */
  nextPath: string;
}

/**
 * OAuth ログイン操作とエラー・処理中状態を管理する Container。
 */
export function LoginContainer({ initialErrorCode = null, nextPath }: LoginContainerProps) {
  const [pendingProvider, setPendingProvider] = useState<OAuthProviderName | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    initialErrorCode && initialErrorCode in ERROR_MESSAGES
      ? ERROR_MESSAGES[initialErrorCode]
      : null,
  );

  const startSignIn = useCallback(
    async (providerId: string) => {
      if (providerId !== "google") {
        return;
      }
      setErrorMessage(null);
      setPendingProvider(providerId);
      try {
        await signInWithOAuthProvider(providerId, nextPath);
      } catch (error) {
        setPendingProvider(null);
        setErrorMessage(error instanceof Error ? error.message : "ログインの開始に失敗しました。");
      }
    },
    [nextPath],
  );

  const handleRetry = useCallback(() => {
    void startSignIn("google");
  }, [startSignIn]);

  return (
    <LoginCard
      title="ログイン"
      description="リアルタイム文字起こしを利用するには、招待済みの Google アカウントでログインしてください。"
      providers={LOGIN_PROVIDERS}
      pendingProviderId={pendingProvider}
      renderProviderButton={({ provider, disabled, isPending, onClick }) => (
        <GoogleSignInButton
          label={isPending ? (provider.pendingLabel ?? provider.label) : provider.label}
          logoSrc="/identity/google-g.png"
          disabled={disabled}
          onClick={onClick}
        />
      )}
      errorMessage={errorMessage}
      retryLabel="もう一度試す"
      onSelectProvider={(id) => {
        void startSignIn(id);
      }}
      onRetry={handleRetry}
      footerNote="新規登録は制限されています。認証完了後、元の画面へ自動的に戻ります。"
    />
  );
}
