import { getValidAccessToken } from "../supabase/client";
import type {
  PackageInsertImportPage,
  PackageInsertImportResult,
  PackageInsertSearchResponse,
  RegisteredMedicineList,
} from "./types";

const MAX_XML_BYTES = 10 * 1024 * 1024;
const DIRECT_UPLOAD_LIMIT = 3 * 1024 * 1024;

async function requireAccessToken(): Promise<string> {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error("ログインセッションを確認できませんでした。再ログインしてください。");
  }
  return token;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as {
      detail?: string | { message?: string };
    };
    if (typeof body.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
    if (body.detail && typeof body.detail === "object" && typeof body.detail.message === "string") {
      return body.detail.message;
    }
  } catch {
    // JSON 解析に失敗した場合は既定文言を使う
  }
  return fallback;
}

/**
 * 取り込み済み XML の履歴一覧を取得する。
 */
export async function listPackageInsertImports(
  offset: number,
  signal: AbortSignal,
  limit = 20,
): Promise<PackageInsertImportPage> {
  const token = await requireAccessToken();
  const response = await fetch(`/api/package-insert-imports?limit=${limit}&offset=${offset}`, {
    signal,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "取り込み済み XML の一覧を取得できませんでした。"),
    );
  }
  return (await response.json()) as PackageInsertImportPage;
}

/**
 * PMDA 電子添文 XML ファイルをアップロードして登録する（3MiB 超は分割アップロード）。
 */
export async function importPackageInsert(file: File): Promise<PackageInsertImportResult> {
  if (file.size > MAX_XML_BYTES) {
    throw new Error("XML ファイルは 10MiB 以内で選択してください。");
  }
  if (file.size > DIRECT_UPLOAD_LIMIT) {
    return importLargePackageInsert(file);
  }

  const token = await requireAccessToken();
  const form = new FormData();
  form.append("file", file);

  const response = await fetch("/api/package-insert-imports", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "取り込みに失敗しました。内容を確認して再送してください。"),
    );
  }
  return (await response.json()) as PackageInsertImportResult;
}

async function importLargePackageInsert(file: File): Promise<PackageInsertImportResult> {
  const token = await requireAccessToken();
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sourceSha256 = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

  const startRes = await fetch("/api/package-insert-imports/uploads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename: file.name,
      byte_size: file.size,
      source_sha256: sourceSha256,
    }),
  });
  if (!startRes.ok) {
    throw new Error(await readErrorMessage(startRes, "分割アップロードを開始できませんでした。"));
  }

  const session = (await startRes.json()) as { upload_id: string; chunk_bytes: number };
  if (
    !Number.isSafeInteger(session.chunk_bytes) ||
    session.chunk_bytes < 1 ||
    session.chunk_bytes > DIRECT_UPLOAD_LIMIT
  ) {
    throw new Error("送信設定を確認できませんでした。再送してください。");
  }

  for (let offset = 0, index = 0; offset < file.size; offset += session.chunk_bytes, index += 1) {
    const partRes = await fetch(
      `/api/package-insert-imports/uploads/${encodeURIComponent(session.upload_id)}/parts/${index}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        body: file.slice(offset, offset + session.chunk_bytes),
      },
    );
    if (!partRes.ok) {
      throw new Error(
        await readErrorMessage(partRes, "分割パートの送信に失敗しました。再送してください。"),
      );
    }
  }

  const completeRes = await fetch(
    `/api/package-insert-imports/uploads/${encodeURIComponent(session.upload_id)}/complete`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!completeRes.ok) {
    throw new Error(
      await readErrorMessage(completeRes, "取り込みの完了処理に失敗しました。再送してください。"),
    );
  }
  return (await completeRes.json()) as PackageInsertImportResult;
}

/**
 * 検索対象として登録済みの有効な医薬品一覧を取得する。
 */
export async function listRegisteredMedicines(
  signal: AbortSignal,
): Promise<RegisteredMedicineList> {
  const token = await requireAccessToken();
  const response = await fetch("/api/medicines", {
    signal,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "登録済み医薬品の一覧を取得できませんでした。"),
    );
  }
  return (await response.json()) as RegisteredMedicineList;
}

/**
 * 登録済み添付文書からキーワードで検索する。
 */
export async function searchPackageInserts(
  query: string,
  yjCodes: readonly string[],
  expand: boolean,
): Promise<PackageInsertSearchResponse> {
  const token = await requireAccessToken();
  const params = new URLSearchParams({ q: query });
  for (const code of yjCodes) {
    params.append("yj_codes", code);
  }
  if (expand) {
    params.set("expand", "true");
  }

  const response = await fetch(`/api/search?${params.toString()}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "添付文書の検索に失敗しました。"));
  }
  return (await response.json()) as PackageInsertSearchResponse;
}
