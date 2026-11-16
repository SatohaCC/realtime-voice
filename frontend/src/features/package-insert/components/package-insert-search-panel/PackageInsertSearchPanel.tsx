"use client";

import * as stylex from "@stylexjs/stylex";
import { type FormEvent, useId, useState } from "react";
import { Badge, Banner, Button, Card, Checkbox, Chip, TextField } from "@/shared/ui";
import {
  PackageInsertEvidenceCard,
  type PackageInsertEvidenceItem,
} from "../package-insert-evidence-card";
import { packageInsertSearchPanelStyles as s } from "./PackageInsertSearchPanel.styles";

export interface SearchMedicineOption {
  id: string;
  label: string;
}

export interface SearchSectionGroup {
  code: string;
  title: string;
  count: number;
}

export interface PackageInsertSearchPanelProps {
  /** 入力中の検索キーワード */
  query: string;
  /** 検索キーワード変更時のコールバック */
  onQueryChange: (value: string) => void;
  /** 検索実行時のコールバック */
  onSearch: () => void;
  /** 検索中フラグ */
  isSearching: boolean;
  /** 類義語拡張トグル状態 */
  isExpandEnabled: boolean;
  /** 類義語拡張トグル変更時のコールバック */
  onExpansionChange: (enabled: boolean) => void;
  /** 検索入力例リスト */
  queryExamples?: readonly string[];
  /** 絞り込み可能な医薬品選択肢一覧 */
  medicineOptions: readonly SearchMedicineOption[];
  /** 選択中の医薬品 ID 一覧 */
  selectedMedicineIds: readonly string[];
  /** 医薬品選択トグル時のコールバック */
  onToggleMedicine: (id: string) => void;
  /** 医薬品選択クリア時のコールバック */
  onClearMedicines: () => void;
  /** 検索エラーメッセージ */
  errorMessage?: string | null;
  /** 検索を 1 回以上実行済みか */
  hasSearched: boolean;
  /** 検索実行時のクエリ文字列 */
  searchedQuery: string;
  /** 検索に含めた拡張類義語一覧 */
  expandedKeywords: readonly string[];
  /** 絞り込み前の総検索結果数 */
  totalCount: number;
  /** 現在のセクション絞り込み後に表示する結果配列 */
  displayedSources: readonly PackageInsertEvidenceItem[];
  /** セクションごとの集計 */
  sectionGroups: readonly SearchSectionGroup[];
  /** 選択中のセクションコード（全件時は "all"） */
  selectedSection: string;
  /** セクションフィルタ選択時のコールバック */
  onSelectSection: (sectionCode: string) => void;
  /** ハイライト対象のキーワード配列 */
  highlightWords: readonly string[];
}

const DEFAULT_EXAMPLES = ["悪心", "併用禁忌", "腎機能障害"] as const;

/**
 * 添付文書のキーワード検索・医薬品絞り込み・セクション別結果表示を提供する統合パネル。
 */
export function PackageInsertSearchPanel({
  query,
  onQueryChange,
  onSearch,
  isSearching,
  isExpandEnabled,
  onExpansionChange,
  queryExamples = DEFAULT_EXAMPLES,
  medicineOptions,
  selectedMedicineIds,
  onToggleMedicine,
  onClearMedicines,
  errorMessage = null,
  hasSearched,
  searchedQuery,
  expandedKeywords,
  totalCount,
  displayedSources,
  sectionGroups,
  selectedSection,
  onSelectSection,
  highlightWords,
}: PackageInsertSearchPanelProps) {
  const inputId = useId();
  const helpId = useId();
  const [showMedicineFilter, setShowMedicineFilter] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim() || isSearching) return;
    onSearch();
  };

  return (
    <div {...stylex.props(s.root)}>
      <Card as="section" variant="outlined" style={s.controlCard}>
        <form {...stylex.props(s.searchForm)} onSubmit={handleSubmit}>
          <label htmlFor={inputId} {...stylex.props(s.searchLabel)}>
            検索キーワード
          </label>
          <div {...stylex.props(s.searchRow)}>
            <TextField
              id={inputId}
              type="search"
              value={query}
              onChange={onQueryChange}
              disabled={isSearching}
              aria-describedby={helpId}
              placeholder="キーワードを入力（例: 悪心 併用禁忌）"
              style={s.searchInput}
            />
            <Button type="submit" variant="filled" disabled={isSearching || !query.trim()}>
              {isSearching ? "検索中…" : "検索"}
            </Button>
          </div>

          <div id={helpId} {...stylex.props(s.exampleRow)}>
            <span {...stylex.props(s.exampleLabel)}>例を選ぶと検索欄に入力されます:</span>
            <div {...stylex.props(s.chipGroup)}>
              {queryExamples.map((example) => (
                <Chip key={example} disabled={isSearching} onClick={() => onQueryChange(example)}>
                  {example}
                </Chip>
              ))}
            </div>
          </div>

          <div {...stylex.props(s.expandOptionRow)}>
            <Checkbox checked={isExpandEnabled} onChange={onExpansionChange} disabled={isSearching}>
              関連する表現も検索（類義語拡張）
            </Checkbox>
            <p {...stylex.props(s.noteText)}>
              例: 「吐き気」と入力すると「悪心」「嘔吐」なども検索対象に含めます。
            </p>
          </div>
        </form>

        <div {...stylex.props(s.divider)} />

        <div {...stylex.props(s.filterSection)}>
          <div {...stylex.props(s.filterHeader)}>
            <span {...stylex.props(s.filterTitle)}>
              検索する医薬品:{" "}
              {selectedMedicineIds.length === 0
                ? "登録済みの全製品"
                : `${selectedMedicineIds.length}製品を選択中`}
            </span>
            <Button
              variant="text"
              size="sm"
              aria-expanded={showMedicineFilter}
              onClick={() => setShowMedicineFilter((prev) => !prev)}
            >
              {showMedicineFilter ? "医薬品の選択を閉じる" : "医薬品を選んで絞り込む"}
            </Button>
          </div>
          <p {...stylex.props(s.noteText)}>
            {medicineOptions.length === 0
              ? "取り込み済みの医薬品はまだありません。先に XML取り込みページから登録してください。"
              : "絞り込みを指定しない場合は、取り込み済みの全製品から検索します。"}
          </p>

          {showMedicineFilter && medicineOptions.length > 0 ? (
            <div {...stylex.props(s.filterList)}>
              <div {...stylex.props(s.chipGroup)}>
                {medicineOptions.map((option) => {
                  const selected = selectedMedicineIds.includes(option.id);
                  return (
                    <Chip
                      key={option.id}
                      selected={selected}
                      aria-pressed={selected}
                      onClick={() => onToggleMedicine(option.id)}
                    >
                      {option.label}
                    </Chip>
                  );
                })}
              </div>
              {selectedMedicineIds.length > 0 ? (
                <div>
                  <Button variant="text" size="sm" onClick={onClearMedicines}>
                    すべての医薬品を対象に戻す（選択解除）
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {errorMessage ? (
        <Banner tone="danger">
          <strong>検索できませんでした: </strong>
          {errorMessage}
        </Banner>
      ) : null}

      {hasSearched ? (
        <section aria-label="検索結果" aria-live="polite" {...stylex.props(s.resultsSection)}>
          <div {...stylex.props(s.summaryBar)}>
            <span {...stylex.props(s.summaryText)}>
              「{searchedQuery}」の検索結果（合計: {totalCount}件）
            </span>
          </div>

          {expandedKeywords.length > 0 ? (
            <div {...stylex.props(s.expandedKeywordsRow)}>
              <span {...stylex.props(s.expandedKeywordsLabel)}>検索に含めた類似語:</span>
              {expandedKeywords.map((word) => (
                <Badge key={word} tone="neutral">
                  {word}
                </Badge>
              ))}
            </div>
          ) : null}

          {sectionGroups.length > 1 ? (
            <div {...stylex.props(s.sectionFilterRow)}>
              <span {...stylex.props(s.sectionFilterLabel)}>セクション別:</span>
              <Chip
                selected={selectedSection === "all"}
                aria-pressed={selectedSection === "all"}
                onClick={() => onSelectSection("all")}
              >
                すべて ({totalCount})
              </Chip>
              {sectionGroups.map((group) => {
                const isSelected = selectedSection === group.code;
                return (
                  <Chip
                    key={group.code}
                    selected={isSelected}
                    aria-pressed={isSelected}
                    onClick={() => onSelectSection(isSelected ? "all" : group.code)}
                  >
                    [{group.code}] {group.title} ({group.count})
                  </Chip>
                );
              })}
            </div>
          ) : null}

          {displayedSources.length === 0 ? (
            <Card variant="filled" style={s.emptyCard}>
              <h2 {...stylex.props(s.emptyTitle)}>該当する記載は見つかりませんでした（0件）</h2>
              <p {...stylex.props(s.noteText)}>
                検索語を短くするか、別の表現（または類義語拡張）を試してください。
                {selectedMedicineIds.length > 0
                  ? " 医薬品を絞り込んでいる場合は、選択を解除して検索範囲を広げられます。"
                  : ""}
              </p>
            </Card>
          ) : (
            <div {...stylex.props(s.resultsList)}>
              {displayedSources.map((item) => (
                <PackageInsertEvidenceCard
                  key={item.unit_id}
                  source={item}
                  highlightWords={highlightWords}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
