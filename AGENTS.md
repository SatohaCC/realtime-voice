# プロジェクトの作業ルール

このリポジトリで作業するときは、対象に応じて以下の規約を読む。

- バージョン管理: [.agents/rules/vcs.md](.agents/rules/vcs.md)。Git で管理する。
- コメント・docstring: [.agents/rules/coding-style.md](.agents/rules/coding-style.md)
- Backend: [.agents/rules/backend-architecture.md](.agents/rules/backend-architecture.md)
- Frontendの共有UI: [.agents/rules/frontend-shared-ui.md](.agents/rules/frontend-shared-ui.md)

`frontend/` を変更する場合は、その配下の `AGENTS.md` も読む。プロジェクト固有のSkillは `.agents/skills/` にある。

## コミットメッセージ

コミットメッセージは **Conventional Commitsの形式で、説明を日本語** にする。

- 形式: `<type>(<任意のscope>): <日本語の説明>`。scopeが不要なら省略する。
- typeは変更内容に合わせて `feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `ci` 等を選ぶ。
- 例: `chore: 初期テンプレートを整備`、`fix(ui): ステータス更新時の表示を修正`。
- 本文を付ける場合も日本語で、変更理由や必要な補足を書く。ローカルの絶対パスや秘密情報を含めない。
