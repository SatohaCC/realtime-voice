"use client";

import * as stylex from "@stylexjs/stylex";
import type { AudioDeviceOption, MicChannelView } from "@/shared/components/dual-mic-panel";
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
import { workspaceControlBarStyles as s } from "./WorkspaceControlBar.styles";

export interface WorkspaceControlBarProps {
  modeGroupLabel: string;
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
  canChangeMode?: boolean;
  startLabel: string;
  stopLabel: string;
  onToggleCapture: () => void;
  newConversationLabel: string;
  canStartNewConversation: boolean;
  onNewConversation: () => void;
  statsText?: string;
  infoNotice?: string | null;
  errorMessage?: string | null;
}

/**
 * 2列ワークスペース上部に配置するコンパクトな収音・会話制御バー。
 */
export function WorkspaceControlBar({
  modeGroupLabel,
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
  canChangeMode = !isCapturing,
  startLabel,
  stopLabel,
  onToggleCapture,
  newConversationLabel,
  canStartNewConversation,
  onNewConversation,
  statsText,
  infoNotice,
  errorMessage,
}: WorkspaceControlBarProps) {
  const deviceOptions = devices.map((device) => ({
    value: device.deviceId,
    label: device.label,
  }));

  return (
    <div {...stylex.props(s.root)}>
      <div {...stylex.props(s.topRow)}>
        <div {...stylex.props(s.statusGroup)}>
          <Badge tone={statusBadgeTone}>{statusBadgeText}</Badge>
          {statsText ? <span {...stylex.props(s.metaText)}>{statsText}</span> : null}
        </div>

        <div {...stylex.props(s.actionsGroup)}>
          <SegmentedControl
            aria-label={modeGroupLabel}
            size="sm"
            value={mode}
            disabled={!canChangeMode}
            onValueChange={onModeChange}
            items={[
              { value: "dual", label: modeLabels.dual },
              { value: "single", label: modeLabels.single },
            ]}
          />

          <Button variant="outlined" size="sm" onClick={onRefreshDevices} disabled={!canChangeMode}>
            {refreshDevicesLabel}
          </Button>

          <Button
            variant="outlined"
            size="sm"
            onClick={onNewConversation}
            disabled={!canStartNewConversation}
          >
            {newConversationLabel}
          </Button>

          <Button
            variant={isCapturing ? "tonal" : "filled"}
            size="sm"
            onClick={onToggleCapture}
            disabled={!isCapturing && !canStart}
          >
            {isCapturing ? stopLabel : startLabel}
          </Button>
        </div>
      </div>

      <div {...stylex.props(s.channelsRow, mode === "single" && s.channelSingleRow)}>
        {channels.map((channel) => {
          const percent = Math.round(Math.max(0, Math.min(1, channel.level)) * 100);
          return (
            <Card
              key={channel.id}
              variant="outlined"
              style={[s.channelItem, channel.isSpeaking && s.channelItemActive]}
            >
              <div {...stylex.props(s.channelSelectRow)}>
                <span {...stylex.props(s.channelLabel)}>{channel.label}</span>

                <div {...stylex.props(s.channelSelectWrap)}>
                  <Select
                    label={channel.deviceSelectLabel}
                    hideLabel
                    options={deviceOptions}
                    value={channel.selectedDeviceId || null}
                    placeholder={emptyDeviceLabel}
                    disabled={isCapturing || !canChangeMode || devices.length === 0}
                    onValueChange={(nextValue) => {
                      if (nextValue !== null) {
                        onDeviceChange(channel.id, nextValue);
                      }
                    }}
                  />
                </div>
              </div>

              <div {...stylex.props(s.channelStatusRow)}>
                <Meter
                  label={channel.levelLabel}
                  value={percent}
                  hideLabel
                  size="sm"
                  tone={channel.isSpeaking ? "tertiary" : "primary"}
                  style={s.channelMeter}
                />

                <Badge tone={channel.isSpeaking ? "success" : "neutral"}>
                  {channel.isSpeaking ? channel.speakingLabel : channel.idleLabel}
                </Badge>
              </div>
            </Card>
          );
        })}
      </div>

      {infoNotice ? (
        <Banner tone="info" size="sm">
          {infoNotice}
        </Banner>
      ) : null}

      {errorMessage ? (
        <Banner tone="danger" size="sm" role="alert">
          {errorMessage}
        </Banner>
      ) : null}
    </div>
  );
}
