import { describe, expect, it } from "vitest";
import type { PharmacistVoiceprintRecord } from "./voiceprintStore";
import {
  deletePharmacistVoiceprint,
  loadPharmacistVoiceprint,
  savePharmacistVoiceprint,
} from "./voiceprintStore";

function createFakeIndexedDbFactory(): IDBFactory {
  const backingStore = new Map<string, Record<string, unknown>>();

  const makeRequest = <T>(exec: () => T): IDBRequest<T> => {
    const req: {
      result?: T;
      error: DOMException | null;
      onsuccess: ((ev: Event) => void) | null;
      onerror: ((ev: Event) => void) | null;
      onupgradeneeded?: ((ev: IDBVersionChangeEvent) => void) | null;
    } = {
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    queueMicrotask(() => {
      try {
        req.result = exec();
        if (req.onupgradeneeded) {
          req.onupgradeneeded({} as IDBVersionChangeEvent);
        }
        req.onsuccess?.(new Event("success"));
      } catch (err) {
        req.error = err instanceof DOMException ? err : new DOMException(String(err));
        req.onerror?.(new Event("error"));
      }
    });
    return req as unknown as IDBRequest<T>;
  };

  const fakeDb = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    close: () => {},
    transaction: () => {
      const tx: {
        error: DOMException | null;
        oncomplete: ((ev: Event) => void) | null;
        onerror: ((ev: Event) => void) | null;
        onabort: ((ev: Event) => void) | null;
        objectStore: () => unknown;
      } = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => ({
          put: (value: Record<string, unknown>) => {
            backingStore.set(String(value.userId), value);
            queueMicrotask(() => tx.oncomplete?.(new Event("complete")));
            return makeRequest(() => value.userId);
          },
          get: (key: string) => makeRequest(() => backingStore.get(key)),
          delete: (key: string) => {
            backingStore.delete(key);
            queueMicrotask(() => tx.oncomplete?.(new Event("complete")));
            return makeRequest(() => undefined);
          },
        }),
      };
      return tx;
    },
  };

  return {
    open: () => makeRequest(() => fakeDb as unknown as IDBDatabase),
  } as unknown as IDBFactory;
}

describe("voiceprintStore", () => {
  it("アカウント単位で薬剤師声紋を端末ローカルへ保存・読込・削除できる", async () => {
    const fakeIdb = createFakeIndexedDbFactory();
    const recordA: PharmacistVoiceprintRecord = {
      userId: "user-a",
      modelId: "campp-v1",
      embeddingDim: 3,
      embedding: [0.1, 0.2, 0.3],
      voicedSec: 3.4,
      updatedAt: "2026-11-15T00:00:00.000Z",
    };

    const saved = await savePharmacistVoiceprint(recordA, fakeIdb);
    expect(saved).toBe(true);

    const loadedA = await loadPharmacistVoiceprint("user-a", fakeIdb);
    expect(loadedA).toEqual(recordA);

    const loadedB = await loadPharmacistVoiceprint("user-b", fakeIdb);
    expect(loadedB).toBeNull();

    await deletePharmacistVoiceprint("user-a", fakeIdb);
    expect(await loadPharmacistVoiceprint("user-a", fakeIdb)).toBeNull();
  });

  it("IndexedDB が利用不可な環境では安全にフォールバックする", async () => {
    const ok = await savePharmacistVoiceprint(
      {
        userId: "user-a",
        modelId: "campp-v1",
        embeddingDim: 2,
        embedding: [0.5, 0.5],
        voicedSec: 3.0,
        updatedAt: "2026-11-15T00:00:00.000Z",
      },
      null,
    );
    expect(ok).toBe(false);
    expect(await loadPharmacistVoiceprint("user-a", null)).toBeNull();
  });
});
