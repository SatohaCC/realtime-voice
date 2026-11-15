import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { extractAuthenticatedUserFromClaims, getSupabasePublicConfig } from "./config";

export interface ServerAuthUser {
  userId: string;
  email: string | null;
}

/**
 * Next.js Server Component / Route Handler 用の Supabase クライアントを生成する。
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient | null> {
  const config = getSupabasePublicConfig();
  if (!config) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からの呼び出し時は Cookie 書き込みを Proxy 側へ委譲する
        }
      },
    },
  });
}

/**
 * サーバー側で JWT クレームを検証し、認証済みユーザーを返す。未認証時は null を返す。
 */
export async function getServerAuthUser(): Promise<ServerAuthUser | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    return null;
  }
  return extractAuthenticatedUserFromClaims(data?.claims as Record<string, unknown> | undefined);
}
