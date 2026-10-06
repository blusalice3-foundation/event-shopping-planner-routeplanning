import { isBlockDetectionSettings } from "./map";
import type { EventConsistencyStore } from "./consistency";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string";
const strings = (value: unknown): boolean =>
  Array.isArray(value) && value.every(string);
const known = (value: RecordValue, names: string[]): boolean =>
  Object.keys(value).every((key) => names.includes(key));
const unique = (values: unknown[]): boolean =>
  new Set(values.map((value) => JSON.stringify(value))).size === values.length;
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const point = (value: unknown): boolean =>
  record(value) &&
  number(value.row) &&
  number(value.col) &&
  Number.isInteger(value.row) &&
  Number.isInteger(value.col) &&
  value.row >= 0 &&
  value.col >= 0;
export const isHallRef = (value: unknown): boolean =>
  record(value) &&
  known(
    value,
    value.kind === "map"
      ? ["kind", "mapKey", "hallId"]
      : ["kind", "dayKey", "hallId"],
  ) &&
  string(value.hallId) &&
  value.hallId.length > 0 &&
  ((value.kind === "map" && string(value.mapKey)) ||
    (value.kind === "simple" && string(value.dayKey)));
const group = (value: unknown): boolean =>
  record(value) &&
  known(value, ["hall", "priority"]) &&
  (value.hall === null || isHallRef(value.hall)) &&
  ["none", "priority", "highest"].includes(String(value.priority));
export const isConsistencyRoute = (value: unknown): boolean =>
  record(value) &&
  known(value, ["isRouteVisible", "visitOrder"]) &&
  typeof value.isRouteVisible === "boolean" &&
  Array.isArray(value.visitOrder) &&
  value.visitOrder.every(
    (p) =>
      point(p) &&
      record(p) &&
      known(p, ["row", "col", "blockName", "number", "order", "itemIds"]) &&
      Number(p.row) >= 1 &&
      Number(p.col) >= 1 &&
      string(p.blockName) &&
      number(p.number) &&
      number(p.order) &&
      Number.isInteger(p.order) &&
      p.order >= 0 &&
      strings(p.itemIds),
  );
const definitions = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.every(
    (hall) =>
      record(hall) &&
      string(hall.id) &&
      hall.id.length > 0 &&
      string(hall.name) &&
      Array.isArray(hall.vertices) &&
      hall.vertices.every(point) &&
      (!Object.prototype.hasOwnProperty.call(hall, "blockNames") ||
        strings(hall.blockNames)) &&
      (!Object.prototype.hasOwnProperty.call(hall, "color") ||
        string(hall.color)),
  );
const legacyRoutes = (value: unknown): boolean =>
  record(value) &&
  strings(value.hallOrder) &&
  Array.isArray(value.hallVisitLists) &&
  value.hallVisitLists.every(
    (list) =>
      record(list) &&
      string(list.hallId) &&
      list.hallId.length > 0 &&
      strings(list.itemIds),
  );
function pending(value: unknown): boolean {
  if (
    !record(value) ||
    !known(value, [
      "sourceKey",
      "sourceDayKey",
      "sourceMapKey",
      "reason",
      "payload",
    ]) ||
    !string(value.sourceKey) ||
    !(value.sourceDayKey === null || string(value.sourceDayKey)) ||
    !(value.sourceMapKey === null || string(value.sourceMapKey)) ||
    !["ambiguous-source", "ambiguous-day", "conflicting-definition"].includes(
      String(value.reason),
    ) ||
    !record(value.payload)
  )
    return false;
  const payload = value.payload;
  switch (payload.kind) {
    case "manual-hall":
      return (
        known(payload, ["kind", "itemId", "manualHallId"]) &&
        string(payload.itemId) &&
        string(payload.manualHallId) &&
        payload.manualHallId.length > 0
      );
    case "hall-definitions":
      return known(payload, ["kind", "halls"]) && definitions(payload.halls);
    case "hall-route-settings":
      return (
        known(payload, ["kind", "settings"]) && legacyRoutes(payload.settings)
      );
    case "route-settings":
      return (
        known(payload, ["kind", "settings"]) &&
        isConsistencyRoute(payload.settings)
      );
    default:
      return false;
  }
}
export function validateEventConsistency(value: unknown): string[] {
  const errors: string[] = [];
  const check = (valid: boolean, path: string) => {
    if (!valid) errors.push(`${path}: 関連設定の型・構造が不正です`);
  };
  if (!record(value))
    return ["data.eventConsistency: 必須のオブジェクトがありません"];
  const context = (raw: unknown, path: string, mapless: boolean) => {
    if (!record(raw)) {
      check(false, path);
      return;
    }
    check(
      known(raw, ["assignments", "hallOrder", "hallVisitLists", "route"]),
      path,
    );
    check(
      record(raw.assignments) &&
        Object.values(raw.assignments).every(isHallRef),
      `${path}.assignments`,
    );
    check(
      Array.isArray(raw.hallOrder) &&
        raw.hallOrder.every(group) &&
        unique(raw.hallOrder),
      `${path}.hallOrder`,
    );
    check(
      Array.isArray(raw.hallVisitLists) &&
        raw.hallVisitLists.every(
          (list) =>
            record(list) &&
            known(list, ["group", "itemIds", "legacyHallId"]) &&
            group(list.group) &&
            strings(list.itemIds) &&
            unique(list.itemIds as unknown[]) &&
            (!Object.prototype.hasOwnProperty.call(list, "legacyHallId") ||
              string(list.legacyHallId)),
        ),
      `${path}.hallVisitLists`,
    );
    // A legacy hall/priority group can contain several separately saved lists.
    // Validate each list above without combining or rejecting those partitions.
    check(
      raw.route === null || (!mapless && isConsistencyRoute(raw.route)),
      `${path}.route`,
    );
  };
  for (const [eventName, event] of Object.entries(value)) {
    const path = `data.eventConsistency.${eventName}`;
    if (!record(event)) {
      check(false, path);
      continue;
    }
    check(
      known(event, [
        "schemaVersion",
        "blockDetectionSettings",
        "days",
        "legacyPending",
      ]),
      path,
    );
    check(event.schemaVersion === 1, `${path}.schemaVersion`);
    check(
      event.blockDetectionSettings === null ||
        isBlockDetectionSettings(event.blockDetectionSettings),
      `${path}.blockDetectionSettings`,
    );
    check(
      Array.isArray(event.legacyPending) && event.legacyPending.every(pending),
      `${path}.legacyPending`,
    );
    if (!record(event.days)) {
      check(false, `${path}.days`);
      continue;
    }
    for (const [dayKey, day] of Object.entries(event.days)) {
      const dayPath = `${path}.days.${dayKey}`;
      if (!record(day)) {
        check(false, dayPath);
        continue;
      }
      check(known(day, ["selectedMapKey", "mapless", "maps"]), dayPath);
      check(
        day.selectedMapKey === null || string(day.selectedMapKey),
        `${dayPath}.selectedMapKey`,
      );
      if (day.mapless !== null)
        context(day.mapless, `${dayPath}.mapless`, true);
      if (!record(day.maps)) {
        check(false, `${dayPath}.maps`);
        continue;
      }
      for (const [mapKey, mapContext] of Object.entries(day.maps))
        context(mapContext, `${dayPath}.maps.${mapKey}`, false);
    }
  }
  return errors;
}
export function assertEventConsistency(
  value: unknown,
): asserts value is EventConsistencyStore {
  const errors = validateEventConsistency(value);
  if (errors.length) throw new Error(errors.join("\n"));
}
