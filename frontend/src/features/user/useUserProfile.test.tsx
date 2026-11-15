import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/shared/lib/query/QueryProvider";
import { useUserProfile } from "./useUserProfile";

const mocks = vi.hoisted(() => ({
  getValidAccessToken: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("@/shared/lib/supabase/client", () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}));

function createWrapper() {
  return ({ children }: { children: ReactNode }) => <QueryProvider>{children}</QueryProvider>;
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useUserProfile", () => {
  it("Bearer トークン付きで /api/users/me を呼び出し、マスク済みメールアドレスを返す", async () => {
    mocks.getValidAccessToken.mockResolvedValue("access-token-123");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        user_id: "user-1",
        masked_email: "p***@e***.com",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useUserProfile("user-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.profile).toEqual({
        user_id: "user-1",
        masked_email: "p***@e***.com",
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/users/me",
      expect.objectContaining({
        cache: "no-store",
        headers: { Authorization: "Bearer access-token-123" },
      }),
    );
    expect(result.current.error).toBeNull();
  });

  it("Backend エラー応答の detail をエラーとして返す", async () => {
    mocks.getValidAccessToken.mockResolvedValue("access-token-123");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ detail: "認証の有効期限が切れています。" }),
      })),
    );

    const { result } = renderHook(() => useUserProfile("user-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBe("認証の有効期限が切れています。");
    });
    expect(result.current.profile).toBeNull();
  });
});
