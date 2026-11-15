export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

const ALLOWED_REDIRECT_PATHS = new Set(["/", "/transcription"]);

/**
 * Supabase の公開設定（URL と Publishable Key）を取得する。未設定時は null を返す。
 */
export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  if (!url || !publishableKey) {
    return null;
  }
  return { url, publishableKey };
}

/**
 * URL 文字列を `scheme://host` 形式の Origin へ正規化する。
 */
export function normalizeHttpOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * OAuth やログアウト後の戻り先に使う信頼済み Origin を解決する（任意の Host ヘッダーは信用しない）。
 */
export function resolveTrustedAppOrigin(requestUrl: string): string {
  const configured = normalizeHttpOrigin(process.env.APP_PUBLIC_URL);
  if (configured) {
    return configured;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    const fromVercel = normalizeHttpOrigin(
      vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`,
    );
    if (fromVercel) {
      return fromVercel;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const parsed = normalizeHttpOrigin(requestUrl);
    if (
      parsed &&
      (parsed.startsWith("http://localhost:") ||
        parsed === "http://localhost" ||
        parsed.startsWith("http://127.0.0.1:") ||
        parsed === "http://127.0.0.1")
    ) {
      return parsed;
    }
    return "http://localhost:3000";
  }

  throw new Error("APP_PUBLIC_URL が設定されていないため、信頼済み Origin を解決できません。");
}

/**
 * 許可されたアプリ内パスのみを戻り先として受け入れ、オープンリダイレクトを拒否する。
 */
export function sanitizeRedirectPath(
  nextPath: string | null | undefined,
  fallback = "/transcription",
): string {
  if (!nextPath) {
    return fallback;
  }

  const trimmed = nextPath.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return fallback;
    }
    if (!ALLOWED_REDIRECT_PATHS.has(parsed.pathname)) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * JWT クレームが有効な認証済みユーザー（非匿名）のものかを判定する。
 */
export function extractAuthenticatedUserFromClaims(
  claims: Record<string, unknown> | null | undefined,
): { userId: string; email: string | null } | null {
  if (!claims) return null;

  const sub = typeof claims.sub === "string" ? claims.sub.trim() : "";
  const role = claims.role;
  const isAnonymous = claims.is_anonymous === true;

  if (!sub || role !== "authenticated" || isAnonymous) {
    return null;
  }

  const rawEmail = typeof claims.email === "string" ? claims.email.trim() : "";
  return {
    userId: sub,
    email: rawEmail || null,
  };
}
