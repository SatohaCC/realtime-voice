"use client";

import * as stylex from "@stylexjs/stylex";
import { Fragment, type ReactNode, useId, useState } from "react";
import { Badge, Button, Card } from "../../ui";
import { packageInsertEvidenceCardStyles as s } from "./PackageInsertEvidenceCard.styles";

export interface PackageInsertEvidenceRevision {
  source_label?: string | null;
  year_month?: string | null;
  version?: string | null;
}

export interface PackageInsertEvidenceSection {
  code: string;
  title: string;
}

export interface PackageInsertEvidenceItem {
  unit_id: string;
  document_id: string;
  product_name: string;
  generic_name: string;
  product_yj_codes: readonly string[];
  document_revision: PackageInsertEvidenceRevision;
  section: PackageInsertEvidenceSection;
  kind: string;
  excerpt: string;
  columns?: Record<string, string> | null;
  url: string;
  retrieved_by?: readonly string[];
}

export interface PackageInsertEvidenceCardProps {
  /** 表示対象の添付文書根拠アイテム */
  source: PackageInsertEvidenceItem;
  /** 本文・見出し・YJコード内で強調する検索語リスト */
  highlightWords?: readonly string[];
  /** 取得方法バッジの表示ラベル上書きマップ */
  retrievalLabels?: Readonly<Record<string, string>>;
  /** 優先警告対象（例: 警告・禁忌・併用禁忌）として強調枠・常時展開にするか */
  isPriority?: boolean;
  /** 初期展開状態（優先項目は常に展開） */
  defaultExpanded?: boolean;
  /** 出典リンクラベル */
  sourceLinkLabel?: string;
}

interface ParsedTableCell {
  id: string;
  text: string;
  rowspan?: number;
  colspan?: number;
  isHeader: boolean;
}

interface ParsedTableRow {
  id: string;
  cells: ParsedTableCell[];
}

type EvidenceBlock =
  | { id: string; kind: "heading"; text: string }
  | { id: string; kind: "paragraph"; text: string }
  | { id: string; kind: "table"; rows: ParsedTableRow[] };

const PRIORITY_SECTION_CODES = new Set(["1", "2", "10.1"]);

const DEFAULT_RETRIEVAL_LABELS: Record<string, string> = {
  always: "毎回確認",
  logic: "質問の言葉に一致",
  jev: "質問意図から追加",
  keyword: "本文の語句から検索",
};

const COLUMN_LABELS: Record<string, string> = {
  drug_name: "薬剤名等",
  clinical_symptoms_and_measures: "臨床症状・措置方法",
  mechanism_and_risk_factors: "機序・危険因子",
};

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&amp;/g, "&");
}

function parseTableHtml(tableHtml: string): ParsedTableRow[] {
  const rows: ParsedTableRow[] = [];
  const rowMatches = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  let rowOrder = 0;
  for (const rowMarkup of rowMatches) {
    const cells: ParsedTableCell[] = [];
    const cellRegex = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match = cellRegex.exec(rowMarkup);
    let cellOrder = 0;
    while (match !== null) {
      const tag = match[1].toLowerCase();
      const attrs = match[2];
      const inner = match[3];
      const rowspanMatch = attrs.match(/\browspan\s*=\s*["']?(\d+)["']?/i);
      const colspanMatch = attrs.match(/\bcolspan\s*=\s*["']?(\d+)["']?/i);
      const rowspan = rowspanMatch ? Number.parseInt(rowspanMatch[1], 10) : undefined;
      const colspan = colspanMatch ? Number.parseInt(colspanMatch[1], 10) : undefined;
      cells.push({
        id: `cell-${rowOrder}-${cellOrder}`,
        text: decodeHtmlEntities(inner).trim(),
        rowspan: rowspan && rowspan > 1 ? rowspan : undefined,
        colspan: colspan && colspan > 1 ? colspan : undefined,
        isHeader: tag === "th",
      });
      cellOrder += 1;
      match = cellRegex.exec(rowMarkup);
    }
    if (cells.length > 0) {
      rows.push({ id: `row-${rowOrder}`, cells });
      rowOrder += 1;
    }
  }
  return rows;
}

function parseEvidenceBlocks(excerpt: string): EvidenceBlock[] {
  const blocks: EvidenceBlock[] = [];
  const segments = excerpt
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  let blockOrder = 0;
  for (const segment of segments) {
    const id = `block-${blockOrder}`;
    blockOrder += 1;
    if (segment.startsWith("### ")) {
      blocks.push({ id, kind: "heading", text: segment.slice(4).trim() });
    } else if (segment.startsWith("<table") && segment.endsWith("</table>")) {
      const rows = parseTableHtml(segment);
      if (rows.length > 0) {
        blocks.push({ id, kind: "table", rows });
      }
    } else {
      blocks.push({ id, kind: "paragraph", text: segment });
    }
  }
  return blocks;
}

function renderHighlightedText(text: string, words: readonly string[]): ReactNode {
  const validWords = words.map((w) => w.trim()).filter((w) => w.length > 0);
  if (validWords.length === 0 || !text) {
    return text;
  }
  const escaped = validWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const lowerSet = new Set(validWords.map((w) => w.toLowerCase()));
  const parts = text.split(pattern);
  const tokens: Array<{ id: string; value: string; matched: boolean }> = [];
  let offset = 0;
  for (const part of parts) {
    if (!part) continue;
    tokens.push({
      id: `seg-${offset}-${part.length}`,
      value: part,
      matched: lowerSet.has(part.toLowerCase()),
    });
    offset += part.length;
  }

  return tokens.map((token) =>
    token.matched ? (
      <mark key={token.id} {...stylex.props(s.highlight)}>
        {token.value}
      </mark>
    ) : (
      <Fragment key={token.id}>{token.value}</Fragment>
    ),
  );
}

function formatRevisionText(revision: PackageInsertEvidenceRevision): string {
  const ym = revision.year_month?.trim();
  const ver = revision.version?.trim();
  if (!ym && !ver) {
    return "不明";
  }
  return [ym, ver ? `第${ver}版` : ""].filter(Boolean).join(" ");
}

/**
 * 添付文書の検索根拠セクション・表・引用情報を M3 スタイルで描画するカード。
 */
export function PackageInsertEvidenceCard({
  source,
  highlightWords = [],
  retrievalLabels = DEFAULT_RETRIEVAL_LABELS,
  isPriority,
  defaultExpanded = false,
  sourceLinkLabel = "PMDAの出典を開く ↗",
}: PackageInsertEvidenceCardProps) {
  const priority = isPriority ?? PRIORITY_SECTION_CODES.has(source.section.code);
  const blocks = parseEvidenceBlocks(source.excerpt);
  const canCollapse = !priority && (source.excerpt.length > 260 || blocks.length > 3);
  const [expanded, setExpanded] = useState(priority || defaultExpanded || !canCollapse);
  const bodyId = useId();
  const columnEntries = source.columns
    ? Object.entries(source.columns).filter(([, value]) => value.trim().length > 0)
    : [];

  return (
    <Card
      as="article"
      variant="outlined"
      style={[s.card, priority && s.priorityCard]}
      data-evidence-card="true"
      data-unit-id={source.unit_id}
    >
      <div {...stylex.props(s.header)}>
        <div {...stylex.props(s.titleGroup)}>
          <div {...stylex.props(s.sectionRow)}>
            <span {...stylex.props(s.sectionCodeBadge, priority && s.priorityCodeBadge)}>
              {source.section.code}
            </span>
            <h3 {...stylex.props(s.sectionTitle)}>
              {renderHighlightedText(source.section.title, highlightWords)}
            </h3>
          </div>
          <p {...stylex.props(s.productName)}>
            {renderHighlightedText(source.product_name, highlightWords)}
          </p>
        </div>

        {source.retrieved_by && source.retrieved_by.length > 0 ? (
          <div {...stylex.props(s.badgeGroup)}>
            {source.retrieved_by.map((method) => (
              <Badge key={method} tone={priority ? "danger" : "neutral"}>
                {retrievalLabels[method] ?? method}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div id={bodyId} {...stylex.props(s.bodyWrapper, canCollapse && !expanded && s.bodyClamped)}>
        {columnEntries.length > 0 ? (
          <div {...stylex.props(s.columnsGrid)}>
            {columnEntries.map(([key, value]) => (
              <div key={key} {...stylex.props(s.columnItem)}>
                <span {...stylex.props(s.columnLabel)}>{COLUMN_LABELS[key] ?? key}</span>
                <span {...stylex.props(s.columnValue)}>
                  {renderHighlightedText(value, highlightWords)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {blocks.map((block) => {
          if (block.kind === "heading") {
            return (
              <h4 key={block.id} {...stylex.props(s.subHeading)}>
                {renderHighlightedText(block.text, highlightWords)}
              </h4>
            );
          }
          if (block.kind === "table") {
            const firstRowIsHeader = block.rows[0]?.cells.every((cell) => cell.isHeader);
            const hasStructuredHeader =
              firstRowIsHeader ||
              (block.rows.length > 1 &&
                block.rows[0].cells.every((cell) => !cell.rowspan && !cell.colspan));
            const headerRow = hasStructuredHeader ? block.rows[0] : null;
            const bodyRows = hasStructuredHeader ? block.rows.slice(1) : block.rows;

            return (
              <div key={block.id} {...stylex.props(s.tableScroll)}>
                <table {...stylex.props(s.table)}>
                  {headerRow ? (
                    <thead>
                      <tr>
                        {headerRow.cells.map((cell) => (
                          <th
                            key={cell.id}
                            scope="col"
                            rowSpan={cell.rowspan}
                            colSpan={cell.colspan}
                            {...stylex.props(s.tableHeaderCell)}
                          >
                            {renderHighlightedText(cell.text, highlightWords)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {bodyRows.map((row) => (
                      <tr key={row.id}>
                        {row.cells.map((cell) => {
                          const CellTag = cell.isHeader ? "th" : "td";
                          return (
                            <CellTag
                              key={cell.id}
                              rowSpan={cell.rowspan}
                              colSpan={cell.colspan}
                              {...stylex.props(cell.isHeader ? s.tableHeaderCell : s.tableCell)}
                            >
                              {renderHighlightedText(cell.text, highlightWords)}
                            </CellTag>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          return (
            <p key={block.id} {...stylex.props(s.paragraph)}>
              {renderHighlightedText(block.text, highlightWords)}
            </p>
          );
        })}
      </div>

      {canCollapse ? (
        <div {...stylex.props(s.toggleRow)}>
          <Button
            variant="text"
            size="sm"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? "折りたたむ" : "全文を表示"}
          </Button>
        </div>
      ) : null}

      <div {...stylex.props(s.footer)}>
        <span>改訂: {formatRevisionText(source.document_revision)}</span>
        <span>·</span>
        <span>
          YJコード:{" "}
          {renderHighlightedText(source.product_yj_codes.join(", ") || "不明", highlightWords)}
        </span>
        {source.url ? (
          <>
            <span>·</span>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              {...stylex.props(s.externalLink)}
            >
              {sourceLinkLabel}
            </a>
          </>
        ) : null}
      </div>
    </Card>
  );
}
