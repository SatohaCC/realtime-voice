# ローカル話者認識 技術検証（PoC）および実装計画

作成日: 2026-11-15。確定前提に基づく技術検証と段階的実装の計画。

## 1. 確定した設計前提

- **実行環境**: CPU のみで実用になること（薬局 PC や GPU 非搭載環境でも動作すること）。
- **声紋データの保持方針**:
  - **薬剤師（アカウント紐づけ）**: 事前に登録し、**端末ローカル（ブラウザの `IndexedDB` に `user_id` キーで保存）** へ永続保存する。クラウド DB には保存しない。生音声（WAV/PCM）は保存せず、抽出済みの特徴ベクトルとモデル識別子（`model_id`）・更新日時のみを保持する。
  - **1ログインアカウント＝薬剤師1名**: 認証済み `user_id`（Supabase JWT の `sub`）につき 1 件の薬剤師プロファイルを扱う。
  - **患者（来局者）**: 事前登録・長期保存は行わず、会話中のみ RAM 上に一時的な話者重心を構築し、会話終了時（「新しい会話」・完了・切断/TTL）に破棄する。
- **優先順位**: コスト削減より、話者割り当て精度・短い返答の保持・文字起こし品質（薬剤名・数値・否定表現）を優先する。

## 2. 現行構成の確認済み制約と改善ポイント

- **ブラウザ収音**（`frontend/src/shared/lib/audio/dualMicCapture.ts`）:
  - 2マイク時は `autoGainControl: false` だが、`echoCancellation: true` と `noiseSuppression: true` が固定で有効。声質特徴への影響を実録音で比較する。
- **Backend 音声履歴**（`backend/app/services/conversation_service.py`）:
  - 既定では `BackendAudioLevelHistory` が 100ms ごとの RMS 数値のみ保持し、生 PCM を残さない。話者照合や遅延再判定には、会話限定の直近 2ch PCM リングバッファ（例: 30 秒分・終了時破棄）が必要。
- **Deepgram 解析**（`backend/app/services/soap_stream_service.py`）:
  - 現在はセグメント全体の `transcript` / `start` / `duration` のみ利用し、`words[]`（単語別時刻）を取得していない。1 発話内に話者交代が混ざるケースを分割するには単語時刻の利用が必要。
- **スキーマ・SOAP 整合**（`backend/app/schemas/soap.py`, `backend/app/services/soap_service.py`）:
  - `SpeakerRole` が `"pharmacist" | "patient"` の 2 値固定で、保留（`"unknown"`）を表現できない。
  - `TranscriptStatus` に `"refined"` はあるが、確定後の話者訂正・分割・重複統合に伴う既反映 SOAP 項目の自動再評価パスが未実装。

## 3. CPU のみでの技術候補と採用方針

- **第一候補**: `sherpa-onnx` + `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`（約 27 MB, Apache-2.0, 192 次元埋め込み）。
  - Python 3.14（Windows x64 / Linux x64）の公式 wheel が利用可能であり、PyTorch を不要とすることで依存容量・メモリ・起動時間を抑えられる。
  - 比較対象として `3dspeaker_speech_eres2net_base_200k_sv_zh-cn_16k-common.onnx` 等や、区間検出用の `Silero VAD`（約 2 MB, MIT）も評価可能。
- **不採用候補（現時点）**: `SpeechBrain` / `pyannote.audio` の PyTorch 版（Python 3.14 互換・依存容量 1〜2GB 超・HF gated 制約のため本番組み込み不適）。

## 4. 事前登録（薬剤師のみ）＋ 会話中判定の方式

```text
[事前登録フロー（初回・再登録時のみ）]
  ブラウザ収音 (3〜5秒・単一マイク)
    -> Backend 一時抽出 (sherpa-onnx CPU) ※Backendは抽出後すぐ破棄
    -> ブラウザ IndexedDB へ { userId, modelId, embedding[192], updatedAt } を保存

[会話中フロー]
  WebSocket 接続 (Auth -> AuthOk)
    -> ブラウザが IndexedDB から該当 userId の embedding を読み込み、
       セッション初期化フレームで Backend メモリへ送信（再接続時も再送可）
    -> Backend ConversationSessionRecord の RAM 上のみに保持
    -> 会話中:
         1. 薬剤師照合スコア s_P（登録ベクトルとのコサイン類似度）
         2. 患者一時重心スコア s_Q（ch1優位・高SNR・非薬剤師区間から会話内のみで構築）
         3. 2ch RMS 比・時刻重畳・文字列類似度
       を組み合わせ、pharmacist / patient / unknown を判定
    -> 短発話（「はい」「いいえ」等）は即時暫定表示し、後続 1〜2 秒を含めて再判定
    -> 「薬剤師に一致しない＝すべて患者」にはせず、低類似・拮抗時は unknown（保留）とする
    -> 会話終了・「新しい会話」押下時に Backend RAM の音声バッファと重心を即時破棄
```

## 5. PoC（最小技術検証）の内容と受入条件

本番コード（`backend/app/`・`frontend/src/`）を変更する前に、独立した検証スクリプト（`backend/scripts/speaker_poc_eval.py`）で以下を実測する。

### 測定項目（現行ベースライン vs 候補方式）

1. CPU 単体でのモデルロード時間・RSS メモリ増分・1発話（0.5s / 1.5s / 3.0s）あたりの推論遅延
2. 話者誤割り当て率
3. 発話の欠落率と二重表示率（表記揺れ・区間ズレ重複を含む）
4. 短い肯定・否定返答（「はい」「いいえ」等）の保持率
5. 同時発話・話者交代境界の誤り
6. 薬剤名・数値・否定表現への悪影響の有無

### 評価データの分離条件

- **登録音声（Enrollment）**: 薬剤師役の事前登録用 3〜5 秒（評価会話とは別録音）。
- **閾値調整用（Dev）**: カウンター距離での 2ch 16kHz WAV 会話録音 2〜3 本。
- **最終評価用（Eval）**: 閾値固定後に 1 回だけ計測する別録音 5〜10 本。
  - 含めるシナリオ: 通常交互会話 / 短返答連続 / 同時発話・相槌 / 連続発話内の話者交代 / 薬剤名・用量・否定表現 / 第三者の声・雑音 / ブラウザ AEC・NS ON/OFF 比較。
