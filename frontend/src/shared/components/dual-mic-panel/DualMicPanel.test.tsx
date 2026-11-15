import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DualMicPanel } from "./DualMicPanel";

describe("DualMicPanel", () => {
  const getAnimations = Element.prototype.getAnimations;
  beforeAll(() => {
    Element.prototype.getAnimations = () => [];
  });
  afterAll(() => {
    Element.prototype.getAnimations = getAnimations;
  });

  it("2マイクのデバイス選択・モード切替・収音操作・音量メーターを描画する", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const onDeviceChange = vi.fn();
    const onRefreshDevices = vi.fn();
    const onToggleCapture = vi.fn();

    render(
      <DualMicPanel
        title="音声入力モニター"
        statusBadgeText="待機中"
        statusBadgeTone="neutral"
        mode="dual"
        modeLabels={{ single: "1マイク", dual: "2マイク" }}
        onModeChange={onModeChange}
        devices={[
          { deviceId: "mic-a", label: "Mic A" },
          { deviceId: "mic-b", label: "Mic B" },
        ]}
        emptyDeviceLabel="未検出"
        channels={[
          {
            id: "mic1",
            label: "マイク 1",
            selectedDeviceId: "mic-a",
            deviceSelectLabel: "デバイス 1",
            levelLabel: "入力レベル",
            level: 0.42,
            isSpeaking: true,
            speakingLabel: "発話中",
            idleLabel: "無音",
          },
          {
            id: "mic2",
            label: "マイク 2",
            selectedDeviceId: "mic-b",
            deviceSelectLabel: "デバイス 2",
            levelLabel: "入力レベル",
            level: 0.05,
            isSpeaking: false,
            speakingLabel: "発話中",
            idleLabel: "無音",
          },
        ]}
        onDeviceChange={onDeviceChange}
        onRefreshDevices={onRefreshDevices}
        refreshDevicesLabel="デバイス再取得"
        isCapturing={false}
        canStart={true}
        startLabel="収音開始"
        stopLabel="収音停止"
        onToggleCapture={onToggleCapture}
      />,
    );

    expect(screen.getByRole("meter", { name: "マイク 1 入力レベル" })).toHaveValue(42);
    expect(screen.getByRole("meter", { name: "マイク 2 入力レベル" })).toHaveValue(5);

    await user.click(screen.getByRole("radio", { name: "1マイク" }));
    expect(onModeChange).toHaveBeenCalledWith("single");

    await user.click(screen.getByRole("combobox", { name: "デバイス 1" }));
    await user.click(screen.getByRole("option", { name: "Mic B", hidden: true }));
    expect(onDeviceChange).toHaveBeenCalledWith("mic1", "mic-b");

    await user.click(screen.getByRole("button", { name: "デバイス再取得" }));
    expect(onRefreshDevices).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "収音開始" }));
    expect(onToggleCapture).toHaveBeenCalledTimes(1);
  });

  it("エラーメッセージがある場合に alert として表示する", () => {
    render(
      <DualMicPanel
        title="音声入力モニター"
        statusBadgeText="エラー"
        statusBadgeTone="danger"
        mode="single"
        modeLabels={{ single: "1マイク", dual: "2マイク" }}
        onModeChange={() => {}}
        devices={[]}
        emptyDeviceLabel="未検出"
        channels={[]}
        onDeviceChange={() => {}}
        onRefreshDevices={() => {}}
        refreshDevicesLabel="再取得"
        isCapturing={false}
        canStart={false}
        startLabel="収音開始"
        stopLabel="収音停止"
        onToggleCapture={() => {}}
        errorMessage="権限がありません"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("権限がありません");
    expect(screen.getByRole("button", { name: "収音開始" })).toBeDisabled();
  });
});
