import { useState, type Dispatch, type SetStateAction } from "react";
import { downloadBlob } from "../utils/downloadBlob";
import {
  discardUnsavedChanges,
  readUnsavedChanges,
  type UnsavedChangesRecord,
  type StoredUnsavedChanges,
} from "../utils/unsavedChangesJournal";

export default function UnsavedChangesRecoveryNotice({
  ready,
  onResume,
  records: suppliedRecords,
  onRecordsChange,
}: {
  ready: boolean;
  onResume(record: UnsavedChangesRecord): Promise<void>;
  records?: StoredUnsavedChanges[];
  onRecordsChange?: Dispatch<SetStateAction<StoredUnsavedChanges[]>>;
}) {
  const [localRecords, setLocalRecords] = useState(
    () => suppliedRecords ?? readUnsavedChanges(),
  );
  const records = suppliedRecords ?? localRecords;
  const setRecords = onRecordsChange ?? setLocalRecords;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [minimized, setMinimized] = useState(true);
  if (!records.length) return null;
  if (minimized)
    return (
      <button
        type="button"
        className="mx-2 my-1 max-w-[calc(100%-1rem)] rounded-lg border border-amber-500 bg-amber-50 px-2 py-1 text-xs text-slate-900"
        aria-expanded={false}
        onClick={() => setMinimized(false)}
      >
        未保存操作の救済記録（{records.length}件）を表示
      </button>
    );
  const current = records[0];
  const discard = () => {
    if (!discardUnsavedChanges(current.key)) {
      setError("救済記録を削除できませんでした。記録は保持しています。");
      return;
    }
    setRecords((values) => values.filter((value) => value.key !== current.key));
  };
  const resumable =
    current.record?.operations.length &&
    current.record.operations.every((operation) => operation.canResume);
  return (
    <aside
      className="fixed left-4 top-4 z-40 max-h-[45dvh] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-amber-500 bg-amber-50 p-4 shadow-xl text-slate-900 dark:bg-slate-900 dark:text-white"
      role="region"
      aria-label="離脱前の未保存操作"
    >
      <p className="font-semibold">離脱前の未保存操作の救済記録があります</p>
      <p className="mt-2 text-sm">
        保存中・確認待ちだった内容です。保存データには自動反映しません。再開できない操作はJSON救済記録を確認してやり直してください。この記録は通常のJSONバックアップとは形式が異なります。
      </p>
      <p className="mt-1 text-xs">
        {current.record?.recordedAt ?? "記録の形式を確認できません"}（残り
        {records.length}件）
      </p>
      {current.record?.operations.some(
        (operation) => operation.inputUnavailable,
      ) && (
        <p role="alert" className="mt-2 text-sm">
          処理開始前に離脱した操作があり、その入力内容はこの救済記録に含まれていません。元ファイルや入力内容を用意して操作をやり直してください。
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          onClick={() => setMinimized(true)}
        >
          記録を保持して最小化
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          disabled={!ready || !resumable || busyKey !== null}
          onClick={() => {
            if (!current.record) return;
            setBusyKey(current.key);
            setMinimized(true);
            setError("");
            void onResume(current.record)
              .then(
                () => {
                  if (discardUnsavedChanges(current.key))
                    setRecords((values) =>
                      values.filter((value) => value.key !== current.key),
                    );
                },
                (reason: unknown) => {
                  setMinimized(false);
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "再開できませんでした。記録は保持しています。",
                  );
                },
              )
              .finally(() => setBusyKey(null));
          }}
        >
          {busyKey
            ? "再開した操作の確認・保存を待っています"
            : "内容を再確認して再開"}
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          onClick={() => {
            try {
              downloadBlob(
                new Blob([current.text], {
                  type: "application/json;charset=utf-8",
                }),
                "event-shopping-planner-unsaved-recovery.json",
              );
            } catch {
              setError(
                "出力を開始できませんでした。救済記録は保持しています。",
              );
            }
          }}
        >
          JSON救済記録を出力
        </button>
        <button
          type="button"
          className="rounded border px-3 py-2 text-sm"
          disabled={busyKey !== null}
          onClick={() => {
            if (
              window.confirm(
                "この救済記録を破棄します。必要な内容を確認し、出力した場合はファイルが保存されたことを確認しましたか？",
              )
            )
              discard();
          }}
        >
          記録を破棄
        </button>
      </div>
      <p className="mt-2 text-xs">
        出力後は共有・プレビュー画面で実際にファイルを保存してください。出力ボタンだけでは記録を削除しません。記録を保持したまま通常の操作も続けられます。
      </p>
    </aside>
  );
}
