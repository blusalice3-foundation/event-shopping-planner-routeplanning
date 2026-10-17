import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppBackup,
  parseAppBackup,
  serializeAppBackup,
  validateSnapshotStructure,
} from "./appBackup";
import {
  sheetSnapshot,
  SHEET_EVENT,
} from "../test/sheetImportOptionalUrlFixtures";
import { fresh, port } from "../test/sheetImportOptionalUrlPersistence";
import { db } from "./indexedDB";
import { resetDatabaseConnection } from "../persistence/db/openDatabase";
import {
  exportToXlsx,
  importFromXlsx,
} from "../xlsx/engine/eventWorkbookEngine";
import {
  toImportedEventData,
  buildXlsxEventRestoreSource,
} from "../features/events/fileImport";
import type { ShoppingItem } from "../types/item";

afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
for (const mode of ["direct", "worker"])
  describe(`optional fields backup restore: ${mode}`, () => {
    it.each([undefined, "", "　 "])(
      "normalizes URL %s and known undefined keys before validation while retaining manual items and unknown fields",
      async (url) => {
        fresh();
        const data = sheetSnapshot();
        Object.assign(data.eventLists[SHEET_EVENT][0], {
          block: "",
          number: "",
          source: "app",
          protectionLevel: "full",
          url,
          assignedTo: undefined,
          futureField: { note: "エラーが発生しました" },
        });
        Object.freeze(data.eventLists[SHEET_EVENT][0]);
        const raw = {
          kind: "event-shopping-planner-backup",
          version: 2,
          exportedAt: "2026-10-17T00:00:00.000Z",
          data,
        };
        const restored = parseAppBackup(raw);
        expect(restored.ok).toBe(true);
        if (!restored.ok) throw new Error(restored.errors.join("\n"));
        expect(restored.data.eventLists[SHEET_EVENT]).toHaveLength(2);
        const item = restored.data.eventLists[SHEET_EVENT][0];
        expect(item).toMatchObject({
          block: "",
          number: "",
          futureField: { note: "エラーが発生しました" },
        });
        expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(item, "assignedTo")).toBe(
          false,
        );
        expect(
          Object.prototype.hasOwnProperty.call(
            raw.data.eventLists[SHEET_EVENT][0],
            "url",
          ),
        ).toBe(true);
        const commands = port(mode);
        const initial = await commands.readApplicationSnapshot();
        await commands.commitApplicationSnapshotAtomically(restored.data, {
          expectedRoots: initial.expectedRoots,
        });
        expect((await commands.readApplicationSnapshot()).snapshot).toEqual(
          (await db.readApplicationSnapshot()).snapshot,
        );
        const serialized = serializeAppBackup(createAppBackup(restored.data));
        expect(
          Object.prototype.hasOwnProperty.call(
            JSON.parse(serialized).data.eventLists[SHEET_EVENT][0],
            "url",
          ),
        ).toBe(false);
        expect(
          validateSnapshotStructure(raw.data).some((error) =>
            error.includes("assignedTo"),
          ),
        ).toBe(true);
      },
    );
    it("round trips a full XLSX with a manual blank location and no URL through actual storage", async () => {
      fresh();
      const data = sheetSnapshot();
      Object.assign(data.eventLists[SHEET_EVENT][0], {
        block: "",
        number: "",
        source: "app",
        protectionLevel: "full",
        url: "",
      });
      const blob = await exportToXlsx(
        SHEET_EVENT,
        data.eventLists[SHEET_EVENT] as ShoppingItem[],
        {
          includeItems: true,
          includeLayoutInfo: true,
          includeMapData: true,
          includeRouteInfo: true,
          format: "full",
        },
        {
          eventConsistency: data.eventConsistency,
          executeModeItems: data.executeModeItems,
          dayModes: data.dayModes,
        },
      );
      const bytes = await blob.arrayBuffer();
      const imported = await importFromXlsx(
        new File([], "restore.xlsx"),
        bytes,
      );
      expect(imported.success, imported.errors.join("\n")).toBe(true);
      const restored = buildXlsxEventRestoreSource(
        toImportedEventData(imported),
      );
      const commands = port(mode);
      const initial = await commands.readApplicationSnapshot();
      await commands.commitApplicationSnapshotAtomically(restored.data, {
        expectedRoots: initial.expectedRoots,
      });
      const saved = (await commands.readApplicationSnapshot()).snapshot;
      expect(saved.eventLists[SHEET_EVENT]).toHaveLength(2);
      expect(saved.eventLists[SHEET_EVENT][0]).toMatchObject({
        id: data.eventLists[SHEET_EVENT][0].id,
        block: "",
        number: "",
        source: "app",
      });
      expect(
        Object.prototype.hasOwnProperty.call(
          saved.eventLists[SHEET_EVENT][0],
          "url",
        ),
      ).toBe(false);
    });
  });
it.each([null, 7, [], {}])(
  "keeps invalid URL %s visible to backup validation",
  (url) => {
    const data = sheetSnapshot();
    Object.assign(data.eventLists[SHEET_EVENT][0], { url });
    expect(
      parseAppBackup({
        kind: "event-shopping-planner-backup",
        version: 2,
        exportedAt: "2026-10-17T00:00:00.000Z",
        data,
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringContaining("url")]),
    });
  },
);
