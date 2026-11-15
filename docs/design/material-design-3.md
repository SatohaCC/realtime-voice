# Material Design 3の適用とレビュー

## 採用範囲

2026-11-15。既存のNext.js・StyleX・`@ui-sdk/react`を維持し、トップページと既存の共有部品をM3のロールへ対応させた。新たなUIライブラリや外部フォントは追加していない。

カラーは医療向けサイトを想定した独自の静的パレットを使用し、カラーの役割とボタンの意味付けはMaterial WebのM3を参照した。操作状態のState Layerは現在のM3サイトのhover 8%、focus/press 10%を採用した。旧Web v0.192のfocus/press 12%をそのまま使用する実装とは区別する。

## カラーの方向性

- Primary: 青緑（ライトの主要色 `#006B68`）。主要操作とブランドの軸に使う。
- Secondary: 彩度を抑えたグリーングレー。補助操作は主要操作より落ち着いた強調にする。
- Tertiary: 柔らかなブルー。画面のアクセントを担い、成功状態の緑と区別する。
- Surface: わずかに緑を含む白とグレー。ダークテーマも緑寄りのチャコールへ揃える。
- Errorは判別しやすい赤、Successは独立した緑系ロールを維持する。色だけで状態を伝えず、文言も併用する。

Referenceの色を置き換え、System / Componentの対応は維持する。tone風の番号は既存の参照スロット名として扱い、今回の色をColor UtilitiesによるHCT生成結果とは主張しない。実際の前景・背景でコントラストを確認する。

画面の大きな見出し・48px/32pxの角丸・抽象的な形状はM3 Expressiveの意匠を取り入れた製品側のカスタマイズ。Expressiveの全コンポーネント・全30タイプスタイル・spring物理モーションの完全実装を意味しない。モーションは160msの従来型CSS transitionを明示的なフォールバックとし、モーション低減時は0sとする。

## レビューと対応

| 確認した問題 | 対応 |
|---|---|
| bg / fg / accent中心で用途の区別が少ない | ReferenceのpaletteとSystemのprimary / container / surface / outline等に分離 |
| hover / disabledでボタン全体のopacityを変更 | content色を使う単一の背景レイヤーと、disabledの背景・文字を個別に設定 |
| focus indicatorがない | キーボードフォーカスに独立した3pxのoutlineを追加 |
| ボタンの強調度が2種類 | Filled / Tonal / Outlined / Text / Elevatedを実装。primary / secondaryの旧指定も互換対応 |
| Badgeの成功色が小さい文字では弱い | success-container / on-success-containerへ対応。successはM3標準の色名ではなく製品の拡張 |
| 画面が小さなカードだけで構成される | 紹介・実APIの接続状態・テーマの色見本へ整理。部品比較はStorybookへ配置 |
| 画面更新を読み上げる領域がない | 接続状態にstatus / live regionを設定 |
| グローバルresetがStyleXの余白を打ち消す | resetを低優先度のCSS layerに入れ、モバイルの実paddingをE2Eで検証 |
| Storybookと検証サーバーのポートが競合 | 開発用6006とブラウザ検証用6007を分離 |

## 実装の対応

- Reference / System: `frontend/src/shared/styles/tokens.stylex.ts`
- Component: 各部品の `*.styles.ts` で意味を持つSystemトークンへ対応
- Button: Filledはprimary/on-primary、Tonalはsecondary-container、Outlined/Textはprimary、Elevatedはsurface-container-low
- Badge: neutralはsurface-container-highest、dangerはerror-container、successは製品拡張ロール
- Shape: noneからfullまでの10段階を定義。画面幅に応じて構成を変え、端末の種類で分岐しない
- Theme: CSSのprefers-color-schemeで初期描画からlight/darkに対応。テーマ用の追加Effectは使わない
- 部品比較: `Button.stories.tsx` の「バリアント比較」でElevated / Filled / Tonal / Outlined / Textを、標準・小・無効の各行で一覧表示する。アプリ用のギャラリー部品は作らない
- API取得と表示の接続は既存のHealthStatusContainerを維持

Badgeは任意のステータス文言を表示する製品用ラベルであり、M3の通知件数用Badgeの厳密な再現とは区別する。ボタンの標準タッチ領域は48px、smは44pxの製品設定。プレス時の角丸変更は製品側の意匠であり、rippleやspringの代替実装を名乗らない。

## ヘッダー・選択入力の補足

サイトヘッダーは製品独自の半透明表現を保つ。840px未満ではメニューを使い、ブランド名は必要時に省略する。開閉ボタンの後にナビゲーションを置き、Tab・Escape・領域外へのフォーカス移動に対応する。Selectは独自のコンパクトな選択入力であり、M3のExposed dropdown fieldの寸法・フローティングラベルの完全再現ではない。枠線はStyleXで幅・種類・色を個別指定する。

## 確認方法

### Tabs

`shared/ui/tabs/Tabs`はラベル・パネル・選択値をPropsで受け取り、`@ui-sdk/react/tabs`でARIAの関連付けとキーボード操作を提供する。Primaryはラベル幅の3px下線、Secondaryはタブ全幅の2px下線。高さ48pxと色の対応はMaterial Web v0.192を基準にし、医療向けの既存Systemトークンを使用する。State Layerは既存部品と同じhover 8%、focus/press 10%の採用基準を維持する。Primaryのアイコン付きはAndroidの説明に合わせて高さ72pxとし、通知件数・ドットバッジはerror/on-errorロールと読み上げ名を持つ。選択インジケーターはAndroidのElasticTabIndicatorInterpolatorを参照し、左右の端をsine/cosineで別々に補間する。Web Animations APIで17点・250msの近似とし、springの完全再現とは呼ばない。モーション低減時は即座に確定し、連続操作・リサイズでは現在位置と実測幅へ追従する。

通常・無効・手動選択・制御された選択・横スクロールを`Tabs.stories.tsx`で確認できる。無効タブはヘッドレスUIの契約に従いフォーカス可能だが選択できない。ラベルは文字列を必須とし、アイコンとバッジは任意。Primaryのアイコン・ラベル配置とSecondaryのラベル配置を分け、アイコンのみのタブやルーティングは対象に含めない。狭い画面ではタブ列の内側を横スクロールする。

参照: [Material Web Tabs](https://github.com/material-components/material-web/blob/main/docs/components/tabs.md)、[Primary v0.192](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-comp-primary-navigation-tab.scss)、[Secondary v0.192](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-comp-secondary-navigation-tab.scss)。

`pnpm check`、`pnpm test`、`pnpm build`、`pnpm test:e2e`、`pnpm test:storybook`を使用する。Storybookには各variantの個別ストーリーとサイズ・無効状態の比較表を用意した。

ブラウザではlight/dark、desktop/mobile、キーボード操作とfocus outline、disabled、APIの更新・エラーからの復帰、モーション低減、横方向のはみ出し、初期表示のテキストコントラストを確認する。コントラストの数値確認は実際の色から行い、Tone差だけで適合を判定しない。これらの確認は全アクセシビリティ基準の認証を意味しない。

## 参照した公式情報

- [M3 State layers](https://m3.material.io/foundations/interaction/states/state-layers)
- [Material Web buttons](https://material-web.dev/components/button/)
- [Shape corner scale](https://m3.material.io/styles/shape/corner-radius-scale)
- [Typography](https://m3.material.io/styles/typography/overview)
- [Motion physics system](https://m3.material.io/styles/motion/overview/how-it-works)
- [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

タブ拡張の参照: [Android Tabs](https://github.com/material-components/material-components-android/blob/master/docs/components/Tabs.md)、[Elastic indicator](https://github.com/material-components/material-components-android/blob/master/lib/java/com/google/android/material/tabs/ElasticTabIndicatorInterpolator.java)。
