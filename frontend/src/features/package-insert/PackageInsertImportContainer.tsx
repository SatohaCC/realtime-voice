"use client";

import { PackageInsertImportPanel } from "./components/package-insert-import-panel";
import { usePackageInsertImport } from "./usePackageInsertImport";

/**
 * 添付文書 XML 取り込み機能の状態と Presentational パネルを接続する Container。
 */
export function PackageInsertImportContainer() {
  const {
    selectedFile,
    isSubmitting,
    submitError,
    result,
    historyPage,
    historyLoading,
    historyError,
    handleSelectFile,
    handleSubmit,
    refetchHistory,
    setOffset,
  } = usePackageInsertImport();

  return (
    <PackageInsertImportPanel
      selectedFileName={selectedFile?.name ?? null}
      selectedFileSize={selectedFile?.size ?? null}
      onSelectFile={handleSelectFile}
      onSubmit={() => {
        void handleSubmit();
      }}
      isSubmitting={isSubmitting}
      submitError={submitError}
      result={result}
      historyPage={historyPage}
      historyLoading={historyLoading}
      historyError={historyError}
      onRefreshHistory={refetchHistory}
      onChangeHistoryOffset={setOffset}
    />
  );
}
