# プロジェクトの作業ルール

このリポジトリで作業するときは、対象に応じて以下の規約を読む。

- バージョン管理: [.agents/rules/vcs.md](.agents/rules/vcs.md)。Git で管理する。
- コメント・docstring: [.agents/rules/coding-style.md](.agents/rules/coding-style.md)
- Backend: [.agents/rules/backend-architecture.md](.agents/rules/backend-architecture.md)
- Frontendの共有UI: [.agents/rules/frontend-shared-ui.md](.agents/rules/frontend-shared-ui.md)

`frontend/` を変更する場合は、その配下の `AGENTS.md` も読む。プロジェクト固有のSkillは `.agents/skills/` にある。

## 実装と検証の手順

- 実装前に、同じ責務を持つ既存コードを確認し、その構成と公開インターフェースに合わせる。
- Frontend の型だけの import は `import type` に分離し、配列型は `T[]`（読み取り専用は `readonly T[]`）に統一する。
- Frontend の修正後は `pnpm format:frontend` で安全な自動修正を適用し、`pnpm check` と関連テストを実行する。Biome の警告も失敗として扱う。
- チェックを通すためだけに、ルールの無効化、検査対象の除外、`any`・非 null アサーション・型検査の無効化を追加しない。設定変更が依頼の目的である場合は、変更した制約が機能することを検証する。
- 抑制コメントが必要な場合は、対象のルールと範囲を最小限にし、例外が必要な具体的な理由を日本語で記述する。完了報告にも例外の理由を記載する。
- `--unsafe` による一括修正は行わず、修正内容を確認して個別に適用する。
- 完了報告では、実行して通過した検証と、未実行・環境要因で失敗した検証を区別する。

## コミットメッセージ

コミットメッセージは **Conventional Commitsの形式で、説明を日本語** にする。

- 形式: `<type>(<任意のscope>): <日本語の説明>`。scopeが不要なら省略する。
- typeは変更内容に合わせて `feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `ci` 等を選ぶ。
- 例: `chore: 初期テンプレートを整備`、`fix(ui): ステータス更新時の表示を修正`。
- 本文を付ける場合も日本語で、変更理由や必要な補足を書く。ローカルの絶対パスや秘密情報を含めない。
