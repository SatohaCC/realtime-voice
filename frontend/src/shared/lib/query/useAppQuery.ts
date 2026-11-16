"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export interface AppQueryOptions<TData> {
  queryKey: readonly unknown[];
  queryFn: (context: { signal: AbortSignal }) => Promise<TData>;
  enabled?: boolean;
}

export function useAppQuery<TData>({ queryKey, queryFn, enabled }: AppQueryOptions<TData>) {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => queryFn({ signal }),
    enabled,
  });

  return {
    data: data ?? null,
    error: error instanceof Error ? error.message : null,
    isLoading: isFetching,
    refetch: () => {
      void refetch();
    },
  };
}

/**
 * 指定したキープレフィックスに一致するクエリキャッシュを無効化するコールバックを返す。
 */
export function useInvalidateAppQueries() {
  const queryClient = useQueryClient();
  return useCallback(
    (queryKey: readonly unknown[]) => {
      void queryClient.invalidateQueries({ queryKey });
    },
    [queryClient],
  );
}
