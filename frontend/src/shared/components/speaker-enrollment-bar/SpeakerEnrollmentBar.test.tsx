import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpeakerEnrollmentBar } from "./SpeakerEnrollmentBar";

describe("SpeakerEnrollmentBar", () => {
  it("状態表示と登録・削除ハンドラを呼び出す", () => {
    const onEnroll = vi.fn();
    const onClear = vi.fn();

    render(
      <SpeakerEnrollmentBar
        title="話者声紋"
        badgeText="登録済み"
        badgeTone="success"
        descriptionText="端末保存済み"
        actionLabel="再登録"
        clearLabel="削除"
        isEnrolling={false}
        canEnroll
        canClear
        warningMessages={["音量が小さめです。"]}
        onEnroll={onEnroll}
        onClear={onClear}
      />,
    );

    expect(screen.getByText("話者声紋")).toBeInTheDocument();
    expect(screen.getByText("登録済み")).toBeInTheDocument();
    expect(screen.getByText("音量が小さめです。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再登録" }));
    expect(onEnroll).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("登録中は中止ボタンと進捗を表示する", () => {
    const onCancel = vi.fn();
    render(
      <SpeakerEnrollmentBar
        title="話者声紋"
        badgeText="録音中"
        badgeTone="neutral"
        actionLabel="登録"
        cancelLabel="中止"
        isEnrolling
        canEnroll={false}
        canClear={false}
        progressRatio={0.5}
        progressLabel="50%"
        onEnroll={() => {}}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("50%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "中止" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
