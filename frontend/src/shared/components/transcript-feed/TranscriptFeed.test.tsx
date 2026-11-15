import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TranscriptFeed } from "./TranscriptFeed";

describe("TranscriptFeed", () => {
  it("空状態のメッセージを表示し、クリアボタンを無効化する", () => {
    render(
      <TranscriptFeed
        title="文字起こし結果"
        segments={[]}
        emptyMessage="まだ文字起こしがありません"
        clearLabel="クリア"
        canClear={false}
        onClear={() => {}}
      />,
    );

    expect(screen.getByText("まだ文字起こしがありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "クリア" })).toBeDisabled();
  });

  it("話者別セグメントを表示し、クリアボタン押下で onClear を呼ぶ", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    render(
      <TranscriptFeed
        title="文字起こし結果"
        segments={[
          {
            id: "1",
            channelIndex: 0,
            speakerLabel: "話者 A",
            text: "こんにちは",
            status: "final",
            statusLabel: "確定",
            timeLabel: "00:01.0",
          },
          {
            id: "2",
            channelIndex: 1,
            speakerLabel: "話者 B",
            text: "調子が悪いです",
            status: "interim",
            statusLabel: "仮",
            timeLabel: "00:03.2",
          },
        ]}
        emptyMessage="空です"
        clearLabel="クリア"
        canClear={true}
        onClear={onClear}
      />,
    );

    expect(screen.getByText("話者 A")).toBeInTheDocument();
    expect(screen.getByText("こんにちは")).toBeInTheDocument();
    expect(screen.getByText("話者 B")).toBeInTheDocument();
    expect(screen.getByText("調子が悪いです")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "文字起こし結果" })).toHaveAttribute("tabindex", "0");

    await user.click(screen.getByRole("button", { name: "クリア" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
