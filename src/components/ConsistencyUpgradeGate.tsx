import { semanticSignature } from "../app/commands/applicationMutationCoordinator";
import { useEffect, useState, type ReactNode } from "react";
import { appRuntime } from "../app/composition/appRuntime";
import type { ConsistencyUpgradeArchive } from "../app/ports/PersistenceCommandPort";
import { downloadBlob } from "../utils/downloadBlob";
export default function ConsistencyUpgradeGate({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState<"loading" | "notice" | "ready" | "error">(
    "loading",
  );
  const [archive, setArchive] = useState<ConsistencyUpgradeArchive | null>(
    null,
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let alive = true;
    void appRuntime.persistenceCommands.inspectConsistencyUpgrade().then(
      (value) => {
        if (alive) {
          setArchive(value);
          setState(value ? "notice" : "ready");
        }
      },
      (error) => {
        if (alive) {
          setError(
            error instanceof Error
              ? error.message
              : "保存データを確認できません。",
          );
          setState("error");
        }
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  const openUpgraded = async () => {
    if (!archive || !saved) return;
    setState("loading");
    try {
      const latest =
        await appRuntime.persistenceCommands.inspectConsistencyUpgrade();
      const contents = (value: ConsistencyUpgradeArchive) => ({
        databaseVersion: value.databaseVersion,
        stores: value.stores,
        localStorage: value.localStorage,
      });
      if (
        latest &&
        semanticSignature(contents(latest)) !==
          semanticSignature(contents(archive))
      ) {
        setArchive(latest);
        setSaved(false);
        setError(
          "別のタブで保存データが変わりました。最新の移行前データを保存してください。",
        );
        setState("notice");
        return;
      }
      setState("ready");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "保存データを確認できません。",
      );
      setState("error");
    }
  };
  if (state === "ready") return <>{children}</>;
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-900 p-8 text-slate-900 dark:text-white flex justify-center items-center">
      <section className="max-w-xl space-y-4">
        <h1 className="text-xl font-bold">保存データの更新</h1>
        {state === "loading" ? (
          <p>保存形式を確認しています…</p>
        ) : state === "error" ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => location.reload()}>再試行</button>
          </>
        ) : (
          <>
            {error && <p role="alert">{error}</p>}
            <p>
              所属・巡回設定を日付とマップごとに保持するため、保存形式を更新します。更新後の保存領域は旧版（1.9.6.7以前）から開けません。
            </p>
            <p>
              先に移行前データをダウンロードしてください。旧版へ戻す必要がある場合は、旧版で作成したJSONバックアップを別のブラウザープロファイルで復元します。移行元の記録は更新時にも保存します。
            </p>
            <p>旧版を開いている別のタブを閉じてから更新してください。</p>
            <button
              className="border rounded p-2"
              onClick={() => {
                if (!archive) return;
                downloadBlob(
                  new Blob([JSON.stringify(archive, null, 2)], {
                    type: "application/json",
                  }),
                  "event-shopping-planner-pre-upgrade.json",
                );
                setSaved(true);
              }}
            >
              移行前データを保存
            </button>
            <button
              disabled={!saved}
              className="ml-3 bg-blue-600 text-white disabled:opacity-50 rounded p-2"
              onClick={() => {
                void openUpgraded();
              }}
            >
              保存形式を更新して開く
            </button>
          </>
        )}
      </section>
    </main>
  );
}
