"use client";

import * as stylex from "@stylexjs/stylex";
import { type ChangeEvent, type FormEvent, useId, useRef } from "react";
import { Badge, Banner, Button, Card } from "@/shared/ui";
import { packageInsertImportPanelStyles as s } from "./PackageInsertImportPanel.styles";

export interface ImportedProductView {
  yj_code: string | null;
  brand_name: string | null;
}

export interface ImportedRevisionView {
  source_label: string | null;
  year_month: string | null;
  version: string | null;
}

export interface CleanupPendingView {
  version_id: string;
  reason: string;
}

export interface ImportResultView {
  document_id: string;
  source_sha256: string;
  status: "active" | "superseded";
  reused: boolean;
  section_count: number;
  search_unit_count: number;
  products: readonly ImportedProductView[];
  revisions: readonly ImportedRevisionView[];
  generation_id: string | null;
  registration_sequence: number;
  active_yj_codes: readonly string[];
  deleted_version_ids: readonly string[];
  cleanup_pending: readonly CleanupPendingView[];
  artifacts_deleted: boolean;
}

export interface ImportHistorySummaryView {
  document_id: string;
  source_sha256: string;
  filename: string | null;
  registration_sequence: number;
  revised_at: string;
  products: readonly ImportedProductView[];
  active_yj_codes: readonly string[];
  artifacts_deleted: boolean;
}

export interface ImportHistoryPageView {
  items: readonly ImportHistorySummaryView[];
  total_count: number;
  limit: number;
  offset: number;
}

export interface PackageInsertImportPanelProps {
  /** 現在選択されている XML ファイル名 */
  selectedFileName: string | null;
  /** 選択中のファイルサイズ（バイト） */
  selectedFileSize?: number | null;
  /** ファイル選択時のコールバック */
  onSelectFile: (file: File | null) => void;
  /** 登録実行時のコールバック */
  onSubmit: () => void;
  /** 送信中フラグ */
  isSubmitting: boolean;
  /** 取り込みエラーメッセージ */
  submitError?: string | null;
  /** 直近の取り込み結果 */
  result?: ImportResultView | null;
  /** 履歴一覧ページデータ */
  historyPage?: ImportHistoryPageView | null;
  /** 履歴読み込み中フラグ */
  historyLoading: boolean;
  /** 履歴読み込みエラーメッセージ */
  historyError?: string | null;
  /** 履歴再読み込みコールバック */
  onRefreshHistory: () => void;
  /** 履歴ページ移動コールバック */
  onChangeHistoryOffset: (nextOffset: number) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * PMDA 電子添文 XML のアップロード・登録結果・履歴一覧を提供するパネル。
 */
export function PackageInsertImportPanel({
  selectedFileName,
  selectedFileSize = null,
  onSelectFile,
  onSubmit,
  isSubmitting,
  submitError = null,
  result = null,
  historyPage = null,
  historyLoading,
  historyError = null,
  onRefreshHistory,
  onChangeHistoryOffset,
}: PackageInsertImportPanelProps) {
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    onSelectFile(file);
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFileName || isSubmitting) return;
    onSubmit();
  };

  return (
    <div {...stylex.props(s.root)}>
      <Card as="section" variant="filled" style={s.guideCard} aria-labelledby="import-guide-title">
        <h2 id="import-guide-title" {...stylex.props(s.sectionHeading)}>
          登録方法
        </h2>
        <ol {...stylex.props(s.stepList)}>
          <li>PMDA から取得した対象製品の電子添文 XML（最大 10MiB）を用意します。</li>
          <li>「XMLファイルを選択」からファイルを選び、「XMLを登録」を押します。</li>
          <li>登録結果と下の登録履歴で、検索に適用されている製品・改訂年月を確認します。</li>
        </ol>
        <p {...stylex.props(s.mutedText)}>
          同じ YJ コードでは改訂年月（YYYY-MM）が最も新しい版が検索対象として有効になります。
        </p>
      </Card>

      <Card as="section" variant="outlined" style={s.uploadCard} aria-label="XMLアップロード">
        <form onSubmit={handleFormSubmit} {...stylex.props(s.formRow)}>
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            accept=".xml,application/xml,text/xml"
            disabled={isSubmitting}
            aria-label="XMLファイルを選択"
            onChange={handleFileChange}
            {...stylex.props(s.visuallyHiddenInput)}
          />
          <Button
            variant="outlined"
            disabled={isSubmitting}
            onClick={() => fileInputRef.current?.click()}
          >
            XMLファイルを選択
          </Button>
          <Button type="submit" variant="filled" disabled={!selectedFileName || isSubmitting}>
            {isSubmitting ? "登録中…" : "XMLを登録"}
          </Button>
        </form>

        {selectedFileName ? (
          <div {...stylex.props(s.selectedFileBox)}>
            <span>選択したファイル:</span>
            <strong>{selectedFileName}</strong>
            {selectedFileSize !== null ? <span>({formatBytes(selectedFileSize)})</span> : null}
          </div>
        ) : null}

        {submitError ? (
          <Banner tone="danger">
            <strong>取り込めませんでした: </strong>
            {submitError}
          </Banner>
        ) : null}
      </Card>

      {result ? (
        <Card
          as="section"
          variant="outlined"
          style={s.resultCard}
          aria-label="取り込み結果"
          aria-live="polite"
        >
          <div {...stylex.props(s.resultHeader)}>
            <h2 {...stylex.props(s.sectionHeading)}>
              {result.status === "superseded"
                ? "登録しました（現在の検索には適用されていません）"
                : "登録しました（検索に適用されています）"}
            </h2>
            <Badge tone={result.status === "active" ? "success" : "neutral"}>
              {result.status === "active" ? "検索に適用中" : "旧版（履歴のみ）"}
            </Badge>
          </div>

          <div>
            <h3 {...stylex.props(s.subHeading)}>登録した製品</h3>
            <ul {...stylex.props(s.plainList)}>
              {result.products.map((product) => (
                <li key={`${product.yj_code ?? "none"}-${product.brand_name ?? "unknown"}`}>
                  {product.brand_name || "製品名不明"}
                  {product.yj_code ? `（YJ: ${product.yj_code}）` : ""}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 {...stylex.props(s.subHeading)}>改訂年月</h3>
            <ul {...stylex.props(s.plainList)}>
              {result.revisions.map((revision) => (
                <li
                  key={`${revision.source_label ?? "rev"}-${revision.year_month ?? "none"}-${revision.version ?? "none"}`}
                >
                  {revision.year_month || "不明"}
                  {revision.version ? `（第${revision.version}版）` : ""}
                  {revision.source_label ? ` · ${revision.source_label}` : ""}
                </li>
              ))}
            </ul>
          </div>

          {result.reused ? (
            <p {...stylex.props(s.mutedText)}>
              同じ原本が既に登録済みのため、既存の登録情報を返しています。
            </p>
          ) : null}

          {result.artifacts_deleted ? (
            <p {...stylex.props(s.mutedText)}>
              この旧版の検索データは削除済みです。同原本の再送でも再有効化されません。
            </p>
          ) : null}

          {result.deleted_version_ids.length > 0 ? (
            <p {...stylex.props(s.mutedText)}>
              置き換えた旧版を削除しました: {result.deleted_version_ids.join(", ")}
            </p>
          ) : null}

          <details {...stylex.props(s.detailsBox)}>
            <summary {...stylex.props(s.detailsSummary)}>管理用の登録情報を表示</summary>
            <div {...stylex.props(s.detailsBody)}>
              <p {...stylex.props(s.mutedText)}>
                現在適用中の YJ コード: {result.active_yj_codes.join(", ") || "なし"}
              </p>
              <p {...stylex.props(s.mutedText)}>
                公開世代: {result.generation_id || "なし"} / 登録順: {result.registration_sequence}
              </p>
              <p {...stylex.props(s.mutedText)}>
                項目数: {result.section_count} / 検索用項目数: {result.search_unit_count}
              </p>
              <p {...stylex.props(s.mutedText)}>登録ID: {result.document_id}</p>
              <p {...stylex.props(s.monoText)}>原本SHA256: {result.source_sha256}</p>
            </div>
          </details>
        </Card>
      ) : null}

      <Card
        as="section"
        variant="outlined"
        style={s.historyCard}
        aria-labelledby="import-history-title"
      >
        <div {...stylex.props(s.historyHeader)}>
          <div {...stylex.props(s.historyTitleGroup)}>
            <h2 id="import-history-title" {...stylex.props(s.sectionHeading)}>
              登録履歴
            </h2>
            <p {...stylex.props(s.mutedText)}>
              新しい登録順に表示します。検索への適用状況も合わせて確認できます。
            </p>
          </div>
          <Button variant="text" size="sm" onClick={onRefreshHistory} disabled={historyLoading}>
            一覧を更新
          </Button>
        </div>

        <div aria-busy={historyLoading}>
          {historyLoading ? (
            <p role="status" {...stylex.props(s.mutedText)}>
              一覧を読み込み中…
            </p>
          ) : null}

          {historyError ? (
            <Banner tone="danger">{historyError}（「一覧を更新」で再試行できます）</Banner>
          ) : null}

          {!historyLoading && !historyError && historyPage?.total_count === 0 ? (
            <p {...stylex.props(s.mutedText)}>
              登録履歴はまだありません。上のフォームから電子添文 XML を登録してください。
            </p>
          ) : null}

          {!historyError && historyPage && historyPage.items.length > 0 ? (
            <>
              <p {...stylex.props(s.mutedText)}>
                {historyPage.total_count}件中 {historyPage.offset + 1}〜
                {historyPage.offset + historyPage.items.length}件
              </p>

              <ul {...stylex.props(s.historyList)}>
                {historyPage.items.map((item) => {
                  const productNames = item.products
                    .map((p) => p.brand_name)
                    .filter((name): name is string => Boolean(name));
                  const isActive = item.active_yj_codes.length > 0;
                  return (
                    <li
                      key={`${item.document_id}:${item.source_sha256}`}
                      {...stylex.props(s.historyItem)}
                    >
                      <div {...stylex.props(s.historyItemRow)}>
                        <h3 {...stylex.props(s.historyItemTitle)}>
                          {productNames.join(" / ") || "製品名不明"}
                        </h3>
                        <Badge tone={isActive ? "success" : "neutral"}>
                          {isActive ? "検索に適用中" : "現在は適用されていません"}
                        </Badge>
                      </div>
                      <p {...stylex.props(s.mutedText)}>改訂年月: {item.revised_at}</p>
                      {item.artifacts_deleted ? (
                        <p {...stylex.props(s.mutedText)}>
                          この旧版の検索データは削除済みです。登録履歴のみ保持しています。
                        </p>
                      ) : null}
                      <details {...stylex.props(s.detailsBox)}>
                        <summary {...stylex.props(s.detailsSummary)}>管理用の詳細を表示</summary>
                        <div {...stylex.props(s.detailsBody)}>
                          <p {...stylex.props(s.mutedText)}>
                            ファイル名: {item.filename ?? "記録なし"}
                          </p>
                          <p {...stylex.props(s.mutedText)}>登録順: {item.registration_sequence}</p>
                          <p {...stylex.props(s.mutedText)}>
                            現在適用中の YJ コード: {item.active_yj_codes.join(", ") || "なし"}
                          </p>
                          <p {...stylex.props(s.mutedText)}>登録ID: {item.document_id}</p>
                          <p {...stylex.props(s.monoText)}>原本SHA256: {item.source_sha256}</p>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>

              <div {...stylex.props(s.paginationRow)}>
                <Button
                  variant="text"
                  size="sm"
                  disabled={historyLoading || historyPage.offset === 0}
                  onClick={() =>
                    onChangeHistoryOffset(Math.max(0, historyPage.offset - historyPage.limit))
                  }
                >
                  前の20件
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  disabled={
                    historyLoading ||
                    historyPage.offset + historyPage.items.length >= historyPage.total_count
                  }
                  onClick={() => onChangeHistoryOffset(historyPage.offset + historyPage.limit)}
                >
                  次の20件
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
