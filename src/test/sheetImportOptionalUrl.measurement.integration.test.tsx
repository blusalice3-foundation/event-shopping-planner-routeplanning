import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "../app/state/useApplicationSnapshot";
import { useIndexedDbPersistence } from "../hooks/useIndexedDbPersistence";
import { resetDatabaseConnection } from "../persistence/db/openDatabase";

import { parseAppBackup, validateSnapshotStructure } from "../utils/appBackup";
import { readEventCsv } from "../features/events/sheetImport";
import { normalizeSheetItemsUrls } from "../features/events/updateDiff";
import {
  applyPendingEventUpdate,
  buildEventUpdateDiffFromSpreadsheet,
} from "../features/events/updateFlow";

import { buildBulkAddItems } from "../features/events/bulkAdd";
import {
  buildXlsxEventRestoreSource,
  toImportedEventData,
} from "../features/events/fileImport";
import {
  exportToXlsx,
  importFromXlsx,
} from "../xlsx/engine/eventWorkbookEngine";
import {
  SHEET_EVENT,
  sheetCsv,
  sheetItem,
  sheetSnapshot,
} from "./sheetImportOptionalUrlFixtures";

import {
  fresh,
  port,
  seed,
  setters,
  commits,
} from "./sheetImportOptionalUrlPersistence";

const phase = process.env.SHEET_URL_MEASURE_PHASE;
const repetitions = 20;
const options = { interval: 1, timeout: 10000 };
function sample(
  key: string,
  count: number,
  mode: string,
  iteration: number,
  start: number,
  detail: object = {},
) {
  console.log(
    "SHEET_URL_SAMPLE " +
      JSON.stringify({
        phase,
        key,
        count,
        mode,
        iteration,
        durationMs: performance.now() - start,
        ...detail,
      }),
  );
}
afterEach(() => {
  cleanup();
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.skipIf(!phase)(
  "sheet import optional URL route measurements (opt in)",
  () => {
    for (const count of [150, 500]) {
      for (const format of ["google", "legacy"] as const)
        for (const kind of ["normal", "mixed", "excluded"] as const) {
          it(`import ${count} ${format} ${kind}`, async () => {
            const csv = sheetCsv(count, kind, format);
            for (let iteration = 0; iteration < repetitions; iteration++) {
              fresh();
              const start = performance.now();
              try {
                const parsed = readEventCsv(csv);
                const parsedAt = performance.now();
                const items = normalizeSheetItemsUrls(
                  parsed.rows.map((row) => row.item),
                ).map(({ rawQuantity: _raw, ...item }) => item);
                const data = sheetSnapshot(0);
                data.eventLists[SHEET_EVENT] = buildBulkAddItems(items, {
                  source: "spreadsheet",
                });
                const errors = validateSnapshotStructure(data);
                if (errors.length) throw new Error(errors.join("\n"));
                if (items.length) await seed(data);
                sample(
                  `import-${format}-${kind}`,
                  count,
                  "direct",
                  iteration,
                  start,
                  {
                    parseMs: parsedAt - start,
                    accepted: items.length,
                    status: "ok",
                  },
                );
              } catch (error) {
                sample(
                  `import-${format}-${kind}`,
                  count,
                  "direct",
                  iteration,
                  start,
                  {
                    status: "failed",
                    error: (error as Error).message.slice(0, 100),
                  },
                );
                if (phase === "after") throw error;
              }
            }
          });
        }
      for (const mode of ["direct", "worker"]) {
        for (const kind of ["normal", "mixed", "excluded"] as const)
          for (const sourceSwitch of [false, true]) {
            it(`update ${count} ${mode} ${kind} switch=${sourceSwitch}`, async () => {
              const csv = sheetCsv(count, kind);
              vi.stubGlobal(
                "fetch",
                vi.fn(async () => ({ ok: true, text: async () => csv })),
              );
              for (let iteration = 0; iteration < repetitions; iteration++) {
                fresh();
                const original = sheetSnapshot(count);
                await seed(original);
                const commands = port(mode);
                const read = await commands.readApplicationSnapshot();
                const start = performance.now();
                try {
                  const diff = await buildEventUpdateDiffFromSpreadsheet(
                    original.eventLists[SHEET_EVENT] as ReturnType<
                      typeof sheetItem
                    >[],
                    {
                      url: "https://docs.google.com/spreadsheets/d/test/edit",
                      sheetName: "品目表",
                    },
                  );
                  const reviewMs = performance.now() - start;
                  const confirmedAt = performance.now();
                  const nextSource = {
                    url: "https://docs.google.com/spreadsheets/d/test/edit",
                    sheetName: "品目表",
                  };
                  const state = applyPendingEventUpdate({
                    state: read.snapshot as unknown as Parameters<
                      typeof applyPendingEventUpdate
                    >[0]["state"],
                    pending: {
                      kind: sourceSwitch ? "source-switch" : "items-only",
                      eventName: SHEET_EVENT,
                      diff,
                      baseSource: null,
                      nextSource,
                    },
                    baseItems: original.eventLists[SHEET_EVENT] as ReturnType<
                      typeof sheetItem
                    >[],
                    options: { acceptCsvExclusions: true },
                  });
                  if (!state) throw new Error("Update invalidated");
                  const next = { ...read.snapshot, ...state };
                  const validationErrors = validateSnapshotStructure(next);
                  if (validationErrors.length)
                    throw new Error(validationErrors.join("\n"));
                  await commands.commitApplicationSnapshotAtomically(next, {
                    expectedRoots: read.expectedRoots,
                  });
                  sample(
                    `update-${kind}-switch=${sourceSwitch}`,
                    count,
                    mode,
                    iteration,
                    start,
                    {
                      reviewMs,
                      saveMs: performance.now() - confirmedAt,
                      status: "ok",
                    },
                  );
                } catch (error) {
                  sample(
                    `update-${kind}-switch=${sourceSwitch}`,
                    count,
                    mode,
                    iteration,
                    start,
                    {
                      status: "failed",
                      error: (error as Error).message.slice(0, 100),
                    },
                  );
                  if (phase === "after") throw error;
                }
              }
            });
          }
        for (const state of [
          "B01",
          "B02",
          "B03",
          "B04",
          "B05",
          "B06",
          "undefined",
        ] as const) {
          it(`startup ${count} ${mode} ${state}`, async () => {
            for (let iteration = 0; iteration < repetitions; iteration++) {
              fresh();
              const data = sheetSnapshot(count);
              if (["B03", "B04", "B05", "B06", "undefined"].includes(state))
                for (const item of data.eventLists[SHEET_EVENT])
                  Object.assign(item, {
                    url: state === "undefined" ? undefined : "",
                  });
              await seed(data, !["B02", "B04", "B05", "B06"].includes(state));
              if (state === "B05") {
                const preCommands = port(mode);
                const preSetters = setters();
                const pre = renderHook(() =>
                  useIndexedDbPersistence({
                    values: {
                      ...emptyApplicationSnapshot(),
                      mapViewportSettings: {},
                    },
                    setters: preSetters,
                    persistenceCommands: preCommands,
                    externalMutations: true,
                  }),
                );
                await waitFor(
                  () =>
                    expect(pre.result.current.startupState.status).not.toBe(
                      "loading",
                    ),
                  options,
                );
                pre.unmount();
              }
              const commands = port(mode);
              const observed = vi.fn();
              const targetSetters = setters();
              const counter = commits();
              const snapshotRead = vi.spyOn(
                commands,
                "readApplicationSnapshot",
              );
              if (state === "B06") counter.failNext();
              const start = performance.now();
              const h = renderHook(() =>
                useIndexedDbPersistence({
                  values: {
                    ...emptyApplicationSnapshot(),
                    mapViewportSettings: {},
                  },
                  setters: targetSetters,
                  persistenceCommands: commands,
                  onHydratedSnapshot: observed,
                  externalMutations: true,
                }),
              );
              await waitFor(
                () =>
                  expect(h.result.current.startupState.status).not.toBe(
                    "loading",
                  ),
                options,
              );
              let failureMs = 0;
              if (
                state === "B06" &&
                h.result.current.startupState.status === "recovery-required"
              ) {
                failureMs = performance.now() - start;
                await act(async () => h.result.current.retryInitialization());
                await waitFor(
                  () => expect(h.result.current.isInitialized).toBe(true),
                  options,
                );
              }
              const status = h.result.current.startupState.status;
              sample(`startup-${state}`, count, mode, iteration, start, {
                status,
                failureMs,
                readCalls: snapshotRead.mock.calls.length,
                ...counter.result,
              });
              counter.stop();
              snapshotRead.mockRestore();
              h.unmount();
              if (phase === "after") {
                expect(status).toBe("ready");
                expect(
                  observed.mock.calls[0][0].snapshot.eventLists[
                    SHEET_EVENT
                  ].every(
                    (item: object) =>
                      !Object.prototype.hasOwnProperty.call(item, "url"),
                  ),
                ).toBe(true);
                if (["B01", "B05"].includes(state))
                  expect(counter.result.successes).toBe(0);
              }
            }
          });
        }
        for (const format of ["json", "xlsx"] as const)
          for (const blankUrl of [false, true]) {
            it(`restore ${count} ${mode} ${format} blank=${blankUrl}`, async () => {
              const data = sheetSnapshot(count);
              if (blankUrl)
                for (const item of data.eventLists[SHEET_EVENT])
                  Object.assign(item, { url: "" });
              const json = JSON.stringify({
                kind: "event-shopping-planner-backup",
                version: 2,
                exportedAt: "2026-10-17T00:00:00.000Z",
                data,
              });
              const file =
                format === "xlsx"
                  ? await exportToXlsx(
                      SHEET_EVENT,
                      data.eventLists[SHEET_EVENT] as ReturnType<
                        typeof sheetItem
                      >[],
                      {
                        includeItems: true,
                        includeLayoutInfo: true,
                        includeMapData: true,
                        includeRouteInfo: true,
                        format: "full",
                      },
                      { eventConsistency: data.eventConsistency },
                    )
                  : null;
              let bytes: ArrayBuffer | null = null;
              const fixturePath = join(
                process.env.SHEET_URL_FIXED_INPUT_DIR!,
                `restore-${count}-${mode}-blank=${blankUrl}.xlsx`,
              );
              if (format === "xlsx") {
                if (phase === "before") {
                  bytes =
                    typeof file!.arrayBuffer === "function"
                      ? await file!.arrayBuffer()
                      : await new Promise<ArrayBuffer>((resolve) => {
                          const reader = new FileReader();
                          reader.onload = () =>
                            resolve(reader.result as ArrayBuffer);
                          reader.readAsArrayBuffer(file!);
                        });
                  await writeFile(fixturePath, new Uint8Array(bytes));
                } else {
                  const buffer = await readFile(fixturePath);
                  bytes = new Uint8Array(buffer).buffer;
                }
              }
              console.log(
                "SHEET_URL_FIXTURE " +
                  JSON.stringify({
                    count,
                    format,
                    blankUrl,
                    sha256: createHash("sha256")
                      .update(bytes ? new Uint8Array(bytes) : json)
                      .digest("hex"),
                  }),
              );
              for (let iteration = 0; iteration < repetitions; iteration++) {
                fresh();
                const commands = port(mode);
                const initial = await commands.readApplicationSnapshot();
                const start = performance.now();
                const restored =
                  format === "json"
                    ? parseAppBackup(json)
                    : buildXlsxEventRestoreSource(
                        toImportedEventData(
                          await importFromXlsx(
                            new File([], "restore.xlsx"),
                            bytes!,
                          ),
                        ),
                      );
                if ("ok" in restored) expect(restored.ok).toBe(true);
                if (!restored.data) throw new Error("Restore failed");
                const parseMs = performance.now() - start;
                await commands.commitApplicationSnapshotAtomically(
                  restored.data,
                  { expectedRoots: initial.expectedRoots },
                );
                sample(
                  `restore-${format}-blank=${blankUrl}`,
                  count,
                  mode,
                  iteration,
                  start,
                  { parseMs, status: "ok" },
                );
              }
            });
          }
        for (const following of [false, true]) {
          it(`retry ${count} ${mode} following=${following}`, async () => {
            for (let iteration = 0; iteration < repetitions; iteration++) {
              fresh();
              await seed(sheetSnapshot(count));
              const commands = port(mode);
              const h = renderHook(() => {
                const application = useApplicationSnapshot(
                  commands,
                  SHEET_EVENT,
                  "1日目",
                );
                const persistence = useIndexedDbPersistence({
                  values: application.raw,
                  setters: application.hydrationSetters,
                  onHydratedSnapshot:
                    application.coordinator.initializeEventGenerations,
                  persistenceCommands: commands,
                  externalMutations: true,
                });
                application.handlers.current = {
                  drain: persistence.flushPendingSave,
                  observeSnapshot: persistence.observeSnapshot,
                  applied: persistence.acceptCommittedSnapshot,
                };
                return { application, persistence };
              });
              await waitFor(
                () =>
                  expect(h.result.current.persistence.isInitialized).toBe(true),
                options,
              );
              const fail = vi
                .spyOn(commands, "commitApplicationSnapshotAtomically")
                .mockRejectedValueOnce(
                  new DOMException("injected", "AbortError"),
                );
              act(() => {
                h.result.current.application.setters.setEventLists((lists) => ({
                  ...lists,
                  [SHEET_EVENT]: [
                    ...lists[SHEET_EVENT],
                    { ...sheetItem(count), url: "" },
                  ],
                }));
              });
              await waitFor(
                () =>
                  expect(
                    h.result.current.application.retryableFailures.length +
                      h.result.current.application.confirmations.length,
                  ).toBeGreaterThan(0),
                options,
              );
              if (h.result.current.application.confirmations.length) {
                act(() =>
                  h.result.current.application.confirm(
                    h.result.current.application.confirmations[0].token,
                  ),
                );
              }
              await waitFor(
                () =>
                  expect(
                    h.result.current.application.retryableFailures.length,
                  ).toBe(1),
                options,
              );
              if (following)
                act(() =>
                  h.result.current.application.updateItemFields({
                    eventName: SHEET_EVENT,
                    itemId: "item-0",
                    changes: { remarks: "後続の編集" },
                    baseline: sheetItem(0),
                  }),
                );
              const start = performance.now();
              act(() => h.result.current.application.retryPending());
              await waitFor(
                () =>
                  expect(
                    h.result.current.application.pendingCount === 0 ||
                      h.result.current.application.confirmations.length > 0,
                  ).toBe(true),
                options,
              );
              const replanMs = performance.now() - start;
              if (h.result.current.application.confirmations.length)
                act(() =>
                  h.result.current.application.confirm(
                    h.result.current.application.confirmations[0].token,
                  ),
                );
              await waitFor(
                () => expect(h.result.current.application.pendingCount).toBe(0),
                options,
              );
              sample(
                `retry-following=${following}`,
                count,
                mode,
                iteration,
                start,
                {
                  status: "ok",
                  replanMs,
                  saveMs: performance.now() - start - replanMs,
                },
              );
              fail.mockRestore();
              h.unmount();
            }
          });
        }
      }
    }
  },
);
