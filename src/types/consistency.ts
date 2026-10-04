import type {
  BlockDetectionSettings,
  HallDefinition,
  HallRouteSettings,
  RouteSettings,
} from "./map";

export type Priority = "none" | "priority" | "highest";
export type HallRef =
  | { kind: "map"; mapKey: string; hallId: string }
  | { kind: "simple"; dayKey: string; hallId: string };
export type HallGroupRef = { hall: HallRef | null; priority: Priority };
export type HallVisitListV1 = {
  group: HallGroupRef;
  itemIds: string[];
  legacyHallId?: string;
};
export type VisitContextV1 = {
  assignments: Record<string, HallRef>;
  hallOrder: HallGroupRef[];
  hallVisitLists: HallVisitListV1[];
  route: RouteSettings | null;
};
export type DayConsistencyV1 = {
  selectedMapKey: string | null;
  mapless: VisitContextV1 | null;
  maps: Record<string, VisitContextV1>;
};
export type LegacyPayloadV1 =
  | { kind: "manual-hall"; itemId: string; manualHallId: string }
  | { kind: "hall-definitions"; halls: HallDefinition[] }
  | { kind: "hall-route-settings"; settings: HallRouteSettings }
  | { kind: "route-settings"; settings: RouteSettings };
export type LegacyPendingV1 = {
  sourceKey: string;
  sourceDayKey: string | null;
  sourceMapKey: string | null;
  reason: "ambiguous-source" | "ambiguous-day" | "conflicting-definition";
  payload: LegacyPayloadV1;
};
export type EventConsistencyV1 = {
  schemaVersion: 1;
  blockDetectionSettings: BlockDetectionSettings | null;
  days: Record<string, DayConsistencyV1>;
  legacyPending: LegacyPendingV1[];
};
export type EventConsistencyStore = Record<string, EventConsistencyV1>;
export type HallSelectionIntent =
  | { kind: "unchanged" }
  | { kind: "automatic" }
  | { kind: "select"; hall: HallRef };

export const createVisitContext = (): VisitContextV1 => ({
  assignments: {},
  hallOrder: [],
  hallVisitLists: [],
  route: null,
});
export const createDayConsistency = (): DayConsistencyV1 => ({
  selectedMapKey: null,
  mapless: null,
  maps: {},
});
export const createEventConsistency = (): EventConsistencyV1 => ({
  schemaVersion: 1,
  blockDetectionSettings: null,
  days: {},
  legacyPending: [],
});
