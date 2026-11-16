"use client";

import { useCallback, useRef, useState } from "react";
import { importPackageInsert, listPackageInsertImports } from "@/shared/lib/package-insert/client";
import type { PackageInsertImportResult } from "@/shared/lib/package-insert/types";
import { useAppQuery, useInvalidateAppQueries } from "@/shared/lib/query/useAppQuery";

const IMPORT_HISTORY_QUERY_KEY = "package-insert-imports";
const REGISTERED_MEDICINES_QUERY_KEY = "registered-medicines";

/**
 * 添付文書 XML の選択・送信・取り込み結果・履歴一覧取得を管理する Hook。
 */
export function usePackageInsertImport() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<PackageInsertImportResult | null>(null);
  const [offset, setOffset] = useState(0);

  const submittingRef = useRef(false);
  const invalidateQueries = useInvalidateAppQueries();

  const {
    data: historyPage,
    error: historyError,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useAppQuery({
    queryKey: [IMPORT_HISTORY_QUERY_KEY, offset],
    queryFn: ({ signal }) => listPackageInsertImports(offset, signal),
  });

  const handleSelectFile = useCallback((file: File | null) => {
    setSelectedFile(file);
    setSubmitError(null);
    setResult(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedFile || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const imported = await importPackageInsert(selectedFile);
      setResult(imported);
      setOffset(0);
      invalidateQueries([IMPORT_HISTORY_QUERY_KEY]);
      invalidateQueries([REGISTERED_MEDICINES_QUERY_KEY]);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "XML の取り込みに失敗しました。");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [invalidateQueries, selectedFile]);

  return {
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
  };
}
