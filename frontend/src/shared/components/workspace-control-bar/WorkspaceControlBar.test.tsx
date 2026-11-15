import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceControlBar } from "./WorkspaceControlBar";

describe("WorkspaceControlBar", () => {
  it("収音中はモード切替・新しい会話・デバイス再取得を無効化し、停止ボタンを表示する", () => {
    const onToggleCapture = vi.fn();
    render(
      <WorkspaceControlBar
        modeGroupLabel="収音モード"
        statusBadgeText="文字起こし中"
        statusBadgeTone="success"
        mode="dual"
        modeLabels={{ single: "1マイク", dual: "2マイク（話者分離）" }}
        onModeChange={() => {}}
        devices={[{ deviceId: "d1", label: "Mic 1" }]}
        emptyDeviceLabel="なし"
        channels={[
          {
            id: "mic1",
            label: "マイク 1 · 薬剤師",
            selectedDeviceId: "d1",
            deviceSelectLabel: "デバイス1",
            levelLabel: "音量1",
            level: 0.4,
            isSpeaking: true,
            speakingLabel: "発話中",
            idleLabel: "無音",
          },
        ]}
        onDeviceChange={() => {}}
        onRefreshDevices={() => {}}
        refreshDevicesLabel="デバイス再取得"
        isCapturing
        canStart
        startLabel="文字起こし開始"
        stopLabel="文字起こし停止"
        onToggleCapture={onToggleCapture}
        newConversationLabel="新しい会話"
        canStartNewConversation={false}
        onNewConversation={() => {}}
      />,
    );

    expect(screen.getByRole("radio", { name: "1マイク" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("combobox", { name: "デバイス1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新しい会話" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "デバイス再取得" })).toBeDisabled();

    const stopBtn = screen.getByRole("button", { name: "文字起こし停止" });
    fireEvent.click(stopBtn);
    expect(onToggleCapture).toHaveBeenCalledTimes(1);
  });

  it("開始不可（重複デバイス等）の待機中でも、1マイクへの切替とデバイス再取得は操作できる", () => {
    const onModeChange = vi.fn();
    render(
      <WorkspaceControlBar
        modeGroupLabel="収音モード"
        statusBadgeText="待機中"
        statusBadgeTone="neutral"
        mode="dual"
        modeLabels={{ single: "1マイク", dual: "2マイク（話者分離）" }}
        onModeChange={onModeChange}
        devices={[{ deviceId: "d1", label: "Mic 1" }]}
        emptyDeviceLabel="なし"
        channels={[
          {
            id: "mic1",
            label: "マイク1",
            selectedDeviceId: "d1",
            deviceSelectLabel: "デバイス1",
            levelLabel: "音量1",
            level: 0,
            isSpeaking: false,
            speakingLabel: "発話中",
            idleLabel: "無音",
          },
        ]}
        onDeviceChange={() => {}}
        onRefreshDevices={() => {}}
        refreshDevicesLabel="デバイス再取得"
        isCapturing={false}
        canStart={false}
        canChangeMode={true}
        startLabel="文字起こし開始"
        stopLabel="文字起こし停止"
        onToggleCapture={() => {}}
        newConversationLabel="新しい会話"
        canStartNewConversation={true}
        onNewConversation={() => {}}
      />,
    );

    const singleRadio = screen.getByRole("radio", { name: "1マイク" });
    expect(singleRadio).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "デバイス1" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "文字起こし開始" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "デバイス再取得" })).toBeEnabled();
    fireEvent.click(singleRadio);
    expect(onModeChange).toHaveBeenCalledWith("single");
  });
});
