import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { groupTranscriptTurns, TranscriptChat } from "./TranscriptChat";

const SAMPLE_SEGMENTS = [
  {
    streamId: "s1",
    segmentId: "seg-1",
    channelIndex: 0 as const,
    roleName: "薬剤師",
    micLabel: "マイク1",
    timeLabel: "00:01.0",
    text: "ご体調はいかがですか？",
    status: "final" as const,
    statusLabel: "確定",
  },
  {
    streamId: "s1",
    segmentId: "seg-2",
    channelIndex: 1 as const,
    roleName: "患者",
    micLabel: "マイク2",
    timeLabel: "00:04.2",
    text: "昨日から咳が出ます。",
    status: "final" as const,
    statusLabel: "確定",
  },
  {
    streamId: "s1",
    segmentId: "seg-3",
    channelIndex: 1 as const,
    roleName: "患者",
    micLabel: "マイク2",
    timeLabel: "00:06.8",
    text: "熱は37.8℃です。",
    status: "final" as const,
    statusLabel: "確定",
  },
];

describe("TranscriptChat", () => {
  it("同話者の連続確定発話をグループ化しつつ個別の根拠 segment key を保持する", () => {
    const groups = groupTranscriptTurns(SAMPLE_SEGMENTS);
    expect(groups).toHaveLength(2);
    expect(groups[1]?.items.map((item) => item.segmentId)).toEqual(["seg-2", "seg-3"]);

    const { container } = render(
      <TranscriptChat
        title="文字起こし"
        countLabel="3 発話"
        segments={SAMPLE_SEGMENTS}
        emptyMessage="まだ発話はありません"
        scrollToBottomLabel="↓ 新しい発話"
        highlightedSegmentKey="s1:seg-3"
      />,
    );

    expect(screen.getByText("昨日から咳が出ます。")).toBeInTheDocument();
    expect(screen.getByText("熱は37.8℃です。")).toBeInTheDocument();
    const turnItems = container.querySelectorAll("li[data-align]");
    expect(turnItems[0]).toHaveAttribute("data-align", "right");
    expect(turnItems[1]).toHaveAttribute("data-align", "left");
    const highlighted = container.querySelector('[data-segment-key="s1:seg-3"]');
    expect(highlighted).toHaveAttribute("data-highlighted", "true");
  });

  it("過去を閲覧中に新しい発話が来ると自動スクロールを抑止し「新しい発話」を表示する", () => {
    const { rerender } = render(
      <TranscriptChat
        title="文字起こし"
        segments={SAMPLE_SEGMENTS.slice(0, 2)}
        emptyMessage="空"
        scrollToBottomLabel="↓ 新しい発話"
      />,
    );

    const scroller = screen.getByTestId("transcript-chat-scroller");
    Object.defineProperty(scroller, "scrollHeight", { value: 600, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 200, configurable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 50, writable: true, configurable: true });
    fireEvent.scroll(scroller);

    rerender(
      <TranscriptChat
        title="文字起こし"
        segments={SAMPLE_SEGMENTS}
        emptyMessage="空"
        scrollToBottomLabel="↓ 新しい発話"
      />,
    );

    expect(scroller.scrollTop).toBe(50);
    const jumpButton = screen.getByRole("button", { name: "↓ 新しい発話" });
    fireEvent.click(jumpButton);
    expect(screen.queryByRole("button", { name: "↓ 新しい発話" })).not.toBeInTheDocument();
  });
});
