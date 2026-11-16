"use client";

import { StatusCard } from "@/shared/components";
import type { HealthResponse } from "./useHealthStatus";
import { useHealthStatus } from "./useHealthStatus";

function toBadge(data: HealthResponse | null, error: string | null, isLoading: boolean) {
  if (isLoading) return { tone: "neutral" as const, text: "Checking..." };
  if (error) return { tone: "danger" as const, text: `Error: ${error}` };
  if (data) return { tone: "success" as const, text: `${data.status} (${data.service})` };
  return { tone: "neutral" as const, text: "Unknown" };
}

export function HealthStatusContainer() {
  const { data, error, isLoading, onRefresh } = useHealthStatus();
  const badge = toBadge(data, error, isLoading);

  return (
    <StatusCard
      label="Backend API"
      badgeText={badge.text}
      badgeTone={badge.tone}
      actionLabel={isLoading ? "Checking..." : "Refresh Status"}
      isActionDisabled={isLoading}
      onAction={onRefresh}
    />
  );
}
