import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { groupTranscriptTurns, TranscriptChat } from "./TranscriptChat";

const SPEAKER_OPTIONS = [
  { value: "host" as const, label: "進行役" },
  { value: "guest" as const, label: "参加者" },
  { value: "unassigned" as const, label: "未割当" },
];

const SAMPLE_SEGMENTS = [
  {
    streamId: "s1",
    segmentId: "seg-1",
    channelIndex: 0 as const,
    speakerId: "host" as const,
    roleName: "進行役",
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
    speakerId: "guest" as const,
    roleName: "参加者",
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
    speakerId: "guest" as const,
    roleName: "参加者",
    micLabel: "マイク2",
    timeLabel: "00:06.8",
    text: "熱は37.8℃です。",
    status: "final" as const,
    statusLabel: "確定",
  },
];

describe("TranscriptChat", () => {
  it("識別子が同じでも話者の確度が異なる発話は別ターンにする", () => {
    const groups = groupTranscriptTurns([
      { ...SAMPLE_SEGMENTS[1], speakerId: "unknown", isSpeakerUncertain: false },
      { ...SAMPLE_SEGMENTS[2], speakerId: "unknown", isSpeakerUncertain: true },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].isSpeakerUncertain).toBe(false);
    expect(groups[1].isSpeakerUncertain).toBe(true);
  });
  it("無効な原文は取り消し線で残し、有効化操作で同じIDを返す", async () => {
    const onSetSegmentEnabled = vi.fn();
    render(
      <TranscriptChat
        title="会話"
        emptyMessage="空"
        scrollToBottomLabel="末尾"
        segments={[{ ...SAMPLE_SEGMENTS[0], disabled: true }]}
        getSegmentToggleLabel={({ disabled }) => (disabled ? "有効に戻す" : "無効化")}
        onSetSegmentEnabled={onSetSegmentEnabled}
      />,
    );
    const text = screen.getByText(SAMPLE_SEGMENTS[0].text);
    expect(text.parentElement).toHaveAttribute("data-disabled", "true");
    expect(text.tagName).toBe("S");
    await userEvent.click(screen.getByRole("button", { name: "有効に戻す" }));
    expect(onSetSegmentEnabled).toHaveBeenCalledWith("s1", "seg-1", true);
    expect(text).toBeInTheDocument();
  });
  const getAnimations = Element.prototype.getAnimations;
  beforeAll(() => {
    Element.prototype.getAnimations = () => [];
  });
  afterAll(() => {
    Element.prototype.getAnimations = getAnimations;
  });

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

  it("共有Selectで確定済み発話の話者を変更するとグループ内全セグメントの訂正ハンドラを呼ぶ", async () => {
    const user = userEvent.setup();
    const onChangeSegmentSpeaker = vi.fn();
    render(
      <TranscriptChat
        title="文字起こし"
        segments={SAMPLE_SEGMENTS}
        emptyMessage="空"
        scrollToBottomLabel="↓ 新しい発話"
        speakerOptions={SPEAKER_OPTIONS}
        getSpeakerSelectLabel={({ timeLabel }) => `${timeLabel} の話者を変更`}
        onChangeSegmentSpeaker={onChangeSegmentSpeaker}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "00:04.2 の話者を変更" });
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const controlsId = trigger.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    const listbox = document.getElementById(controlsId ?? "");
    expect(listbox).not.toBeNull();
    await user.click(
      within(listbox as HTMLElement).getByRole("option", { name: "進行役", hidden: true }),
    );
    expect(onChangeSegmentSpeaker).toHaveBeenCalledTimes(2);
    expect(onChangeSegmentSpeaker).toHaveBeenNthCalledWith(1, "s1", "seg-2", "host");
    expect(onChangeSegmentSpeaker).toHaveBeenNthCalledWith(2, "s1", "seg-3", "host");
  });

  it("任意の話者IDと明示した不確かな表示を扱える", () => {
    const { container } = render(
      <TranscriptChat
        title="文字起こし"
        segments={[
          {
            streamId: "s1",
            segmentId: "seg-u",
            channelIndex: 1,
            align: "left",
            speakerId: "guest-42",
            isSpeakerUncertain: true,
            roleName: "未割当",
            timeLabel: "00:08.0",
            text: "はい。",
            status: "final",
            statusLabel: "確定",
          },
        ]}
        emptyMessage="空"
        scrollToBottomLabel="↓ 新しい発話"
      />,
    );

    const turn = container.querySelector('li[data-speaker-id="guest-42"]');
    expect(turn).toBeInTheDocument();
    expect(turn).toHaveAttribute("data-speaker-uncertain", "true");
    expect(screen.getByText("未割当")).toBeInTheDocument();
  });

  it("削除ボタン押下で対象セグメントのみ削除ハンドラを呼び、interim には表示しない", async () => {
    const user = userEvent.setup();
    const onSetSegmentEnabled = vi.fn();
    render(
      <TranscriptChat
        title="文字起こし"
        segments={[
          ...SAMPLE_SEGMENTS,
          {
            streamId: "s1",
            segmentId: "seg-interim",
            channelIndex: 0 as const,
            speakerId: "host" as const,
            roleName: "進行役",
            timeLabel: "00:09.5",
            text: "確認します…",
            status: "interim" as const,
            statusLabel: "認識中",
          },
        ]}
        emptyMessage="空"
        scrollToBottomLabel="↓ 新しい発話"
        getSegmentToggleLabel={({ timeLabel, text }) => `${timeLabel} の発話「${text}」を削除`}
        onSetSegmentEnabled={onSetSegmentEnabled}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "00:09.5 の発話「確認します…」を削除" }),
    ).not.toBeInTheDocument();

    const deleteButton = screen.getByRole("button", {
      name: "00:06.8 の発話「熱は37.8℃です。」を削除",
    });
    await user.click(deleteButton);
    expect(onSetSegmentEnabled).toHaveBeenCalledTimes(1);
    expect(onSetSegmentEnabled).toHaveBeenCalledWith("s1", "seg-3", false);
  });

  it("発話があるときのみスクロール領域をキーボードフォーカス可能にする", () => {
    const { rerender } = render(
      <TranscriptChat
        title="文字起こし"
        segments={[]}
        emptyMessage="まだ発話はありません"
        scrollToBottomLabel="↓ 新しい発話"
      />,
    );
    expect(screen.getByTestId("transcript-chat-scroller")).not.toHaveAttribute("tabindex");

    rerender(
      <TranscriptChat
        title="文字起こし"
        segments={SAMPLE_SEGMENTS}
        emptyMessage="まだ発話はありません"
        scrollToBottomLabel="↓ 新しい発話"
      />,
    );
    expect(screen.getByTestId("transcript-chat-scroller")).toHaveAttribute("tabindex", "0");
  });
});
