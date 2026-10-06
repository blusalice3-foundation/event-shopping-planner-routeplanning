import type { ShoppingItem } from "../../../types/item";
import type { BlockDefinition, DayMapData } from "../../../types/map";
import type {
  HallRef,
  HallSelectionIntent,
  LegacyPendingV1,
  VisitContextV1,
} from "../../../types/consistency";
import {
  normalizeBaseSpaceNumber,
  normalizeSpaceBlock,
} from "../../space-navigation/domain/visitIdentity";
import {
  findRouteLookupNumberCell,
  getRouteLookupNumberCellEntries,
} from "../../../utils/mapRoutingSignature";
import { isPointInPolygonInclusive } from "../../../utils/mapRoutePolygon";
import {
  hallRefKey,
  sameDay,
  sameHall,
  type MapResolution,
  type SourcedHall,
} from "./context";

export type ResolvedCell = {
  block: BlockDefinition;
  cell: { row: number; col: number };
  numberValue: number;
};
export type LocationResolution =
  | { status: "resolved"; location: ResolvedCell }
  | { status: "missing" | "ambiguous"; candidates: ResolvedCell[] };
export function resolveBlocks(
  map: DayMapData,
  name: string,
): BlockDefinition[] {
  const normalized = normalizeSpaceBlock(name);
  if (!normalized) return [];
  const exact = map.blocks.filter(
    (block) => normalizeSpaceBlock(block.name) === normalized,
  );
  if (exact.length) return exact;
  const fallback = map.blocks.filter(
    (block) =>
      normalizeSpaceBlock(block.name).toLowerCase() ===
      normalized.toLowerCase(),
  );
  return fallback.length === 1 ? fallback : [];
}
export function resolveLocation(
  map: DayMapData,
  item: Pick<ShoppingItem, "block" | "number">,
): LocationResolution {
  return resolveLocationWithLookup(map, item, findRouteLookupNumberCell);
}
function resolveLocationWithLookup(
  map: DayMapData,
  item: Pick<ShoppingItem, "block" | "number">,
  lookup: typeof findRouteLookupNumberCell,
): LocationResolution {
  const numberText = normalizeBaseSpaceNumber(item.number).match(/\d+/)?.[0];
  if (!numberText) return { status: "missing", candidates: [] };
  const numberValue = Number(numberText);
  const cells = new Map<string, ResolvedCell>();
  for (const block of resolveBlocks(map, item.block)) {
    // Preserve the established rule inside a block before comparing distinct blocks.
    const cell = lookup(block, numberValue);
    if (cell)
      cells.set(JSON.stringify([cell.row, cell.col]), {
        block,
        cell: { row: cell.row, col: cell.col },
        numberValue,
      });
  }
  const candidates = [...cells.values()];
  return candidates.length === 1
    ? { status: "resolved", location: candidates[0] }
    : { status: candidates.length ? "ambiguous" : "missing", candidates };
}
export type Membership = {
  status:
    | "resolved"
    | "confirmation-required"
    | "unassigned"
    | "map-selection-required";
  hall: HallRef | null;
  candidates: HallRef[];
  memberIds: string[];
  sharedKey: string | null;
  location: LocationResolution | null;
  reason:
    | "manual"
    | "automatic"
    | "conflicting-assignments"
    | "multiple-halls"
    | "no-hall"
    | "map-selection";
};
export type MembershipInput = {
  items: readonly ShoppingItem[];
  day: string;
  map: MapResolution;
  halls: SourcedHall[];
  context: VisitContextV1 | null | undefined;
};
export function membershipShareKey(
  item: ShoppingItem,
  map: MapResolution,
  location = map.status === "resolved" ? resolveLocation(map.data, item) : null,
): string | null {
  if (map.status === "selection-required") return null;
  return JSON.stringify([
    item.eventDate.replace(/\u3000/g, " ").trim(),
    map.status === "resolved" ? map.key : null,
    ...(location?.status === "resolved"
      ? ["cell", location.location.cell.row, location.location.cell.col]
      : [
          "space",
          normalizeSpaceBlock(item.block),
          normalizeBaseSpaceNumber(item.number),
        ]),
  ]);
}
export function membershipCandidates(
  item: ShoppingItem,
  map: MapResolution,
  halls: SourcedHall[],
  location = map.status === "resolved" ? resolveLocation(map.data, item) : null,
): HallRef[] {
  if (map.status === "selection-required") return [];
  const block = normalizeSpaceBlock(item.block);
  const simple = halls.filter((hall) =>
    hall.definition.blockNames?.some(
      (name) => normalizeSpaceBlock(name) === block,
    ),
  );
  if (location?.status === "resolved") {
    const { row, col } = location.location.cell;
    const polygon = halls.filter(
      (hall) =>
        hall.definition.vertices.length >= 3 &&
        isPointInPolygonInclusive(row, col, hall.definition.vertices),
    );
    // Simple definitions coexist with detailed definitions; both are real candidates.
    return [
      ...new Map(
        [
          ...polygon,
          ...simple.filter((hall) => hall.definition.vertices.length < 3),
        ].map((hall) => [hallRefKey(hall.ref), hall.ref]),
      ).values(),
    ];
  }
  if (location?.status === "ambiguous") return simple.map((hall) => hall.ref);
  if (map.status === "resolved") {
    const blocks = resolveBlocks(map.data, item.block);
    if (blocks.length === 1) {
      const b = blocks[0];
      const center = halls.filter((hall) =>
        isPointInPolygonInclusive(
          (b.startRow + b.endRow) / 2,
          (b.startCol + b.endCol) / 2,
          hall.definition.vertices,
        ),
      );
      if (center.length)
        return [
          ...new Map(
            [...center, ...simple].map((hall) => [
              hallRefKey(hall.ref),
              hall.ref,
            ]),
          ).values(),
        ];
    }
  }
  return simple.map((hall) => hall.ref);
}
/** Index the complete day once so candidates and execution items use the same peers. */
export function createMembershipResolver(
  input: MembershipInput,
): (item: ShoppingItem) => Membership {
  const { map, halls, context } = input;
  // A resolver owns one immutable day. Index each block once and share location
  // results between grouping, candidate detection, and the displayed membership.
  const numberCells = new Map<
    BlockDefinition,
    Map<number, NonNullable<ReturnType<typeof findRouteLookupNumberCell>>>
  >();
  const locations = new WeakMap<ShoppingItem, LocationResolution>();
  const locationFor = (item: ShoppingItem): LocationResolution | null => {
    if (map.status !== "resolved") return null;
    let location = locations.get(item);
    if (!location) {
      location = resolveLocationWithLookup(map.data, item, (block, value) => {
        let index = numberCells.get(block);
        if (!index) {
          index = new Map(getRouteLookupNumberCellEntries(block));
          numberCells.set(block, index);
        }
        return index.get(value);
      });
      locations.set(item, location);
    }
    return location;
  };
  const groups = new Map<string, ShoppingItem[]>();
  for (const member of input.items) {
    if (!sameDay(member.eventDate, input.day)) continue;
    const key = membershipShareKey(member, map, locationFor(member));
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(member);
    groups.set(key, group);
  }
  const resolved = new Map<string, Omit<Membership, "location">>();
  return (item) => {
    const location = locationFor(item);
    const sharedKey = membershipShareKey(item, map, location);
    if (sharedKey === null)
      return {
        status: "map-selection-required",
        hall: null,
        candidates: [],
        memberIds: [],
        sharedKey,
        location,
        reason: "map-selection",
      };
    const cached = resolved.get(sharedKey);
    if (cached) return { ...cached, location };
    const members = groups.get(sharedKey) ?? [];
    const memberIds = [...new Set(members.map((member) => member.id))].sort();
    const candidates = [
      ...new Map(
        [...members, item]
          .flatMap((member) =>
            membershipCandidates(member, map, halls, locationFor(member)),
          )
          .map((ref) => [hallRefKey(ref), ref]),
      ).values(),
    ];
    const valid = new Map<string, HallRef>();
    for (const member of members) {
      const assignment = context?.assignments[member.id];
      if (
        assignment &&
        candidates.some((candidate) => sameHall(candidate, assignment))
      )
        valid.set(hallRefKey(assignment), assignment);
    }
    const common = { candidates, memberIds, sharedKey };
    const value: Omit<Membership, "location"> =
      valid.size > 1
        ? {
            ...common,
            status: "confirmation-required",
            hall: null,
            reason: "conflicting-assignments",
          }
        : valid.size === 1
          ? {
              ...common,
              status: "resolved",
              hall: [...valid.values()][0],
              reason: "manual",
            }
          : candidates.length === 1
            ? {
                ...common,
                status: "resolved",
                hall: candidates[0],
                reason: "automatic",
              }
            : {
                ...common,
                status: candidates.length
                  ? "confirmation-required"
                  : "unassigned",
                hall: null,
                reason: candidates.length ? "multiple-halls" : "no-hall",
              };
    resolved.set(sharedKey, value);
    return { ...value, location };
  };
}
export function resolveMembership(
  item: ShoppingItem,
  input: MembershipInput,
): Membership {
  return createMembershipResolver(input)(item);
}
/** Only explicit intent changes peers. Ordinary arrivals inherit the destination. */
export function applyMembershipIntent(
  item: ShoppingItem,
  previous: ShoppingItem | undefined,
  intent: HallSelectionIntent,
  input: MembershipInput,
): VisitContextV1 {
  if (!input.context) throw new Error("所属の保存先がありません。");
  const context = structuredClone(input.context);
  const membership = resolveMembership(item, { ...input, context });
  if (membership.status === "map-selection-required") {
    if (intent.kind !== "unchanged")
      throw new Error("マップの選択が必要です。");
    return context;
  }
  if (intent.kind === "automatic") {
    for (const id of membership.memberIds) delete context.assignments[id];
  } else if (intent.kind === "select") {
    if (
      !membership.candidates.some((candidate) =>
        sameHall(candidate, intent.hall),
      )
    )
      throw new Error("選択したホールは現在の配置に適合しません。");
    for (const id of membership.memberIds)
      context.assignments[id] = intent.hall;
  } else if (
    !previous ||
    membershipShareKey(previous, input.map) !== membership.sharedKey
  ) {
    const destination = resolveMembership(item, {
      ...input,
      context,
      items: input.items.filter((other) => other.id !== item.id),
    });
    const original = context.assignments[item.id];
    if (destination.reason === "manual" && destination.hall)
      context.assignments[item.id] = destination.hall;
    else if (
      original &&
      !membership.candidates.some((candidate) => sameHall(candidate, original))
    )
      delete context.assignments[item.id];
  }
  return context;
}

/** An explicit choice supersedes legacy manual values for this shared unit only. */
export function removeResolvedManualHallPending(
  pending: LegacyPendingV1[],
  memberIds: readonly string[],
  day: string,
  mapKey: string | null,
): LegacyPendingV1[] {
  const members = new Set(memberIds);
  return pending.filter(
    (entry) =>
      entry.payload.kind !== "manual-hall" ||
      !members.has(entry.payload.itemId) ||
      (entry.sourceDayKey !== null && !sameDay(entry.sourceDayKey, day)) ||
      (entry.sourceMapKey !== null && entry.sourceMapKey !== mapKey),
  );
}
