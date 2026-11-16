import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getSupabasePublicConfig,
  normalizeHttpOrigin,
  resolveTrustedAppOrigin,
} from "@/shared/lib/supabase/config";

function isAllowedLogoutOrigin(originHeader: string | null, trustedOrigin: string): boolean {
  const normalized = normalizeHttpOrigin(originHeader);
  if (!normalized) {
    return false;
  }
  if (normalized === trustedOrigin) {
    return true;
  }
  if (process.env.NODE_ENV !== "production") {
    return normalized === "http://localhost:3000" || normalized === "http://127.0.0.1:3000";
  }
  return false;
}

/**
 * POST 経由で Origin を検査した上でログアウトし、セッション Cookie を破棄する。
 */
export async function POST(request: NextRequest) {
  const trustedOrigin = resolveTrustedAppOrigin(request.url);
  if (!isAllowedLogoutOrigin(request.headers.get("origin"), trustedOrigin)) {
    return NextResponse.json(
      { detail: "不正な送信元からのログアウト要求です。" },
      {
        status: 403,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  }

  const pendingCookies: Array<{ name: string; value: string; options?: CookieOptions }> = [];
  const config = getSupabasePublicConfig();

  if (config) {
    const supabase = createServerClient(config.url, config.publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          pendingCookies.push(...cookiesToSet);
        },
      },
    });

    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // リモート失効に失敗してもローカル Cookie 破棄を完了させる
    }
  }

  const response = NextResponse.redirect(new URL("/login", trustedOrigin), 303);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.append("Vary", "Cookie");
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  return response;
}
