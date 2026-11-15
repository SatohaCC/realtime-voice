"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractAuthenticatedUserFromClaims,
  getSupabasePublicConfig,
  sanitizeRedirectPath,
} from "./config";

export type OAuthProviderName = "google";

let browserClient: SupabaseClient | null = null;

/**
 * ブラウザ用 Supabase クライアントを返す。公開環境変数が未設定なら null を返す。
 */
export function getBrowserSupabaseClient(): SupabaseClient | null {
  const config = getSupabasePublicConfig();
  if (!config) {
    return null;
  }
  if (!browserClient) {
    browserClient = createBrowserClient(config.url, config.publishableKey);
  }
  return browserClient;
}

/**
 * Google による OAuth (PKCE) ログインを開始する。
 */
export async function signInWithOAuthProvider(
  provider: OAuthProviderName,
  nextPath = "/transcription",
): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase の公開設定が構成されていません。");
  }

  const safeNext = sanitizeRedirectPath(nextPath);
  const redirectUrl = new URL("/auth/callback", window.location.origin);
  redirectUrl.searchParams.set("next", safeNext);

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: redirectUrl.toString(),
    },
  });

  if (error) {
    throw new Error(error.message || "ログインの開始に失敗しました。");
  }
}

/**
 * クレーム検証済みの現在セッションから WebSocket 認証用のアクセストークンを取得する。
 */
export async function getValidAccessToken(): Promise<string | null> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const user = extractAuthenticatedUserFromClaims(
    claimsData?.claims as Record<string, unknown> | undefined,
  );
  if (claimsError || !user) {
    return null;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    return null;
  }
  return sessionData.session.access_token;
}

/**
 * 現在のブラウザ側認証ユーザー識別子とメールを取得する。
 */
export async function getBrowserAuthUser(): Promise<{
  userId: string;
  email: string | null;
} | null> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    return null;
  }
  return extractAuthenticatedUserFromClaims(data?.claims as Record<string, unknown> | undefined);
}

/**
 * ブラウザ側のログアウトおよびユーザー切替イベントを購読する。
 */
export function subscribeAuthState(callbacks: {
  onSignedOut?: () => void;
  onUserChanged?: (user: { userId: string; email: string | null } | null) => void;
}): () => void {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    return () => {};
  }

  let previousUserId: string | null | undefined;

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    const nextUserId = session?.user?.id ?? null;
    const nextEmail = session?.user?.email ?? null;

    if (event === "SIGNED_OUT") {
      previousUserId = null;
      callbacks.onUserChanged?.(null);
      callbacks.onSignedOut?.();
      return;
    }

    if (previousUserId !== undefined && previousUserId !== nextUserId) {
      callbacks.onUserChanged?.(nextUserId ? { userId: nextUserId, email: nextEmail } : null);
    } else if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      callbacks.onUserChanged?.(nextUserId ? { userId: nextUserId, email: nextEmail } : null);
    }
    previousUserId = nextUserId;
  });

  return () => {
    subscription.unsubscribe();
  };
}

/**
 * クライアント側のローカルセッション状態を破棄する（サーバーログアウト前の補助）。
 */
export async function clearBrowserAuthSession(): Promise<void> {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    return;
  }
  await supabase.auth.signOut({ scope: "local" });
}
