import xlsxLimits from "../../../config/xlsx-limits.json";
import type { EventWorkbookAdditionalData } from "./eventWorkbook";
import { createAppBackup } from "../../utils/appBackup";
import type { PersistenceSnapshot } from "../../app/ports/PersistenceCommandPort";
import type {
  EventConsistencyV1,
  LegacyPendingV1,
  VisitContextV1,
} from "../../types/consistency";
import {
  createDayConsistency,
  createEventConsistency,
} from "../../types/consistency";
import { MAPLESS_HALL_KEY } from "../../types/map";
import type { ExportOptions } from "../../types/export";
import type { ShoppingItem } from "../../types/item";
import {
  validateSnapshotReferences,
  validateSnapshotStructure,
} from "../../utils/appBackup";
import { validateEventConsistency } from "../../features/consistency/domain/validation";

export type WorkbookContentSection =
  | "items"
  | "metadata"
  | "layout"
  | "maps"
  | "mapSettings"
  | "blockDetectionSettings"
  | "selectedMaps"
  | "simpleHalls"
  | "mapHalls"
  | "maplessAssignments"
  | "mapAssignments"
  | "maplessOrder"
  | "mapOrder"
  | "maplessVisits"
  | "mapVisits"
  | "routes"
  | "legacyPending";
export interface ContentManifest {
  schemaVersion: 1;
  options: ExportOptions;
  sections: Record<
    WorkbookContentSection,
    { included: boolean; count: number }
  >;
  omissions: Array<{
    section: WorkbookContentSection;
    count: number;
    reason: string;
  }>;
  requiredSheets: string[];
  records: ConsistencyRecordDescriptor[];
}
export interface ConsistencyRecordDescriptor {
  kind: "event" | "day" | "context" | "legacyPending";
  dayKey: string;
  context: "event" | "day" | "mapless" | "map" | "pending";
  mapKey: string;
  recordId: string;
  totalParts: number;
}
export interface ConsistencyChunkRow extends ConsistencyRecordDescriptor {
  part: number;
  json: string;
}
const entries = Object.entries;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: unknown, keys: string[]): boolean =>
  record(value) &&
  JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort());
const sectionNames: WorkbookContentSection[] = [
  "items",
  "metadata",
  "layout",
  "maps",
  "mapSettings",
  "blockDetectionSettings",
  "selectedMaps",
  "simpleHalls",
  "mapHalls",
  "maplessAssignments",
  "mapAssignments",
  "maplessOrder",
  "mapOrder",
  "maplessVisits",
  "mapVisits",
  "routes",
  "legacyPending",
];
function pendingIncluded(
  pending: LegacyPendingV1,
  L: boolean,
  M: boolean,
  R: boolean,
): boolean {
  if (!R) return false;
  if (
    pending.reason === "ambiguous-source" ||
    pending.reason === "ambiguous-day" ||
    pending.sourceDayKey === null
  )
    return L && M;
  return (
    (!pending.sourceMapKey || M) &&
    (!(
      pending.payload.kind === "route-settings" ||
      pending.payload.kind === "hall-route-settings"
    ) ||
      L)
  );
}
function count(
  snapshot: PersistenceSnapshot,
  name: string,
): Record<WorkbookContentSection, number> {
  const event = snapshot.eventConsistency[name] ?? createEventConsistency();
  const days = Object.values(event.days),
    mapless = days.flatMap((day) => (day.mapless ? [day.mapless] : [])),
    mapped = days.flatMap((day) => Object.values(day.maps));
  const sum = (
    contexts: VisitContextV1[],
    key: "assignments" | "hallOrder" | "hallVisitLists",
  ) =>
    contexts.reduce(
      (total, context) =>
        total +
        (key === "assignments"
          ? Object.keys(context.assignments).length
          : key === "hallVisitLists"
            ? context.hallVisitLists.reduce(
                (n, list) => n + list.itemIds.length,
                0,
              )
            : context.hallOrder.length),
      0,
    );
  const halls = entries(snapshot.hallDefinitions[name] ?? {});
  return {
    items: snapshot.eventLists[name]?.length ?? 0,
    metadata: snapshot.eventMetadata[name] ? 1 : 0,
    layout:
      Object.values(snapshot.executeModeItems[name] ?? {}).reduce(
        (n, ids) => n + ids.length,
        0,
      ) + Object.keys(snapshot.dayModes[name] ?? {}).length,
    maps: Object.keys(snapshot.mapData[name] ?? {}).length,
    mapSettings:
      Object.keys(snapshot.mapRotationSettings[name] ?? {}).length +
      Object.keys(snapshot.mapViewportSettings[name] ?? {}).length,
    blockDetectionSettings: event.blockDetectionSettings ? 1 : 0,
    selectedMaps: days.filter((day) => day.selectedMapKey !== null).length,
    simpleHalls: halls
      .filter(([key]) => key.startsWith(`${MAPLESS_HALL_KEY}:`))
      .reduce((n, [, halls]) => n + halls.length, 0),
    mapHalls: halls
      .filter(([key]) => !key.startsWith(`${MAPLESS_HALL_KEY}:`))
      .reduce((n, [, halls]) => n + halls.length, 0),
    maplessAssignments: sum(mapless, "assignments"),
    mapAssignments: sum(mapped, "assignments"),
    maplessOrder: sum(mapless, "hallOrder"),
    mapOrder: sum(mapped, "hallOrder"),
    maplessVisits: sum(mapless, "hallVisitLists"),
    mapVisits: sum(mapped, "hallVisitLists"),
    routes: [...mapless, ...mapped].filter((context) => context.route !== null)
      .length,
    legacyPending: event.legacyPending.length,
  };
}
export function selectWorkbookContent(
  source: PersistenceSnapshot,
  name: string,
  options: ExportOptions,
): { snapshot: PersistenceSnapshot; manifest: ContentManifest } {
  if (!options.includeItems) throw new Error("品目データは必須です。");
  const full = options.format === "full",
    L = full && options.includeLayoutInfo,
    M = full && options.includeMapData,
    R = full && options.includeRouteInfo;
  const next = Object.fromEntries(
    Object.keys(source).map((key) => [key, {}]),
  ) as unknown as PersistenceSnapshot;
  next.eventLists[name] = (source.eventLists[name] as ShoppingItem[]).map(
    (item) => {
      const copy = { ...item };
      delete copy.manualHallId;
      return copy;
    },
  );
  if (full && source.eventMetadata[name])
    next.eventMetadata[name] = structuredClone(source.eventMetadata[name]);
  if (L) {
    next.executeModeItems[name] = structuredClone(
      source.executeModeItems[name] ?? {},
    );
    next.dayModes[name] = structuredClone(source.dayModes[name] ?? {});
  }
  if (M) {
    next.mapData[name] = structuredClone(source.mapData[name] ?? {});
    next.mapRotationSettings[name] = structuredClone(
      source.mapRotationSettings[name] ?? {},
    );
    next.mapViewportSettings[name] = structuredClone(
      source.mapViewportSettings[name] ?? {},
    );
  }
  if (R)
    next.hallDefinitions[name] = structuredClone(
      Object.fromEntries(
        entries(source.hallDefinitions[name] ?? {}).filter(
          ([key]) => M || key.startsWith(`${MAPLESS_HALL_KEY}:`),
        ),
      ),
    );
  const original = source.eventConsistency[name] ?? createEventConsistency(),
    event = createEventConsistency();
  next.eventConsistency[name] = event;
  if (M)
    event.blockDetectionSettings = structuredClone(
      original.blockDetectionSettings,
    );
  const context = (value: VisitContextV1, mapped: boolean): VisitContextV1 => ({
    assignments: structuredClone(value.assignments),
    hallOrder: structuredClone(value.hallOrder),
    hallVisitLists: L ? structuredClone(value.hallVisitLists) : [],
    route: L && M && R && mapped ? structuredClone(value.route) : null,
  });
  if (M || R)
    for (const [key, old] of entries(original.days)) {
      const day = createDayConsistency();
      if (M) day.selectedMapKey = old.selectedMapKey;
      if (R && old.mapless) day.mapless = context(old.mapless, false);
      if (M && R)
        day.maps = Object.fromEntries(
          entries(old.maps).map(([mapKey, value]) => [
            mapKey,
            context(value, true),
          ]),
        );
      event.days[key] = day;
    }
  event.legacyPending = structuredClone(
    original.legacyPending.filter((pending) =>
      pendingIncluded(pending, L, M, R),
    ),
  );
  const errors = [
    ...validateSnapshotStructure(next),
    ...validateSnapshotReferences(next),
  ];
  if (errors.length) throw new Error(errors.join("\n"));
  const before = count(source, name),
    after = count(next, name);
  const included: Record<WorkbookContentSection, boolean> = {
    items: true,
    metadata: full,
    layout: L,
    maps: M,
    mapSettings: M,
    blockDetectionSettings: M,
    selectedMaps: M,
    simpleHalls: R,
    mapHalls: M && R,
    maplessAssignments: R,
    mapAssignments: M && R,
    maplessOrder: R,
    mapOrder: M && R,
    maplessVisits: L && R,
    mapVisits: L && M && R,
    routes: L && M && R,
    legacyPending: R,
  };
  const sections = Object.fromEntries(
    entries(included).map(([key, included]) => [
      key,
      { included, count: after[key as WorkbookContentSection] },
    ]),
  ) as ContentManifest["sections"];
  const manifest: ContentManifest = {
    schemaVersion: 1,
    options: { ...options },
    sections,
    omissions: (Object.keys(before) as WorkbookContentSection[])
      .filter((key) => before[key] > after[key])
      .map((section) => ({
        section,
        count: before[section] - after[section],
        reason: "選択した出力オプションでは必要な関連情報を同梱しないため",
      })),
    requiredSheets: [
      "アイテムデータ",
      ...(full ? ["メタデータ", "関連設定"] : []),
      ...(L ? ["配置情報"] : []),
      ...(M ? ["マップデータ"] : []),
      ...(R ? ["ルート情報"] : []),
    ],
    records: [],
  };
  if (full) manifest.records = encodeConsistencyRows(event).records;
  return { snapshot: next, manifest };
}
export function splitJsonCells(json: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < json.length; ) {
    let end = Math.min(start + 30000, json.length);
    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
    parts.push(json.slice(start, end));
    start = end;
  }
  return parts.length ? parts : [""];
}
export function encodeConsistencyRows(event: EventConsistencyV1): {
  rows: ConsistencyChunkRow[];
  records: ConsistencyRecordDescriptor[];
} {
  const rows: ConsistencyChunkRow[] = [],
    records: ConsistencyRecordDescriptor[] = [];
  const add = (
    descriptor: Omit<ConsistencyRecordDescriptor, "totalParts">,
    value: unknown,
  ) => {
    const parts = splitJsonCells(JSON.stringify(value));
    const record = { ...descriptor, totalParts: parts.length };
    records.push(record);
    parts.forEach((json, index) =>
      rows.push({ ...record, part: index + 1, json }),
    );
  };
  add(
    {
      kind: "event",
      dayKey: "",
      context: "event",
      mapKey: "",
      recordId: "event",
    },
    { schemaVersion: 1, blockDetectionSettings: event.blockDetectionSettings },
  );
  for (const [dayKey, day] of entries(event.days)) {
    add(
      {
        kind: "day",
        dayKey,
        context: "day",
        mapKey: "",
        recordId: JSON.stringify(["day", dayKey]),
      },
      {
        selectedMapKey: day.selectedMapKey,
        mapless: day.mapless !== null,
        maps: Object.keys(day.maps),
      },
    );
    if (day.mapless)
      add(
        {
          kind: "context",
          dayKey,
          context: "mapless",
          mapKey: "",
          recordId: JSON.stringify(["context", dayKey, null]),
        },
        day.mapless,
      );
    for (const [mapKey, context] of entries(day.maps))
      add(
        {
          kind: "context",
          dayKey,
          context: "map",
          mapKey,
          recordId: JSON.stringify(["context", dayKey, mapKey]),
        },
        context,
      );
  }
  event.legacyPending.forEach((pending, index) =>
    add(
      {
        kind: "legacyPending",
        dayKey: pending.sourceDayKey ?? "",
        context: "pending",
        mapKey: pending.sourceMapKey ?? "",
        recordId: `pending:${index}`,
      },
      pending,
    ),
  );
  return { rows, records };
}
export function decodeConsistencyRows(
  rows: ConsistencyChunkRow[],
  manifest: ContentManifest,
): EventConsistencyV1 {
  if (
    rows.length > xlsxLimits.maxRowCount ||
    rows.some(
      (row) => !row || typeof row.json !== "string" || row.json.length > 30000,
    )
  )
    throw new Error("関連設定のセルまたは行数が上限を超えています。");
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const row of rows) {
    bytes += encoder.encode(row.json).byteLength;
    if (bytes > xlsxLimits.maxXmlTextBytes)
      throw new Error("関連設定の本文が上限を超えています。");
  }
  const event = createEventConsistency();
  let offset = 0;
  const seen = new Set<string>(),
    declarations = new Map<string, { mapless: boolean; maps: string[] }>();
  for (const descriptor of manifest.records) {
    if (
      seen.has(descriptor.recordId) ||
      !Number.isSafeInteger(descriptor.totalParts) ||
      descriptor.totalParts < 1
    )
      throw new Error("関連設定のレコードID・分割数が不正です。");
    seen.add(descriptor.recordId);
    const parts = rows.slice(offset, offset + descriptor.totalParts);
    offset += descriptor.totalParts;
    if (
      parts.length !== descriptor.totalParts ||
      parts.some(
        (row, index) =>
          row.part !== index + 1 ||
          row.json.length > 30000 ||
          Object.keys(descriptor).some(
            (key) =>
              row[key as keyof ConsistencyRecordDescriptor] !==
              descriptor[key as keyof ConsistencyRecordDescriptor],
          ),
      )
    )
      throw new Error(
        "関連設定の分割片が欠落・重複しているか、順序・総数が不正です。",
      );
    const value = JSON.parse(parts.map((row) => row.json).join(""));
    if (descriptor.kind === "event") {
      if (
        descriptor.recordId !== "event" ||
        descriptor.context !== "event" ||
        descriptor.dayKey !== "" ||
        descriptor.mapKey !== "" ||
        !exactKeys(value, ["schemaVersion", "blockDetectionSettings"]) ||
        value.schemaVersion !== 1
      )
        throw new Error("未対応の関連設定です。");
      event.blockDetectionSettings = value.blockDetectionSettings;
    } else if (descriptor.kind === "day") {
      if (
        descriptor.context !== "day" ||
        descriptor.mapKey !== "" ||
        !exactKeys(value, ["selectedMapKey", "mapless", "maps"]) ||
        event.days[descriptor.dayKey] ||
        typeof value.mapless !== "boolean" ||
        !Array.isArray(value.maps) ||
        !value.maps.every((key: unknown) => typeof key === "string") ||
        new Set(value.maps).size !== value.maps.length
      )
        throw new Error("日付設定が不正です。");
      event.days[descriptor.dayKey] = {
        selectedMapKey: value.selectedMapKey,
        mapless: null,
        maps: {},
      };
      declarations.set(descriptor.dayKey, value);
    } else if (descriptor.kind === "context") {
      const day = event.days[descriptor.dayKey];
      if (!day) throw new Error("所属設定の日付がありません。");
      if (
        descriptor.context === "mapless" &&
        descriptor.mapKey === "" &&
        day.mapless === null
      )
        day.mapless = value;
      else if (
        descriptor.context === "map" &&
        descriptor.mapKey !== "" &&
        !Object.prototype.hasOwnProperty.call(day.maps, descriptor.mapKey)
      )
        day.maps[descriptor.mapKey] = value;
      else throw new Error("所属設定の文脈が不正です。");
    } else if (descriptor.kind === "legacyPending") {
      if (
        descriptor.context !== "pending" ||
        descriptor.dayKey !== (value.sourceDayKey ?? "") ||
        descriptor.mapKey !== (value.sourceMapKey ?? "")
      )
        throw new Error("保留設定の保存元が一致しません。");
      event.legacyPending.push(value);
    } else throw new Error("未対応の関連設定レコードです。");
  }
  if (offset !== rows.length || !seen.has("event"))
    throw new Error("関連設定のレコード数が一致しません。");
  for (const [key, expected] of declarations)
    if (
      (event.days[key].mapless !== null) !== expected.mapless ||
      JSON.stringify(Object.keys(event.days[key].maps)) !==
        JSON.stringify(expected.maps)
    )
      throw new Error("宣言された所属設定がありません。");
  const errors = validateEventConsistency({ event });
  if (errors.length) throw new Error(errors.join("\n"));
  return event;
}
export function parseContentManifest(value: unknown): ContentManifest {
  if (!value || typeof value !== "object")
    throw new Error("contentManifestがありません。");
  if (
    !exactKeys(value, [
      "schemaVersion",
      "options",
      "sections",
      "omissions",
      "requiredSheets",
      "records",
    ])
  )
    throw new Error("contentManifestに未対応の項目があります。");
  const manifest = value as ContentManifest;
  if (
    manifest.schemaVersion !== 1 ||
    !manifest.options ||
    manifest.options.includeItems !== true ||
    manifest.options.format !== "full" ||
    ![
      manifest.options.includeLayoutInfo,
      manifest.options.includeMapData,
      manifest.options.includeRouteInfo,
    ].every((value) => typeof value === "boolean") ||
    !Array.isArray(manifest.records) ||
    !Array.isArray(manifest.requiredSheets) ||
    !manifest.requiredSheets.every((name) => typeof name === "string") ||
    !Array.isArray(manifest.omissions) ||
    !manifest.sections ||
    typeof manifest.sections !== "object"
  )
    throw new Error("contentManifestの形式が不正です。");
  if (
    !exactKeys(manifest.options, [
      "includeItems",
      "includeLayoutInfo",
      "includeMapData",
      "includeRouteInfo",
      "format",
    ]) ||
    new Set(manifest.requiredSheets).size !== manifest.requiredSheets.length ||
    new Set(manifest.omissions.map((value) => value?.section)).size !==
      manifest.omissions.length
  )
    throw new Error("contentManifestの宣言が重複しているか不正です。");
  if (!exactKeys(manifest.sections, sectionNames))
    throw new Error("contentManifestの保持範囲が不正です。");
  for (const omission of manifest.omissions)
    if (
      !omission ||
      !exactKeys(omission, ["section", "count", "reason"]) ||
      !sectionNames.includes(omission.section) ||
      !Number.isSafeInteger(omission.count) ||
      omission.count <= 0 ||
      typeof omission.reason !== "string" ||
      !omission.reason
    )
      throw new Error("contentManifestの省略理由が不正です。");
  for (const section of Object.values(manifest.sections))
    if (
      !section ||
      !exactKeys(section, ["included", "count"]) ||
      typeof section.included !== "boolean" ||
      !Number.isSafeInteger(section.count) ||
      section.count < 0
    )
      throw new Error("contentManifestの件数が不正です。");
  for (const record of manifest.records)
    if (
      !record ||
      !exactKeys(record, [
        "kind",
        "dayKey",
        "context",
        "mapKey",
        "recordId",
        "totalParts",
      ]) ||
      !["event", "day", "context", "legacyPending"].includes(record.kind) ||
      ![
        record.kind,
        record.dayKey,
        record.context,
        record.mapKey,
        record.recordId,
      ].every((value) => typeof value === "string") ||
      !Number.isSafeInteger(record.totalParts) ||
      record.totalParts < 1
    )
      throw new Error("contentManifestの分割宣言が不正です。");
  if (
    manifest.records.length > xlsxLimits.maxRowCount ||
    manifest.records.reduce((total, record) => total + record.totalParts, 0) >
      xlsxLimits.maxRowCount
  )
    throw new Error("関連設定の分割宣言が行数の上限を超えています。");
  if (
    new Set(manifest.records.map((record) => record.recordId)).size !==
    manifest.records.length
  )
    throw new Error("関連設定のレコードIDが重複しています。");
  return manifest;
}
export function validateWorkbookManifest(
  snapshot: PersistenceSnapshot,
  name: string,
  manifest: ContentManifest,
): void {
  const expected = selectWorkbookContent(
    snapshot,
    name,
    manifest.options,
  ).manifest;
  const actual = count(snapshot, name);
  if (sectionNames.some((key) => actual[key] !== manifest.sections[key].count))
    throw new Error(
      "出力対象外の関連情報、または宣言と異なる件数を含んでいます。",
    );
  if (
    sectionNames.some(
      (key) =>
        expected.sections[key].included !== manifest.sections[key].included ||
        expected.sections[key].count !== manifest.sections[key].count,
    ) ||
    JSON.stringify(expected.requiredSheets) !==
      JSON.stringify(manifest.requiredSheets) ||
    JSON.stringify(expected.records) !== JSON.stringify(manifest.records)
  )
    throw new Error(
      "contentManifestの保持範囲・件数が実際の内容と一致しません。",
    );
}
export function createWorkbookSource(
  name: string,
  items: ShoppingItem[],
  data: EventWorkbookAdditionalData,
): PersistenceSnapshot {
  const section = (value: Record<string, unknown> | undefined) =>
    value && Object.prototype.hasOwnProperty.call(value, name)
      ? { [name]: value[name] }
      : {};
  const snapshot = {
    eventLists: { [name]: items },
    eventMetadata: data.metadata ? { [name]: data.metadata } : {},
    executeModeItems: section(data.executeModeItems),
    dayModes: section(data.dayModes),
    mapData: section(data.mapData),
    mapRotationSettings: section(data.mapRotationSettings),
    mapViewportSettings: section(data.mapViewportSettings),
    hallDefinitions: section(data.hallDefinitions),
    routeSettings: section(data.routeSettings),
    hallRouteSettings: section(data.hallRouteSettings),
    ...(data.eventConsistency
      ? { eventConsistency: section(data.eventConsistency) }
      : {}),
  };
  return createAppBackup(snapshot as PersistenceSnapshot, new Date(), {
    blockDetectionSettings: data.blockDetectionSettings ?? {},
  }).data;
}
