# Realtime Voice

Next.js + FastAPI + pnpm 12 + Vercel のプロジェクトテンプレートです。

## 必要な環境

- Node.js 24.x
- pnpm 12.18.0（ルートの `package.json` の `packageManager` / `engines` に指定）
- Python 3.14（`backend/.python-version` に指定。pnpm の Python ワークスペース機能で環境を管理）

Corepack を利用する場合は、初回に次を実行します。Corepack 自体が未導入なら先に導入してください。

```powershell
corepack enable
corepack prepare pnpm@12.18.0 --activate
pnpm --version
```

## セットアップと起動

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm-workspace.yaml` の `python.enabled: true` により、Frontend・Backend の依存関係をまとめてインストールします。通常の開発起動には環境変数の設定は不要です。

- Frontend: http://localhost:3000
- Backend: http://127.0.0.1:8000/api/health
- FastAPI APIドキュメント: http://127.0.0.1:8000/docs

開発時は Next.js が `/api/*` を Backend に転送します。転送先を変更する場合は、ルートの `.env.example` を `frontend/.env.local` にコピーし、`BACKEND_URL` を編集して Frontend を再起動してください。Next.js は `frontend/` をアプリのルートとして環境変数を読み込みます。

Backend の `CORS_ORIGINS` は、許可する Origin をカンマ区切りで指定するプロセス環境変数です。既定値は `http://localhost:3000` と `http://127.0.0.1:3000` です。

### 環境変数（認証・文字起こし）

ローカル開発時はルートに `.env`（Backend 参照）および `frontend/.env.local`（Frontend 参照）を配置し、実値や秘密情報はコミットしないでください。

- **Frontend（`frontend/.env.local` 等）**:
  - `NEXT_PUBLIC_SUPABASE_URL`: Supabase プロジェクト URL
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase Publishable Key（従来の anon key。Service Role / Secret Key は設定しない）
  - `APP_PUBLIC_URL`（任意）: OAuth コールバック後のリダイレクト先 Origin を固定するための信頼済み公開 URL（ローカル開発時は省略可、例: `http://localhost:3000`）
- **Backend（`.env` 等）**:
  - `DEEPGRAM_KEY` / `DEEPGRAM_MODEL`: Deepgram API キーとモデル（既定 `nova-3`。Backend のみに置き、ブラウザへは公開しない）
  - `STT_MONO_MIX_ENABLED` / `STT_VAD_ENABLED`: 既定は両方 `false`。精度優先で2ch PCMを無音・小声を含めてそのまま送り、Deepgram の `multichannel=true` で独立認識する。ch0=薬剤師、ch1=患者を維持する。既存環境で `true` にしている場合は両方 `false` に変更してBackendを再起動する
  - `STT_VAD_RMS_THRESHOLD` / `STT_VAD_PREROLL_MS` / `STT_VAD_HANGOVER_MS` / `STT_KEEPALIVE_INTERVAL_SECONDS`: 明示的にモノラル合成・VADを有効化して比較実験する場合の設定。通常の精度優先構成では音声カットに使用しない
  - `SUPABASE_URL`: JWT / JWKS 検証対象の Supabase プロジェクト URL（ES256 / RS256 の非対称鍵を前提）
  - `SUPABASE_JWT_AUDIENCE`: 既定値 `authenticated`
  - `CORS_ORIGINS` / `WS_ALLOWED_ORIGINS`: 許可するフロントエンド Origin（カンマ区切り）
  - `TRANSCRIPTION_MAX_SESSION_SECONDS`: 1 回の文字起こし WebSocket セッション上限（既定 `240` 秒。Vercel 実行時間上限より短く設定）
  - `SOAP_LLM_PROVIDER` / `SOAP_LLM_MODEL` / `SOAP_LLM_FINALIZE_MODEL` / `SOAP_LLM_THINKING_BUDGET` / `SOAP_LLM_MAX_TOKENS` / `SOAP_LLM_TIMEOUT_SECONDS` / `GOOGLE_API_KEY`: リアルタイム SOAP 生成用 LLM 設定（既定は `google_genai`、既定モデル `gemini-3.5-flash-lite`、思考トークン予算既定 `0`。無効化時は `off` または `none` を指定）
  - `SOAP_MIN_INTERVAL_SECONDS` / `SOAP_MAX_BATCH_WAIT_SECONDS`: リアルタイム SOAP 抽出バッチ間隔（既定 `12.0` 秒）

短い肯定・否定返答や挨拶も、確定発話として直近の会話文脈とともにLLMへ渡します。質問への回答か相槌かを文字列だけでは判定しません。回り込みの自動除外は、空白を除く同一文が8文字以上、両区間の重なりが長い側の80%以上、他chのRMSが自chの3倍超という保守的な初期条件に限定し、除外候補は内部に保持します。これらの閾値は実録音で精度検証済みの値ではありません。

実機では、各マイクを担当話者の口元に近づけ、入力ゲインを調整して音割れと回り込みを抑えます。同じ2ch録音で、話者の誤割り当て、発話の欠落・重複、薬剤名・数値・否定表現の誤りを分けて評価してください。

2マイク時はブラウザの自動ゲイン調整を無効にするよう要求し、遠い声が自動増幅されてマイク間の音量差が縮むのを抑えます。ただし、ブラウザ・デバイス側で要求が反映されるかは実機確認が必要です。2ch独立認識自体は話者分離ではなく、両マイクが拾った声は両chで認識されます。同じ場所から1人で2役を話しても役割は判定できません。カウンターでの評価は2人が各自の位置で行い、1人で試す場合は役ごとに話す位置を変えてください。

## 構成

- `frontend/src/app/`: App Router、レイアウト、ページ
- `frontend/src/features/`: データ取得と表示の接続（Container / custom Hook）
- `frontend/src/shared/ui/`: ヘッドレスUIを包む、Props ベースの最小部品
- `frontend/src/shared/components/`: UI部品を組み合わせる Presentational コンポーネント
- `frontend/src/shared/lib/`: データ取得等の外部ライブラリのアダプタ
- `frontend/config/stylexVitePlugin.ts`: Storybook / Vitest 共通の StyleX 変換
- `backend/app/`: FastAPI の `routers` / `schemas` / `services` / `clients` / `core`
- `.agents/rules/`: 設計・コーディング規約
- `.agents/skills/`: React の責務分離、Effect の要否判断の Skill
- `.github/workflows/ci.yml`: 静的検証、単体テスト、E2E、Storybook描画、本番ビルド
- `vercel.json`: Frontend / Backend の Services と公開ルーティング
- `scripts/`: Node.js 24 で直接実行する TypeScript（`.mts`）の開発用スクリプトとテスト。型チェックは `pnpm typecheck:scripts`

## コマンド

バージョン管理は Git を使います。作業手順は [バージョン管理ルール](.agents/rules/vcs.md) を参照してください。コミット前は `pnpm check` と必要なテストを実行します。

| コマンド | 内容 |
|---|---|
| `pnpm dev` | Frontend と Backend を同時起動 |
| `pnpm dev:frontend` / `pnpm dev:backend` | 各サーバーを単独起動 |
| `pnpm lint` | Biome、Ruff、Backend の依存方向チェック |
| `pnpm format` | Biome / Ruff による整形・修正 |
| `pnpm check` | ローカルパス混入検査、Biome、TypeScript、mypy、Ruff、依存方向、Python の整形チェック |
| `pnpm check:paths` | Git対象のファイルとリンクにローカルの絶対パスがないか検査 |
| `pnpm test` | 検査スクリプトのテスト、Frontend の Vitest、Backend の pytest |
| `pnpm test:frontend` / `pnpm test:backend` | 各単体テストを個別実行 |
| `pnpm test:e2e` | 開発サーバーを起動し、Chromium から FastAPI まで検証 |
| `pnpm build` | Next.js の本番ビルド |
| `pnpm storybook` | Storybook を http://localhost:6006 で起動 |
| `pnpm build-storybook` | Storybook の静的ビルド |
| `pnpm test:storybook` | 静的ビルド後、全ストーリーの描画と StyleX の適用を Chromium で検証 |

E2E / Storybook のブラウザ検証前に、初回のみ Chromium をインストールします。

```powershell
pnpm --filter frontend exec playwright install chromium
```

Linux でシステム依存も導入する場合は `playwright install chromium --with-deps` を使います。E2E はポート 3000 / 8000、Storybook 検証は 6007 を使用します。E2E はローカルで起動済みのサーバーを再利用し、CI では新規起動します。Storybook 検証は常に専用サーバーを起動するため、6007 を空けてください。開発用Storybookの6006とは別ポートです。

## Vercel

[Vercel Services](https://vercel.com/docs/services)（Beta）で Next.js と FastAPI を同じプロジェクトへ配置します。

- Vercel プロジェクトの Root Directory はリポジトリのルートを指定します。
- `frontend` サービスは `frontend/` の Next.js をビルドします。
- `backend` サービスは `backend/` の `app.main:app` を FastAPI のエントリポイントとして読み込みます。
- `/api/*` は Backend、それ以外は Frontend へ転送します。Backend に渡るパスは `/api/health` のままです。
- 本番のAPI接続は同一ドメインのルーティングを使うため、開発用の `BACKEND_URL` は不要です。

Vercel の Git 連携では、この設定を持つリポジトリのルートからデプロイします。初回プレビューでは `/` の表示、`/api/health` のJSON応答、画面の更新操作を確認してください。`pnpm build` は Next.js のビルド検証であり、Vercel 上のサービス結合まで検証するものではありません。

## 生成物とキャッシュ

- `.cache/`: Ruff / mypy / Vitest のキャッシュ、Playwright の結果、Storybook の静的ビルド
- `backend/.venv`: pnpm が管理する Python 環境へのリンク。ローカル環境に依存するため Git から除外
- `*.tsbuildinfo`: TypeScript の増分ビルド情報。Git から除外
- `frontend/.next/`: Next.js の開発・ビルド出力
- Python の起動コマンドは `-B` で bytecode 生成を抑制。pytest のキャッシュは無効化

`pnpm-lock.yaml` と `backend/pylock.toml` は依存関係を再現するためコミットします。

`pnpm check:paths` は追跡中・未追跡の無視されていないファイルを検査します。Windows のドライブ付きパス、Unix のホーム配下、file URI、UNCパス、絶対パスのリンクを検出すると失敗します。コミット直前のステージ内容だけを検査する場合は `pnpm check:paths --staged` を使います。検出したパスの値はログに出しません。除外済みの生成物やバイナリ、外部へ貼り付ける実行ログはこの検査の対象外です。

ローカルでの `pnpm install` 時に Git の `pre-commit` フックを設定します。`git commit` 前にステージ済みの内容を検査し、混入があればコミットを中止します。再設定は `pnpm hooks:install` で実行できます。既存のコミット前・push前フックは引き継ぎ、以前のパスはローカルGit設定だけに保存します。CIやGit管理外ではインストール処理をスキップします。Gitフックを呼ばないツールによるコミットは対象外です。

Python のロック対象は Windows x64 と Linux x64（manylinux 2.28 以降）、Python 3.14 です。別のOS・CPUを使う場合は `pnpm-workspace.yaml` の `supportedArchitectures` に追加し、`pnpm install --no-frozen-lockfile` でロックファイルを更新してください。
