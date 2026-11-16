"use client";

import { PackageInsertSearchPanel } from "@/shared/components";
import { usePackageInsertSearch } from "./usePackageInsertSearch";

/**
 * 添付文書キーワード検索機能の状態と Presentational パネルを接続する Container。
 */
export function PackageInsertSearchContainer() {
  const {
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
    hasSearched,
    searchedQuery,
    expandedKeywords,
    totalCount,
    displayedSources,
    sectionGroups,
    selectedSection,
    setSelectedSection,
    highlightWords,
    handleSearch,
  } = usePackageInsertSearch();

  return (
    <PackageInsertSearchPanel
      query={query}
      onQueryChange={setQuery}
      onSearch={() => {
        void handleSearch();
      }}
      isSearching={isSearching}
      isExpandEnabled={isExpandEnabled}
      onExpansionChange={setIsExpandEnabled}
      medicineOptions={medicineOptions}
      selectedMedicineIds={selectedYjCodes}
      onToggleMedicine={toggleYjCode}
      onClearMedicines={clearYjCodes}
      errorMessage={errorMessage}
      hasSearched={hasSearched}
      searchedQuery={searchedQuery}
      expandedKeywords={expandedKeywords}
      totalCount={totalCount}
      displayedSources={displayedSources}
      sectionGroups={sectionGroups}
      selectedSection={selectedSection}
      onSelectSection={setSelectedSection}
      highlightWords={highlightWords}
    />
  );
}
