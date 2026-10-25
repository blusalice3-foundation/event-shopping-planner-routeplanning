import { describe, expect, it } from "vitest";
import { createPrivateSnapshotFreezer } from "./privateSnapshotFreeze";

function fixture() {
  const borders = { top: null, right: null, bottom: null, left: null };
  const cell = { row: 1, col: 1, value: null, borders };
  const map = {
    cells: [cell],
    blocks: [],
    mergedCells: [],
    maxRow: 1,
    maxCol: 1,
  };
  const item = {
    id: "a",
    title: "ユーザー登録",
    remarks: "エラーが発生しました",
    url: undefined,
  };
  return {
    map,
    cell,
    borders,
    item,
    snapshot: {
      eventLists: { event: [item] },
      mapData: { event: { " 1日目　マップ": map } },
    },
  };
}

describe("private snapshot freeze witnesses", () => {
  it("retains private witnesses for map descendants and items in separate partitions", () => {
    const { snapshot, map, cell, borders, item } = fixture();
    const freezer = createPrivateSnapshotFreezer();
    freezer.freeze(snapshot);
    for (const value of [
      snapshot,
      snapshot.mapData,
      snapshot.mapData.event,
      map,
      map.cells,
      cell,
      borders,
      item,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(freezer.has(map)).toBe(true);
    expect(freezer.has(snapshot.mapData.event)).toBe(true);
    expect(freezer.has(snapshot.eventLists.event)).toBe(true);
    expect(freezer.has(item)).toBe(true);
    for (const value of [map.cells, map.blocks, map.mergedCells, cell, borders])
      expect(freezer.has(value)).toBe(true);
    expect(Object.keys(snapshot.mapData.event)).toEqual([" 1日目　マップ"]);
    expect(Object.prototype.hasOwnProperty.call(item, "url")).toBe(true);
  });

  it("does not accept a caller's shallow Object.freeze as deep-freeze evidence", () => {
    const { snapshot, map, cell } = fixture();
    Object.freeze(map);
    const freezer = createPrivateSnapshotFreezer();
    expect(freezer.has(map)).toBe(false);
    expect(Object.isFrozen(cell)).toBe(false);
    freezer.freeze(snapshot);
    expect(Object.isFrozen(cell)).toBe(true);
    expect(freezer.has(map)).toBe(true);
    expect(createPrivateSnapshotFreezer().has(map)).toBe(false);
  });

  it("reuses each unchanged map root while freezing a replacement map independently", () => {
    let reads = 0;
    const unchanged = new Proxy(
      { cells: [{ row: 1, col: 1 }] },
      {
        ownKeys(target) {
          reads++;
          return Reflect.ownKeys(target);
        },
      },
    );
    const previous = { cells: [{ row: 2, col: 1 }] };
    const freezer = createPrivateSnapshotFreezer();
    freezer.freeze({ mapData: { event: { unchanged, edited: previous } } });
    const originalReads = reads;
    const replacement = { cells: [{ row: 2, col: 2 }] };
    const next = {
      mapData: {
        renamedEvent: { "raw map key": unchanged, edited: replacement },
      },
    };
    freezer.freeze(next);
    expect(reads).toBe(originalReads);
    expect(freezer.has(unchanged)).toBe(true);
    expect(freezer.has(replacement)).toBe(true);
    expect(Object.isFrozen(replacement.cells[0])).toBe(true);
    expect(freezer.has(replacement.cells[0])).toBe(true);
    expect(previous.cells[0].col).toBe(1);
    expect(Object.keys(next.mapData.renamedEvent)).toEqual([
      "raw map key",
      "edited",
    ]);
  });

  it("handles geometry cycles and preserves item markers for geometry/item aliases", () => {
    const { snapshot, map, cell, item } = fixture();
    Object.assign(map, { self: map, itemAlias: item });
    Object.assign(cell, { mapAlias: map });
    const freezer = createPrivateSnapshotFreezer();
    freezer.freeze(snapshot);
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(cell)).toBe(true);
    expect(Object.isFrozen(item)).toBe(true);
    expect(freezer.has(map)).toBe(true);
    expect(freezer.has(cell)).toBe(true);
    expect(freezer.has(item)).toBe(true);
  });

  it("handles cycles between distinct map roots while retaining private cell witnesses", () => {
    const first = { cells: [{ row: 1 }] };
    const second = { cells: [{ row: 2 }] };
    Object.assign(first, { peer: second });
    Object.assign(second, { peer: first });
    const freezer = createPrivateSnapshotFreezer();
    freezer.freeze({ mapData: { event: { first, second } } });
    expect(freezer.has(first)).toBe(true);
    expect(freezer.has(second)).toBe(true);
    expect(freezer.has(first.cells[0])).toBe(true);
    expect(freezer.has(second.cells[0])).toBe(true);
    expect(Object.isFrozen(second.cells[0])).toBe(true);
  });

  it("publishes no failed map witness and can retry after a partial freeze", () => {
    const first = { value: 1 };
    let fail = true;
    const failing = new Proxy(
      { value: 2 },
      {
        preventExtensions(target) {
          if (fail) throw new Error("freeze interrupted");
          return Reflect.preventExtensions(target);
        },
      },
    );
    const map = { cells: [first, failing] };
    const snapshot = { mapData: { event: { map } } };
    const freezer = createPrivateSnapshotFreezer();
    expect(() => freezer.freeze(snapshot)).toThrow("freeze interrupted");
    expect(Object.isFrozen(first)).toBe(true);
    expect(freezer.has(map)).toBe(false);
    expect(freezer.has(first)).toBe(false);
    expect(freezer.has(snapshot)).toBe(false);
    fail = false;
    freezer.freeze(snapshot);
    expect(freezer.has(map)).toBe(true);
    expect(Object.isFrozen(failing)).toBe(true);
    expect(freezer.has(failing)).toBe(true);
  });

  it("does not publish cyclic ordinary values when a later parent freeze fails", () => {
    const child: { parent?: object } = {};
    let fail = true;
    const parent = new Proxy(
      { child },
      {
        preventExtensions(target) {
          if (fail) throw new Error("parent interrupted");
          return Reflect.preventExtensions(target);
        },
      },
    );
    child.parent = parent;
    const snapshot = { mapData: {}, parent };
    const freezer = createPrivateSnapshotFreezer();
    expect(() => freezer.freeze(snapshot)).toThrow("parent interrupted");
    expect(Object.isFrozen(child)).toBe(true);
    expect(freezer.has(child)).toBe(false);
    expect(freezer.has(parent)).toBe(false);
    fail = false;
    freezer.freeze(snapshot);
    expect(freezer.has(child)).toBe(true);
    expect(freezer.has(parent)).toBe(true);
    expect(freezer.has(snapshot)).toBe(true);
  });

  it("keeps non-map values deeply frozen and individually marked", () => {
    const item = { id: "a", nested: { value: "メモ" } };
    const snapshot = { eventLists: { event: [item] } };
    const freezer = createPrivateSnapshotFreezer();
    freezer.freeze(snapshot);
    expect(freezer.has(item)).toBe(true);
    expect(freezer.has(item.nested)).toBe(true);
    expect(Object.isFrozen(item.nested)).toBe(true);
    expect(() => {
      item.nested.value = "changed";
    }).toThrow();
  });
  it("returns at the trusted snapshot boundary without enumerating maps again", () => {
    let reads = 0;
    const mapData = new Proxy(
      { event: { map: { cells: [{ row: 1 }] } } },
      {
        ownKeys(target) {
          reads++;
          return Reflect.ownKeys(target);
        },
      },
    );
    const snapshot = { mapData };
    const freezer = createPrivateSnapshotFreezer();
    freezer.freeze(snapshot);
    const initialReads = reads;
    freezer.freeze(snapshot);
    expect(reads).toBe(initialReads);
    expect(freezer.has(snapshot)).toBe(true);
  });

  it("reuses private descendant witnesses across a partial map-root replacement", () => {
    let reads = 0;
    const shared = new Proxy(
      { row: 1, col: 1, borders: { top: null } },
      {
        ownKeys(target) {
          reads++;
          return Reflect.ownKeys(target);
        },
      },
    );
    const previous = { cells: [shared, { row: 1, col: 2 }] };
    const freezer = createPrivateSnapshotFreezer();
    freezer.freeze({ mapData: { event: { map: previous } } });
    const initialReads = reads;
    const edited = { row: 1, col: 3 };
    const replacement = { cells: [shared, edited] };
    freezer.freeze({ mapData: { event: { map: replacement } } });
    expect(reads).toBe(initialReads);
    expect(freezer.has(shared)).toBe(true);
    expect(freezer.has(replacement)).toBe(true);
    expect(freezer.has(edited)).toBe(true);
    expect(Object.isFrozen(edited)).toBe(true);
    expect(previous.cells[1].col).toBe(2);
  });

  it("retains previous witnesses when a different newly captured map graph fails", () => {
    const { snapshot, map, cell, item } = fixture();
    const freezer = createPrivateSnapshotFreezer();
    freezer.freeze(snapshot);
    const failing = new Proxy(
      { cells: [{ row: 2 }] },
      {
        preventExtensions() {
          throw new Error("new map interrupted");
        },
      },
    );
    const next = { mapData: { event: { old: map, replacement: failing } } };
    expect(() => freezer.freeze(next)).toThrow("new map interrupted");
    expect(freezer.has(map)).toBe(true);
    expect(freezer.has(cell)).toBe(true);
    expect(freezer.has(item)).toBe(true);
    expect(freezer.has(failing)).toBe(false);
    expect(freezer.has(failing.cells[0])).toBe(false);
    expect(freezer.has(next)).toBe(false);
  });
});
