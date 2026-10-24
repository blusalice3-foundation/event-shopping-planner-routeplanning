import { useRef, useState } from "react";
import type { ApplicationSnapshotRead } from "../ports/PersistenceCommandPort";
import { db } from "../../persistence/facade/indexedDbPersistence";
import { createAppBackupFile } from "../../utils/appBackup";
import { downloadBlob } from "../../utils/downloadBlob";

/** An explicit maintenance screen; the ordinary application is never mounted here. */
export default function StorageRollbackMaintenance() {
  const observation = useRef<ApplicationSnapshotRead>();
  const [busy, setBusy] = useState(false);
  const [backupReady, setBackupReady] = useState(false);
  const [backupSaved, setBackupSaved] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const downloadBackup = async () => {
    setBusy(true);
    setError("");
    setStatus("");
    setBackupReady(false);
    setBackupSaved(false);
    observation.current = undefined;
    try {
      const read = await db.readApplicationSnapshot({
        prepareScopedCommands: false,
      });
      if (read.consistencyMissing || read.scopeTarget)
        throw new Error(
          "保存済みデータの確認が必要です。通常画面で復旧を完了してから、もう一度開いてください。",
        );
      const backup = createAppBackupFile(read.snapshot);
      downloadBlob(
        backup.blob,
        `event-shopping-planner-backup-${backup.exportedAt.replace(/:/g, "-")}.json`,
      );
      observation.current = read;
      setBackupReady(true);
      setStatus("バックアップの保存が完了したら、下の確認を選んでください。");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "データを確認できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  };

  const prepareRollback = async () => {
    const read = observation.current;
    if (!read || !backupSaved || busy) return;
    setBusy(true);
    setError("");
    setStatus("保存形式を準備しています。この画面を閉じずにお待ちください。");
    try {
      await db.prepareShoppingMoveRollback(read.expectedRoots);
      setPrepared(true);
      setStatus("旧バージョンで読み込める保存形式の準備が完了しました。");
    } catch (reason) {
      observation.current = undefined;
      setBackupReady(false);
      setBackupSaved(false);
      setStatus("");
      setError(
        `${reason instanceof Error ? reason.message : "準備を完了できませんでした。"} 最新のバックアップを保存してから再度お試しください。`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6 text-gray-900">
      <h1 className="text-2xl font-bold">旧バージョンへ戻す準備</h1>
      <p>
        この端末に保存された最新の買い物データを、旧バージョンでも読み込める形式にします。
        ほかのタブやウィンドウで本アプリを開いている場合は、先に閉じてください。
      </p>
      <p>
        まずバックアップを保存してください。準備中は買い物操作を行わず、完了後にこの画面を閉じてから旧バージョンへ切り替えてください。
      </p>
      {!prepared && (
        <>
          <button
            type="button"
            className="rounded bg-blue-700 px-4 py-3 text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void downloadBackup()}
          >
            1. 最新のバックアップを保存
          </button>
          <label className="flex gap-3">
            <input
              type="checkbox"
              checked={backupSaved}
              disabled={busy || !backupReady}
              onChange={(event) => setBackupSaved(event.target.checked)}
            />
            バックアップファイルが保存されたことを確認しました
          </label>
          <button
            type="button"
            className="rounded bg-blue-700 px-4 py-3 text-white disabled:opacity-50"
            disabled={busy || !backupReady || !backupSaved}
            onClick={() => void prepareRollback()}
          >
            2. 旧バージョン用に準備
          </button>
        </>
      )}
      <p role="status" aria-live="polite">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {prepared && (
        <p>
          この画面を閉じてください。引き続き現行版を使う場合もデータは保存できますが、買い物の移動には従来の保存処理を使います。
          バックアップファイルは旧バージョンでの確認が済むまで保管してください。
        </p>
      )}
    </main>
  );
}
