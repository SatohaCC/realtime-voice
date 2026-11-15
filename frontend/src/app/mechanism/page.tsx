import * as stylex from "@stylexjs/stylex";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card } from "@/shared/ui";
import { mechanismStyles as s } from "./mechanism.styles";

export const metadata: Metadata = {
  title: "仕組み | Realtime Voice",
  description:
    "2マイク音声・CPUローカル声紋認識（CAM++ / IndexedDB）・STT非依存VADゲート・Deepgram Nova-3 words[]話者境界分割・Gemini 12秒バッチSOAP更新と話者訂正再評価の内部ロジック。",
};

const PIPELINE_STAGES = [
  {
    step: "1",
    tag: "Browser & Local",
    title: "声紋登録と 2マイク 16kHz PCM 収音",
    description:
      "事前登録した薬剤師声紋（IndexedDB）を会話開始時に送信。AudioWorklet で 16kHz Int16 PCM とチャンネル別 RMS を連続送信します。",
  },
  {
    step: "2",
    tag: "Audio Gate & STT",
    title: "VAD 判定と Deepgram words[] 取得",
    description:
      "STT 非依存の AudioActivityGate が無音判定・モノラル合成・実時刻/チャンネル復元を行い、Deepgram Nova-3 が単語時刻 words[] 付きで文字起こしします。",
  },
  {
    step: "3",
    tag: "CPU Speaker ID",
    title: "CAM++ 話者照合と重複・交代境界整理",
    description:
      "45秒PCM履歴から CPU（sherpa-onnx）で声紋抽出し、薬剤師声紋・患者一時重心で照合。話者交代分割・回り込み重複統合・不確かな発話の患者フォールバックを行います。",
  },
  {
    step: "4",
    tag: "Gemini Batch",
    title: "12秒集約 S・O・P 抽出と訂正再評価",
    description:
      "確定発話を最大 12 秒で束ね相槌をスキップして S・O・P を抽出。後続の確定・話者確定・手動訂正時は SoapStateManager が整合性を自動再評価します。",
  },
  {
    step: "5",
    tag: "Stop Finalize",
    title: "患者一時状態破棄と A 最終生成",
    description:
      "録音停止時に未反映発話と会話由来 SOAP を同期したうえで S・O・P 全体から A 案を生成。患者の一時声紋重みと PCM バッファは終了時に即破棄します。",
  },
] as const;

const CORE_LOGICS = [
  {
    badge: "CPU声紋 · ローカル保存",
    tone: "success" as const,
    title: "事前登録・CPUローカル声紋抽出と非永続のプライバシー設計",
    summary:
      "外部音声APIへ生声紋を預けず、サーバー側 CPU（sherpa-onnx / CAM++）で 1 回だけ特徴ベクトル化してブラウザの IndexedDB へ端末ローカル保存する設計です。",
    points: [
      "事前登録（useSpeakerEnrollment）は 3 文読み上げ（1〜2文ごとに有音3秒目標・最大10秒、autoGainControl=false）から select_speaker_audio が 20ms 単位で音量・クリッピング（1%未満）を検査し、無音ポーズを切らない連続波形で 2.5s 以上の有効区間を統合抽出します。",
      "既定モデル 3dspeaker_campplus_zh_en_16k_contiguous_v2（CPU 2 スレッド）のベクトルは IndexedDB（voiceprintStore）へ保存。会話開始時に WebSocket の SpeakerProfile で送り、Backend はメモリ内のみで照合します。",
      "患者声紋は事前登録や永続保存を行わず、会話中の ch1 優位・1.2s 以上の非薬剤師発話でのみ一時重心（_patient_centroid）を初期化・更新し、録音停止・新規会話時に破棄します。",
    ],
  },
  {
    badge: "話者照合 · 境界/重複制御",
    tone: "success" as const,
    title: "患者フォールバック・短発話蓄積・words[] 分割と 2ch 重複統合",
    summary:
      "左右マイクへの声の回り込みや 1ch での複数人混在に対し、無理にマイク番号へ当てはめず複数シグナルで精度と整合性を両立しています。",
    points: [
      "ConversationSpeakerTracker は 45.0s の BackendAudioPcmRingBuffer から該当区間 PCM を切り出し、薬剤師閾値（高 0.50 / 低 0.35）・患者閾値（0.35）・マージン 0.08・優位比 1.8 で判定。短い/曖昧な発話は患者に寄せて表示・SOAP処理します。",
      "0.6s 未満の短い不明発話は同一チャンネル 350ms 以内の連続発話（_pending_short_segments / 最大4件）を連結再照合して後から確定。1発話内の連続発話は Deepgram words[] を句読点または 0.35s 無音で分割（build_word_clause_candidates）して話者交代を切り分けます。",
      "両マイクに同一話者が載った場合は到着順を問わず類似度・IoU・RMS優位で重複側をシステムが削除（_suppress_incoming_crosstalk / removed）、別話者の同時発話はそのまま保持します。UI からの手動変更（UpdateSegmentSpeaker）は自動再照合より優先保護されます。",
    ],
  },
  {
    badge: "VAD · 音声ゲート",
    tone: "neutral" as const,
    title: "左右レベル表示・回り込み抑止と STT 非依存 AudioActivityGate",
    summary:
      "画面は左に患者、右に薬剤師（不確かな発話も患者側）を配置。音量ゲートを Deepgram から分離し、将来の STT 差し替えにも対応できる構造です。",
    points: [
      "ブラウザ側 detectSpeakingChannels はノイズ下限 0.025・優位比 1.25 で隣マイクへの回り込みを抑止してリアルタイム発話インジケーターを表示します。",
      "バックエンドの AudioActivityGate は RMS 閾値 0.008・プリロール 300ms・ハングオーバー 600ms で無音をスキップし、無音区間は KeepAlive（4.0s）で WebSocket 接続を維持します。",
      "モノラル合成や無音カット時も、STT が返す圧縮タイムスタンプを実会話時刻と元チャンネル（0/1）へ正確に復元し、45秒リングバッファと同期させます。",
    ],
  },
  {
    badge: "コスト・遅延制御",
    tone: "neutral" as const,
    title: "12秒バッチ集約と相槌スキップによる LLM 最適化",
    summary:
      "確定発話のたびに LLM を呼ぶとコスト増と競合更新が起きるため、Deepgram 受信とは別の非同期ワーカーが一定間隔でまとめて抽出を行います。",
    points: [
      "デバウンス 500ms、最大待機・最短実行間隔 12.0s（設定変更可）で複数発話を 1 回の extract_soap に集約。",
      "「はい」「ありがとうございます」など挨拶・相槌だけのバッチは is_ignorable_utterance_text で LLM 呼び出しを丸ごとスキップ。",
      "Gemini（既定 gemini-3.5-flash-lite）は思考量を最小化（Gemini 3 系は thinking_level='minimal'、2.5 系は thinking_budget=0）し高速・低コスト化。",
    ],
  },
  {
    badge: "S/P統合 · 再評価",
    tone: "success" as const,
    title: "決定的なロール検証と発話確定・訂正時の SOAP 自動再整合",
    summary:
      "LLM 出力はそのまま画面へ流さず SoapStateManager が引用・話者権限を検証。後から話者が確定・修正された際も根拠不整合を残しません。",
    points: [
      "S（主観的情報）と P（計画）は会話全体を各 1 項目へ逐次統合。すべての引用（quote）が確定発話の最新版本文に一致するか検証し、不一致バッチは全体拒否します。",
      "S は患者発話根拠、P・会話由来 A は薬剤師発話根拠が必須。不確かな発話は患者として S/O 抽出の対象になり、P・会話由来 A の根拠には使いません。誤った話者は文字起こし中に手動訂正できます。",
      "短発話の後追い確定・UI 手動話者訂正では reconcile_transcript_segments が根拠を再整合します。話者変更で本文の根拠が変わる場合や発話の無効化・再有効化、自動重複削除では既存 SOAP を撤回し、有効な発話全体から再生成します。再生成に失敗しても古い本文は戻しません。",
    ],
  },
  {
    badge: "A の臨床設計",
    tone: "neutral" as const,
    title: "「S・O から P を選んだ理由」としての A と停止時生成",
    summary:
      "薬歴の A（Assessment）は単なる評価ではなく「SO の情報から判断してなぜ P を実施したか」という臨床判断であり、会話中にそのまま発話されないことが一般的です。",
    points: [
      "会話中の extract_soap は明示的に言語化された場合を除き推測 A を作らず、API コストと根拠の薄い推測を抑制。",
      "文字起こし停止時（15.0s 予算内）に最終発話を同期後、s_items・o_items・plan_items を渡して finalize_a_from_p を実行。",
      "会話由来 A（origin='conversation'）は保護し、推測 A（origin='plan_inference'）には「要確認」を付与。再開後に P が変われば未反映フラグで通知します。",
    ],
  },
] as const;

const SOAP_ROLES = [
  {
    code: "S 主観的情報",
    source: "入力元: 患者（不確かな発話の患者フォールバックを含む）",
    behavior:
      "患者の主訴・症状・生活背景・相談事項を 1 項目へ逐次統合。話者が後から患者と確定・訂正された発話も再評価対象へ自動合流します。",
  },
  {
    code: "O 客観的情報",
    source: "入力元: 双方の発言（事実）",
    behavior:
      "処方日数や検査値・体温などの事実を抽出。患者発言は reported、薬剤師確認は confirmed として扱い、重複無効化時は根拠も整理されます。",
  },
  {
    code: "A アセスメント",
    source: "生成: 停止時に S・O・P を統合",
    behavior:
      "S・O を踏まえてなぜその P を実施したのかの臨床判断案（要確認）を自動作成。会話中に薬剤師が明示した判断も保持します。",
  },
  {
    code: "P 計画",
    source: "入力元: 薬剤師（患者フォールバックの発話は除外）",
    behavior:
      "服薬指導・注意点・受診勧奨を 1 項目へ統合更新し、話者訂正や撤回発言があれば計画本文および依存項目の整合性を再評価します。",
  },
] as const;

const SPEC_ROWS = [
  {
    layer: "ブラウザ音声取得",
    component: "AudioWorklet (dualMicCapture)",
    params: "16kHz / Int16 PCM / 2ch・声紋登録時は autoGainControl=false / 優位比 1.25",
    role: "左右マイクの PCM 連続送信、回り込み抑止レベル表示、声紋登録用 3 文録音",
  },
  {
    layer: "事前声紋登録",
    component: "useSpeakerEnrollment / voiceprintStore",
    params:
      "IndexedDB（端末ローカル） / select_speaker_audio（有音 >= 2.5s, clipping < 1%, 最大 960,000B）",
    role: "アカウント別に薬剤師1名の声紋ベクトルを端末保存し、開始時 SpeakerProfile で送信",
  },
  {
    layer: "音声ゲート・VAD",
    component: "AudioActivityGate",
    params: "RMS 閾値 0.008 / プリロール 300ms / ハングオーバー 600ms / KeepAlive 4.0s",
    role: "STT 非依存の無音判定・モノラル合成・実時刻と話者チャンネル復元",
  },
  {
    layer: "音声認識 (STT)",
    component: "Deepgram Nova-3 Streaming",
    params: "language=ja / linear16 / interim_results=true / endpointing=300ms / words[] 時刻",
    role: "暫定・確定テキストと単語単位タイムスタンプ（words[]）の低遅延配信",
  },
  {
    layer: "話者照合・重複統合",
    component: "ConversationSpeakerTracker / ConversationTranscriptState",
    params:
      "CAM++ CPU (2 threads) / 閾値 0.50・0.35 / margin 0.08 / PCM履歴 45.0s / 連結 gap <= 350ms",
    role: "登録声紋と患者一時重心の照合、words[] 交代分割、2ch重複置換、UpdateSegmentSpeaker 反映",
  },
  {
    layer: "SOAP 中間更新",
    component: "_SoapSessionCoordinator",
    params: "デバウンス 500ms / 最大待機・最短間隔 12.0s / gemini-3.5-flash-lite",
    role: "確定話者のみ対象にした相槌スキップ付き非同期バッチ集約で S・O・P を抽出",
  },
  {
    layer: "状態検証・再評価",
    component: "SoapStateManager (reconcile_transcript_segments)",
    params: "引用部分文字列一致・segment_revision 一致・役割制約・retracted_item_ids 通知",
    role: "根拠と権限の原子的適用に加え、話者訂正・重複無効化時の SOAP 撤回/再評価を実行",
  },
  {
    layer: "A 最終生成",
    component: "finalize_a_from_p",
    params: "停止時予算 15.0s / 入力: s_items + o_items + plan_items + existing_a_items",
    role: "S・O を根拠に P を実施した臨床判断を「要確認」ドラフトとして生成し一時状態を破棄",
  },
] as const;

export default function MechanismPage() {
  return (
    <main id="main-content" tabIndex={-1} {...stylex.props(s.page)}>
      <section {...stylex.props(s.heroCard)}>
        <p {...stylex.props(s.eyebrow)}>ARCHITECTURE &amp; LOGIC</p>
        <h1 {...stylex.props(s.title)}>リアルタイム文字起こし・SOAP 自動生成の仕組み</h1>
        <p {...stylex.props(s.lead)}>
          患者（左）と薬剤師（右）の対話音声をストリーミング送信し、事前登録・端末ローカル保存の薬剤師声紋（CPU
          CAM++）による話者照合、2ch 重複統合・words[] 分割、さらに遅延や API
          コストを抑えて「根拠が追跡でき、話者訂正にも自動再整合する
          SOAP」を組み立てる仕組みを解説します。
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
          <h2 {...stylex.props(s.sectionTitle)}>実装した 6 つのコアロジック</h2>
          <p {...stylex.props(s.sectionSub)}>
            話者精度・プライバシー保護・リアルタイム性・コスト・根拠整合の両立ポイント
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
