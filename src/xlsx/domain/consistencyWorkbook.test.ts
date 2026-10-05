import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { PersistenceSnapshot } from "../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../types/item";
import type { ExportOptions } from "../../types/export";
import type { EventWorkbookAdditionalData } from "./eventWorkbook";
import { DEFAULT_BLOCK_DETECTION_SETTINGS } from "../../types/map";
import {
  createDayConsistency,
  createEventConsistency,
  createVisitContext,
} from "../../types/consistency";
import {
  decodeConsistencyRows,
  encodeConsistencyRows,
  parseContentManifest,
  selectWorkbookContent,
  splitJsonCells,
  validateWorkbookManifest,
} from "./consistencyWorkbook";
import { exportToXlsx, importFromXlsx } from "../engine/eventWorkbookEngine";
import { migrateLegacyConsistency } from "../../features/consistency/domain/migration";
const source = (): PersistenceSnapshot => {
  const simple = {
    kind: "simple" as const,
    dayKey: " 1日目　",
    hallId: "hall",
  };
  const detailed = {
    kind: "map" as const,
    mapKey: "１日目マップ",
    hallId: "hall",
  };
  const group = (hall: typeof simple | typeof detailed) => ({
    hall,
    priority: "none" as const,
  });
  return {
    eventLists: {
      event: [
        {
          id: "A",
          circle: "東",
          eventDate: "1日目",
          block: "A",
          number: "01a",
          title: "ユーザー登録",
          price: 500,
          quantity: 1,
          purchaseStatus: "None",
          remarks: "エラーが発生しました",
        },
      ],
    },
    eventMetadata: {
      event: {
        spreadsheetUrl: "",
        spreadsheetSheetName: "",
        lastImportDate: "2026-09-27T00:00:00.000Z",
      },
    },
    executeModeItems: { event: { " 1日目　": ["A"] } },
    dayModes: { event: { " 1日目　": "execute" } },
    mapData: {
      event: {
        "１日目マップ": {
          cells: [],
          mergedCells: [],
          maxRow: 3,
          maxCol: 3,
          blocks: [
            {
              name: "A",
              startRow: 1,
              startCol: 1,
              endRow: 3,
              endCol: 3,
              numberCells: [{ row: 2, col: 2, value: 1 }],
            },
          ],
        },
      },
    },
    mapRotationSettings: {
      event: {
        "１日目マップ": {
          initialAngle: 90,
          mapTabAngle: 90,
          focusModeAngle: 90,
        },
      },
    },
    mapViewportSettings: {},
    routeSettings: {},
    hallRouteSettings: {},
    hallDefinitions: {
      event: {
        "__mapless__: 1日目　": [
          { id: "hall", name: "簡易", vertices: [], blockNames: ["A"] },
        ],
        "１日目マップ": [
          {
            id: "hall",
            name: "詳細",
            vertices: [
              { row: 1, col: 1 },
              { row: 1, col: 3 },
              { row: 3, col: 3 },
            ],
          },
        ],
      },
    },
    eventConsistency: {
      event: {
        ...createEventConsistency(),
        blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
        days: {
          " 1日目　": {
            ...createDayConsistency(),
            selectedMapKey: "１日目マップ",
            mapless: {
              ...createVisitContext(),
              assignments: { A: simple },
              hallOrder: [group(simple)],
              hallVisitLists: [{ group: group(simple), itemIds: ["A"] }],
            },
            maps: {
              "１日目マップ": {
                assignments: { A: detailed },
                hallOrder: [group(simple), group(detailed)],
                hallVisitLists: [{ group: group(detailed), itemIds: ["A"] }],
                route: {
                  isRouteVisible: true,
                  visitOrder: [
                    {
                      row: 2,
                      col: 2,
                      blockName: "A",
                      number: 1,
                      order: 0,
                      itemIds: ["A"],
                    },
                  ],
                },
              },
            },
          },
        },
        legacyPending: [
          {
            sourceKey: "__mapless__",
            sourceDayKey: null,
            sourceMapKey: null,
            reason: "ambiguous-day",
            payload: {
              kind: "hall-definitions",
              halls: [
                {
                  id: "pending",
                  name: "確認待ち",
                  vertices: [],
                  blockNames: ["X"],
                },
              ],
            },
          },
        ],
      },
    },
  };
};
const options = (L: boolean, M: boolean, R: boolean): ExportOptions => ({
  includeItems: true,
  includeLayoutInfo: L,
  includeMapData: M,
  includeRouteInfo: R,
  format: "full",
});
describe("full workbook option matrix", () => {
  for (const L of [false, true])
    for (const M of [false, true])
      for (const R of [false, true])
        it(`round-trips layout=${L} maps=${M} routes=${R}`, async () => {
          const original = source();
          const selection = options(L, M, R);
          const expected = selectWorkbookContent(original, "event", selection);
          const blob = await exportToXlsx(
            "event",
            original.eventLists.event as ShoppingItem[],
            selection,
            {
              ...original,
              metadata: original.eventMetadata.event,
            } as EventWorkbookAdditionalData,
          );
          const result = await importFromXlsx(new File([blob], "event.xlsx"));
          expect(result.errors).toEqual([]);
          expect(result.success).toBe(true);
          expect(result.items).toMatchObject(original.eventLists.event);
          expect(result.metadata).toEqual(original.eventMetadata.event);
          expect(result.eventConsistency).toEqual(
            expected.snapshot.eventConsistency.event,
          );
          expect(result.layoutInfo?.executeModeItems ?? {}).toEqual(
            expected.snapshot.executeModeItems.event ?? {},
          );
          expect(result.hallDefinitions ?? {}).toEqual(
            expected.snapshot.hallDefinitions.event ?? {},
          );
          expect(result.mapData ?? {}).toEqual(
            expected.snapshot.mapData.event ?? {},
          );
          expect(result.contentManifest).toEqual(expected.manifest);
          expect(
            result.eventConsistency?.days[" 1日目　"]?.maps["１日目マップ"]
              ?.route !== null &&
              !!result.eventConsistency?.days[" 1日目　"]?.maps["１日目マップ"]
                ?.route,
          ).toBe(L && M && R);
        });
  it("round-trips split visit lists in both map and mapless contexts without merging them", async () => {
    const original = source();
    const first = original.eventLists.event[0] as ShoppingItem;
    original.eventLists.event.push({ ...first, id: "B", title: "分割先" });
    original.executeModeItems.event[" 1日目　"].push("B");
    const day = original.eventConsistency.event.days[" 1日目　"];
    for (const context of [day.mapless!, day.maps["１日目マップ"]]) {
      const firstList = context.hallVisitLists[0];
      firstList.legacyHallId = "hall";
      context.hallVisitLists.push({
        ...structuredClone(firstList),
        itemIds: ["B"],
      });
    }
    const before = structuredClone(original);
    const blob = await exportToXlsx(
      "event",
      original.eventLists.event as ShoppingItem[],
      options(true, true, true),
      {
        ...original,
        metadata: original.eventMetadata.event,
      } as EventWorkbookAdditionalData,
    );
    const restored = await importFromXlsx(new File([blob], "split.xlsx"));
    expect(restored.errors).toEqual([]);
    expect(restored.success).toBe(true);
    expect(restored.eventConsistency).toEqual(original.eventConsistency.event);
    expect(original).toEqual(before);
  });
  it("emits only items in simple format and leaves manual hall cells empty", async () => {
    const original = source();
    const blob = await exportToXlsx(
      "event",
      original.eventLists.event as ShoppingItem[],
      { ...options(true, true, true), format: "simple" },
      original as EventWorkbookAdditionalData,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "アイテムデータ",
    ]);
    const result = await importFromXlsx(new File([blob], "simple.xlsx"));
    expect(result.success).toBe(true);
    expect(result.eventConsistency).toBeUndefined();
    expect(result.items[0].manualHallId).toBeUndefined();
  });
  it("rejects attempts to omit mandatory items", () =>
    expect(() =>
      selectWorkbookContent(source(), "event", {
        ...options(false, false, false),
        includeItems: false,
      }),
    ).toThrow("必須"));
});
describe("pending workbook dependencies", () => {
  for (const L of [false, true])
    for (const M of [false, true])
      for (const R of [false, true]) {
        it(`preserves undated legacy mapless halls with layout=${L} maps=${M} routes=${R}`, async () => {
          const old = source();
          old.eventLists.event.push({
            ...(old.eventLists.event[0] as ShoppingItem),
            id: "B",
            eventDate: "2日目",
          });
          old.mapData = {};
          old.mapRotationSettings = {};
          old.hallDefinitions = {
            event: {
              __mapless__: [
                {
                  id: "old",
                  name: "旧簡易ホール",
                  vertices: [],
                  blockNames: ["A"],
                },
              ],
            },
          };
          const { eventConsistency: _unused, ...legacy } = old;
          const original = migrateLegacyConsistency(legacy).data;
          const pending = original.eventConsistency.event.legacyPending;
          expect(pending).toEqual([
            expect.objectContaining({
              sourceKey: "__mapless__",
              sourceDayKey: null,
              sourceMapKey: null,
              reason: "ambiguous-day",
              payload: expect.objectContaining({ kind: "hall-definitions" }),
            }),
          ]);
          const before = structuredClone(original);
          const selected = selectWorkbookContent(
            original,
            "event",
            options(L, M, R),
          );
          const expected = R ? pending : [];
          expect(
            selected.snapshot.eventConsistency.event.legacyPending,
          ).toEqual(expected);
          expect(selected.manifest.sections.legacyPending).toEqual({
            included: R,
            count: expected.length,
          });
          expect(
            selected.manifest.omissions.filter(
              (entry) => entry.section === "legacyPending",
            ),
          ).toHaveLength(R ? 0 : 1);
          const blob = await exportToXlsx(
            "event",
            original.eventLists.event as ShoppingItem[],
            options(L, M, R),
            {
              ...original,
              metadata: original.eventMetadata.event,
            } as EventWorkbookAdditionalData,
          );
          const restored = await importFromXlsx(
            new File([blob], "pending.xlsx"),
          );
          expect(restored.errors).toEqual([]);
          expect(restored.success).toBe(true);
          expect(restored.eventConsistency?.legacyPending).toEqual(expected);
          expect(restored.contentManifest).toEqual(selected.manifest);
          expect(original).toEqual(before);
        });
        it(`requires only actual pending dependencies with layout=${L} maps=${M} routes=${R}`, () => {
          const original = source();
          const maplessHalls = original.eventConsistency.event.legacyPending[0];
          const mappedHalls = {
            ...maplessHalls,
            sourceKey: "１日目マップ",
            sourceMapKey: "１日目マップ",
          };
          const maplessVisits = {
            ...maplessHalls,
            payload: {
              kind: "hall-route-settings" as const,
              settings: { hallOrder: ["pending"], hallVisitLists: [] },
            },
          };
          const mappedVisits = {
            ...maplessVisits,
            sourceKey: mappedHalls.sourceKey,
            sourceMapKey: mappedHalls.sourceMapKey,
          };
          const route = {
            ...mappedHalls,
            payload: {
              kind: "route-settings" as const,
              settings: { isRouteVisible: true, visitOrder: [] },
            },
          };
          const manual = {
            ...maplessHalls,
            sourceKey: "eventLists",
            sourceDayKey: "1日目",
            payload: {
              kind: "manual-hall" as const,
              itemId: "A",
              manualHallId: "hall",
            },
          };
          const unknownSource = {
            ...manual,
            reason: "ambiguous-source" as const,
          };
          original.eventConsistency.event.legacyPending = [
            maplessHalls,
            mappedHalls,
            maplessVisits,
            mappedVisits,
            route,
            manual,
            unknownSource,
          ];
          const expected = R
            ? [
                maplessHalls,
                ...(M ? [mappedHalls] : []),
                ...(L ? [maplessVisits] : []),
                ...(L && M ? [mappedVisits, route] : []),
                manual,
                ...(L && M ? [unknownSource] : []),
              ]
            : [];
          const selected = selectWorkbookContent(
            original,
            "event",
            options(L, M, R),
          );
          expect(
            selected.snapshot.eventConsistency.event.legacyPending,
          ).toEqual(expected);
          expect(selected.manifest.sections.legacyPending.count).toBe(
            expected.length,
          );
          expect(
            selected.manifest.omissions.find(
              (entry) => entry.section === "legacyPending",
            )?.count ?? 0,
          ).toBe(7 - expected.length);
        });
      }
});
describe("related settings and manifest corruption", () => {
  it("splits large Japanese and emoji records without breaking surrogate pairs", () => {
    const event = source().eventConsistency.event;
    event.legacyPending[0].sourceKey = "あ😀".repeat(30000);
    const { rows, records } = encodeConsistencyRows(event);
    expect(rows.some((row) => row.totalParts > 1)).toBe(true);
    expect(
      rows.every(
        (row) => row.json.length <= 30000 && !/[\uD800-\uDBFF]$/.test(row.json),
      ),
    ).toBe(true);
    const manifest = selectWorkbookContent(
      source(),
      "event",
      options(true, true, true),
    ).manifest;
    manifest.records = records;
    expect(decodeConsistencyRows(rows, manifest)).toEqual(event);
    expect(
      splitJsonCells("あ".repeat(29999) + "😀").map((part) => part.length),
    ).toEqual([29999, 2]);
  });
  it.each(["missing", "duplicate", "order", "total"])(
    "rejects %s chunks",
    (damage) => {
      const selected = selectWorkbookContent(
        source(),
        "event",
        options(true, true, true),
      );
      const { rows } = encodeConsistencyRows(
        selected.snapshot.eventConsistency.event,
      );
      if (damage === "missing") rows.pop();
      if (damage === "duplicate") rows.push(rows[0]);
      if (damage === "order") rows.reverse();
      if (damage === "total") rows[0].totalParts++;
      expect(() => decodeConsistencyRows(rows, selected.manifest)).toThrow();
    },
  );
  it("rejects unknown sections, malformed omission counts, and undeclared data", () => {
    const selected = selectWorkbookContent(
      source(),
      "event",
      options(false, false, false),
    );
    expect(() =>
      parseContentManifest({
        ...selected.manifest,
        sections: {
          ...selected.manifest.sections,
          unknown: { included: true, count: 0 },
        },
      }),
    ).toThrow();
    expect(() =>
      parseContentManifest({
        ...selected.manifest,
        omissions: [{ section: "maps", count: -1, reason: "x" }],
      }),
    ).toThrow();
    selected.snapshot.mapData.event = source().mapData.event;
    expect(() =>
      validateWorkbookManifest(selected.snapshot, "event", selected.manifest),
    ).toThrow();
  });
  it("rejects a missing declared related-settings sheet instead of falling back to legacy", async () => {
    const original = source();
    const blob = await exportToXlsx(
      "event",
      original.eventLists.event as ShoppingItem[],
      options(true, true, true),
      {
        ...original,
        metadata: original.eventMetadata.event,
      } as EventWorkbookAdditionalData,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    workbook.removeWorksheet("関連設定");
    const data = await workbook.xlsx.writeBuffer();
    const result = await importFromXlsx(
      new File([new Uint8Array(data)], "broken.xlsx"),
    );
    expect(result.success).toBe(false);
    expect(result.errors.join("\n")).toContain("関連設定");
  });
});
describe("closed full-workbook declarations", () => {
  it.each(["duplicate-metadata", "future-workbook", "future-schema"])(
    "rejects %s without falling back",
    async (damage) => {
      const original = source();
      const blob = await exportToXlsx(
        "event",
        original.eventLists.event as ShoppingItem[],
        options(true, true, true),
        {
          ...original,
          metadata: original.eventMetadata.event,
        } as EventWorkbookAdditionalData,
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await blob.arrayBuffer());
      const sheet = workbook.getWorksheet("メタデータ")!;
      if (damage === "duplicate-metadata") sheet.addRow(["version", "3.0"]);
      else
        sheet.eachRow((row) => {
          if (
            row.getCell(1).value ===
            (damage === "future-workbook"
              ? "version"
              : "consistencySchemaVersion")
          )
            row.getCell(2).value = "99";
        });
      const result = await importFromXlsx(
        new File(
          [new Uint8Array(await workbook.xlsx.writeBuffer())],
          "invalid.xlsx",
        ),
      );
      expect(result.success).toBe(false);
    },
  );
  it("rejects excessive chunk declarations and unknown manifest fields", () => {
    const manifest = selectWorkbookContent(
      source(),
      "event",
      options(true, true, true),
    ).manifest;
    expect(() => parseContentManifest({ ...manifest, unknown: 1 })).toThrow(
      "未対応",
    );
    const excessive = structuredClone(manifest);
    excessive.records[0].totalParts = Number.MAX_SAFE_INTEGER;
    expect(() => parseContentManifest(excessive)).toThrow("上限");
    expect(() =>
      parseContentManifest({
        ...manifest,
        records: [...manifest.records, manifest.records[0]],
      }),
    ).toThrow("重複");
  });
});
