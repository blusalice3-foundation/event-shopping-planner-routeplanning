// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createUnsavedChangesWriter,
  readUnsavedChanges,
  discardUnsavedChanges,
  parseUnsavedChanges,
  unsavedSnapshotChanges,
} from "./unsavedChangesJournal";
import { emptyApplicationSnapshot } from "../app/state/useApplicationSnapshot";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("unsaved changes checkpoints", () => {
  it("stores only changed event values and a new writer never removes earlier rescue records", () => {
    const base = emptyApplicationSnapshot();
    const desired = {
      ...base,
      dayModes: { event: { day: "execute" as const } },
    };
    const changes = unsavedSnapshotChanges(base, desired);
    expect(changes).toEqual([
      {
        store: "dayModes",
        eventName: "event",
        baseline: undefined,
        desired: { day: "execute" },
      },
    ]);
    const old = createUnsavedChangesWriter("application");
    expect(old.write([{ id: "old", changes, canResume: false }])).toBe(true);
    const fresh = createUnsavedChangesWriter("application");
    expect(fresh.write([])).toBe(true);
    expect(readUnsavedChanges()).toHaveLength(1);
    expect(fresh.write([{ id: "new", changes, canResume: false }])).toBe(true);
    expect(fresh.write([])).toBe(true);
    expect(readUnsavedChanges()).toHaveLength(1);
    expect(readUnsavedChanges()[0].record?.operations[0].id).toBe("old");
  });
  it("preserves malformed records for read-only export and rejects unexpected store names", () => {
    localStorage.setItem("esp-unsaved-changes-v1:broken", "broken rescue data");
    expect(readUnsavedChanges()[0]).toMatchObject({
      text: "broken rescue data",
      record: null,
    });
    expect(
      parseUnsavedChanges(
        JSON.stringify({
          format: "event-shopping-planner-unsaved-changes",
          version: 1,
          recordedAt: "now",
          source: "application",
          operations: [
            {
              id: "x",
              changes: [{ store: "__proto__", eventName: "x" }],
              canResume: true,
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(discardUnsavedChanges("other-key")).toBe(false);
  });
  it("reports storage failures and keeps an earlier successful checkpoint", () => {
    const writer = createUnsavedChangesWriter("application");
    writer.write([{ id: "x", changes: [], canResume: false }]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(writer.write([{ id: "new", changes: [], canResume: false }])).toBe(
      false,
    );
    expect(readUnsavedChanges()[0].record?.operations[0].id).toBe("x");
  });
});

it("admits ordinary 500-item edits while rejecting a 150000-cell map before traversing its cells or touching storage", () => {
  const writer = createUnsavedChangesWriter("application");
  const items = Array.from({ length: 500 }, (_, index) => ({
    id: String(index),
    eventDate: "1日目",
    circle: "ユーザー登録",
    title: "通常品目",
    block: "A",
    number: String(index),
    price: 500,
    quantity: 1,
    purchaseStatus: "None",
    remarks: "エラーが発生しました",
  }));
  expect(
    writer.write([
      {
        id: "normal",
        changes: [
          {
            store: "eventLists",
            eventName: "event",
            baseline: items,
            desired: items.map((item, index) =>
              index === 0 ? { ...item, quantity: 2 } : item,
            ),
          },
        ],
        canResume: true,
      },
    ]),
  ).toBe(true);
  const existing = readUnsavedChanges()[0].text;
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  let visitedCells = 0;
  const cells = new Array(150_000);
  Object.defineProperty(cells, 0, {
    get() {
      visitedCells++;
      throw new Error("huge cell traversal");
    },
  });
  expect(
    writer.write([
      {
        id: "huge",
        changes: [
          {
            store: "mapData",
            eventName: "event",
            desired: { map1: { cells }, map2: { cells } },
          },
        ],
        canResume: false,
      },
    ]),
  ).toBe(false);
  expect(visitedCells).toBe(0);
  expect(setItem).not.toHaveBeenCalled();
  expect(readUnsavedChanges()[0].text).toBe(existing);
});
it("bounds comparison of cloned large maps instead of walking all historical cells", () => {
  let reads = 0;
  const makeCells = () =>
    Array.from({ length: 150_000 }, () => ({
      get row() {
        reads++;
        return 1;
      },
    }));
  const baseline = {
    ...emptyApplicationSnapshot(),
    mapData: { event: { map1: { cells: makeCells() } } },
  };
  const desired = {
    ...emptyApplicationSnapshot(),
    mapData: { event: { map1: { cells: makeCells() } } },
  };
  expect(
    unsavedSnapshotChanges(baseline as never, desired as never),
  ).toHaveLength(1);
  expect(reads).toBeLessThan(50_000);
});
it("rejects an oversized primitive before replacing a successful checkpoint", () => {
  const writer = createUnsavedChangesWriter("application");
  writer.write([{ id: "prior", changes: [], canResume: false }]);
  const existing = readUnsavedChanges()[0].text;
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  expect(
    writer.write([
      {
        id: "large-string",
        changes: [],
        input: "x".repeat(2 * 1024 * 1024),
        canResume: false,
      },
    ]),
  ).toBe(false);
  expect(setItem).not.toHaveBeenCalled();
  expect(readUnsavedChanges()[0].text).toBe(existing);
});

it("rejects more than 100 operations before reading their payloads and retains the last valid record", () => {
  const writer = createUnsavedChangesWriter("application");
  writer.write([{ id: "prior", changes: [], canResume: false }]);
  const existing = readUnsavedChanges()[0].text;
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  let reads = 0;
  const operation = {
    id: "over-limit",
    get changes() {
      reads++;
      throw new Error("must not inspect inputs");
    },
    canResume: false,
  };
  expect(writer.write(new Array(101).fill(operation))).toBe(false);
  expect(reads).toBe(0);
  expect(setItem).not.toHaveBeenCalled();
  expect(readUnsavedChanges()[0].text).toBe(existing);
});
