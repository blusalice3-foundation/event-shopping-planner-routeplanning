import { DB_NAME, DB_VERSION } from "./constants";
import type { ConsistencyUpgradeArchive } from "../../app/ports/PersistenceCommandPort";
/** Opens the existing version read-only; creation is aborted before any schema change. */
export async function inspectConsistencyUpgrade(): Promise<ConsistencyUpgradeArchive | null> {
  const database = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    let missing = false;
    let settled = false;
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () => (missing ? resolve(null) : reject(request.error));
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    request.onblocked = () => {
      settled = true;
      reject(
        new Error(
          "他のタブでデータを更新しています。旧版を含む他のタブを閉じて再試行してください。",
        ),
      );
    };
  });
  try {
    // The current format uses IndexedDB; leftover legacy preferences are archival only.
    if (database && database.version >= DB_VERSION) return null;
    const legacyKeys = [
      "eventShoppingLists",
      "eventLists",
      "eventMetadata",
      "executeModeItems",
      "dayModes",
      "mapData",
      "mapRotationSettings",
      "routeSettings",
      "hallDefinitions",
      "hallRouteSettings",
      "mapViewportSettings",
      "blockDetectionSettings",
      "syncQueue",
    ];
    const local = Object.fromEntries(
      legacyKeys.flatMap((key) => {
        const value = localStorage.getItem(key);
        return value === null ? [] : [[key, value]];
      }),
    );

    if (!database && !Object.keys(local).length) return null;
    const archive: ConsistencyUpgradeArchive = {
      kind: "event-shopping-planner-pre-upgrade",
      version: 1,
      databaseVersion: database?.version ?? 0,
      exportedAt: new Date().toISOString(),
      stores: {},
      localStorage: local,
    };
    if (!database) return archive;
    const stores = Array.from(database.objectStoreNames);
    if (!stores.length) return archive;
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(stores, "readonly");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
      for (const name of stores) {
        const entries: ConsistencyUpgradeArchive["stores"][string] =
          (archive.stores[name] = []);
        const request = transaction.objectStore(name).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          entries.push({ key: cursor.key, value: cursor.value });
          cursor.continue();
        };
      }
    });
    return archive;
  } finally {
    database?.close();
  }
}
