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
import { fetchEventItemsFromSpreadsheet } from "./sheetImport";
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
      eventGeneration?: number;
    }
  | {
      kind: "source-switch";
      eventName: string;
      diff: EventUpdateDiff;
      eventGeneration?: number;
      nextSource: SpreadsheetSource;
    };

export type EventUpdateCommitState = {
  eventLists: Record<string, ShoppingItem[]>;
  eventMetadata: Record<string, EventMetadata>;
  executeModeItems: Record<string, ExecuteModeItems>;
};

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
      return [...fields].every((field) => item[field] === previous[field]);
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
  const currentItems = state.eventLists[pending.eventName];
  if (!currentItems || !eventUpdateItemsMatch(currentItems, baseItems)) {
    return null;
  }

  const currentExecuteModeItems = state.executeModeItems[pending.eventName];
  const nextExecuteModeItems = currentExecuteModeItems
    ? {
        ...state.executeModeItems,
        [pending.eventName]: Object.fromEntries(
          Object.entries(currentExecuteModeItems).map(([dayName, itemIds]) => [
            dayName,
            pending.diff.itemsToDelete.reduce(
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
              state.eventMetadata[pending.eventName]?.lastImportDate || "",
          },
        }
      : state.eventMetadata;

  return {
    eventLists: {
      ...state.eventLists,
      [pending.eventName]: applyEventUpdateToItems(
        currentItems,
        pending.diff,
        options,
      ),
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
  const sheetItems = await fetchEventItemsFromSpreadsheet(
    source.url,
    source.sheetName,
  );
  const normalizedSheetItems = normalizeSheetItemsUrls(sheetItems);
  return createEventUpdateDiff(currentItems, normalizedSheetItems);
}
