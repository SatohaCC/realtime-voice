import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { Badge, Card } from "@/shared/ui";
import { pageStyles as s } from "./page.styles";

const FEATURES = [
  {
    badge: "話者分離",
    tone: "success" as const,
    title: "2マイクで患者・薬剤師を自動振り分け",
    description:
      "患者用・薬剤師用の音声を 16kHz PCM で取得し、登録した薬剤師声紋と会話中の患者声紋、マイク間の音量差を使って話者を判定します。不確かな発話は患者側へ表示し、後から手動訂正できます。1マイクでは文字起こしのみ利用できます。",
  },
  {
    badge: "10〜15秒更新",
    tone: "neutral" as const,
    title: "確定発話のバッチ集約でリアルタイム SOAP 化",
    description:
      "Deepgram Nova-3 の確定発話を約 12 秒間隔で集約し、Gemini が S・O・P を差分更新します。相槌や挨拶だけの区間は LLM 呼び出しをスキップし、応答速度とコストを最適化しています。",
  },
  {
    badge: "S/P統合 · 根拠検証",
    tone: "success" as const,
    title: "発話引用の一致と役割制約を厳格チェック",
    description:
      "S（主観的情報）と P（計画）は会話全体を各 1 項目へ整理して更新。引用文字列が確定発話の最新版本文に含まれるか、S=患者・P/A=薬剤師の役割に合致するかを検証してから反映します。",
  },
  {
    badge: "停止時 A 生成",
    tone: "neutral" as const,
    title: "S・O を踏まえて「なぜ P をしたか」を A へ言語化",
    description:
      "会話中に言葉へ表れにくい薬剤師の臨床判断（Assessment）は、文字起こし停止時に最新の S・O・P を突き合わせて「要確認」ドラフトとして自動生成します。",
  },
] as const;

const WORKFLOW_STEPS = [
  {
    step: "1",
    title: "声紋を登録し、マイクを選んで開始",
    description:
      "ログイン後、ユーザー設定で薬剤師声紋を端末ローカルへ登録します。文字起こしページで患者用・薬剤師用のマイクを指定して開始します。",
  },
  {
    step: "2",
    title: "会話しながら S・O・P を確認",
    description:
      "左右のチャットへリアルタイムに文字起こしが流れ、約 12 秒ごとに S・O・P が整理されます。根拠チップから該当発話も追えます。",
  },
  {
    step: "3",
    title: "停止時に A を生成し、コピーして転記",
    description:
      "文字起こし停止で S・O・P から A アセスメント案を自動作成。「SOAP をコピー」で薬歴システムへそのまま貼り付けられます。",
  },
] as const;

export default function HomePage() {
  return (
    <main id="main-content" tabIndex={-1} {...stylex.props(s.page)}>
      <section {...stylex.props(s.hero)}>
        <div {...stylex.props(s.heroLeadCard)}>
          <p {...stylex.props(s.eyebrow)}>薬局服薬指導 × リアルタイム SOAP</p>
          <h1 {...stylex.props(s.headline)}>
            対話を止めずに、
            <br />
            薬歴の土台をその場で。
          </h1>
          <p {...stylex.props(s.description)}>
            患者と薬剤師の 2 マイク音声をリアルタイムで文字起こしし、根拠となる発話と紐づけた
            S・O・P の整理から停止時の A（アセスメント）案生成までを一貫して支援します。
          </p>
          <div {...stylex.props(s.ctaRow)}>
            <Link href="/transcription" {...stylex.props(s.primaryCta)}>
              文字起こしを始める <span aria-hidden="true">→</span>
            </Link>
            <Link href="/mechanism" {...stylex.props(s.secondaryCta)}>
              仕組みを見る
            </Link>
            <Link href="/user" {...stylex.props(s.secondaryCta)}>
              ユーザー設定で声紋登録
            </Link>
          </div>
        </div>

        <aside aria-label="画面構成のイメージ" {...stylex.props(s.previewShell)}>
          <div {...stylex.props(s.previewTopBar)}>
            <span {...stylex.props(s.previewTitle)}>2マイク会話 → 4欄 SOAP 連携</span>
            <Badge tone="neutral">Deepgram Nova-3 · Gemini</Badge>
          </div>

          <div {...stylex.props(s.previewBoard)}>
            <div {...stylex.props(s.previewChatBox)}>
              <div {...stylex.props(s.bubblePatient)}>
                <span {...stylex.props(s.bubbleRole)}>患者</span>
                昨日転んで腰が痛く受診しました。朝ごはんは食べません。
              </div>
              <div {...stylex.props(s.bubblePharmacist)}>
                <span {...stylex.props(s.bubbleRole)}>薬剤師</span>
                朝食べない場合はクッキー等か多めのお水で服用してください。
              </div>
            </div>

            <div {...stylex.props(s.previewSoapGrid)}>
              <div {...stylex.props(s.previewSoapTile)}>
                <div {...stylex.props(s.previewSoapHead)}>
                  <Badge tone="success">S</Badge>
                  <span>主観的情報</span>
                </div>
                <p {...stylex.props(s.previewSoapBody)}>
                  昨日転倒し腰痛で受診。朝食抜きのため朝薬の服用方法を相談。
                </p>
              </div>
              <div {...stylex.props(s.previewSoapTile)}>
                <div {...stylex.props(s.previewSoapHead)}>
                  <Badge tone="neutral">O</Badge>
                  <span>客観的情報</span>
                </div>
                <p {...stylex.props(s.previewSoapBody)}>
                  処方日数・測定値などの事実情報を区別して整理。
                </p>
              </div>
              <div {...stylex.props(s.previewSoapTile)}>
                <div {...stylex.props(s.previewSoapHead)}>
                  <Badge tone="neutral">A</Badge>
                  <span>アセスメント</span>
                </div>
                <p {...stylex.props(s.previewSoapBody)}>
                  S・O を踏まえ胃障害回避のため P を指導したと停止時に生成。
                </p>
              </div>
              <div {...stylex.props(s.previewSoapTile)}>
                <div {...stylex.props(s.previewSoapHead)}>
                  <Badge tone="neutral">P</Badge>
                  <span>計画</span>
                </div>
                <p {...stylex.props(s.previewSoapBody)}>
                  食後服用と軽食または多めの水での服用指導を実施。
                </p>
              </div>
            </div>
          </div>

          <p {...stylex.props(s.previewCaption)}>
            S・P は各 1 項目に統合更新され、すべての項目に発話根拠が紐づきます。
          </p>
        </aside>
      </section>

      <section {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 {...stylex.props(s.sectionTitle)}>現場の対話に合わせた 4 つの特長</h2>
          <p {...stylex.props(s.sectionSub)}>精度・根拠の透明性・API コストのバランスを両立</p>
        </div>
        <ul {...stylex.props(s.featureGrid)}>
          {FEATURES.map((feature) => (
            <li key={feature.title} {...stylex.props(s.featureListItem)}>
              <Card variant="outlined" style={s.featureCard}>
                <div>
                  <Badge tone={feature.tone}>{feature.badge}</Badge>
                </div>
                <h3 {...stylex.props(s.featureTitle)}>{feature.title}</h3>
                <p {...stylex.props(s.featureBody)}>{feature.description}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 {...stylex.props(s.sectionTitle)}>ご利用の流れ</h2>
          <p {...stylex.props(s.sectionSub)}>3 ステップで薬歴の下書きを作成</p>
        </div>
        <ol {...stylex.props(s.stepList)}>
          {WORKFLOW_STEPS.map((item) => (
            <li key={item.step} {...stylex.props(s.stepItem)}>
              <Card variant="filled" style={s.stepCard}>
                <span {...stylex.props(s.stepNumber)} aria-hidden="true">
                  {item.step}
                </span>
                <h3 {...stylex.props(s.stepTitle)}>{item.title}</h3>
                <p {...stylex.props(s.stepBody)}>{item.description}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 {...stylex.props(s.sectionTitle)}>内部ロジックと検証設計</h2>
          <p {...stylex.props(s.sectionSub)}>話者分離・コスト最適化・SOAP 根拠検証の仕組み</p>
        </div>
        <Card variant="elevated" style={s.mechanismBanner}>
          <div {...stylex.props(s.mechanismBody)}>
            <h3 {...stylex.props(s.panelTitle)}>今回のパイプラインと検証ロジック</h3>
            <p {...stylex.props(s.panelDescription)}>
              ブラウザでの 16kHz PCM 収音から、STT 非依存の音量・無音ゲート、Deepgram Nova-3
              の文字起こし、12 秒ごとのバッチ SOAP 更新、そして停止時の S・O・P 統合 A
              アセスメント生成までの設計を詳しく解説しています。
            </p>
          </div>
          <Link href="/mechanism" {...stylex.props(s.inlineLink)}>
            仕組みページで詳しく見る <span aria-hidden="true">→</span>
          </Link>
        </Card>
      </section>

      <footer {...stylex.props(s.footer)}>
        <span>Realtime Voice — 服薬指導向けリアルタイム文字起こし & SOAP 支援</span>
        <div {...stylex.props(s.footerLinks)}>
          <Link href="/" {...stylex.props(s.footerLink)}>
            ホーム
          </Link>
          <Link href="/transcription" {...stylex.props(s.footerLink)}>
            文字起こし
          </Link>
          <Link href="/mechanism" {...stylex.props(s.footerLink)}>
            仕組み
          </Link>
        </div>
      </footer>
    </main>
  );
}
