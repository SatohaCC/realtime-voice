export interface PharmacistVoiceprintRecord {
  /** ログインアカウントの識別子（1アカウント＝薬剤師1名） */
  userId: string;
  modelId: string;
  embeddingDim: number;
  embedding: readonly number[];
  voicedSec: number;
  updatedAt: string;
}

const DB_NAME = "realtime-voice-speaker-db";
const DB_VERSION = 1;
const STORE_NAME = "pharmacist-voiceprints";

function resolveIndexedDb(customFactory?: IDBFactory | null): IDBFactory | null {
  if (customFactory !== undefined) {
    return customFactory;
  }
  if (typeof globalThis === "undefined" || !("indexedDB" in globalThis)) {
    return null;
  }
  return globalThis.indexedDB ?? null;
}

function openVoiceprintDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "userId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB を開けませんでした。"));
  });
}

function isValidRecord(raw: unknown): raw is PharmacistVoiceprintRecord {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return (
    typeof obj.userId === "string" &&
    obj.userId.length > 0 &&
    typeof obj.modelId === "string" &&
    obj.modelId.length > 0 &&
    typeof obj.embeddingDim === "number" &&
    Array.isArray(obj.embedding) &&
    obj.embedding.length > 0 &&
    obj.embedding.every((val) => typeof val === "number" && Number.isFinite(val))
  );
}

/**
 * 事前登録済みの薬剤師声紋ベクトルを端末ローカルの IndexedDB へアカウント単位で保存する。
 */
export async function savePharmacistVoiceprint(
  record: PharmacistVoiceprintRecord,
  idbFactory?: IDBFactory | null,
): Promise<boolean> {
  const idb = resolveIndexedDb(idbFactory);
  if (!idb) {
    return false;
  }
  const db = await openVoiceprintDb(idb);
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({
        ...record,
        embedding: [...record.embedding],
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error ?? new Error("声紋データの保存に失敗しました。"));
      tx.onabort = () => reject(tx.error ?? new Error("声紋データの保存が中断されました。"));
    });
  } finally {
    db.close();
  }
}

/**
 * 指定アカウント（userId）に紐づく薬剤師声紋を IndexedDB から読み込む。
 */
export async function loadPharmacistVoiceprint(
  userId: string,
  idbFactory?: IDBFactory | null,
): Promise<PharmacistVoiceprintRecord | null> {
  const trimmed = userId.trim();
  if (!trimmed) {
    return null;
  }
  const idb = resolveIndexedDb(idbFactory);
  if (!idb) {
    return null;
  }
  const db = await openVoiceprintDb(idb);
  try {
    return await new Promise<PharmacistVoiceprintRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(trimmed);
      req.onsuccess = () => {
        const result = req.result;
        resolve(isValidRecord(result) ? result : null);
      };
      req.onerror = () => reject(req.error ?? new Error("声紋データの読込に失敗しました。"));
    });
  } finally {
    db.close();
  }
}

/**
 * 指定アカウント（userId）の薬剤師声紋を IndexedDB から削除する。
 */
export async function deletePharmacistVoiceprint(
  userId: string,
  idbFactory?: IDBFactory | null,
): Promise<void> {
  const trimmed = userId.trim();
  if (!trimmed) {
    return;
  }
  const idb = resolveIndexedDb(idbFactory);
  if (!idb) {
    return;
  }
  const db = await openVoiceprintDb(idb);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.delete(trimmed);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("声紋データの削除に失敗しました。"));
      tx.onabort = () => reject(tx.error ?? new Error("声紋データの削除が中断されました。"));
    });
  } finally {
    db.close();
  }
}
