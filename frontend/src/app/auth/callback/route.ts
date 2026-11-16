import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getSupabasePublicConfig,
  resolveTrustedAppOrigin,
  sanitizeRedirectPath,
} from "@/shared/lib/supabase/config";

function createPrivateRedirect(
  url: URL,
  cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }> = [],
): NextResponse {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.append("Vary", "Cookie");
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options);
  }
  return response;
}

/**
 * エラーコードやメッセージが新規サインアップ無効化による拒否かを判定する。
 */
function isSignupDisabledError(
  rawCode: string | null | undefined,
  rawMessage: string | null | undefined,
): boolean {
  const code = rawCode?.trim().toLowerCase() ?? "";
  if (code === "signup_disabled" || code === "user_not_found") {
    return true;
  }
  const message = rawMessage?.trim().toLowerCase() ?? "";
  return message.includes("signups not allowed");
}

/**
 * OAuth コールバックのクエリパラメータが新規サインアップ無効化による拒否かを判定する。
 */
function isSignupDisabledQuery(searchParams: URLSearchParams): boolean {
  return isSignupDisabledError(
    searchParams.get("error_code"),
    searchParams.get("error_description"),
  );
}

/**
 * コード交換時のエラーが新規サインアップ無効化による拒否かを判定する。
 */
function isSignupDisabledAuthError(error: { code?: string; message?: string }): boolean {
  return isSignupDisabledError(error.code, error.message);
}

/**
 * OAuth コールバックの PKCE コードを Cookie セッションへ交換する Route Handler。
 */
export async function GET(request: NextRequest) {
  const trustedOrigin = resolveTrustedAppOrigin(request.url);
  const { searchParams } = request.nextUrl;
  const nextPath = sanitizeRedirectPath(searchParams.get("next"));

  const oauthError = searchParams.get("error") ?? searchParams.get("error_code");
  if (oauthError) {
    const loginUrl = new URL("/login", trustedOrigin);
    loginUrl.searchParams.set(
      "error",
      isSignupDisabledQuery(searchParams) ? "signup_disabled" : "oauth_denied",
    );
    loginUrl.searchParams.set("next", nextPath);
    return createPrivateRedirect(loginUrl);
  }

  const code = searchParams.get("code")?.trim();
  if (!code) {
    const loginUrl = new URL("/login", trustedOrigin);
    loginUrl.searchParams.set("error", "missing_code");
    loginUrl.searchParams.set("next", nextPath);
    return createPrivateRedirect(loginUrl);
  }

  const config = getSupabasePublicConfig();
  if (!config) {
    const loginUrl = new URL("/login", trustedOrigin);
    loginUrl.searchParams.set("error", "auth_not_configured");
    return createPrivateRedirect(loginUrl);
  }

  const pendingCookies: Array<{ name: string; value: string; options?: CookieOptions }> = [];
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const loginUrl = new URL("/login", trustedOrigin);
    loginUrl.searchParams.set(
      "error",
      isSignupDisabledAuthError(error) ? "signup_disabled" : "auth_callback_failed",
    );
    loginUrl.searchParams.set("next", nextPath);
    return createPrivateRedirect(loginUrl, pendingCookies);
  }

  return createPrivateRedirect(new URL(nextPath, trustedOrigin), pendingCookies);
}
