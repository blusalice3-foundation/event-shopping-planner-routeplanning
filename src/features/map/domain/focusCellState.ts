import {
  changedItemPositions,
  registerItemChanges,
} from "../../../utils/itemIndex";
import { sameItemRouting } from "../../../utils/executionVisitIndex";
import type { ShoppingItem } from "../../../types/item";
import type { DayMapData } from "../../../types/map";
import { normalizeExecutionVisitDay } from "../../../utils/visitProjection";
import { resolveLocation } from "../../consistency/domain/membership";
import {
  countNavigatorStatuses,
  getNavigatorStatusKind,
} from "../../space-navigation/domain/statusSegments";

export function collectFocusCellItems(
  items: readonly ShoppingItem[],
  executeIds: readonly string[],
  day: string,
  mapData: DayMapData,
  resolveItemLocation: typeof resolveLocation = resolveLocation,
): {
  execution: Map<string, ShoppingItem[]>;
  candidates: Map<string, ShoppingItem[]>;
} {
  const execution = new Map<string, ShoppingItem[]>();
  const candidates = new Map<string, ShoppingItem[]>();
  const ids = new Set(executeIds);
  const seen = new Set<string>();
  const normalizedDay = normalizeExecutionVisitDay(day);
  for (const item of items) {
    if (
      seen.has(item.id) ||
      normalizeExecutionVisitDay(item.eventDate) !== normalizedDay
    )
      continue;
    seen.add(item.id);
    const location = resolveItemLocation(mapData, item);
    if (location.status !== "resolved") continue;
    const cell = location.location.cell;
    const key = [cell.row, cell.col].join("-");
    const target = ids.has(item.id) ? execution : candidates;
    const members = target.get(key) ?? [];
    members.push(item);
    target.set(key, members);
  }
  return { execution, candidates };
}

export function summarizeFocusCell(items: readonly ShoppingItem[]) {
  const all = (predicate: (item: ShoppingItem) => boolean) =>
    items.length > 0 && items.every(predicate);
  const isVisited = all((item) => getNavigatorStatusKind(item) === "completed");
  const allPostponed = all((item) => item.purchaseStatus === "Postpone");
  const allLate = all((item) => item.purchaseStatus === "Late");
  const counts = countNavigatorStatuses([
    ...new Map(items.map((item) => [item.id, item])).values(),
  ]);
  const segments = [
    { label: "未", count: counts.unvisited },
    { label: "後", count: counts.postponed },
    { label: "遅", count: counts.late },
    { label: "限未", count: counts.limited },
    { label: "済", count: counts.completed },
  ].filter(({ count }) => count > 0);
  const statusLabel = segments
    .map(({ label, count }) => (segments.length > 1 ? label + count : label))
    .join("・");
  return {
    statusLabel,
    hasItems: items.length > 0,
    isVisited,
    allNone: all((item) => item.purchaseStatus === "None"),
    allProcessed: isVisited || allPostponed || allLate,
    hasPostponed: items.some((item) => item.purchaseStatus === "Postpone"),
    hasLate: items.some((item) => item.purchaseStatus === "Late"),
    allPostponed,
    allLate,
  };
}

/** Reuse coordinate membership for content edits and replace only affected cells. */
export function createFocusCellItemsProjector() {
  let previous: readonly ShoppingItem[] | undefined;
  let previousContext: readonly unknown[] = [];
  let value: ReturnType<typeof collectFocusCellItems>;
  let membership = new Map<
    string,
    { category: "execution" | "candidates"; key: string; index: number }
  >();
  return (...args: Parameters<typeof collectFocusCellItems>) => {
    const [items, ids, day, map, resolver] = args;
    const context = [ids, day, map, resolver];
    const changes =
      previous &&
      context.every((input, index) => input === previousContext[index])
        ? changedItemPositions(previous, items)
        : null;
    if (
      changes === null ||
      changes.some((index) => !sameItemRouting(previous![index], items[index]))
    ) {
      value = collectFocusCellItems(...args);
      membership = new Map();
      for (const category of ["execution", "candidates"] as const)
        for (const [key, members] of value[category])
          members.forEach((item, index) =>
            membership.set(item.id, { category, key, index }),
          );
    } else if (changes.length) {
      const next = { ...value };
      const updated = new Map<string, number[]>();
      for (const position of changes) {
        const item = items[position];
        const location = membership.get(item.id);
        if (!location) continue;
        const key = location.category + ":" + location.key;
        let indices = updated.get(key);
        if (!indices) {
          indices = [];
          updated.set(key, indices);
          if (next[location.category] === value[location.category])
            next[location.category] = new Map(value[location.category]);
          next[location.category].set(
            location.key,
            value[location.category].get(location.key)!.slice(),
          );
        }
        next[location.category].get(location.key)![location.index] = item;
        indices.push(location.index);
      }
      for (const [key, indices] of updated) {
        const [category, cell] = key.split(":") as [
          "execution" | "candidates",
          string,
        ];
        registerItemChanges(
          value[category].get(cell)!,
          next[category].get(cell)!,
          indices,
        );
      }
      if (updated.size) {
        const keys = [...updated.keys()]
          .filter((key) => key.startsWith("execution:"))
          .map((key) => key.slice("execution:".length));
        if (next.execution !== value.execution && WeakCellReference)
          cellChanges.set(next.execution, {
            previous: new WeakCellReference(value.execution),
            keys,
          });
        value = next;
      }
    }
    previous = items;
    previousContext = context;
    return value!;
  };
}

type CellMembers = Map<string, ShoppingItem[]>;
type CellReference = { deref(): CellMembers | undefined };
const WeakCellReference = (
  globalThis as unknown as {
    WeakRef?: new (value: CellMembers) => CellReference;
  }
).WeakRef;
const cellChanges = new WeakMap<
  CellMembers,
  { previous: CellReference; keys: readonly string[] }
>();
export type FocusCellDisplayState = ReturnType<typeof summarizeFocusCell> & {
  items: ShoppingItem[];
  visitKeys: Set<string>;
  isCurrentPosition: boolean;
  isTemporaryPosition: boolean;
  isNextDestination: boolean;
  isPreviousPosition: boolean;
};
type CellLabel = { text: string; bgColor: string; textColor: string };
type Positions = {
  officialVisitKey: string | null;
  temporaryVisitKey: string | null;
};
const labelForCell = (
  state: FocusCellDisplayState,
  phase: string,
  phaseIndex: number,
): CellLabel => {
  if (state.isCurrentPosition) {
    if (phaseIndex === 0 && phase !== "normal")
      return phase === "postponed"
        ? {
            text: "後始",
            bgColor: "rgba(156,39,176,0.5)",
            textColor: "#FFFFFF",
          }
        : {
            text: "遅始",
            bgColor: "rgba(33,150,243,0.5)",
            textColor: "#FFFFFF",
          };
    return {
      text: phaseIndex === 0 ? "始" : "次",
      bgColor: "rgba(255,109,0,0.5)",
      textColor: "#FFFFFF",
    };
  }
  if (state.allProcessed && state.allPostponed)
    return {
      text: "後",
      bgColor: "rgba(156,39,176,0.4)",
      textColor: "rgba(156,39,176,0.9)",
    };
  if (state.allProcessed && state.allLate)
    return {
      text: "遅",
      bgColor: "rgba(33,150,243,0.4)",
      textColor: "rgba(33,150,243,0.9)",
    };
  if (state.allProcessed)
    return {
      text: "済",
      bgColor: "rgba(158,158,158,0.5)",
      textColor: "rgba(76,175,80,0.8)",
    };
  return {
    text: state.statusLabel,
    bgColor: "rgba(66,165,245,0.3)",
    textColor: "rgba(33,150,243,0.8)",
  };
};

/** Status edits notify one cell; movement touches only the old/new markers. */
export function createFocusCellDisplayProjector(
  visitKey: (item: ShoppingItem) => string,
) {
  let previous: CellMembers | undefined;
  let previousPositions: readonly (string | null)[] = [];
  let previousPhase = "";
  let previousPhaseIndex = -1;
  let visits = new Map<string, string>();
  let cellCoordinates = new Map<string, { row: number; col: number }>();
  let states = new Map<string, FocusCellDisplayState>();
  let labels = new Map<string, CellLabel>();
  return (
    members: CellMembers,
    position: Positions,
    next: string | null,
    prev: string | null,
    phase: string,
    phaseIndex: number,
  ) => {
    const positions = [
      position.officialVisitKey,
      position.temporaryVisitKey,
      next,
      prev,
    ];
    const delta = cellChanges.get(members);
    const changed =
      previous === members
        ? []
        : delta && delta.previous.deref() === previous
          ? delta.keys
          : null;
    const touched = new Set<string>();
    if (changed === null) {
      visits = new Map();
      cellCoordinates = new Map();
      states = new Map();
      labels = new Map();
      for (const [key, items] of members) {
        const [row, col] = key.split("-").map(Number);
        cellCoordinates.set(key, { row, col });
        const visitKeys = new Set(items.map(visitKey));
        for (const id of visitKeys) if (!visits.has(id)) visits.set(id, key);
        states.set(key, {
          ...summarizeFocusCell(items),
          items,
          visitKeys,
          isCurrentPosition: false,
          isTemporaryPosition: false,
          isNextDestination: false,
          isPreviousPosition: false,
        });
        touched.add(key);
      }
    } else {
      for (const key of changed) touched.add(key);
      positions.forEach((id, index) => {
        if (id === previousPositions[index]) return;
        for (const marker of [id, previousPositions[index]]) {
          const key = marker ? visits.get(marker) : undefined;
          if (key) touched.add(key);
        }
      });
      if (phase !== previousPhase || phaseIndex !== previousPhaseIndex) {
        const key = position.officialVisitKey
          ? visits.get(position.officialVisitKey)
          : undefined;
        if (key) touched.add(key);
      }
      if (touched.size) {
        states = new Map(states);
        labels = new Map(labels);
      }
    }
    for (const key of touched) {
      const before = states.get(key)!;
      const items = members.get(key)!;
      const state: FocusCellDisplayState = {
        ...before,
        ...(items !== before.items ? summarizeFocusCell(items) : {}),
        items,
        isCurrentPosition:
          !!position.officialVisitKey &&
          before.visitKeys.has(position.officialVisitKey),
        isTemporaryPosition:
          !!position.temporaryVisitKey &&
          before.visitKeys.has(position.temporaryVisitKey),
        isNextDestination: !!next && before.visitKeys.has(next),
        isPreviousPosition: !!prev && before.visitKeys.has(prev),
      };
      states.set(key, state);
      labels.set(key, labelForCell(state, phase, phaseIndex));
    }
    previous = members;
    previousPositions = positions;
    previousPhase = phase;
    previousPhaseIndex = phaseIndex;
    const coordinates = (id: string | null) => {
      const key = id ? visits.get(id) : undefined;
      if (!key) return null;
      return cellCoordinates.get(key) ?? null;
    };
    return { states, labels, coordinates, updatedCellCount: touched.size };
  };
}
