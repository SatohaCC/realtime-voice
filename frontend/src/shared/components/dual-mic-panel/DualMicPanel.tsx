"use client";

import * as stylex from "@stylexjs/stylex";
import {
  Badge,
  type BadgeProps,
  Banner,
  Button,
  Card,
  Meter,
  SegmentedControl,
  Select,
} from "@/shared/ui";
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
          <SegmentedControl
            aria-label={title}
            size="sm"
            value={mode}
            disabled={isCapturing}
            onValueChange={onModeChange}
            items={[
              { value: "single", label: modeLabels.single },
              { value: "dual", label: modeLabels.dual },
            ]}
          />

          <Button variant="outlined" size="sm" onClick={onRefreshDevices} disabled={isCapturing}>
            {refreshDevicesLabel}
          </Button>
        </div>
      </div>

      <div {...stylex.props(dualMicPanelStyles.channelsGrid)}>
        {channels.map((channel) => {
          const percent = Math.round(Math.max(0, Math.min(1, channel.level)) * 100);

          return (
            <Card
              key={channel.id}
              variant="outlined"
              style={[
                dualMicPanelStyles.channelCard,
                channel.isSpeaking && dualMicPanelStyles.channelCardActive,
              ]}
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

              <Meter
                label={channel.levelLabel}
                aria-label={`${channel.label} ${channel.levelLabel}`}
                value={percent}
                showValue
                tone={channel.isSpeaking ? "tertiary" : "primary"}
              />
            </Card>
          );
        })}
      </div>

      {errorMessage ? (
        <Banner tone="danger" role="alert">
          {errorMessage}
        </Banner>
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
