import type {
  ApplicationBackupChange,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
import { db } from "../facade/indexedDbPersistence";
import { buildWorkerBackup } from "./backupWorkerServer";
// Runtime fallback sources are exported from the captured UI snapshot instead.
// Dedicated workers have no native localStorage, even when there are no sources.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() {
      return storage.size;
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  },
});
self.onmessage = async (
  event: MessageEvent<{
    changes: ApplicationBackupChange[];
    snapshot?: PersistenceSnapshot;
  }>,
) => {
  try {
    self.postMessage(
      await buildWorkerBackup(db.readApplicationSnapshot, event.data),
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
