import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserProfileContainer } from "./UserProfileContainer";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  unsubscribe: vi.fn(),
  authCallbacks: null as null | {
    onUserChanged?: (user: { userId: string; email: string | null } | null) => void;
  },
  enroll: vi.fn(async () => {}),
  cancel: vi.fn(),
  clear: vi.fn(async () => {}),
  refreshDevices: vi.fn(async () => {}),
  devices: [
    { deviceId: "mic-1", label: "薬剤師用マイク" },
    { deviceId: "mic-2", label: "サブマイク" },
  ],
  deviceError: null as string | null,
  profileState: {
    profile: { user_id: "user-1", masked_email: "p***@e***.com" } as {
      user_id: string;
      masked_email: string | null;
    } | null,
    error: null as string | null,
    isLoading: false,
    refetch: vi.fn(),
  },
  speakerState: {
    userId: "user-1" as string | null,
    voiceprint: null as null | {
      userId: string;
      modelId: string;
      embeddingDim: number;
      embedding: number[];
      voicedSec: number;
      updatedAt: string;
    },
    isEnrolling: false,
    progressRatio: 0,
    sampleIndex: 0,
    warnings: [] as string[],
    error: null as string | null,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/shared/lib/supabase/client", () => ({
  subscribeAuthState: (callbacks: NonNullable<typeof mocks.authCallbacks>) => {
    mocks.authCallbacks = callbacks;
    return mocks.unsubscribe;
  },
}));

vi.mock("@/features/speaker/useSpeakerEnrollment", () => ({
  useSpeakerEnrollment: () => ({
    ...mocks.speakerState,
    enroll: mocks.enroll,
    cancel: mocks.cancel,
    clear: mocks.clear,
    reportProfileRejected: vi.fn(),
  }),
}));

vi.mock("@/features/audio/useAudioInputDevices", () => ({
  useAudioInputDevices: () => ({
    devices: mocks.devices,
    error: mocks.deviceError,
    refreshDevices: mocks.refreshDevices,
  }),
}));

vi.mock("./useUserProfile", () => ({
  useUserProfile: () => mocks.profileState,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.devices = [
    { deviceId: "mic-1", label: "薬剤師用マイク" },
    { deviceId: "mic-2", label: "サブマイク" },
  ];
  mocks.deviceError = null;
  mocks.profileState = {
    profile: { user_id: "user-1", masked_email: "p***@e***.com" },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  };
  mocks.speakerState = {
    userId: "user-1",
    voiceprint: null,
    isEnrolling: false,
    progressRatio: 0,
    sampleIndex: 0,
    warnings: [],
    error: null,
  };
});

describe("UserProfileContainer", () => {
  it("バックエンドでマスクされたメールアドレス・声紋登録バー・文字起こし画面へのリンクを表示し、選択マイクで登録できる", () => {
    render(<UserProfileContainer initialUserId="user-1" />);

    expect(screen.getByText("p***@e***.com")).toBeInTheDocument();
    expect(screen.getByText("user-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "文字起こし画面へ" })).toHaveAttribute(
      "href",
      "/transcription",
    );
    expect(screen.getByRole("region", { name: "薬剤師声紋（端末ローカル）" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "3回録音して声紋登録" }));
    expect(mocks.enroll).toHaveBeenCalledWith("mic-1");

    fireEvent.click(screen.getByRole("button", { name: "デバイス再取得" }));
    expect(mocks.refreshDevices).toHaveBeenCalledOnce();
    expect(mocks.refreshDevices).toHaveBeenCalledWith(true);
  });

  it("登録済み声紋がある場合は再登録と削除が可能で、エラー時も表示する", () => {
    mocks.profileState.profile = { user_id: "user-1", masked_email: null };
    mocks.speakerState.voiceprint = {
      userId: "user-1",
      modelId: "cam++",
      embeddingDim: 192,
      embedding: [0.1, 0.2],
      voicedSec: 9.2,
      updatedAt: "2026-11-15T12:00:00Z",
    };
    mocks.speakerState.error = "声紋の検証に失敗しました。";

    render(<UserProfileContainer initialUserId="user-1" />);

    expect(screen.getByText("未設定")).toBeInTheDocument();
    expect(screen.getByText("登録エラー")).toBeInTheDocument();
    expect(screen.getByText("声紋の検証に失敗しました。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(mocks.clear).toHaveBeenCalledOnce();
  });

  it("録音中は中止ボタンで録音をキャンセルでき、デバイス再取得を無効化する", () => {
    mocks.speakerState.isEnrolling = true;
    mocks.speakerState.sampleIndex = 1;
    mocks.speakerState.progressRatio = 0.5;

    render(<UserProfileContainer initialUserId="user-1" />);

    expect(screen.getByText("録音中...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "デバイス再取得" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "録音中止" }));
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it("プロフィール取得エラー時は取得失敗表示とエラーバナーを表示する", () => {
    mocks.profileState.profile = null;
    mocks.profileState.error = "ログインセッションを確認できませんでした。";

    render(<UserProfileContainer initialUserId="user-1" />);

    expect(screen.getByText("取得できませんでした")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ログインセッションを確認できませんでした。",
    );
  });

  it("権限未許可でデバイスIDが空でも、再取得操作から権限を要求できる", () => {
    mocks.devices = [{ deviceId: "", label: "マイク 1" }];
    render(<UserProfileContainer initialUserId="user-1" />);

    expect(screen.getByRole("button", { name: "3回録音して声紋登録" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "デバイス再取得" }));
    expect(mocks.refreshDevices).toHaveBeenCalledWith(true);
  });

  it.each([null, { userId: "user-2", email: null }])(
    "認証ユーザーが変わったら旧プロフィールを隠してログイン画面へ戻す: %s",
    (user) => {
      const { unmount } = render(<UserProfileContainer initialUserId="user-1" />);
      expect(screen.getByText("p***@e***.com")).toBeInTheDocument();

      act(() => mocks.authCallbacks?.onUserChanged?.(user));

      expect(screen.queryByText("p***@e***.com")).not.toBeInTheDocument();
      expect(screen.queryByText("user-1")).not.toBeInTheDocument();
      expect(screen.queryByText("ログイン中")).not.toBeInTheDocument();
      expect(mocks.replace).toHaveBeenCalledWith("/login?next=/user");
      unmount();
      expect(mocks.unsubscribe).toHaveBeenCalled();
    },
  );
});
