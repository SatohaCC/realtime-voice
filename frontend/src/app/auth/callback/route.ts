import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
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
 * OAuth コールバックの PKCE コードを Cookie セッションへ交換する Route Handler。
 */
export async function GET(request: NextRequest) {
  const trustedOrigin = resolveTrustedAppOrigin(request.url);
  const { searchParams } = request.nextUrl;
  const nextPath = sanitizeRedirectPath(searchParams.get("next"));

  const oauthError = searchParams.get("error");
  if (oauthError) {
    const loginUrl = new URL("/login", trustedOrigin);
    loginUrl.searchParams.set("error", "oauth_denied");
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
    loginUrl.searchParams.set("error", "auth_callback_failed");
    loginUrl.searchParams.set("next", nextPath);
    return createPrivateRedirect(loginUrl, pendingCookies);
  }

  return createPrivateRedirect(new URL(nextPath, trustedOrigin), pendingCookies);
}
