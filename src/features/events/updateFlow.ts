import type { BulkImportResult } from "../../types/import";
import { recordEntry } from "../../utils/ownRecord";
import type {
  EventMetadata,
  ExecuteModeItems,
  ShoppingItem,
} from "../../types/item";
import { removeExecutionVisitMemberPreservingBasePosition } from "../../utils/visitProjection";
import {
  applyEventUpdateToItems,
  type EventUpdateApplyOptions,
} from "./updateApply";
import { fetchEventImportFromSpreadsheet } from "./sheetImport";
import {
  createEventUpdateDiff,
  normalizeSheetItemsUrls,
  type EventUpdateDiff,
} from "./updateDiff";

export type SpreadsheetSource = {
  url: string;
  sheetName: string;
};

export type PendingEventUpdate =
  | {
      kind: "items-only";
      eventName: string;
      diff: EventUpdateDiff;
      baseSource: SpreadsheetSource | null;
      eventGeneration?: number;
      onImportComplete?: (result: BulkImportResult) => void;
    }
  | {
      kind: "source-switch";
      eventName: string;
      diff: EventUpdateDiff;
      baseSource: SpreadsheetSource | null;
      eventGeneration?: number;
      onImportComplete?: (result: BulkImportResult) => void;
      nextSource: SpreadsheetSource;
    };

export type EventUpdateCommitState = {
  eventLists: Record<string, ShoppingItem[]>;
  eventMetadata: Record<string, EventMetadata>;
  executeModeItems: Record<string, ExecuteModeItems>;
};

export class EventUpdateInvalidatedError extends Error {
  constructor() {
    super(
      "確認中にイベントの品目または更新元が変更・削除されたため、更新元も品目も変更していません。もう一度更新してください。",
    );
    this.name = "EventUpdateInvalidated";
  }
}

/** Compare source values, not metadata identity or unrelated import timestamps. */
export function eventUpdateSourceMatches(
  metadata: EventMetadata | undefined,
  baseSource: SpreadsheetSource | null,
): boolean {
  const current = resolveSpreadsheetSource(metadata);
  return (
    current?.url === baseSource?.url &&
    current?.sheetName === baseSource?.sheetName
  );
}

/** Review snapshots preserve own undefined values, unlike JSON serialization. */
function eventUpdateValueMatches(current: unknown, base: unknown): boolean {
  if (current === base) return true;
  if (
    current === null ||
    base === null ||
    typeof current !== "object" ||
    typeof base !== "object"
  )
    return false;
  const currentIsArray = Array.isArray(current);
  if (currentIsArray !== Array.isArray(base)) return false;
  if (currentIsArray && current.length !== (base as unknown[]).length)
    return false;
  if (!currentIsArray) {
    // Persisted future fields are plain JSON records; do not equate opaque objects.
    for (const value of [current, base]) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
    }
  }
  const keys = Object.keys(current);
  return (
    keys.length === Object.keys(base).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(base, key) &&
        eventUpdateValueMatches(
          (current as Record<string, unknown>)[key],
          (base as Record<string, unknown>)[key],
        ),
    )
  );
}

/** Projections may allocate new arrays and items without changing their values. */
export function eventUpdateItemsMatch(
  current: ShoppingItem[] | undefined,
  base: ShoppingItem[] | null,
): boolean {
  return (
    !!current &&
    !!base &&
    current.length === base.length &&
    current.every((item, index) => {
      const previous = base[index];
      const fields = new Set([
        ...Object.keys(item),
        ...Object.keys(previous),
      ]) as Set<keyof ShoppingItem>;
      return [...fields].every((field) => {
        const value = item[field];
        const previousValue = previous[field];
        // Unknown persisted fields may contain JSON objects cloned for review.
        // Keep scalar comparisons strict and only walk distinct object values.
        return (
          value === previousValue ||
          (value !== null &&
            previousValue !== null &&
            typeof value === "object" &&
            typeof previousValue === "object" &&
            eventUpdateValueMatches(value, previousValue))
        );
      });
    })
  );
}

export function applyPendingEventUpdate({
  state,
  pending,
  baseItems,
  options,
}: {
  state: EventUpdateCommitState;
  pending: PendingEventUpdate;
  baseItems: ShoppingItem[] | null;
  options: EventUpdateApplyOptions;
}): EventUpdateCommitState | null {
  if (pending.diff.csvReview && !options.acceptCsvExclusions) return null;
  if (
    !eventUpdateSourceMatches(
      recordEntry(state.eventMetadata, pending.eventName),
      pending.baseSource,
    )
  )
    return null;
  const currentItems = recordEntry(state.eventLists, pending.eventName);
  const diff = pending.diff.matching
    ? createEventUpdateDiff(
        currentItems ?? [],
        pending.diff.matching.sheetItems,
        options.identityChoices,
        pending.diff.sheetImport?.rowExclusions,
      )
    : pending.diff;
  if (diff.unresolvedMatches?.length) return null;
  if (!currentItems || !eventUpdateItemsMatch(currentItems, baseItems)) {
    return null;
  }

  const currentExecuteModeItems = recordEntry(
    state.executeModeItems,
    pending.eventName,
  );
  const nextExecuteModeItems = currentExecuteModeItems
    ? {
        ...state.executeModeItems,
        [pending.eventName]: Object.fromEntries(
          Object.entries(currentExecuteModeItems).map(([dayName, itemIds]) => [
            dayName,
            diff.itemsToDelete.reduce(
              (remainingItemIds, deletedItem) =>
                removeExecutionVisitMemberPreservingBasePosition(
                  remainingItemIds,
                  deletedItem,
                  currentItems,
                ),
              itemIds,
            ),
          ]),
        ),
      }
    : state.executeModeItems;
  const nextEventMetadata =
    pending.kind === "source-switch"
      ? {
          ...state.eventMetadata,
          [pending.eventName]: {
            spreadsheetUrl: pending.nextSource.url,
            spreadsheetSheetName: pending.nextSource.sheetName,
            lastImportDate:
              recordEntry(state.eventMetadata, pending.eventName)
                ?.lastImportDate || "",
          },
        }
      : state.eventMetadata;

  return {
    eventLists: {
      ...state.eventLists,
      [pending.eventName]: applyEventUpdateToItems(currentItems, diff, options),
    },
    eventMetadata: nextEventMetadata,
    executeModeItems: nextExecuteModeItems,
  };
}

export function resolveSpreadsheetSource(
  metadata?: EventMetadata,
  urlOverride?: SpreadsheetSource,
): SpreadsheetSource | null {
  const url = urlOverride?.url || metadata?.spreadsheetUrl;
  if (!url) return null;

  return {
    url,
    sheetName: urlOverride?.sheetName || metadata?.spreadsheetSheetName || "",
  };
}

export async function buildEventUpdateDiffFromSpreadsheet(
  currentItems: ShoppingItem[],
  source: SpreadsheetSource,
): Promise<EventUpdateDiff> {
  const parsed = await fetchEventImportFromSpreadsheet(
    source.url,
    source.sheetName,
  );
  const normalizedSheetItems = normalizeSheetItemsUrls(parsed.items);
  return {
    ...createEventUpdateDiff(
      currentItems,
      normalizedSheetItems,
      {},
      parsed.rowExclusions,
    ),
    ...(parsed.warnings.length
      ? {
          csvReview: {
            warnings: parsed.warnings,
            itemCount: parsed.items.length,
          },
        }
      : {}),
  };
}
