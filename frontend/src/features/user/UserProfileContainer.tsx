"use client";

import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import { useAudioInputDevices } from "@/features/audio/useAudioInputDevices";
import { useSpeakerEnrollment } from "@/features/speaker/useSpeakerEnrollment";
import type { AudioDeviceOption } from "@/shared/components";
import { SpeakerEnrollmentBar } from "@/shared/components";
import { subscribeAuthState } from "@/shared/lib/supabase/client";
import { Badge, Banner, Button, Card, Select } from "@/shared/ui";
import { userProfileContainerStyles as s } from "./UserProfileContainer.styles";
import { useUserProfile } from "./useUserProfile";

const ENROLLMENT_PROMPTS = [
  "こんにちは。今日はお薬の飲み方を確認します。いつもの声でゆっくりお話しください。",
  "朝と夜の食事の後に、お水で飲んでください。飲み忘れたときは薬局にご相談ください。",
  "気になることや体調の変化はありますか。普段の生活や食事についても教えてください。",
] as const;

export interface UserProfileViewProps {
  /** 表示中のログインユーザーID */
  userId: string;
  /** バックエンドでマスキング済みのメールアドレス */
  maskedEmail: string | null;
  /** プロフィール取得中か */
  isProfileLoading?: boolean;
  /** プロフィール取得エラー */
  profileError?: string | null;
  /** 利用可能な音声入力デバイス一覧 */
  devices: readonly AudioDeviceOption[];
  /** 声紋登録に選択中のマイクデバイスID */
  selectedMicDeviceId: string;
  /** マイク選択変更ハンドラ */
  onMicDeviceChange: (deviceId: string) => void;
  /** デバイス再取得ハンドラ */
  onRefreshDevices: () => void;
  /** デバイス取得エラー */
  deviceError?: string | null;
  /** デバイス状態に関する案内 */
  deviceNotice?: string | null;
  /** 薬剤師声紋登録バーへ渡す props */
  speakerBar: ComponentProps<typeof SpeakerEnrollmentBar>;
}

/**
 * ユーザーアカウント情報と薬剤師声紋の事前登録 UI を表示する純粋ビュー。
 */
export function UserProfileView({
  userId,
  maskedEmail,
  isProfileLoading = false,
  profileError = null,
  devices,
  selectedMicDeviceId,
  onMicDeviceChange,
  onRefreshDevices,
  deviceError,
  deviceNotice,
  speakerBar,
}: UserProfileViewProps) {
  const deviceOptions = devices.map((device) => ({
    value: device.deviceId,
    label: device.label,
  }));

  const emailDisplayText =
    isProfileLoading && maskedEmail === null
      ? "読み込み中..."
      : profileError && maskedEmail === null
        ? "取得できませんでした"
        : (maskedEmail ?? "未設定");

  return (
    <div {...stylex.props(s.root)}>
      <Card variant="outlined" style={s.accountCard}>
        <div {...stylex.props(s.cardHeader)}>
          <div {...stylex.props(s.cardHeadingGroup)}>
            <h2 {...stylex.props(s.cardTitle)}>アカウント情報</h2>
            <Badge tone="success">ログイン中</Badge>
          </div>

          <Link href="/transcription" {...stylex.props(s.workspaceLink)}>
            文字起こし画面へ
          </Link>
        </div>

        <dl {...stylex.props(s.infoList)}>
          <div {...stylex.props(s.infoItem)}>
            <dt {...stylex.props(s.infoTerm)}>メールアドレス</dt>
            <dd {...stylex.props(s.infoValue)}>{emailDisplayText}</dd>
          </div>
          <div {...stylex.props(s.infoItem)}>
            <dt {...stylex.props(s.infoTerm)}>ユーザーID</dt>
            <dd {...stylex.props(s.infoValue, s.infoValueMono)}>{userId}</dd>
          </div>
        </dl>

        {profileError ? (
          <Banner tone="danger" size="sm" role="alert">
            {profileError}
          </Banner>
        ) : null}

        <p {...stylex.props(s.helperText)}>
          登録した薬剤師声紋は現在のアカウントに紐づけて、このブラウザの端末ローカル（IndexedDB）のみに保存されます。
        </p>
      </Card>

      <section aria-label="薬剤師声紋の設定" {...stylex.props(s.voiceprintSection)}>
        <Card variant="outlined" style={s.deviceCard}>
          <div {...stylex.props(s.cardHeadingGroup)}>
            <h2 {...stylex.props(s.cardTitle)}>声紋登録用マイク</h2>
          </div>

          <p {...stylex.props(s.helperText)}>
            2マイク文字起こしで薬剤師（本人）の声を見分けるための声紋を事前登録します。録音に使う薬剤師側マイクを選択してください。
          </p>

          <div {...stylex.props(s.deviceControls)}>
            <div {...stylex.props(s.deviceSelectWrap)}>
              <Select
                label="録音用マイク"
                options={deviceOptions}
                value={selectedMicDeviceId || null}
                placeholder="マイクが見つかりません"
                disabled={speakerBar.isEnrolling || devices.length === 0}
                onValueChange={(nextValue) => {
                  if (nextValue !== null) {
                    onMicDeviceChange(nextValue);
                  }
                }}
              />
            </div>

            <Button
              variant="outlined"
              size="md"
              onClick={onRefreshDevices}
              disabled={speakerBar.isEnrolling}
            >
              デバイス再取得
            </Button>
          </div>

          {deviceNotice ? (
            <Banner tone="info" size="sm">
              {deviceNotice}
            </Banner>
          ) : null}

          {deviceError ? (
            <Banner tone="danger" size="sm" role="alert">
              {deviceError}
            </Banner>
          ) : null}
        </Card>

        <SpeakerEnrollmentBar {...speakerBar} />
      </section>
    </div>
  );
}

export interface UserProfileContainerProps {
  /** サーバー側で解決済みの初期ユーザーID */
  initialUserId: string;
}

/**
 * ユーザーアカウント表示と薬剤師声紋登録を接続するコンテナ。
 */
export function UserProfileContainer({ initialUserId }: UserProfileContainerProps) {
  const router = useRouter();
  const [isAuthValid, setIsAuthValid] = useState(true);
  const speaker = useSpeakerEnrollment();
  const { devices, error: deviceError, refreshDevices } = useAudioInputDevices();
  const [selectedMicId, setSelectedMicId] = useState("");

  const activeMicDeviceId = devices.some((device) => device.deviceId === selectedMicId)
    ? selectedMicId
    : (devices[0]?.deviceId ?? "");

  useEffect(
    () =>
      subscribeAuthState({
        onUserChanged: (user) => {
          if (user?.userId !== initialUserId) {
            setIsAuthValid(false);
            router.replace("/login?next=/user");
          }
        },
      }),
    [initialUserId, router],
  );

  const displayUserId = isAuthValid ? initialUserId : "";
  const {
    profile,
    error: profileError,
    isLoading: isProfileLoading,
  } = useUserProfile(displayUserId);

  const deviceNotice =
    devices.length === 0
      ? "マイクが見つかりません。入力デバイスを接続して「デバイス再取得」を押してください。"
      : !activeMicDeviceId
        ? "「デバイス再取得」を押し、表示されるマイクの利用許可を選択してください。"
        : null;

  const speakerBar: ComponentProps<typeof SpeakerEnrollmentBar> = {
    title: "薬剤師声紋（端末ローカル）",
    badgeText: speaker.isEnrolling
      ? "録音中..."
      : speaker.error
        ? "登録エラー"
        : speaker.voiceprint
          ? "登録済み"
          : "未登録",
    badgeTone: speaker.error
      ? "danger"
      : speaker.voiceprint && !speaker.isEnrolling
        ? "success"
        : "neutral",
    descriptionText: speaker.isEnrolling
      ? `録音 ${speaker.sampleIndex + 1}/3（最大10秒）：進捗が満たされるまで読み上げてください。${
          ENROLLMENT_PROMPTS[speaker.sampleIndex] ?? ""
        }`
      : speaker.voiceprint
        ? `アカウント紐づけ済み（有音 ${speaker.voiceprint.voicedSec.toFixed(1)} 秒）`
        : "薬剤師マイクに向かって3回読み上げます。各回、有効音声が約3秒分集まると次へ進みます（最大10秒）。",
    actionLabel: speaker.voiceprint ? "声紋を再登録" : "3回録音して声紋登録",
    cancelLabel: "録音中止",
    clearLabel: "削除",
    isEnrolling: speaker.isEnrolling,
    canEnroll: Boolean(activeMicDeviceId),
    canClear: Boolean(speaker.voiceprint),
    progressRatio: speaker.progressRatio,
    progressLabel: `有効音声 ${Math.round(speaker.progressRatio * 100)}%`,
    warningMessages: speaker.warnings,
    errorMessage: speaker.error,
    onEnroll: () => {
      if (activeMicDeviceId) {
        void speaker.enroll(activeMicDeviceId);
      }
    },
    onCancel: speaker.cancel,
    onClear: () => {
      void speaker.clear();
    },
  };

  if (!isAuthValid) return null;

  return (
    <UserProfileView
      userId={profile?.user_id ?? displayUserId}
      maskedEmail={profile?.masked_email ?? null}
      isProfileLoading={isProfileLoading}
      profileError={profileError}
      devices={devices}
      selectedMicDeviceId={activeMicDeviceId}
      onMicDeviceChange={setSelectedMicId}
      onRefreshDevices={() => {
        void refreshDevices(true);
      }}
      deviceError={deviceError}
      deviceNotice={deviceNotice}
      speakerBar={speakerBar}
    />
  );
}
