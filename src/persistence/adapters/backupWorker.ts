import type {
  ApplicationBackupChange,
  ApplicationBackupFile,
  PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
import { RUNTIME_FALLBACK_NAMESPACE } from "../../utils/persistenceResilience";
import { createAppBackupFile } from "../../utils/appBackup";

/** A dedicated worker leaves persistence commands and UI input free to run. */
export function createBackupInWorker(
  changes: readonly ApplicationBackupChange[],
  fallback: () => PersistenceSnapshot,
): Promise<ApplicationBackupFile> {
  if (typeof Worker !== "function")
    return Promise.resolve(createAppBackupFile(fallback()));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../worker/backup.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch (error) {
      reject(error);
      return;
    }
    const fail = (error: unknown) => {
      worker.terminate();
      reject(error);
    };
    worker.onerror = () =>
      fail(new Error("バックアップを作成できませんでした。"));
    worker.onmessage = (
      event: MessageEvent<{
        needsSnapshot?: boolean;
        file?: ApplicationBackupFile;
        error?: string;
      }>,
    ) => {
      if (event.data.needsSnapshot) {
        try {
          worker.postMessage({ changes: [], snapshot: fallback() });
        } catch (error) {
          fail(error);
        }
      } else if (event.data.file) {
        worker.terminate();
        resolve(event.data.file);
      } else
        fail(
          new Error(event.data.error ?? "バックアップを作成できませんでした。"),
        );
    };
    try {
      const hasRuntimeSource =
        typeof localStorage !== "undefined" &&
        Array.from({ length: localStorage.length }, (_, index) =>
          localStorage.key(index),
        ).some((key) => key?.startsWith(RUNTIME_FALLBACK_NAMESPACE));
      worker.postMessage(
        hasRuntimeSource ? { changes: [], snapshot: fallback() } : { changes },
      );
    } catch (error) {
      fail(error);
    }
  });
}
