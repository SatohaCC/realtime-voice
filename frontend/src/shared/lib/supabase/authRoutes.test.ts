import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractAuthenticatedUserFromClaims,
  resolveTrustedAppOrigin,
  sanitizeRedirectPath,
} from "./config";
import { handleAuthProxy } from "./proxy";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@supabase/ssr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...actual,
    createServerClient: vi.fn((_url, _key, options) => ({
      auth: {
        exchangeCodeForSession: async (code: string) => {
          const result = await mocks.exchangeCodeForSession(code);
          if (!result.error) {
            options.cookies.setAll([{ name: "sb-session", value: "new-cookie", options: {} }]);
          }
          return result;
        },
        signOut: async () => {
          const result = await mocks.signOut();
          options.cookies.setAll([{ name: "sb-session", value: "", options: { maxAge: 0 } }]);
          return result;
        },
      },
    })),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("supabase auth config helpers", () => {
  it("許可したアプリ内パスだけを返し、外部URLや迂回記法を拒否する", () => {
    expect(sanitizeRedirectPath("/transcription")).toBe("/transcription");
    expect(sanitizeRedirectPath("/transcription?mode=dual")).toBe("/transcription?mode=dual");
    expect(sanitizeRedirectPath("/user")).toBe("/user");
    expect(sanitizeRedirectPath("/")).toBe("/");
    expect(sanitizeRedirectPath("https://evil.example/phish")).toBe("/transcription");
    expect(sanitizeRedirectPath("//evil.example")).toBe("/transcription");
    expect(sanitizeRedirectPath("/\\evil.example")).toBe("/transcription");
    expect(sanitizeRedirectPath("/%2Fevil.example")).toBe("/transcription");
    expect(sanitizeRedirectPath("/admin")).toBe("/transcription");
  });

  it("任意 Host ヘッダーではなく設定された公開URLから Origin を決定する", () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://trusted.example.com/path");
    expect(resolveTrustedAppOrigin("https://evil-host.example/auth/callback")).toBe(
      "https://trusted.example.com",
    );
  });

  it("非匿名かつ role=authenticated のクレームだけを受け入れる", () => {
    expect(
      extractAuthenticatedUserFromClaims({
        sub: "user-1",
        role: "authenticated",
        email: "a@example.com",
      }),
    ).toEqual({ userId: "user-1", email: "a@example.com" });
    expect(extractAuthenticatedUserFromClaims({ sub: "user-1", role: "anon" })).toBeNull();
    expect(
      extractAuthenticatedUserFromClaims({
        sub: "user-1",
        role: "authenticated",
        is_anonymous: true,
      }),
    ).toBeNull();
    expect(extractAuthenticatedUserFromClaims({ sub: "  ", role: "authenticated" })).toBeNull();
  });
});

describe("handleAuthProxy", () => {
  it("未認証での保護ページアクセスを /login へリダイレクトし、公開ページは通す", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    const clientFactory = (
      _url: string,
      _key: string,
      handlers: { setAll: (c: Array<{ name: string; value: string }>) => void },
    ) => ({
      auth: {
        getClaims: async () => {
          handlers.setAll([{ name: "sb-refreshed", value: "cleared" }]);
          return { data: null, error: null };
        },
      },
    });

    const protectedRes = await handleAuthProxy(
      new NextRequest("http://localhost:3000/transcription", {
        headers: { cookie: "sb-fake=tampered" },
      }),
      clientFactory,
    );
    expect(protectedRes.status).toBe(307);
    expect(protectedRes.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Ftranscription",
    );
    expect(protectedRes.headers.get("cache-control")).toContain("no-store");
    expect(protectedRes.cookies.get("sb-refreshed")?.value).toBe("cleared");

    const protectedUserRes = await handleAuthProxy(
      new NextRequest("http://localhost:3000/user", {
        headers: { cookie: "sb-fake=tampered" },
      }),
      clientFactory,
    );
    expect(protectedUserRes.status).toBe(307);
    expect(protectedUserRes.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fuser",
    );

    const publicRes = await handleAuthProxy(
      new NextRequest("http://localhost:3000/"),
      clientFactory,
    );
    expect(publicRes.status).toBe(200);
  });

  it("認証済みユーザーの /login アクセスを安全な戻り先へリダイレクトし、Cookie とキャッシュヘッダーを保持する", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    const clientFactory = (
      _url: string,
      _key: string,
      handlers: { setAll: (c: Array<{ name: string; value: string }>) => void },
    ) => ({
      auth: {
        getClaims: async () => {
          handlers.setAll([{ name: "sb-access", value: "fresh-token" }]);
          return { data: { claims: { sub: "user-1", role: "authenticated" } }, error: null };
        },
      },
    });

    const loginRes = await handleAuthProxy(
      new NextRequest("http://localhost:3000/login?next=https://evil.example"),
      clientFactory,
    );
    expect(loginRes.status).toBe(307);
    expect(loginRes.headers.get("location")).toBe("http://localhost:3000/transcription");
    expect(loginRes.headers.get("cache-control")).toContain("no-store");
    expect(loginRes.headers.get("vary")).toContain("Cookie");
    expect(loginRes.cookies.get("sb-access")?.value).toBe("fresh-token");
  });
});

describe("OAuth callback and logout route handlers", () => {
  it("callback への直接アクセスや外部 next を安全に処理する", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("APP_PUBLIC_URL", "https://app.example.com");
    const { GET } = await import("@/app/auth/callback/route");

    const directRes = await GET(new NextRequest("https://app.example.com/auth/callback"));
    expect(directRes.status).toBe(307);
    expect(directRes.headers.get("location")).toBe(
      "https://app.example.com/login?error=missing_code&next=%2Ftranscription",
    );
    expect(directRes.headers.get("cache-control")).toContain("no-store");

    mocks.exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const okRes = await GET(
      new NextRequest(
        "https://evil-host.example/auth/callback?code=pkce-code&next=https://evil.com",
      ),
    );
    expect(okRes.status).toBe(307);
    expect(okRes.headers.get("location")).toBe("https://app.example.com/transcription");
    expect(okRes.cookies.get("sb-session")?.value).toBe("new-cookie");
  });

  it("logout は Origin を検証した POST のみ受け付け、セッション Cookie を破棄する", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("APP_PUBLIC_URL", "https://app.example.com");
    const logoutModule = await import("@/app/auth/logout/route");

    expect("GET" in logoutModule).toBe(false);

    const badOriginRes = await logoutModule.POST(
      new NextRequest("https://app.example.com/auth/logout", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(badOriginRes.status).toBe(403);

    mocks.signOut.mockResolvedValueOnce({ error: null });
    const okRes = await logoutModule.POST(
      new NextRequest("https://app.example.com/auth/logout", {
        method: "POST",
        headers: { origin: "https://app.example.com" },
      }),
    );
    expect(okRes.status).toBe(303);
    expect(okRes.headers.get("location")).toBe("https://app.example.com/login");
    expect(okRes.headers.get("cache-control")).toContain("no-store");
  });
});
