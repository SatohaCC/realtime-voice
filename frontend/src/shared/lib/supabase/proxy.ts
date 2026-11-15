import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
  extractAuthenticatedUserFromClaims,
  getSupabasePublicConfig,
  sanitizeRedirectPath,
} from "./config";

export interface ProxySupabaseClientLike {
  auth: {
    getClaims: () => Promise<{
      data: { claims?: Record<string, unknown> } | null;
      error: unknown;
    }>;
  };
}

export type ProxyClientFactory = (
  url: string,
  publishableKey: string,
  handlers: {
    getAll: () => Array<{ name: string; value: string }>;
    setAll: (cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) => void;
  },
) => ProxySupabaseClientLike;

function applyNoStoreHeaders(response: NextResponse): void {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.append("Vary", "Cookie");
}

function copyCookies(from: NextResponse, to: NextResponse): void {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
}

const defaultProxyClientFactory: ProxyClientFactory = (url, publishableKey, handlers) =>
  createServerClient(url, publishableKey, {
    cookies: {
      getAll: handlers.getAll,
      setAll: handlers.setAll,
    },
  });

/**
 * Supabase セッションの Cookie 更新と保護ページのリダイレクト制御を行う。
 */
export async function handleAuthProxy(
  request: NextRequest,
  createClient: ProxyClientFactory = defaultProxyClientFactory,
): Promise<NextResponse> {
  let response = NextResponse.next({
    request,
  });

  const pathname = request.nextUrl.pathname;
  const isProtectedPath =
    pathname === "/transcription" ||
    pathname.startsWith("/transcription/") ||
    pathname === "/user" ||
    pathname.startsWith("/user/");
  const isLoginPath = pathname === "/login";
  const isAuthPath = pathname.startsWith("/auth/");

  const config = getSupabasePublicConfig();
  let isAuthenticated = false;

  if (config) {
    const supabase = createClient(config.url, config.publishableKey, {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({
          request,
        });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    });

    const { data, error } = await supabase.auth.getClaims();
    if (!error && extractAuthenticatedUserFromClaims(data?.claims)) {
      isAuthenticated = true;
    }
  }

  if (isProtectedPath && !isAuthenticated) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", sanitizeRedirectPath(`${pathname}${request.nextUrl.search}`));
    const redirectResponse = NextResponse.redirect(loginUrl);
    copyCookies(response, redirectResponse);
    applyNoStoreHeaders(redirectResponse);
    return redirectResponse;
  }

  if (isLoginPath && isAuthenticated) {
    const targetUrl = request.nextUrl.clone();
    const safeNext = sanitizeRedirectPath(request.nextUrl.searchParams.get("next"));
    const resolved = new URL(safeNext, targetUrl.origin);
    targetUrl.pathname = resolved.pathname;
    targetUrl.search = resolved.search;
    const redirectResponse = NextResponse.redirect(targetUrl);
    copyCookies(response, redirectResponse);
    applyNoStoreHeaders(redirectResponse);
    return redirectResponse;
  }

  if (isProtectedPath || isLoginPath || isAuthPath || isAuthenticated) {
    applyNoStoreHeaders(response);
  }

  return response;
}
