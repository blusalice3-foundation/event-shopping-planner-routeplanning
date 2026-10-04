import { normalizeExecutionVisitDay } from "../utils/visitProjection";
import { useState } from "react";
import type { PersistenceSnapshot } from "../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../types/item";
import type { DayMapData, HallDefinition } from "../types/map";
import type { HallGroupRef, LegacyPendingV1 } from "../types/consistency";
import {
  collectEventDays,
  getContextHalls,
  resolveDayMap,
} from "../features/consistency/domain/context";
import {
  legacyGroupIds,
  legacyPendingIdentity,
  type LegacyResolutionChoice,
} from "../features/consistency/domain/legacyResolution";
interface Props {
  snapshot: PersistenceSnapshot;
  eventName: string;
  resolve(identity: string, choice: LegacyResolutionChoice): Promise<unknown>;
}
const labels: Record<LegacyPendingV1["payload"]["kind"], string> = {
  "manual-hall": "所属指定",
  "hall-definitions": "簡易ホール定義",
  "hall-route-settings": "ホール順・訪問品目",
  "route-settings": "経路",
};
export function LegacyConsistencyReview({
  snapshot,
  eventName,
  resolve,
}: Props) {
  const pending = snapshot.eventConsistency[eventName]?.legacyPending ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const entry = pending.find(
    (value) => legacyPendingIdentity(value) === selected,
  );
  return (
    <>
      {pending.length > 0 && (
        <div className="bg-amber-100 p-3 text-amber-950">
          旧設定の対応先を確認してください（{pending.length}件）。
          <button
            className="ml-3 underline"
            onClick={() => setSelected(legacyPendingIdentity(pending[0]))}
          >
            確認待ち設定を開く
          </button>
        </div>
      )}
      {entry && (
        <LegacyEntryEditor
          key={`${eventName}:${selected}`}
          snapshot={snapshot}
          eventName={eventName}
          entry={entry}
          pending={pending}
          select={setSelected}
          close={() => setSelected(null)}
          resolve={resolve}
        />
      )}
    </>
  );
}
function LegacyEntryEditor({
  snapshot,
  eventName,
  entry,
  pending,
  select,
  close,
  resolve,
}: Props & {
  entry: LegacyPendingV1;
  pending: LegacyPendingV1[];
  select(value: string): void;
  close(): void;
}) {
  const event = snapshot.eventConsistency[eventName];
  const days = collectEventDays(
    snapshot.eventLists[eventName] as ShoppingItem[],
    snapshot.executeModeItems[eventName],
    snapshot.dayModes[eventName],
    event.days,
  );
  const [day, setDay] = useState(
    normalizeExecutionVisitDay(entry.sourceDayKey ?? days[0] ?? ""),
  );
  const [mapKey, setMapKey] = useState<string | null>(
    entry.payload.kind === "hall-definitions" ? null : entry.sourceMapKey,
  );
  const [groups, setGroups] = useState<Record<string, HallGroupRef>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const maps = resolveDayMap(
    snapshot.mapData[eventName] as Record<string, DayMapData>,
    day,
  ).candidates;
  const halls = getContextHalls(
    snapshot.hallDefinitions[eventName] as Record<string, HallDefinition[]>,
    day,
    mapKey,
  );
  const ids = legacyGroupIds(entry);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await resolve(legacyPendingIdentity(entry), { day, mapKey, groups });
      close();
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存に失敗しました。");
      setBusy(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-review-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-6 text-slate-900 shadow-2xl dark:bg-slate-800 dark:text-white"
      >
        <h2 id="legacy-review-title" className="text-xl font-semibold">
          確認待ち設定の対応先
        </h2>
        <label className="mt-4 block">
          設定
          <select
            className="block w-full rounded border p-2 text-slate-900"
            disabled={busy}
            value={legacyPendingIdentity(entry)}
            onChange={(event) => select(event.target.value)}
          >
            {pending.map((value, index) => (
              <option key={index} value={legacyPendingIdentity(value)}>
                {labels[value.payload.kind]} / {value.sourceKey} /{" "}
                {value.sourceDayKey ?? "日付未確定"}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-3 text-sm">
          元の内容を保全しています。対応先と変更内容を確認してから保存します。
        </p>
        <details className="mt-2">
          <summary>元の設定</summary>
          <pre className="overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(entry, null, 2)}
          </pre>
        </details>
        <label className="mt-4 block">
          日付
          <select
            className="block w-full rounded border p-2 text-slate-900"
            value={day}
            disabled={busy}
            onChange={(event) => {
              setDay(event.target.value);
              setMapKey(null);
              setGroups({});
            }}
          >
            <option value="">選択してください</option>
            {days.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {entry.payload.kind !== "hall-definitions" && (
          <label className="mt-4 block">
            マップ
            <select
              className="block w-full rounded border p-2 text-slate-900"
              value={mapKey ?? ""}
              disabled={busy}
              onChange={(event) => {
                setMapKey(event.target.value || null);
                setGroups({});
              }}
            >
              <option value="">マップなしの設定</option>
              {maps.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        )}
        {entry.payload.kind === "hall-definitions" && (
          <p className="mt-3 text-sm">
            選択した日付の簡易ホールへ追加します。同じIDの異なる定義は、別のIDで保持します。
          </p>
        )}
        {ids.map((id) => (
          <label key={id} className="mt-4 block">
            旧指定「{id}」
            <select
              className="block w-full rounded border p-2 text-slate-900"
              value={groups[id] ? JSON.stringify(groups[id]) : ""}
              disabled={busy}
              onChange={(event) =>
                setGroups((current) => ({
                  ...current,
                  [id]: JSON.parse(event.target.value) as HallGroupRef,
                }))
              }
            >
              <option value="" disabled>
                対応先を選択してください
              </option>
              <option value={JSON.stringify({ hall: null, priority: "none" })}>
                {entry.payload.kind === "manual-hall"
                  ? "自動判定へ戻す"
                  : "未割当"}
              </option>
              {halls.flatMap((hall) =>
                (entry.payload.kind === "manual-hall"
                  ? ["none" as const]
                  : (["none", "priority", "highest"] as const)
                ).map((priority) => (
                  <option
                    key={JSON.stringify([hall.ref, priority])}
                    value={JSON.stringify({ hall: hall.ref, priority })}
                  >
                    {hall.definition.name}（
                    {hall.ref.kind === "map"
                      ? `詳細: ${hall.ref.mapKey}`
                      : `簡易: ${hall.ref.dayKey}`}
                    ）
                    {priority === "highest"
                      ? " / 最優先"
                      : priority === "priority"
                        ? " / 優先"
                        : ""}
                  </option>
                )),
              )}
            </select>
          </label>
        ))}
        {error && (
          <p role="alert" className="mt-3 text-red-600">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded border px-4 py-2"
            disabled={busy}
            onClick={close}
          >
            閉じる
          </button>
          <button
            className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            disabled={
              busy ||
              !day ||
              ids.some((id) => !groups[id]) ||
              (entry.payload.kind === "route-settings" && mapKey === null)
            }
            onClick={() => void submit()}
          >
            {busy ? "確認・保存中…" : "変更内容を確認"}
          </button>
        </div>
      </section>
    </div>
  );
}
