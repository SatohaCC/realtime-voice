"use client";

import * as stylex from "@stylexjs/stylex";
import { Badge, type BadgeProps } from "@/shared/ui/badge/Badge";
import { Button } from "@/shared/ui/button/Button";
import { Select } from "@/shared/ui/select/Select";
import { dualMicPanelStyles } from "./DualMicPanel.styles";

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

export interface MicChannelView {
  id: string;
  label: string;
  selectedDeviceId: string;
  deviceSelectLabel: string;
  levelLabel: string;
  /** 正規化された RMS 音量 (0.0〜1.0) */
  level: number;
  isSpeaking: boolean;
  speakingLabel: string;
  idleLabel: string;
}

export interface DualMicPanelProps {
  title: string;
  statusBadgeText: string;
  statusBadgeTone: NonNullable<BadgeProps["tone"]>;
  mode: "single" | "dual";
  modeLabels: {
    single: string;
    dual: string;
  };
  onModeChange: (mode: "single" | "dual") => void;
  devices: readonly AudioDeviceOption[];
  emptyDeviceLabel: string;
  channels: readonly MicChannelView[];
  onDeviceChange: (channelId: string, deviceId: string) => void;
  onRefreshDevices: () => void;
  refreshDevicesLabel: string;
  isCapturing: boolean;
  canStart: boolean;
  startLabel: string;
  stopLabel: string;
  onToggleCapture: () => void;
  captureStatsText?: string;
  errorMessage?: string | null;
}

/**
 * 1マイク／2マイク切替・デバイス選択・リアルタイム音量メーターを備えた収音操作パネル。
 */
export function DualMicPanel({
  title,
  statusBadgeText,
  statusBadgeTone,
  mode,
  modeLabels,
  onModeChange,
  devices,
  emptyDeviceLabel,
  channels,
  onDeviceChange,
  onRefreshDevices,
  refreshDevicesLabel,
  isCapturing,
  canStart,
  startLabel,
  stopLabel,
  onToggleCapture,
  captureStatsText,
  errorMessage,
}: DualMicPanelProps) {
  const deviceOptions = devices.map((device) => ({
    value: device.deviceId,
    label: device.label,
  }));

  return (
    <div {...stylex.props(dualMicPanelStyles.root)}>
      <div {...stylex.props(dualMicPanelStyles.header)}>
        <div {...stylex.props(dualMicPanelStyles.titleGroup)}>
          <h3 {...stylex.props(dualMicPanelStyles.title)}>{title}</h3>
          <Badge tone={statusBadgeTone}>{statusBadgeText}</Badge>
        </div>

        <div {...stylex.props(dualMicPanelStyles.headerActions)}>
          <fieldset aria-label={title} {...stylex.props(dualMicPanelStyles.modeGroup)}>
            <Button
              variant={mode === "single" ? "tonal" : "text"}
              size="sm"
              aria-pressed={mode === "single"}
              disabled={isCapturing}
              onClick={() => onModeChange("single")}
            >
              {modeLabels.single}
            </Button>
            <Button
              variant={mode === "dual" ? "tonal" : "text"}
              size="sm"
              aria-pressed={mode === "dual"}
              disabled={isCapturing}
              onClick={() => onModeChange("dual")}
            >
              {modeLabels.dual}
            </Button>
          </fieldset>

          <Button variant="outlined" size="sm" onClick={onRefreshDevices} disabled={isCapturing}>
            {refreshDevicesLabel}
          </Button>
        </div>
      </div>

      <div {...stylex.props(dualMicPanelStyles.channelsGrid)}>
        {channels.map((channel) => {
          const percent = Math.round(Math.max(0, Math.min(1, channel.level)) * 100);

          return (
            <div
              key={channel.id}
              {...stylex.props(
                dualMicPanelStyles.channelCard,
                channel.isSpeaking && dualMicPanelStyles.channelCardActive,
              )}
            >
              <div {...stylex.props(dualMicPanelStyles.channelHeader)}>
                <span {...stylex.props(dualMicPanelStyles.channelTitle)}>{channel.label}</span>
                <Badge tone={channel.isSpeaking ? "success" : "neutral"}>
                  {channel.isSpeaking ? channel.speakingLabel : channel.idleLabel}
                </Badge>
              </div>

              <Select
                label={channel.deviceSelectLabel}
                options={deviceOptions}
                value={channel.selectedDeviceId || null}
                placeholder={emptyDeviceLabel}
                disabled={isCapturing || devices.length === 0}
                onValueChange={(nextValue) => {
                  if (nextValue !== null) {
                    onDeviceChange(channel.id, nextValue);
                  }
                }}
              />

              <div {...stylex.props(dualMicPanelStyles.meterBlock)}>
                <div {...stylex.props(dualMicPanelStyles.meterHeader)}>
                  <span>{channel.levelLabel}</span>
                  <span>{percent}%</span>
                </div>
                <meter
                  min={0}
                  max={100}
                  low={15}
                  high={80}
                  optimum={45}
                  value={percent}
                  aria-label={`${channel.label} ${channel.levelLabel}`}
                  {...stylex.props(
                    dualMicPanelStyles.meter,
                    channel.isSpeaking && dualMicPanelStyles.meterActive,
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>

      {errorMessage ? (
        <div role="alert" {...stylex.props(dualMicPanelStyles.errorBox)}>
          {errorMessage}
        </div>
      ) : null}

      <div {...stylex.props(dualMicPanelStyles.controls)}>
        <Button
          variant={isCapturing ? "outlined" : "filled"}
          onClick={onToggleCapture}
          disabled={!isCapturing && !canStart}
        >
          {isCapturing ? stopLabel : startLabel}
        </Button>
        {captureStatsText ? (
          <span {...stylex.props(dualMicPanelStyles.stats)}>{captureStatsText}</span>
        ) : null}
      </div>
    </div>
  );
}
