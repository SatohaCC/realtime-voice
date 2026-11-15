"use client";

import { useAppQuery } from "@/shared/lib/query/useAppQuery";
import { getValidAccessToken } from "@/shared/lib/supabase/client";

export interface UserProfileResponse {
  user_id: string;
  masked_email: string | null;
}

async function fetchUserProfile(signal: AbortSignal): Promise<UserProfileResponse> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error("ログインセッションを確認できませんでした。");
  }

  const response = await fetch("/api/users/me", {
    signal,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    let detail = `プロフィール取得に失敗しました (HTTP ${response.status})。`;
    try {
      const errBody = (await response.json()) as { detail?: string };
      if (errBody.detail) {
        detail = errBody.detail;
      }
    } catch {
      // JSON でないエラー応答は既定文言を使う
    }
    throw new Error(detail);
  }

  return (await response.json()) as UserProfileResponse;
}

/**
 * バックエンドからマスク済みメールアドレスを含むユーザープロフィールを取得する Hook。
 */
export function useUserProfile(userId: string) {
  const { data, error, isLoading, refetch } = useAppQuery({
    queryKey: ["user-profile", userId],
    queryFn: ({ signal }) => fetchUserProfile(signal),
    enabled: Boolean(userId),
  });

  return {
    profile: data,
    error,
    isLoading,
    refetch,
  };
}
