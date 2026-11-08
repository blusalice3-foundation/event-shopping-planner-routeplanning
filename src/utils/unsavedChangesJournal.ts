import { recordEntry } from "./ownRecord";
import type { PersistenceSnapshot } from "../app/ports/PersistenceCommandPort";
import { jsonEqual } from "./semanticEquality";

const PREFIX = "esp-unsaved-changes-v1:";
export const UNSAVED_JOURNAL_DELAY_MS = 1000;
export const MAX_UNSAVED_JOURNAL_OPERATIONS = 100;
const MAX_COMPARISON_VISITS = 25_000;
const MAX_SERIALIZATION_VISITS = 50_000;
const MAX_ARRAY_ENTRIES = 20_000;
const MAX_SERIALIZED_CHARACTERS = 1024 * 1024;

/** An over-budget value is conservatively changed, never assumed identical. */
export function createUnsavedComparisonBudget() {
  let remaining = MAX_COMPARISON_VISITS;
  const equal = (left: unknown, right: unknown): boolean => {
    if (--remaining < 0) return false;
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (
        !Array.isArray(left) ||
        !Array.isArray(right) ||
        left.length !== right.length
      )
        return false;
      for (let index = 0; index < left.length; index++)
        if (!equal(left[index], right[index])) return false;
      return true;
    }
    if (
      left !== null &&
      right !== null &&
      typeof left === "object" &&
      typeof right === "object"
    ) {
      const keys = Object.keys(left);
      const other = Object.keys(right);
      return (
        keys.length === other.length &&
        keys.every(
          (key, index) =>
            other[index] === key &&
            equal(
              recordEntry(left as Record<string, unknown>, key),
              recordEntry(right as Record<string, unknown>, key),
            ),
        )
      );
    }
    return false;
  };
  return equal;
}
function boundedJournalSerialization(record: UnsavedChangesRecord): string {
  let visits = 0;
  let estimatedCharacters = 0;
  const text = JSON.stringify(record, (key: string, value: unknown) => {
    // Account conservatively for JSON escaping before a large string is copied.
    estimatedCharacters +=
      key.length * 6 + (typeof value === "string" ? value.length * 6 : 24);
    if (
      ++visits > MAX_SERIALIZATION_VISITS ||
      estimatedCharacters > MAX_SERIALIZED_CHARACTERS ||
      (Array.isArray(value) && value.length > MAX_ARRAY_ENTRIES)
    )
      throw new Error(
        "Unsaved changes checkpoint exceeds its bounded storage budget.",
      );
    return value;
  });
  if (text.length > MAX_SERIALIZED_CHARACTERS)
    throw new Error("Unsaved changes checkpoint is too large.");
  return text;
}
const stores = new Set([
  "eventLists",
  "eventMetadata",
  "executeModeItems",
  "dayModes",
  "mapData",
  "mapRotationSettings",
  "mapViewportSettings",
  "routeSettings",
  "hallDefinitions",
  "hallRouteSettings",
  "eventConsistency",
]);
export interface UnsavedSnapshotChange {
  store: keyof PersistenceSnapshot;
  eventName: string;
  baseline?: unknown;
  desired?: unknown;
}
export interface UnsavedChangesRecord {
  format: "event-shopping-planner-unsaved-changes";
  version: 1;
  recordedAt: string;
  source: "application" | "autosave";
  operations: Array<{
    id: string;
    context?: { eventName: string | null; day: string };
    changes: UnsavedSnapshotChange[];
    review?: unknown;
    input?: unknown;
    canResume: boolean;
    inputUnavailable?: boolean;
  }>;
}
export interface StoredUnsavedChanges {
  key: string;
  text: string;
  record: UnsavedChangesRecord | null;
}
export function unsavedSnapshotChanges(
  baseline: PersistenceSnapshot,
  desired: PersistenceSnapshot,
  equal = createUnsavedComparisonBudget(),
): UnsavedSnapshotChange[] {
  return (Object.keys(desired) as Array<keyof PersistenceSnapshot>).flatMap(
    (store) => {
      if (!stores.has(store) || baseline[store] === desired[store]) return [];
      return [
        ...new Set([
          ...Object.keys(baseline[store]),
          ...Object.keys(desired[store]),
        ]),
      ]
        .filter(
          (eventName) =>
            !equal(
              recordEntry(baseline[store], eventName),
              recordEntry(desired[store], eventName),
            ),
        )
        .map((eventName) => ({
          store,
          eventName,
          baseline: recordEntry(baseline[store], eventName),
          desired: recordEntry(desired[store], eventName),
        }));
    },
  );
}
export function parseUnsavedChanges(text: string): UnsavedChangesRecord | null {
  try {
    const value = JSON.parse(text) as UnsavedChangesRecord;
    if (
      value?.format !== "event-shopping-planner-unsaved-changes" ||
      value.version !== 1 ||
      typeof value.recordedAt !== "string" ||
      !["application", "autosave"].includes(value.source) ||
      !Array.isArray(value.operations) ||
      !value.operations.every(
        (operation) =>
          typeof operation?.id === "string" &&
          typeof operation.canResume === "boolean" &&
          Array.isArray(operation.changes) &&
          operation.changes.every(
            (change) =>
              stores.has(change?.store) && typeof change.eventName === "string",
          ),
      )
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function readUnsavedChanges(): StoredUnsavedChanges[] {
  try {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .flatMap((key) => {
        const text = localStorage.getItem(key);
        return text === null
          ? []
          : [{ key, text, record: parseUnsavedChanges(text) }];
      });
  } catch {
    return [];
  }
}
/** Separate from database writes: a checkpoint never confirms or commits an operation. */
export function createUnsavedChangesWriter(
  source: UnsavedChangesRecord["source"],
) {
  const key = `${PREFIX}${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  let written = false;
  return {
    write(operations: UnsavedChangesRecord["operations"]): boolean {
      if (operations.length > MAX_UNSAVED_JOURNAL_OPERATIONS) return false;
      try {
        if (!operations.length) {
          if (written) localStorage.removeItem(key);
          written = false;
        } else {
          localStorage.setItem(
            key,
            boundedJournalSerialization({
              format: "event-shopping-planner-unsaved-changes",
              version: 1,
              recordedAt: new Date().toISOString(),
              source,
              operations,
            } satisfies UnsavedChangesRecord),
          );
          written = true;
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}
export function discardUnsavedChanges(key: string): boolean {
  if (!key.startsWith(PREFIX)) return false;
  try {
    localStorage.removeItem(key);
    return localStorage.getItem(key) === null;
  } catch {
    return false;
  }
}

const RESUMABLE_STORES = new Set([
  "eventLists",
  "eventMetadata",
  "executeModeItems",
  "dayModes",
  "mapRotationSettings",
  "mapViewportSettings",
]);
export function canResumeUnsavedSnapshotChanges(
  changes: readonly UnsavedSnapshotChange[],
): boolean {
  return (
    changes.length > 0 &&
    changes.every((change) => RESUMABLE_STORES.has(change.store))
  );
}
export function describeUnsavedSnapshotChanges(
  changes: readonly UnsavedSnapshotChange[],
): string[] {
  const labels: Partial<Record<keyof PersistenceSnapshot, string>> = {
    eventLists: "購入品目",
    eventMetadata: "イベント情報",
    executeModeItems: "実行列",
    dayModes: "表示モード",
    mapRotationSettings: "地図の回転",
    mapViewportSettings: "地図の表示位置",
  };
  const details: string[] = [];
  const describe = (value: unknown) =>
    value === undefined ? "未設定" : JSON.stringify(value);
  const visit = (before: unknown, after: unknown, path: string) => {
    if (jsonEqual(before, after)) return;
    const isObject = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === "object";
    if (isObject(before) && isObject(after)) {
      for (const key of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ]))
        visit(
          recordEntry(before, key),
          recordEntry(after, key),
          `${path} / ${key}`,
        );
    } else details.push(`${path}: ${describe(before)} → ${describe(after)}`);
  };
  for (const change of changes)
    visit(
      change.baseline,
      change.desired,
      `${labels[change.store] ?? change.store} / ${change.eventName}`,
    );
  return details.length
    ? details
    : ["現在の保存データと一致しているため、保存する変更はありません。"];
}
