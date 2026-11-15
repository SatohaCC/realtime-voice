import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialConversationState } from "@/shared/lib/conversation/conversationReducer";
import { RealtimeTranscriptionContainer } from "./RealtimeTranscriptionContainer";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  toggleTranscription: vi.fn(),
  clearTranscripts: vi.fn(),
  startNewConversation: vi.fn(),
  refreshDevices: vi.fn(async () => {}),
  setMode: vi.fn(),
  setMic1DeviceId: vi.fn(),
  setMic2DeviceId: vi.fn(),
  hookState: {
    mode: "dual" as "single" | "dual",
    hasDuplicateDevices: false,
    segments: [] as Array<{
      id: string;
      channelIndex: 0 | 1;
      speakerLabel: string;
      text: string;
      isFinal: boolean;
      status: "interim" | "final" | "refined";
      startSec: number;
      endSec: number;
      confidence: number;
    }>,
    conversation: null as unknown as ReturnType<typeof createInitialConversationState>,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("./useRealtimeTranscription", () => ({
  useRealtimeTranscription: () => ({
    audio: {
      devices: [
        { deviceId: "mic-1", label: "薬剤師マイク" },
        { deviceId: "mic-2", label: "患者マイク" },
      ],
      mode: mocks.hookState.mode,
      setMode: mocks.setMode,
      mic1DeviceId: "mic-1",
      setMic1DeviceId: mocks.setMic1DeviceId,
      mic2DeviceId: "mic-2",
      setMic2DeviceId: mocks.setMic2DeviceId,
      hasDuplicateDevices: mocks.hookState.hasDuplicateDevices,
      isCapturing: false,
      levels: [0, 0] as const,
      speaking: [false, false] as const,
      frameCount: 0,
      error: null,
      refreshDevices: mocks.refreshDevices,
    },
    segments: mocks.hookState.segments,
    conversation: mocks.hookState.conversation,
    isConnecting: false,
    isStreaming: false,
    isStopping: false,
    error: null,
    toggleTranscription: mocks.toggleTranscription,
    clearTranscripts: mocks.clearTranscripts,
    startNewConversation: mocks.startNewConversation,
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  const base = createInitialConversationState("conv-1");
  base.segments = [
    {
      stream_id: "s1",
      segment_id: "seg-p1",
      segment_revision: 1,
      transcript_revision: 1,
      channel_index: 0,
      speaker_role: "pharmacist",
      speaker_label: "薬剤師",
      text: "お薬を飲む時間帯を確認しましょう。",
      status: "final",
      start_sec: 1.0,
      end_sec: 3.0,
      confidence: 0.98,
    },
    {
      stream_id: "s1",
      segment_id: "seg-pt1",
      segment_revision: 1,
      transcript_revision: 2,
      channel_index: 1,
      speaker_role: "patient",
      speaker_label: "患者",
      text: "朝から少し胃が痛いです。",
      status: "final",
      start_sec: 3.5,
      end_sec: 5.0,
      confidence: 0.97,
    },
  ];
  base.soap = {
    soap_id: "soap-1",
    conversation_id: "conv-1",
    revision: 1,
    processed_transcript_revision: 2,
    sections: {
      S: {
        revision: 1,
        items: [
          {
            item_id: "item-s1",
            item_revision: 1,
            text: "朝から軽い胃痛がある",
            evidence: [
              {
                stream_id: "s1",
                segment_id: "seg-pt1",
                segment_revision: 1,
                quote: "朝から少し胃が痛いです。",
                speaker_role: "patient",
              },
            ],
            origin: "conversation",
            derived_from_plan_items: [],
            stale_after_plan_update: false,
            verification_status: "reported",
          },
        ],
      },
      O: { revision: 0, items: [] },
      A: { revision: 0, items: [], derived_from_plan_revision: null },
      P: { revision: 0, items: [] },
    },
  };
  base.soapStatus = "ready";
  base.changedItemIds = ["item-s1"];
  mocks.hookState = {
    mode: "dual",
    hasDuplicateDevices: false,
    segments: [],
    conversation: base,
  };
});

describe("RealtimeTranscriptionContainer", () => {
  it("2ペイン構成を描画し、根拠クリックで対象発話を強調してモバイルタブを切り替える", () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const { container } = render(<RealtimeTranscriptionContainer />);

    expect(container.querySelector('[data-workspace-pane="transcript"]')).toBeInTheDocument();
    expect(container.querySelector('[data-workspace-pane="soap"]')).toBeInTheDocument();
    expect(screen.getByText("お薬を飲む時間帯を確認しましょう。")).toBeInTheDocument();
    expect(screen.getByText("朝から軽い胃痛がある")).toBeInTheDocument();

    // 上部マイク選択欄もチャット吹き出しも「患者（左）／薬剤師（右）」の順で並び、マイク番号表記がないこと
    const micTexts = Array.from(container.querySelectorAll("span"))
      .map((el) => el.textContent)
      .filter((text) => text === "患者 (S)" || text === "薬剤師 (P/A)");
    expect(micTexts).toEqual(["患者 (S)", "薬剤師 (P/A)"]);
    expect(screen.queryByText(/マイク\s*[12]/)).not.toBeInTheDocument();
    const turnItems = container.querySelectorAll("li[data-align]");
    expect(turnItems[0]).toHaveAttribute("data-align", "right");
    expect(turnItems[1]).toHaveAttribute("data-align", "left");

    fireEvent.click(screen.getByRole("tab", { name: /SOAP/ }));
    expect(screen.getByRole("tab", { name: /SOAP/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: /根拠.*朝から少し胃が痛いです。/ }));
    expect(screen.getByRole("tab", { name: /文字起こし/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(container.querySelector('[data-segment-key="s1:seg-pt1"]')).toHaveAttribute(
      "data-highlighted",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "SOAP をコピー" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("S (主観的情報)"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("朝から軽い胃痛がある"));
  });

  it("1マイクモード時は SOAP を対象外表示とし、案内バナーを表示する", () => {
    mocks.hookState.mode = "single";
    mocks.hookState.segments = [
      {
        id: "single-1",
        channelIndex: 0,
        speakerLabel: "マイク 1",
        text: "テスト発話です。",
        isFinal: true,
        status: "final",
        startSec: 0,
        endSec: 1,
        confidence: 0.99,
      },
    ];

    render(<RealtimeTranscriptionContainer />);

    expect(screen.getByText("対象外（1マイク）")).toBeInTheDocument();
    expect(screen.getByText(/1マイクモードは文字起こしのみ行います/)).toBeInTheDocument();
    expect(screen.getByText("テスト発話です。")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "薬剤師声紋（端末ローカル）" }),
    ).not.toBeInTheDocument();
  });

  it("2マイク時も声紋登録バーを表示せず、不明な発話は患者に寄せる", () => {
    mocks.hookState.mode = "dual";
    const conv = createInitialConversationState("conv-unknown");
    mocks.hookState.conversation = {
      ...conv,
      segments: [
        {
          stream_id: "s1",
          segment_id: "seg-unk",
          segment_revision: 1,
          transcript_revision: 1,
          channel_index: 1,
          speaker_role: "unknown",
          speaker_label: "話者不明",
          text: "お待たせしました。",
          status: "final",
          start_sec: 0.4,
          end_sec: 1.5,
          confidence: 0.9,
        },
      ],
    };

    render(<RealtimeTranscriptionContainer />);

    expect(
      screen.queryByRole("region", { name: "薬剤師声紋（端末ローカル）" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("話者不明")).not.toBeInTheDocument();
    expect(screen.getAllByText("患者").length).toBeGreaterThan(0);
    expect(screen.getByText("お待たせしました。")).toBeInTheDocument();
  });
});
