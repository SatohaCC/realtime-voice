# Supabase Auth 導入計画

作成日: 2026-11-15。実装前の計画。
基準: `93ae4105`（FastAPI WebSocket中継とリアルタイム文字起こしUI）。

## 決定済みの範囲

- トップページは公開を維持する。
- 文字起こしを `/transcription` に移し、このページと文字起こしAPIを認証必須にする。
- OAuthプロバイダはGoogleのみ。
- Next.js 16、FastAPI、StyleX、既存の医療向けM3テーマを維持する。
- 収音キャンセル、末尾PCMのflush、最終結果の待機、発話区間の音量履歴、再接続時のセグメント分離を維持する。
- この計画には実装・コミット・プッシュ・デプロイ・外部サービスの設定変更を含めない。

## 画面とAPI

| パス | アクセス | 役割 |
|---|---|---|
| `/` | 公開 | 紹介、接続状態、配色。文字起こしは別ページへのリンクにする |
| `/transcription` | ログイン必須 | 既存の収音・文字起こし画面。Server Componentでも認証を確認する |
| `/login` | 公開 | Googleでログイン。認証済みなら安全な戻り先へ移動 |
| `/auth/callback` | 公開 | OAuthのcodeをCookieセッションへ交換 |
| `/auth/logout` | POST | ログアウト。Originを検査し、GETでは実行しない |
| `/api/health` | 公開 | 監視用のヘルスチェック |
| `/api/transcriptions/ws` | 認証必須 | Next.jsを経由しない接続でもFastAPIで認証する |

ログイン後の既定の戻り先は `/transcription`。`next` は許可したアプリ内パスだけを扱い、外部URL、`//`、バックスラッシュ等による迂回を拒否する。OAuthの戻り先originは信頼する設定から構成し、任意のHostヘッダーを信用しない。

## Phase 0: 外部設定と接続条件の準備

1. Supabaseプロジェクトと現在の署名方式を確認する。JWKSによる検証の前提をES256 / RS256の非対称鍵に固定し、HS256を無言で許可しない。
2. Googleを有効化し、プロバイダのコールバックにはSupabaseの `/auth/v1/callback` を登録する。また、`Authentication > Sign In / Providers`（または `User Signups`）で **Allow new users to sign up** を無効化し、管理者が `Authentication > Users` から事前招待・登録したメールアドレスのみログインを許可する運用とする。
3. SupabaseのRedirect URLsにはローカル・本番・運用するPreviewの `/auth/callback` を登録する。Previewを許可する範囲はチームの管理対象に限定する。
4. `.env.example` とREADMEに以下を記載する。実値や秘密情報はコミットしない。
   - Frontend: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Backend: `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE=authenticated`, 許可するフロントエンドOrigin
   - 必要に応じて信頼するアプリの公開URLと、文字起こしセッションの時間上限
   - 既存の `DEEPGRAM_KEY` はBackendだけに置く。Supabaseのservice role / secret keyは今回不要。
5. VercelのFluid compute、FastAPIサービスへのWebSocket経路、最大実行時間を確認する。セッション上限を最大実行時間より短く設定し、既存の最終結果待機と終了処理の時間を確保する。

受入条件: 署名方式・公開URL・Origin・接続時間上限が確認できる。認証設定が欠けているときは文字起こしAPIを拒否し、Deepgramへ接続しない。トップページとhealthは利用可能にする。

## Phase 1: Backendの認証境界

### 実装先

- `backend/pyproject.toml`, `backend/pylock.toml`: `pyjwt[crypto]` を追加。
- `app/core/config.py`: Supabase URL・audience・許可Origin・セッション上限の検証。
- `app/clients/supabase_auth_client.py`: JWKS取得、キャッシュ、署名検証。SDK依存はここに隔離する。
- `app/schemas/auth.py`: 検証済みユーザーと認証フレームの型。
- `app/services/auth_service.py`: 認証ユースケース。FastAPIには依存しない。
- `app/routers/transcriptions.py`, `app/services/transcription_service.py`: 認証済みユーザーを前提に中継を開始する。

### 検証規則

- 検証先JWKS URLとissuerは設定したSupabaseプロジェクトから生成する。JWTに含まれるURLを取得先に使わない。
- 許可する署名アルゴリズムを固定し、署名、`exp`、`iss`、`aud`、空でない`sub`を検証する。`role=authenticated` を要求し、匿名ユーザーのトークンは拒否する。
- `email` はユーザーIDに使わず、任意の表示情報として扱う。ユーザーIDは`sub`。
- JWKSクライアントは再利用する。同期I/Oをイベントループ上で直接実行せず、スレッドへの退避とHTTPタイムアウトを組み合わせる。鍵ローテーション・未知の`kid`・キャッシュ期限・取得失敗を扱う。
- トークン・認証フレーム・Cookieをログへ出さない。利用者へのエラーは安定したコードと一般化した文言で返す。

受入条件: 正常JWTは通り、期限切れ・改ざん・別issuer・別audience・不許可アルゴリズム・必須claim欠落は拒否される。JWKS取得が遅くても別の中継処理のイベントループをブロックしない。

## Phase 2: WebSocket認証と接続ライフサイクル

接続の順序を以下に固定する。

1. Originを検査し、許可外またはOriginなしのブラウザ向け接続を拒否する。
2. WebSocketをacceptし、最初のテキストフレーム `Auth` を期限付きで受信する。
3. JWTを検証する。未認証のPCM・KeepAlive・不正JSON・過大な認証フレームは拒否する。
4. 認証成功後にDeepgramへ接続する。この時点ではマイクを開始しない。
5. 上流接続成功とトークンの残存有効期限を確認して `AuthOk` を返す。
6. Frontendの接続Promiseを解決し、マイクの初期化とPCM送信を開始する。

初期値は認証フレーム待ち5秒・最大16KiB。JWKSのHTTPタイムアウトは3秒を目安にし、認証処理全体の上限も設ける。Deepgram接続待ちは既存の10秒を維持し、Frontendには接続全体の期限を設ける。数値は設定・定数へ集約する。

認証失敗は`Error`とclose code `1008`、上流障害・終了待機タイムアウトは`1011`。正常な停止は既存のCloseStreamと最終結果待機を維持する。認証フレームをDeepgramへ転送しない。

### 中断・期限・再開

- 既存のAbortSignalと接続ごとのライフサイクルに認証待ちも含める。認証前後の画面離脱・接続中断でソケットとマイクを解放する。
- `AuthOk` にはサーバーが検証した有効期限と接続終了予定時刻を含める。
- BackendはJWT期限とセッション上限を監視し、期限後の新しいPCMは受け付けない。受理済み音声の最終化だけを期限付きで処理して終了する。
- 初版では自動再開しない。期限・回線断・Vercelの接続終了時は収音を止め、確定済み履歴を保ち、再開操作を案内する。再開時には更新済みトークンで認証し直す。
- ログアウト時は収音・接続を停止する。フロント側のトークン更新だけで既存WebSocketの有効期限が延びたとは扱わない。
- ログアウト・ユーザー切替では表示中の文字起こし履歴を破棄する。別タブからのログアウト通知でも停止し、保護ページからログイン画面へ移動する。期限終了時の同一ユーザーによる再開とは分ける。
- JWTのローカル検証はログアウト直後の失効を保証しないことを記録する。初版では期限まで有効なアクセストークンを扱う。盗難トークンの即時無効化は、別途サーバー側の失効確認が必要。

受入条件: 不正認証・設定不足ではDeepgram接続数とマイク開始数がゼロ。AuthOk前にPCMを送信しない。期限切れで中継が止まり、再開時は別セッションになる。

## Phase 3: Next.jsの認証とページ分離

1. `@supabase/supabase-js` と `@supabase/ssr` を追加し、`shared/lib/supabase/` にブラウザ・サーバー・Proxy用のアダプタを配置する。
2. `frontend/src/proxy.ts` でCookieセッションを更新する。認証判定には`getClaims()`を使う。`getSession()`は生のアクセストークン取得に限定する。
3. 新しいレスポンスやリダイレクトを作る際も、更新Cookieと`Cache-Control`等のキャッシュ制御を引き継ぐ。個人情報やセッション付きレスポンスを共有キャッシュに保存しない。
4. `/login` と `/auth/callback`、POSTのログアウト処理を追加する。PKCEのcode交換、安全な戻り先検証、OAuth失敗表示を用意する。
5. `/transcription/page.tsx` を追加する。Proxyだけに依存せず、ページのサーバー側境界でも認証を確認し、未ログインなら `/login?next=/transcription` へ移動する。
6. `/` から文字起こし本体を移動し、ヘッダーの「文字起こし」リンクとトップページの導線を更新する。既存の接続確認・配色は公開を維持する。
7. ヘッダーにログイン状態とログイン／ログアウト操作を接続する。共有の表示部品はPropsで表示と操作を受け取り、SupabaseやNext.jsへ依存させない。
8. `useRealtimeTranscription` に認証状態・トークン取得・ログアウト時の停止を接続する。Supabaseをfeaturesから直接importしない。

ログイン画面のカードは既存のM3トークンとStyleXを使う。Googleログインボタンは[Google公式ブランド規定](https://developers.google.com/identity/branding-guidelines)のLightテーマ・公式カラーGロゴ・Google Sansで表示し、ブランド色は製品テーマから独立させる。処理中、失敗、再試行を用意する。表示部品はStorybookで確認し、アプリ内に部品ギャラリーは追加しない。

受入条件: `/`は未ログインで閲覧できる。`/transcription`は直接アクセスでも保護され、Googleでログイン後に同ページへ戻る。ブラウザへDeepgramキーやSupabaseの管理用キーを渡さない。

## Phase 4: テストと最終確認

各Phaseの振る舞いをテストで固定してから実装し、以下を検証する。

- Backend: JWT検証、JWKSキャッシュ・更新・取得失敗、許可外Origin、認証期限、不正フレーム、認証前の上流接続ゼロ、認証成功後の中継、期限終了、終了待機中の最終結果。
- Frontend: Authフレーム送信、AuthOkまでの送信抑止、エラー・タイムアウト・キャンセル、マイク開始競合、ログアウト、期限後の再開、旧接続のイベント無視。
- SSR/OAuth: Cookie偽装、更新Cookieとキャッシュヘッダーの保持、callbackへの直接アクセス、外部への戻り先拒否、POSTログアウト、公開ページと保護ページの分離。
- UI: ログイン画面の明暗テーマ・狭い幅・キーボード・処理中とエラー表示。文字起こしページの既存UIも確認する。
- 回帰: 1/2マイク、部分PCMのflush、最終結果の受信、重複除去、再接続時のセグメント分離を維持する。

実行コマンド: `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:storybook`。変更したファイルだけを整形する。

実OAuthの往復、実マイクとDeepgram、VercelのWebSocket upgrade・接続時間上限は外部設定が必要な統合確認として分ける。スタブの成功を実サービスでの成功とは報告しない。外部サービス準備前でも、コード・スタブテスト・ビルドまでは進められる。

## 参照した公式情報

- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase JWT検証とJWKS](https://supabase.com/docs/guides/auth/jwts)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Signing out](https://supabase.com/docs/guides/auth/signout)
- [PyJWT API](https://pyjwt.readthedocs.io/en/stable/api.html)
- [Vercel WebSockets](https://vercel.com/docs/functions/websockets)
