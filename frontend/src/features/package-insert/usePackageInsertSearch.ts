"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { listRegisteredMedicines, searchPackageInserts } from "@/shared/lib/package-insert/client";
import {
  extractHighlightWords,
  extractSectionGroups,
} from "@/shared/lib/package-insert/searchHelpers";
import type { PackageInsertEvidenceSource } from "@/shared/lib/package-insert/types";
import { useAppQuery } from "@/shared/lib/query/useAppQuery";

const REGISTERED_MEDICINES_QUERY_KEY = "registered-medicines";

/**
 * 登録済み医薬品一覧の取得、キーワード検索実行、およびセクション別絞り込みを管理する Hook。
 */
export function usePackageInsertSearch() {
  const [query, setQuery] = useState("");
  const [selectedYjCodes, setSelectedYjCodes] = useState<string[]>([]);
  const [isExpandEnabled, setIsExpandEnabled] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [results, setResults] = useState<PackageInsertEvidenceSource[] | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [expandedKeywords, setExpandedKeywords] = useState<string[]>([]);
  const [selectedSection, setSelectedSection] = useState("all");

  const searchBusyRef = useRef(false);

  const { data: medicineList } = useAppQuery({
    queryKey: [REGISTERED_MEDICINES_QUERY_KEY],
    queryFn: ({ signal }) => listRegisteredMedicines(signal),
  });

  const medicineOptions = useMemo(() => {
    const items = medicineList?.items ?? [];
    return items.flatMap((med) =>
      med.yj_codes.map((code, index) => ({
        id: code,
        label: med.brand_names[index] ?? med.generic_name,
      })),
    );
  }, [medicineList]);

  const toggleYjCode = useCallback((code: string) => {
    setSelectedYjCodes((prev) =>
      prev.includes(code) ? prev.filter((item) => item !== code) : [...prev, code],
    );
  }, []);

  const clearYjCodes = useCallback(() => {
    setSelectedYjCodes([]);
  }, []);

  const handleSearch = useCallback(async () => {
    if (searchBusyRef.current) {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    searchBusyRef.current = true;
    setIsSearching(true);
    setErrorMessage(null);
    try {
      const response = await searchPackageInserts(trimmed, selectedYjCodes, isExpandEnabled);
      setResults(response.items);
      setSearchedQuery(response.query);
      setExpandedKeywords(response.expanded_keywords ?? []);
      setSelectedSection("all");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "添付文書の検索に失敗しました。");
      setResults(null);
      setExpandedKeywords([]);
    } finally {
      searchBusyRef.current = false;
      setIsSearching(false);
    }
  }, [isExpandEnabled, query, selectedYjCodes]);

  const sources = results ?? [];
  const sectionGroups = useMemo(() => extractSectionGroups(sources), [sources]);
  const highlightWords = useMemo(
    () => extractHighlightWords([searchedQuery, ...expandedKeywords].join(" ")),
    [expandedKeywords, searchedQuery],
  );
  const displayedSources = useMemo(
    () =>
      selectedSection === "all"
        ? sources
        : sources.filter((item) => (item.section?.code || "other") === selectedSection),
    [selectedSection, sources],
  );

  return {
    query,
    setQuery,
    isSearching,
    isExpandEnabled,
    setIsExpandEnabled,
    medicineOptions,
    selectedYjCodes,
    toggleYjCode,
    clearYjCodes,
    errorMessage,
    hasSearched: results !== null,
    searchedQuery,
    expandedKeywords,
    totalCount: sources.length,
    displayedSources,
    sectionGroups,
    selectedSection,
    setSelectedSection,
    highlightWords,
    handleSearch,
  };
}
