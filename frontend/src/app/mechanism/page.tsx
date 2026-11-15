import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/shared/ui/badge/Badge";
import { Card } from "@/shared/ui/card/Card";
import { mechanismStyles as s } from "./mechanism.styles";

export const metadata: Metadata = {
  title: "仕組み | Realtime Voice",
  description:
    "2マイク音声の話者分離、STT 非依存 VAD ゲート、Deepgram Nova-3、Gemini による 12 秒バッチ SOAP 更新と停止時 A 生成の内部ロジック。",
};

const PIPELINE_STAGES = [
  {
    step: "1",
    tag: "Browser",
    title: "2マイク 16kHz PCM 収音",
    description:
      "AudioWorklet で患者用・薬剤師用マイクから 16kHz Int16 PCM とチャンネル別 RMS 音量を連続取得し、WebSocket で送信します。",
  },
  {
    step: "2",
    tag: "Audio Gate",
    title: "音量判定と時刻・話者復元",
    description:
      "STT 非依存の AudioActivityGate が RMS 音量判定やモノラル合成・無音スキップを担い、返却時刻を実時刻と話者チャンネルへ戻します。",
  },
  {
    step: "3",
    tag: "Deepgram Nova-3",
    title: "日本語ストリーミング文字起こし",
    description:
      "interim（暫定）と is_final（確定）を即時中継。確定発話は会話レジストリにバージョン付きで蓄積されます。",
  },
  {
    step: "4",
    tag: "Gemini Batch",
    title: "12秒集約で S・O・P を抽出",
    description:
      "受信ループを止めずに確定発話を最大 12 秒で束ね、相槌のみをスキップして S・O・P の差分更新を非同期実行します。",
  },
  {
    step: "5",
    tag: "Stop Finalize",
    title: "S・O・P から A を最終生成",
    description:
      "録音停止時に未反映発話を同期したうえで、S・O・P 全体から「なぜ P を実施したか」の A アセスメント案を生成します。",
  },
] as const;

const CORE_LOGICS = [
  {
    badge: "話者分離 · VAD",
    tone: "success" as const,
    title: "左右話者マッピングと回り込み抑止・再利用可能な音量ゲート",
    summary:
      "画面は左に患者（S）、右に薬剤師（P/A）を配置。音声レベル判定とバックエンドの VAD ゲートを STT エンジンから切り離し、将来の STT 差し替えにも対応できる構造にしています。",
    points: [
      "ブラウザ側 detectSpeakingChannels はノイズ下限 0.025・優位比 1.25 で隣マイクへの声の回り込みを抑止して発話中を表示。",
      "バックエンドの AudioActivityGate は RMS 閾値 0.008・プリロール 300ms・ハングオーバー 600ms で発話区間を抽出し、無音時は KeepAlive（4.0s）で接続維持。",
      "モノラル合成＋VAD 有効時も、STT が返す圧縮タイムスタンプを実会話時刻と優位チャンネル（0/1）へ復元します。",
    ],
  },
  {
    badge: "コスト・遅延制御",
    tone: "neutral" as const,
    title: "10〜15秒バッチ集約と相槌スキップによる LLM 最適化",
    summary:
      "確定発話のたびに LLM を呼ぶとコスト増と競合更新が起きるため、Deepgram 受信とは別の非同期ワーカーが一定間隔でまとめて抽出を行います。",
    points: [
      "デバウンス 500ms、最大待機・最短実行間隔 12.0s（設定変更可）で複数発話を 1 回の extract_spoa に集約。",
      "「はい」「ありがとうございます」など挨拶・相槌だけのバッチは is_ignorable_utterance_text で LLM 呼び出しを丸ごとスキップ。",
      "Gemini（既定 gemini-3.5-flash-lite）は思考量を最小化（Gemini 3 系は thinking_level='minimal'、2.5 系は thinking_budget=0）し高速・低コスト化。",
    ],
  },
  {
    badge: "S/P統合 · 検証",
    tone: "success" as const,
    title: "S・P の 1 項目統合と決定的な根拠・ロール検証",
    summary:
      "LLM が返した操作はそのまま画面へ流さず、SoapStateManager が引用と役割の整合性を検証してから原子的に適用します。",
    points: [
      "S（主観的情報）と P（計画）は会話全体を各 1 項目へ逐次 update 統合。万一 2 件目の add が返っても防御的に統合更新します。",
      "すべての引用（quote）が確定発話の最新版本文に一致するか検証し、不一致を含むバッチは処理済み版を進めず全体拒否。",
      "S は患者発話根拠、P・A は薬剤師発話根拠が必須。O は患者申告（reported）と薬剤師確認（confirmed）を区別します。",
    ],
  },
  {
    badge: "A の臨床設計",
    tone: "neutral" as const,
    title: "「S・O から P を選んだ理由」としての A と停止時生成",
    summary:
      "薬歴の A（Assessment）は単なる評価ではなく「SO の情報から判断してなぜ P を実施したか」という臨床判断であり、会話中にそのまま発話されないことが一般的です。",
    points: [
      "会話中の extract_spoa は明示的に言語化された場合を除き推測 A を作らず、API コストと根拠の薄い推測を抑制。",
      "文字起こし停止時（15.0s 予算内）に最終発話を同期後、s_items・o_items・plan_items を渡して finalize_a_from_p を実行。",
      "会話由来 A（origin='conversation'）は保護し、推測 A（origin='plan_inference'）には「要確認」を付与。再開後に P が変われば未反映フラグで通知します。",
    ],
  },
] as const;

const SOAP_ROLES = [
  {
    code: "S 主観的情報",
    source: "入力元: 患者マイク（左側）",
    behavior:
      "主訴・症状・生活背景・服薬上の相談事項を 1 項目へ逐次統合し、複数の患者発話根拠をまとめて保持します。",
  },
  {
    code: "O 客観的情報",
    source: "入力元: 双方の発言（事実）",
    behavior:
      "処方日数や検査値・体温などの事実を抽出。患者発言は reported、薬剤師確認は confirmed として扱います。",
  },
  {
    code: "A アセスメント",
    source: "生成: 停止時に S・O・P を統合",
    behavior:
      "S・O を踏まえてなぜその P を実施したのかの臨床判断案（要確認）を自動作成。会話中の明示判断も保持します。",
  },
  {
    code: "P 計画",
    source: "入力元: 薬剤師マイク（右側）",
    behavior:
      "服薬指導・注意点・受診勧奨を 1 項目へ統合更新し、訂正発言があれば計画本文から反映・撤回を行います。",
  },
] as const;

const SPEC_ROWS = [
  {
    layer: "ブラウザ音声取得",
    component: "AudioWorklet (dualMicCapture)",
    params: "16kHz / Int16 PCM / 1ch または 2ch / ノイズ下限 0.025・優位比 1.25",
    role: "左右マイクの PCM 連続送信と回り込みを抑えた話者インジケーター表示",
  },
  {
    layer: "音声ゲート・VAD",
    component: "AudioActivityGate",
    params: "RMS 閾値 0.008 / プリロール 300ms / ハングオーバー 600ms / KeepAlive 4.0s",
    role: "STT 非依存の無音判定・任意モノラル合成・実時刻と話者チャンネル復元",
  },
  {
    layer: "音声認識 (STT)",
    component: "Deepgram Nova-3 Streaming",
    params: "language=ja / linear16 / interim_results=true / endpointing=300ms",
    role: "暫定・確定テキストの低遅延配信（2ch 時は multichannel=true）",
  },
  {
    layer: "SOAP 中間更新",
    component: "_SoapSessionCoordinator",
    params: "デバウンス 500ms / 最大待機・最短間隔 12.0s / gemini-3.5-flash-lite",
    role: "相槌スキップ付き非同期バッチ集約で S・O・P を抽出（停止前のコスト抑制）",
  },
  {
    layer: "状態検証・適用",
    component: "SoapStateManager",
    params: "引用部分文字列一致・segment_revision 一致・役割制約・S/P 1項目統合",
    role: "LLM 出力の根拠と権限を検証し、不正バッチを拒否して原子的更新",
  },
  {
    layer: "A 最終生成",
    component: "finalize_a_from_p",
    params: "停止時予算 15.0s / 入力: s_items + o_items + plan_items + existing_a_items",
    role: "S・O を根拠に P を実施した臨床判断を「要確認」ドラフトとして生成",
  },
] as const;

export default function MechanismPage() {
  return (
    <main id="main-content" tabIndex={-1} {...stylex.props(s.page)}>
      <section {...stylex.props(s.heroCard)}>
        <p {...stylex.props(s.eyebrow)}>ARCHITECTURE &amp; LOGIC</p>
        <h1 {...stylex.props(s.title)}>リアルタイム文字起こし・SOAP 自動生成の仕組み</h1>
        <p {...stylex.props(s.lead)}>
          患者（左）と薬剤師（右）の対話音声をブラウザからストリーミング送信し、遅延や API
          コストを抑えつつ「根拠が追跡でき、S・O・P に整合した
          A（アセスメント）」を組み立てるための処理パイプラインを解説します。
        </p>
      </section>

      <section {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 {...stylex.props(s.sectionTitle)}>全体の処理パイプライン</h2>
          <p {...stylex.props(s.sectionSub)}>音声認識ループと LLM 更新を分離した非同期構成</p>
        </div>
        <ol {...stylex.props(s.pipelineList)}>
          {PIPELINE_STAGES.map((stage) => (
            <li key={stage.step} {...stylex.props(s.pipelineItem)}>
              <Card variant="filled" style={s.pipelineCard}>
                <div {...stylex.props(s.stageRow)}>
                  <span {...stylex.props(s.stageNum)} aria-hidden="true">
                    {stage.step}
                  </span>
                  <span {...stylex.props(s.stageTag)}>{stage.tag}</span>
                </div>
                <h3 {...stylex.props(s.cardTitle)}>{stage.title}</h3>
                <p {...stylex.props(s.cardBody)}>{stage.description}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 {...stylex.props(s.sectionTitle)}>実装した 4 つのコアロジック</h2>
          <p {...stylex.props(s.sectionSub)}>
            精度・透明性・リアルタイム性・運用コストの両立ポイント
          </p>
        </div>
        <ul {...stylex.props(s.logicGrid)}>
          {CORE_LOGICS.map((logic) => (
            <li key={logic.title} {...stylex.props(s.logicItem)}>
              <Card variant="outlined" style={s.logicCard}>
                <div {...stylex.props(s.logicCardHeader)}>
                  <Badge tone={logic.tone}>{logic.badge}</Badge>
                </div>
                <h3 {...stylex.props(s.logicTitle)}>{logic.title}</h3>
                <p {...stylex.props(s.logicSummary)}>{logic.summary}</p>
                <ul {...stylex.props(s.bulletList)}>
                  {logic.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 {...stylex.props(s.sectionTitle)}>SOAP 各欄の役割と生成タイミング</h2>
          <p {...stylex.props(s.sectionSub)}>話者ロール制約と臨床薬学上の位置づけ</p>
        </div>
        <div {...stylex.props(s.soapRelationGrid)}>
          {SOAP_ROLES.map((item) => (
            <Card key={item.code} variant="elevated" style={s.soapRoleCard}>
              <h3 {...stylex.props(s.soapRoleTitle)}>{item.code}</h3>
              <p {...stylex.props(s.soapRoleMeta)}>{item.source}</p>
              <p {...stylex.props(s.soapRoleDesc)}>{item.behavior}</p>
            </Card>
          ))}
        </div>
      </section>

      <section {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 {...stylex.props(s.sectionTitle)}>各レイヤーのモジュールと既定パラメータ</h2>
          <p {...stylex.props(s.sectionSub)}>実装コードに基づく設定・責務一覧</p>
        </div>
        <div {...stylex.props(s.tableWrap)}>
          <table {...stylex.props(s.table)}>
            <caption {...stylex.props(s.caption)}>
              音声入力から SOAP 最終生成までの処理レイヤー一覧
            </caption>
            <thead>
              <tr>
                <th scope="col" {...stylex.props(s.thCol)}>
                  レイヤー
                </th>
                <th scope="col" {...stylex.props(s.thCol)}>
                  担当モジュール / 技術
                </th>
                <th scope="col" {...stylex.props(s.thCol)}>
                  主な設定・検証条件
                </th>
                <th scope="col" {...stylex.props(s.thCol)}>
                  役割
                </th>
              </tr>
            </thead>
            <tbody>
              {SPEC_ROWS.map((row) => (
                <tr key={row.layer}>
                  <th scope="row" {...stylex.props(s.thRow)}>
                    {row.layer}
                  </th>
                  <td {...stylex.props(s.td)}>{row.component}</td>
                  <td {...stylex.props(s.td)}>{row.params}</td>
                  <td {...stylex.props(s.td)}>{row.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section {...stylex.props(s.section)}>
        <div {...stylex.props(s.bottomCard)}>
          <div>
            <h2 {...stylex.props(s.bottomTitle)}>実際のワークスペースで試す</h2>
            <p {...stylex.props(s.bottomBody)}>
              2 マイクまたは 1 マイクを接続して、リアルタイム文字起こしと SOAP 生成を体験できます。
            </p>
          </div>
          <div {...stylex.props(s.ctaRow)}>
            <Link href="/transcription" {...stylex.props(s.primaryCta)}>
              文字起こし画面へ <span aria-hidden="true">→</span>
            </Link>
            <Link href="/" {...stylex.props(s.secondaryCta)}>
              ホームへ戻る
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
