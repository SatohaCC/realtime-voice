import * as stylex from "@stylexjs/stylex";
import Link from "next/link";
import { HealthStatusContainer } from "@/features/health/HealthStatusContainer";
import { pageStyles as s } from "./page.styles";

export default function HomePage() {
  return (
    <main id="main-content" tabIndex={-1} {...stylex.props(s.page)}>
      <section aria-labelledby="intro-title" {...stylex.props(s.hero)}>
        <div {...stylex.props(s.introduction)}>
          <p {...stylex.props(s.eyebrow)}>A little voice. A new possibility.</p>
          <h1 id="intro-title" {...stylex.props(s.headline)}>
            声から、
            <br />
            次の体験へ。
          </h1>
          <p {...stylex.props(s.description)}>
            アイデアを、心地よく使えるかたちに。
            <br />
            表情のあるデザインと、小さく確かな土台から。
          </p>
          <a href="#connection" {...stylex.props(s.heroLink)}>
            接続状態を確認 <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div {...stylex.props(s.art)} aria-hidden="true">
          <div {...stylex.props(s.artCircle)}>
            <i {...stylex.props(s.wave, s.waveShort)} />
            <i {...stylex.props(s.wave, s.waveMedium)} />
            <i {...stylex.props(s.wave, s.waveTall)} />
            <i {...stylex.props(s.wave, s.waveMedium)} />
            <i {...stylex.props(s.wave, s.waveShort)} />
          </div>
          <span {...stylex.props(s.artCaption)}>DESIGNED TO FEEL A LITTLE MORE HUMAN</span>
        </div>
      </section>
      <section id="audio" aria-labelledby="audio-title" {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 id="audio-title" {...stylex.props(s.sectionTitle)}>
            リアルタイム文字起こし
          </h2>
          <p {...stylex.props(s.muted)}>AudioWorklet · Deepgram Nova-3</p>
        </div>
        <div {...stylex.props(s.panel)}>
          <p {...stylex.props(s.panelDescription)}>
            1本または2本のマイク音声を話者分離し、リアルタイム文字起こしを行う専用ワークスペースです（利用にはログインが必要です）。
          </p>
          <Link href="/transcription" {...stylex.props(s.ctaLink)}>
            文字起こし画面へ <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
      <section id="connection" aria-labelledby="connection-title" {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 id="connection-title" {...stylex.props(s.sectionTitle)}>
            つながりを確認
          </h2>
          <p {...stylex.props(s.muted)}>Live connection</p>
        </div>
        <div {...stylex.props(s.panel)}>
          <p {...stylex.props(s.panelDescription)}>
            画面からAPIまで、いつでも確かめられる接続状態。
          </p>
          <HealthStatusContainer />
        </div>
      </section>
      <section id="colors" aria-labelledby="palette-title" {...stylex.props(s.section)}>
        <div {...stylex.props(s.sectionHeader)}>
          <h2 id="palette-title" {...stylex.props(s.sectionTitle)}>
            色にも、役割を。
          </h2>
          <p {...stylex.props(s.muted)}>端末の設定に合わせてライト／ダークを切り替えます</p>
        </div>
        <div {...stylex.props(s.palette)}>
          <div {...stylex.props(s.swatch, s.swatchPrimary)}>Primary</div>
          <div {...stylex.props(s.swatch, s.swatchSecondary)}>Secondary</div>
          <div {...stylex.props(s.swatch, s.swatchTertiary)}>Tertiary</div>
        </div>
      </section>
      <footer {...stylex.props(s.footer)}>
        <span>Realtime Voice — a foundation for your next idea.</span>
        <span>Built with care. Ready to make your own.</span>
      </footer>
    </main>
  );
}
