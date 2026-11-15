# Googleログイン用ブランド素材

- `google-g.png`: [Google公式ブランドガイドライン](https://developers.google.com/identity/branding-guidelines)の[カラーGロゴ](https://developers.google.com/static/identity/images/g-logo.png)。改変せず同梱する。
- `google-sans-latin.woff2`: Google Fonts公式配布のGoogle Sans Medium（500）。Google Fonts CSS APIの `family=Google+Sans:wght@500&text=Google` で取得した欧文サブセット。日本語には端末のシステムフォントを使う。
- `OFL.txt`: Google SansのSIL Open Font License。

ボタンは公式Lightテーマ（白背景・枠線 `#747775`・文字 `#1F1F1F`）、20pxロゴ、左12px・ロゴ後10px・右12pxの余白を使う。ブランド色は製品テーマから独立した `google-identity.stylex.ts` に定義し、ダークテーマでも白背景を維持する。ロゴ・フォントは実行時に外部から取得しない。
