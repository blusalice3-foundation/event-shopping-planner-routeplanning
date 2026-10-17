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

import type { ApplicationSnapshotRead } from "../app/ports/PersistenceCommandPort";
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

type StageEntry = { stage: string; startMs: number; endMs: number };
const stages: StageEntry[] = [];
function beginStages() {
  stages.length = 0;
  vi.stubGlobal(
    "__sheetUrlStageObserver",
    (stage: string, startMs: number, endMs: number) => {
      stages.push({ stage, startMs, endMs });
    },
  );
}
function stageSummary() {
  const result: Record<
    string,
    { calls: number; inclusiveMs: number; exclusiveMs: number }
  > = {};
  for (const entry of stages) {
    const value = (result[entry.stage] ??= {
      calls: 0,
      inclusiveMs: 0,
      exclusiveMs: 0,
    });
    value.calls++;
    value.inclusiveMs += entry.endMs - entry.startMs;
    let cursor = entry.startMs;
    let childMs = 0;
    const children = stages
      .filter(
        (child) =>
          child !== entry &&
          child.startMs >= entry.startMs &&
          child.endMs <= entry.endMs,
      )
      .sort((a, b) => a.startMs - b.startMs);
    for (const child of children) {
      childMs += Math.max(0, child.endMs - Math.max(cursor, child.startMs));
      cursor = Math.max(cursor, child.endMs);
    }
    value.exclusiveMs += entry.endMs - entry.startMs - childMs;
  }
  return result;
}
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
  // Refuse timings from the ordinary, uninstrumented Vitest config.
  if (process.env.SHEET_URL_REQUIRE_STAGES === "1" && !key.startsWith("retry"))
    expect(
      stages.length,
      "Use vitest.sheet-url-measurement.config.ts",
    ).toBeGreaterThan(0);
  console.log(
    "SHEET_URL_SAMPLE " +
      JSON.stringify({
        phase,
        key,
        count,
        mode,
        iteration,
        durationMs: performance.now() - start,
        stages: stageSummary(),
        stageSpans: stages,
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
              beginStages();
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
                beginStages();
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
              let hydrationAt: number | null = null;
              const observed = vi.fn((_read: ApplicationSnapshotRead) => {
                hydrationAt = performance.now();
              });
              const targetSetters = setters();
              const counter = commits();
              const readSpans: Array<{ startMs: number; endMs: number }> = [];
              const readSnapshot =
                commands.readApplicationSnapshot.bind(commands);
              const snapshotRead = vi
                .spyOn(commands, "readApplicationSnapshot")
                .mockImplementation(async (...args) => {
                  const startMs = performance.now();
                  try {
                    return await readSnapshot(...args);
                  } finally {
                    readSpans.push({ startMs, endMs: performance.now() });
                  }
                });
              if (state === "B06") counter.failNext();
              beginStages();
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
                initialReadMs: readSpans[0].endMs - readSpans[0].startMs,
                rereadMs: readSpans
                  .slice(1)
                  .reduce((sum, span) => sum + span.endMs - span.startMs, 0),
                readSpans,
                hookScreenApplyMs:
                  hydrationAt === null ? null : performance.now() - hydrationAt,
                preparationAttemptMs: counter.result.transactions
                  .filter((tx) =>
                    readSpans.some(
                      (read) =>
                        tx.startMs >= read.startMs && tx.endMs <= read.endMs,
                    ),
                  )
                  .reduce((sum, tx) => sum + tx.endMs - tx.startMs, 0),
                compatibilityAttemptMs: counter.result.transactions
                  .filter(
                    (tx) =>
                      !readSpans.some(
                        (read) =>
                          tx.startMs >= read.startMs && tx.endMs <= read.endMs,
                      ),
                  )
                  .reduce((sum, tx) => sum + tx.endMs - tx.startMs, 0),
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
                    (item: unknown) =>
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
                if (
                  phase === "before" &&
                  process.env.SHEET_URL_REUSE_FIXED_INPUTS !== "1"
                ) {
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
                const inputFile = new File(
                  [bytes ?? json],
                  `restore.${format}`,
                );
                beginStages();
                const start = performance.now();
                const loaded = await new Promise<string | ArrayBuffer>(
                  (resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () =>
                      resolve(reader.result as string | ArrayBuffer);
                    reader.onerror = () => reject(reader.error);
                    if (format === "json") reader.readAsText(inputFile);
                    else reader.readAsArrayBuffer(inputFile);
                  },
                );
                const fileReadMs = performance.now() - start;
                const restored =
                  format === "json"
                    ? parseAppBackup(loaded)
                    : buildXlsxEventRestoreSource(
                        toImportedEventData(
                          await importFromXlsx(
                            inputFile,
                            loaded as ArrayBuffer,
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
                  {
                    fileReadMs,
                    parseMs: parseMs - fileReadMs,
                    saveMs: performance.now() - start - parseMs,
                    status: "ok",
                  },
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
              beginStages();
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
