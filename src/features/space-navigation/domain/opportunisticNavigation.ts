import {
  changedItemPositions,
  indexedItemsSource,
} from "../../../utils/itemIndex";
import { navigatorEntryIndex } from "./navigatorEntryIndex";
import {
  NAVIGATOR_PHASE_ORDER,
  type NavigatorEntry,
  type NavigatorItem,
  type NavigatorPhase,
} from "../types";
import {
  buildSpaceKey,
  normalizeBaseSpaceNumber,
  normalizeSpaceBlock,
} from "./visitIdentity";

const naturalCollator = new Intl.Collator("ja", {
  numeric: true,
  sensitivity: "base",
});
const SIMPLE_SPACE_NUMBER_PATTERN = /^(\d+)([a-z]*)$/i;
const DISPLAY_TRAILING_SUBNUMBER_PATTERN =
  /^(.*[A-Za-zＡ-Ｚａ-ｚ])([0-9０-９]+)$/u;

export interface OpportunisticSpaceGroup {
  spaceKey: string;
  normalizedBlock: string;
  normalizedNumber: string;
  displayBlock: string;
  displayNumber: string;
  displayLabel: string;
  itemIds: readonly string[];
  items: readonly NavigatorItem[];
}

export interface OpportunisticNavigationDataOptions {
  /**
   * When supplied, item IDs are resolved exclusively against this live map.
   * Missing IDs and items that have moved to a different space are omitted.
   */
  latestItemsById?: ReadonlyMap<string, NavigatorItem>;
}

export interface AggregatedNavigatorSpace {
  spaceKey: string;
  label: string;
  representativeVisitId: string;
  representativeEntry: NavigatorEntry;
  visitIds: readonly string[];
  phases: readonly NavigatorPhase[];
  itemIds: readonly string[];
  items: readonly NavigatorItem[];
  circles: readonly string[];
}

export type OpportunisticStepDirection = "previous" | "next";

export interface OpportunisticSpaceTarget {
  spaceKey: string;
  phase: NavigatorPhase;
  representativeVisitId: string;
  representativeEntry: NavigatorEntry;
  entryIndex: number;
  phaseIndex: number;
}

export interface FindAdjacentSpaceTargetInput extends OpportunisticNavigationDataOptions {
  currentSpaceKey: string;
  phase: NavigatorPhase;
  direction: OpportunisticStepDirection;
}

export type InitialPhaseNavigationCandidates = Record<
  NavigatorPhase,
  OpportunisticSpaceTarget | null
>;

export interface BuildInitialPhaseNavigationCandidatesInput extends OpportunisticNavigationDataOptions {
  currentSpaceKey: string;
  direction: OpportunisticStepDirection;
}

export const REMAINING_PURCHASE_STATUS_BY_PHASE = {
  normal: "None",
  postponed: "Postpone",
  late: "Late",
} as const satisfies Record<NavigatorPhase, NavigatorItem["purchaseStatus"]>;

export interface RemainingSpaceCandidate {
  phase: NavigatorPhase;
  purchaseStatus: (typeof REMAINING_PURCHASE_STATUS_BY_PHASE)[NavigatorPhase];
  spaceKey: string;
  label: string;
  representativeVisitId: string;
  representativeEntry: NavigatorEntry;
  visitIds: readonly string[];
  itemIds: readonly string[];
  items: readonly NavigatorItem[];
  circles: readonly string[];
  isCurrent: boolean;
}

export type RemainingSpaceLists = Record<
  NavigatorPhase,
  readonly RemainingSpaceCandidate[]
>;

export interface BuildRemainingSpaceListsOptions extends OpportunisticNavigationDataOptions {
  currentSpaceKey?: string;
}

interface MutableCellSpaceGroup {
  firstInputIndex: number;
  spaceKey: string;
  normalizedBlock: string;
  normalizedNumber: string;
  displayBlock: string;
  displayNumber: string;
  itemIds: string[];
  items: NavigatorItem[];
}

interface PhaseSpacePosition {
  entry: NavigatorEntry;
  entryIndex: number;
}

interface MutableRemainingSpace {
  phase: NavigatorPhase;
  purchaseStatus: (typeof REMAINING_PURCHASE_STATUS_BY_PHASE)[NavigatorPhase];
  spaceKey: string;
  label: string;
  representativeEntry: NavigatorEntry;
  visitIds: string[];
  itemIds: string[];
  items: NavigatorItem[];
  circles: string[];
  circleSet: Set<string>;
}

function isUsableId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getItemSpaceIdentity(item: Pick<NavigatorItem, "block" | "number">): {
  spaceKey: string;
  normalizedBlock: string;
  normalizedNumber: string;
} | null {
  if (typeof item.block !== "string" || typeof item.number !== "string") {
    return null;
  }
  const normalizedBlock = normalizeSpaceBlock(item.block);
  const normalizedNumber = normalizeBaseSpaceNumber(item.number);
  if (!normalizedBlock || !normalizedNumber) return null;
  return {
    spaceKey: buildSpaceKey(item.block, item.number),
    normalizedBlock,
    normalizedNumber,
  };
}

/**
 * Removes only the trailing sub-number while retaining the first registered
 * item's width and letter case for display.
 */
function getDisplayBaseNumber(number: string): string {
  const trimmed = number.trim();
  const match = trimmed.match(DISPLAY_TRAILING_SUBNUMBER_PATTERN);
  return match ? match[1] : trimmed;
}

function compareNormalizedNumbers(left: string, right: string): number {
  const leftMatch = left.match(SIMPLE_SPACE_NUMBER_PATTERN);
  const rightMatch = right.match(SIMPLE_SPACE_NUMBER_PATTERN);
  if (!leftMatch || !rightMatch) {
    return naturalCollator.compare(left, right);
  }

  const leftNumber = BigInt(leftMatch[1]);
  const rightNumber = BigInt(rightMatch[1]);
  if (leftNumber < rightNumber) return -1;
  if (leftNumber > rightNumber) return 1;

  const leftSuffix = leftMatch[2].toLowerCase();
  const rightSuffix = rightMatch[2].toLowerCase();
  if (leftSuffix === rightSuffix) {
    return naturalCollator.compare(left, right);
  }
  if (!leftSuffix) return -1;
  if (!rightSuffix) return 1;
  return naturalCollator.compare(leftSuffix, rightSuffix);
}

/**
 * Groups items from a clicked map cell by normalized booth identity.
 * Duplicate or empty IDs use first-input-wins semantics.
 */
export function groupCellItemsBySpace(
  items: readonly NavigatorItem[],
): OpportunisticSpaceGroup[] {
  const groups = new Map<string, MutableCellSpaceGroup>();
  const seenItemIds = new Set<string>();

  items.forEach((item, inputIndex) => {
    if (!isUsableId(item?.id) || seenItemIds.has(item.id)) return;
    const identity = getItemSpaceIdentity(item);
    if (!identity) return;

    seenItemIds.add(item.id);
    let group = groups.get(identity.spaceKey);
    if (!group) {
      group = {
        firstInputIndex: inputIndex,
        ...identity,
        displayBlock: item.block.trim(),
        displayNumber: getDisplayBaseNumber(item.number),
        itemIds: [],
        items: [],
      };
      groups.set(identity.spaceKey, group);
    }
    group.itemIds.push(item.id);
    group.items.push(item);
  });

  return Array.from(groups.values())
    .sort((left, right) => {
      const blockComparison = naturalCollator.compare(
        left.normalizedBlock,
        right.normalizedBlock,
      );
      if (blockComparison !== 0) return blockComparison;
      const numberComparison = compareNormalizedNumbers(
        left.normalizedNumber,
        right.normalizedNumber,
      );
      return numberComparison !== 0
        ? numberComparison
        : left.firstInputIndex - right.firstInputIndex;
    })
    .map((group) => ({
      spaceKey: group.spaceKey,
      normalizedBlock: group.normalizedBlock,
      normalizedNumber: group.normalizedNumber,
      displayBlock: group.displayBlock,
      displayNumber: group.displayNumber,
      displayLabel: `${group.displayBlock}-${group.displayNumber}`,
      itemIds: group.itemIds,
      items: group.items,
    }));
}

function resolveEntryItems(
  entry: NavigatorEntry,
  latestItemsById: ReadonlyMap<string, NavigatorItem> | undefined,
): NavigatorItem[] {
  const entryItemsById = new Map<string, NavigatorItem>();
  entry.items.forEach((item) => {
    if (isUsableId(item?.id) && !entryItemsById.has(item.id)) {
      entryItemsById.set(item.id, item);
    }
  });

  const resolved: NavigatorItem[] = [];
  const seen = new Set<string>();
  entry.itemIds.forEach((itemId) => {
    if (!isUsableId(itemId) || seen.has(itemId)) return;
    seen.add(itemId);
    const item = latestItemsById
      ? latestItemsById.get(itemId)
      : entryItemsById.get(itemId);
    if (!item || item.id !== itemId) return;
    if (getItemSpaceIdentity(item)?.spaceKey !== entry.spaceKey) return;
    resolved.push(item);
  });
  return resolved;
}

function isUsableEntry(
  entry: NavigatorEntry,
  latestItemsById: ReadonlyMap<string, NavigatorItem> | undefined,
): boolean {
  return (
    isUsableId(entry.id) &&
    isUsableId(entry.spaceKey) &&
    resolveEntryItems(entry, latestItemsById).length > 0
  );
}

/**
 * Aggregates every phase and priority entry belonging to one normalized space.
 * Route-first visit and item ordering is retained.
 */
export function aggregateNavigatorSpace(
  entries: readonly NavigatorEntry[],
  spaceKey: string,
  options: OpportunisticNavigationDataOptions = {},
): AggregatedNavigatorSpace | null {
  if (!isUsableId(spaceKey)) return null;

  let representativeEntry: NavigatorEntry | null = null;
  const visitIds: string[] = [];
  const visitIdSet = new Set<string>();
  const phases: NavigatorPhase[] = [];
  const phaseSet = new Set<NavigatorPhase>();
  const itemIds: string[] = [];
  const items: NavigatorItem[] = [];
  const seenItemIds = new Set<string>();
  const circles: string[] = [];
  const circleSet = new Set<string>();

  for (const entry of navigatorEntryIndex(entries).bySpace.get(spaceKey) ??
    []) {
    if (
      entry.spaceKey !== spaceKey ||
      !isUsableEntry(entry, options.latestItemsById)
    ) {
      continue;
    }
    const resolvedItems = resolveEntryItems(entry, options.latestItemsById);
    representativeEntry ??= entry;
    if (!visitIdSet.has(entry.id)) {
      visitIdSet.add(entry.id);
      visitIds.push(entry.id);
    }
    if (entry.phase && !phaseSet.has(entry.phase)) {
      phaseSet.add(entry.phase);
      phases.push(entry.phase);
    }
    for (const item of resolvedItems) {
      if (seenItemIds.has(item.id)) continue;
      seenItemIds.add(item.id);
      itemIds.push(item.id);
      items.push(item);
      const circle = item.circle.trim();
      if (circle && !circleSet.has(circle)) {
        circleSet.add(circle);
        circles.push(circle);
      }
    }
  }

  if (!representativeEntry || items.length === 0) return null;
  return {
    spaceKey,
    label: representativeEntry.label,
    representativeVisitId: representativeEntry.id,
    representativeEntry,
    visitIds,
    phases,
    itemIds,
    items,
    circles,
  };
}

function toSpaceTarget(position: PhaseSpacePosition): OpportunisticSpaceTarget {
  const phase = position.entry.phase;
  if (!phase) {
    throw new Error("A phase navigation target must have a phase");
  }
  return {
    spaceKey: position.entry.spaceKey,
    phase,
    representativeVisitId: position.entry.id,
    representativeEntry: position.entry,
    entryIndex: position.entryIndex,
    phaseIndex: position.entry.phaseIndex,
  };
}

/**
 * Finds the adjacent different space from the earliest occurrence of the
 * current space in a phase. Forward movement never crosses a phase boundary.
 * Backward movement crosses late → postponed → normal as needed.
 */
export function findAdjacentSpaceTarget(
  entries: readonly NavigatorEntry[],
  input: FindAdjacentSpaceTargetInput,
): OpportunisticSpaceTarget | null {
  if (!isUsableId(input.currentSpaceKey)) return null;
  const index = navigatorEntryIndex(entries);
  const currentPosition = index.spacePositionsByPhase
    .get(input.phase)
    ?.get(input.currentSpaceKey);
  const resolve = (phase: NavigatorPhase, spaceKey: string) => {
    const entry = index.byPhaseAndSpace
      .get(phase)
      ?.get(spaceKey)
      ?.find((candidate) => isUsableEntry(candidate, input.latestItemsById));
    return entry ? { entry, entryIndex: entry.index } : null;
  };
  if (
    currentPosition === undefined ||
    !resolve(input.phase, input.currentSpaceKey)
  )
    return null;
  const keys = index.spaceOrderByPhase.get(input.phase)!;
  const step = input.direction === "next" ? 1 : -1;
  for (
    let position = currentPosition + step;
    position >= 0 && position < keys.length;
    position += step
  ) {
    const target = resolve(input.phase, keys[position]);
    if (target) return toSpaceTarget(target);
  }
  if (input.direction === "next") return null;
  const phaseOrderIndex = NAVIGATOR_PHASE_ORDER.indexOf(input.phase);
  for (let phaseIndex = phaseOrderIndex - 1; phaseIndex >= 0; phaseIndex--) {
    const phase = NAVIGATOR_PHASE_ORDER[phaseIndex];
    const previousKeys = index.spaceOrderByPhase.get(phase) ?? [];
    for (let position = previousKeys.length - 1; position >= 0; position--) {
      if (previousKeys[position] === input.currentSpaceKey) continue;
      const target = resolve(phase, previousKeys[position]);
      if (target) return toSpaceTarget(target);
    }
  }
  return null;
}

/**
 * Produces the real target shown for the first previous/next action in every
 * phase. A phase without the current space is deliberately represented by
 * null, even if another phase has a boundary target.
 */
export function buildInitialPhaseNavigationCandidates(
  entries: readonly NavigatorEntry[],
  input: BuildInitialPhaseNavigationCandidatesInput,
): InitialPhaseNavigationCandidates {
  return {
    normal: findAdjacentSpaceTarget(entries, {
      ...input,
      phase: "normal",
    }),
    postponed: findAdjacentSpaceTarget(entries, {
      ...input,
      phase: "postponed",
    }),
    late: findAdjacentSpaceTarget(entries, {
      ...input,
      phase: "late",
    }),
  };
}

function buildRemainingPhaseList(
  entries: readonly NavigatorEntry[],
  phase: NavigatorPhase,
  options: BuildRemainingSpaceListsOptions,
): RemainingSpaceCandidate[] {
  const purchaseStatus = REMAINING_PURCHASE_STATUS_BY_PHASE[phase];
  const groups = new Map<string, MutableRemainingSpace>();
  const seenItemIds = new Set<string>();

  (navigatorEntryIndex(entries).byPhase.get(phase) ?? []).forEach((entry) => {
    if (
      entry.phase !== phase ||
      !isUsableEntry(entry, options.latestItemsById)
    ) {
      return;
    }
    const matchingItems = resolveEntryItems(
      entry,
      options.latestItemsById,
    ).filter(
      (item) =>
        item.purchaseStatus === purchaseStatus && !seenItemIds.has(item.id),
    );
    if (matchingItems.length === 0) return;

    let group = groups.get(entry.spaceKey);
    if (!group) {
      group = {
        phase,
        purchaseStatus,
        spaceKey: entry.spaceKey,
        label: entry.label,
        representativeEntry: entry,
        visitIds: [],
        itemIds: [],
        items: [],
        circles: [],
        circleSet: new Set<string>(),
      };
      groups.set(entry.spaceKey, group);
    }
    if (!group.visitIds.includes(entry.id)) group.visitIds.push(entry.id);

    matchingItems.forEach((item) => {
      seenItemIds.add(item.id);
      group!.itemIds.push(item.id);
      group!.items.push(item);
      const circle = item.circle.trim();
      if (circle && !group!.circleSet.has(circle)) {
        group!.circleSet.add(circle);
        group!.circles.push(circle);
      }
    });
  });

  return Array.from(groups.values()).map((group) => ({
    phase: group.phase,
    purchaseStatus: group.purchaseStatus,
    spaceKey: group.spaceKey,
    label: group.label,
    representativeVisitId: group.representativeEntry.id,
    representativeEntry: group.representativeEntry,
    visitIds: group.visitIds,
    itemIds: group.itemIds,
    items: group.items,
    circles: group.circles,
    isCurrent: group.spaceKey === options.currentSpaceKey,
  }));
}

/**
 * Builds the three end-of-route lists in their respective route order.
 */
export function buildRemainingSpaceLists(
  entries: readonly NavigatorEntry[],
  options: BuildRemainingSpaceListsOptions = {},
): RemainingSpaceLists {
  return {
    normal: buildRemainingPhaseList(entries, "normal", options),
    postponed: buildRemainingPhaseList(entries, "postponed", options),
    late: buildRemainingPhaseList(entries, "late", options),
  };
}

/** Remaining-phase lists recheck changed spaces, including live indexed updates. */
export function createRemainingSpaceListsProjector() {
  let previous: readonly NavigatorEntry[] | undefined;
  let previousSource: readonly NavigatorItem[] | undefined;
  let previousCurrent: string | undefined;
  let cached = new Map<NavigatorPhase, Map<string, RemainingSpaceCandidate>>();
  let value: RemainingSpaceLists;
  return (
    entries: readonly NavigatorEntry[],
    options: BuildRemainingSpaceListsOptions = {},
  ) => {
    const changes = previous ? changedItemPositions(previous, entries) : null;
    const source = options.latestItemsById
      ? indexedItemsSource(options.latestItemsById)
      : undefined;
    const liveChanges =
      source && previousSource
        ? changedItemPositions(previousSource, source)
        : source === previousSource
          ? []
          : null;
    if (
      changes?.length === 0 &&
      liveChanges?.length === 0 &&
      options.currentSpaceKey === previousCurrent &&
      (!options.latestItemsById || source)
    )
      return value;
    const affected = new Set<string>();
    const index = navigatorEntryIndex(entries);
    if (
      changes === null ||
      liveChanges === null ||
      (options.latestItemsById && !source)
    ) {
      value = buildRemainingSpaceLists(entries, options);
      cached = new Map(
        NAVIGATOR_PHASE_ORDER.map((phase) => [
          phase,
          new Map(value[phase].map((space) => [space.spaceKey, space])),
        ]),
      );
    } else {
      for (const position of changes) affected.add(entries[position].spaceKey);
      for (const position of liveChanges) {
        const member = source![position];
        affected.add(buildSpaceKey(member.block, member.number));
      }
      const next = { ...value };
      for (const phase of NAVIGATOR_PHASE_ORDER) {
        const groups = new Map(cached.get(phase));
        let dirty = false;
        for (const key of affected) {
          const members = index.byPhaseAndSpace.get(phase)?.get(key) ?? [];
          const candidate = buildRemainingPhaseList(members, phase, options)[0];
          if (candidate) {
            groups.set(key, candidate);
            dirty = true;
          } else if (groups.delete(key)) dirty = true;
        }
        if (options.currentSpaceKey !== previousCurrent) {
          for (const key of [previousCurrent, options.currentSpaceKey]) {
            const candidate = key ? groups.get(key) : undefined;
            if (
              candidate &&
              candidate.isCurrent !== (key === options.currentSpaceKey)
            ) {
              groups.set(key!, {
                ...candidate,
                isCurrent: key === options.currentSpaceKey,
              });
              dirty = true;
            }
          }
        }
        if (dirty) {
          next[phase] = [...groups.values()].sort(
            (a, b) => a.representativeEntry.index - b.representativeEntry.index,
          );
          cached.set(phase, groups);
        }
      }
      value = next;
    }
    previous = entries;
    previousSource = source;
    previousCurrent = options.currentSpaceKey;
    return value;
  };
}
