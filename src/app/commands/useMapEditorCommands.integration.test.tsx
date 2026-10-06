import { act, renderHook } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PersistenceCommandPort,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "../state/useApplicationSnapshot";
import { migrateLegacyConsistency } from "../../features/consistency/domain/migration";
import {
  readApplicationSnapshot,
  commitApplicationSnapshotAtomically,
} from "../../persistence/db/atomicRestoreTransaction";
import { resetDatabaseConnection } from "../../persistence/db/openDatabase";
import type { ShoppingItem } from "../../types/item";
import { getMaplessKey } from "../../types/map";
import {
  useMapEditorCommands,
  type MapEditorActionPort,
  type MapEditorCommands,
} from "./useMapEditorCommands";

const EVENT = "購入記録の整合性";
const DAY = "1日目";
const MAP = `${DAY}マップ`;
const OTHER_DAY = "2日目";
const OTHER_MAP = `${OTHER_DAY}マップ`;
const purchase = {
  purchaseStatus: "Purchased",
  price: 900,
  quantity: 2,
  remarks: "新しいメモ",
} as const;
const item = (id: string, eventDate = DAY): ShoppingItem => ({
  id,
  eventDate,
  circle: `サークル${id}`,
  title: `頒布物${id}`,
  block: "A",
  number: id,
  purchaseStatus: "None",
  price: 500,
  quantity: 1,
  remarks: "元のメモ",
  priorityLevel: "none",
});
const hall = {
  id: "hall",
  name: "東館",
  vertices: [
    { row: 0, col: 0 },
    { row: 0, col: 5 },
    { row: 5, col: 5 },
    { row: 5, col: 0 },
  ],
};
const simpleHall = {
  id: "simple",
  name: "簡易ホール",
  vertices: [],
  blockNames: ["A"],
};
const map = {
  maxRow: 6,
  maxCol: 6,
  cells: [],
  mergedCells: [],
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 5,
      endCol: 5,
      numberCells: [
        { row: 1, col: 1, value: 1 },
        { row: 2, col: 1, value: 2 },
      ],
    },
  ],
};

beforeEach(() => {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
});
afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function harness(mapless = false) {
  const { eventConsistency: _consistency, ...empty } =
    emptyApplicationSnapshot();
  let seed = migrateLegacyConsistency({
    ...empty,
    eventLists: { [EVENT]: [item("1"), item("2"), item("3", OTHER_DAY)] },
    executeModeItems: { [EVENT]: { [DAY]: ["1", "2"], [OTHER_DAY]: ["3"] } },
    dayModes: { [EVENT]: { [DAY]: "execute", [OTHER_DAY]: "execute" } },
    mapData: { [EVENT]: mapless ? {} : { [MAP]: map, [OTHER_MAP]: map } },
    hallDefinitions: {
      [EVENT]: {
        ...(mapless ? {} : { [MAP]: [hall], [OTHER_MAP]: [hall] }),
        [getMaplessKey(DAY)]: [simpleHall],
        [getMaplessKey(OTHER_DAY)]: [simpleHall],
      },
    },
    hallRouteSettings: {
      [EVENT]: mapless
        ? {}
        : {
            [MAP]: {
              hallOrder: ["hall"],
              hallVisitLists: [{ hallId: "hall", itemIds: ["1", "2"] }],
            },
          },
    },
  }).data;
  const first = await readApplicationSnapshot();
  await commitApplicationSnapshotAtomically(seed, {
    expectedRoots: first.expectedRoots,
  });
  seed = (await readApplicationSnapshot()).snapshot;
  const commit = vi.fn(commitApplicationSnapshotAtomically);
  const applied = vi.fn();
  const port = {
    readApplicationSnapshot,
    commitApplicationSnapshotAtomically: commit,
    bindApplicationSettings: () => () => {},
  } as unknown as PersistenceCommandPort;
  let application!: ReturnType<typeof useApplicationSnapshot>;
  const executeModeItemsRef = { current: seed.executeModeItems };
  const actions: MapEditorActionPort = {
    setEventLists: vi.fn((action) => application.setters.setEventLists(action)),
    setMapData: vi.fn((action) => application.setters.setMapData(action)),
    setHallDefinitions: vi.fn((action) =>
      application.setters.setHallDefinitions(action),
    ),
    setHallRouteSettings: vi.fn((action) =>
      application.setters.setHallRouteSettings(action),
    ),
    updateExecuteModeItems: vi.fn((action) =>
      application.setters.setExecuteModeItems(action),
    ),
    commitExecuteModeItemsForEvent: vi.fn(),
    setNewItemDefaults: vi.fn(),
    setItemToEdit: vi.fn(),
    navigation: { showImport: vi.fn() },
    startCellSelection: vi.fn(),
    toggleCellSelection: vi.fn(),
    finishCellSelection: vi.fn(),
    startVertexSelection: vi.fn(),
    toggleVertexSelection: vi.fn(),
    finishVertexSelection: vi.fn(),
  };
  const hook = renderHook(() => {
    application = useApplicationSnapshot(port, EVENT, DAY);
    application.handlers.current.applied = applied;
    const values = application.values;
    executeModeItemsRef.current = values.executeModeItems;
    const commands = useMapEditorCommands({
      state: {
        ...values,
        activeEventName: EVENT,
        activeEventDate: DAY,
        isMapTab: true,
        currentMapTabName: MAP,
        currentMapData: values.mapData[EVENT]?.[MAP],
        items: values.eventLists[EVENT] ?? [],
        executeModeItemsRef,
        visitListPanelMapTab: MAP,
        cellSelectionMode: null,
        vertexSelectionMode: null,
      },
      actions,
      selectors: {
        getMapTabForDate: (date) =>
          mapless ? null : date === DAY ? MAP : OTHER_MAP,
        getItemHallId: () =>
          mapless
            ? null
            : (values.hallDefinitions[EVENT]?.[MAP]?.[0]?.id ?? null),
        areItemsInSameHallGroup: () => true,
      },
      effects: { selectionEventTarget: window, notify: vi.fn() },
      persistence: { commitApplicationSnapshotPatch: application.commitPatch },
    });
    return { application, commands };
  });
  act(() => {
    const setters = hook.result.current.application.hydrationSetters;
    for (const [key, value] of Object.entries(seed)) {
      const setter =
        `set${key[0].toUpperCase()}${key.slice(1)}` as keyof typeof setters;
      setters[setter](value as never);
    }
  });
  async function otherTab(update: (snapshot: PersistenceSnapshot) => void) {
    const latest = await readApplicationSnapshot();
    update(latest.snapshot);
    await commitApplicationSnapshotAtomically(latest.snapshot, {
      expectedRoots: latest.expectedRoots,
    });
  }
  return { ...hook, commit, applied, actions, otherTab };
}

const priorityCases = [
  { command: "handleUpdateItemPriority", mapless: false },
  { command: "handleUpdateItemPriorityFromEdit", mapless: false },
  { command: "handleUpdateItemPriorityFromEdit", mapless: true },
] as const;

describe("map editor commits through the application coordinator", () => {
  it.each(priorityCases)(
    "$command (mapless=$mapless) preserves another tab's purchases with one save and application",
    async ({ command, mapless }) => {
      const h = await harness(mapless);
      await h.otherTab((snapshot) => {
        Object.assign(snapshot.eventLists[EVENT][0] as ShoppingItem, purchase);
        Object.assign(snapshot.eventLists[EVENT][1] as ShoppingItem, {
          ...purchase,
          remarks: "別品目の最新メモ",
        });
      });
      await act(async () => {
        await h.result.current.commands[command]("1", "highest");
        await h.result.current.application.flush();
      });
      const durable = (await readApplicationSnapshot()).snapshot;
      expect(h.result.current.application.failure).toBeNull();
      expect(h.result.current.application.raw).toEqual(durable);
      expect(
        h.result.current.application.values.eventLists[EVENT][0],
      ).toMatchObject({ ...purchase, priorityLevel: "highest" });
      expect(durable.eventLists[EVENT][0]).toMatchObject({
        ...purchase,
        priorityLevel: "highest",
      });
      expect(durable.eventLists[EVENT][1]).toMatchObject({
        ...purchase,
        remarks: "別品目の最新メモ",
      });
      expect(
        await h.result.current.application.coordinator.readExportSnapshot(),
      ).toEqual(durable);
      expect(h.commit).toHaveBeenCalledOnce();
      expect(h.applied).toHaveBeenCalledOnce();
      expect(h.actions.setEventLists).not.toHaveBeenCalled();
      expect(h.actions.setHallRouteSettings).not.toHaveBeenCalled();
      expect(h.actions.updateExecuteModeItems).not.toHaveBeenCalled();
      expect(h.result.current.application.confirmations).toEqual([]);
    },
  );

  it.each(priorityCases)(
    "$command (mapless=$mapless) recalculates a CAS conflict without replaying the stale draft",
    async ({ command, mapless }) => {
      const h = await harness(mapless);
      h.commit.mockImplementationOnce(async (snapshot, options) => {
        await h.otherTab((latest) =>
          Object.assign(latest.eventLists[EVENT][0] as ShoppingItem, purchase),
        );
        await commitApplicationSnapshotAtomically(snapshot, options);
      });
      await act(async () => {
        await h.result.current.commands[command]("1", "highest");
        await h.result.current.application.flush();
      });
      expect(
        (await readApplicationSnapshot()).snapshot.eventLists[EVENT][0],
      ).toMatchObject({ ...purchase, priorityLevel: "highest" });
      expect(
        h.result.current.application.values.eventLists[EVENT][0],
      ).toMatchObject({ ...purchase, priorityLevel: "highest" });
      expect(h.commit).toHaveBeenCalledTimes(2);
      expect(h.applied).toHaveBeenCalledOnce();
    },
  );

  it.each(priorityCases)(
    "$command (mapless=$mapless) leaves the screen unchanged on an aborted save",
    async ({ command, mapless }) => {
      const h = await harness(mapless);
      const before = structuredClone(h.result.current.application.raw);
      h.commit.mockRejectedValueOnce(new Error("transaction aborted"));
      await act(async () => {
        await h.result.current.commands[command]("1", "highest");
        await h.result.current.application.flush();
      });
      expect(h.result.current.application.raw).toEqual(before);
      expect((await readApplicationSnapshot()).snapshot).toEqual(before);
      expect(h.commit).toHaveBeenCalledOnce();
      expect(h.applied).not.toHaveBeenCalled();
      expect(h.result.current.application.failure).toBe("transaction aborted");
    },
  );

  it("keeps a purchase accepted while the priority write is pending", async () => {
    const h = await harness();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.commit.mockImplementationOnce(async (snapshot, options) => {
      await barrier;
      await commitApplicationSnapshotAtomically(snapshot, options);
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = Promise.resolve(
        h.result.current.commands.handleUpdateItemPriority("1", "highest"),
      );
    });
    act(() => {
      h.result.current.application.setters.setEventLists((current) => ({
        ...current,
        [EVENT]: current[EVENT].map((value) =>
          value.id === "1" ? { ...value, ...purchase } : value,
        ),
      }));
    });
    await act(async () => {
      release();
      await pending;
      await h.result.current.application.flush();
    });
    expect(
      (await readApplicationSnapshot()).snapshot.eventLists[EVENT][0],
    ).toMatchObject({ ...purchase, priorityLevel: "highest" });
    expect(
      h.result.current.application.values.eventLists[EVENT][0],
    ).toMatchObject({ ...purchase, priorityLevel: "highest" });
    expect(h.commit).toHaveBeenCalledTimes(2);
    expect(h.applied).toHaveBeenCalledTimes(2);
  });

  it.each([
    "handleUpdateHalls",
    "handleUpdateMaplessHalls",
    "handleSyncMaplessHallsToOtherDates",
    "handleSyncPolygonHallsToOtherDates",
  ] as const)(
    "%s keeps unrelated settings from another tab and applies one committed snapshot",
    async (command) => {
      const h = await harness();
      const sourceDay = structuredClone(
        h.result.current.application.raw.eventConsistency[EVENT].days[DAY],
      );
      await h.otherTab((snapshot) => {
        snapshot.mapData[EVENT]["別マップ"] = structuredClone(map);
        snapshot.hallDefinitions[EVENT]["別マップ"] = [
          { ...hall, name: "最新のホール" },
        ];
        snapshot.eventMetadata[EVENT] = {
          spreadsheetUrl: "",
          spreadsheetSheetName: "最新設定",
          lastImportDate: "2026-10-04",
        };
      });
      let pending!: Promise<void>;
      act(() => {
        pending = (async () => {
          const commands: MapEditorCommands = h.result.current.commands;
          if (command === "handleUpdateHalls") {
            await commands[command](
              h.result.current.application.values.hallDefinitions[EVENT][MAP],
            );
          } else if (command === "handleUpdateMaplessHalls") {
            await commands[command](
              h.result.current.application.values.hallDefinitions[EVENT][
                getMaplessKey(DAY)
              ],
            );
          } else {
            await commands[command]([OTHER_DAY]);
          }
        })();
      });
      await act(async () => {
        await h.result.current.application.coordinator.enqueue(() => undefined);
      });
      for (
        let attempt = 0;
        attempt < 3 && h.result.current.application.confirmations.length;
        attempt++
      ) {
        await act(async () => {
          h.result.current.application.confirm(
            h.result.current.application.confirmations[0].token,
          );
          await h.result.current.application.coordinator.enqueue(
            () => undefined,
          );
        });
      }
      expect(h.result.current.application.confirmations).toEqual([]);
      await act(async () => {
        await pending;
        await h.result.current.application.flush();
      });
      const durable = (await readApplicationSnapshot()).snapshot;
      expect(h.result.current.application.failure).toBeNull();
      expect(h.result.current.application.raw).toEqual(durable);
      expect(durable.eventMetadata[EVENT]).toEqual({
        spreadsheetUrl: "",
        spreadsheetSheetName: "最新設定",
        lastImportDate: "2026-10-04",
      });
      expect(durable.hallDefinitions[EVENT]["別マップ"]).toEqual([
        { ...hall, name: "最新のホール" },
      ]);
      expect(h.commit).toHaveBeenCalledOnce();
      expect(h.applied).toHaveBeenCalledOnce();
      if (command === "handleSyncPolygonHallsToOtherDates") {
        expect(durable.eventConsistency[EVENT].days[DAY]).toEqual(sourceDay);
        const target =
          durable.eventConsistency[EVENT].days[OTHER_DAY].maps[OTHER_MAP];
        expect(target.hallOrder.filter((group) => group.hall)).toEqual([
          {
            hall: {
              kind: "map",
              mapKey: OTHER_MAP,
              hallId: (
                durable.hallDefinitions[EVENT][OTHER_MAP][0] as { id: string }
              ).id,
            },
            priority: "none",
          },
        ]);
      } else if (command === "handleSyncMaplessHallsToOtherDates") {
        expect(durable.eventConsistency[EVENT].days[DAY]).toEqual(sourceDay);
        expect(
          durable.eventConsistency[EVENT].days[OTHER_DAY].mapless,
        ).not.toBeNull();
        expect(
          durable.hallDefinitions[EVENT][getMaplessKey(OTHER_DAY)][0],
        ).not.toEqual(simpleHall);
      }
      expect(h.actions.setHallDefinitions).not.toHaveBeenCalled();
      expect(h.actions.setHallRouteSettings).not.toHaveBeenCalled();
    },
  );
});

it.each(priorityCases)(
  "$command (mapless=$mapless) preserves a purchase accepted before the priority change while saving",
  async ({ command, mapless }) => {
    const h = await harness(mapless);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.commit.mockImplementationOnce(async (snapshot, options) => {
      await barrier;
      await commitApplicationSnapshotAtomically(snapshot, options);
    });
    const commandsFromPreviousRender = h.result.current.commands;
    act(() => {
      h.result.current.application.setters.setEventLists((previous) => ({
        ...previous,
        [EVENT]: previous[EVENT].map((entry) =>
          entry.id === "1" ? { ...entry, ...purchase } : entry,
        ),
      }));
    });
    await vi.waitFor(() => expect(h.commit).toHaveBeenCalledOnce());
    let pending!: Promise<void>;
    act(() => {
      pending = Promise.resolve(
        commandsFromPreviousRender[command]("1", "highest"),
      );
    });
    await act(async () => {
      release();
      await pending;
      await h.result.current.application.flush();
    });
    const durable = (await readApplicationSnapshot()).snapshot;
    expect(durable.eventLists[EVENT][0]).toMatchObject({
      ...purchase,
      priorityLevel: "highest",
    });
    expect(h.result.current.application.raw).toEqual(durable);
    expect(
      h.result.current.application.values.eventLists[EVENT][0],
    ).toMatchObject({
      ...purchase,
      priorityLevel: "highest",
    });
    expect(
      await h.result.current.application.coordinator.readExportSnapshot(),
    ).toEqual(durable);
    expect(h.result.current.application.confirmations).toEqual([]);
    expect(h.commit).toHaveBeenCalledTimes(2);
    expect(h.applied).toHaveBeenCalledTimes(2);
  },
);

it.each([
  "detailed",
  "simple in combined editor",
  "simple in simple editor",
] as const)(
  "preserves the mixed hall order after renaming %s",
  async (editor) => {
    const h = await harness();
    const simpleRef = {
      kind: "simple" as const,
      dayKey: DAY,
      hallId: "simple",
    };
    const mapRef = { kind: "map" as const, mapKey: MAP, hallId: "hall" };
    const hallOrder = [
      { hall: simpleRef, priority: "none" as const },
      { hall: mapRef, priority: "none" as const },
      { hall: null, priority: "highest" as const },
    ];
    const hallVisitLists = [
      { group: hallOrder[0], itemIds: ["1"] },
      { group: hallOrder[1], itemIds: ["2"] },
    ];
    await h.otherTab((snapshot) => {
      Object.assign(snapshot.eventConsistency[EVENT].days[DAY].maps[MAP], {
        assignments: { "1": simpleRef, "2": mapRef },
        hallOrder,
        hallVisitLists,
      });
    });
    const seed = (await readApplicationSnapshot()).snapshot;
    act(() => {
      h.result.current.application.hydrationSetters.setEventConsistency(
        seed.eventConsistency,
      );
    });
    const values = h.result.current.application.values;
    const rename = (entry: typeof hall | typeof simpleHall) =>
      (
        editor === "detailed"
          ? entry.vertices.length > 0
          : entry.vertices.length === 0
      )
        ? { ...entry, name: "変更後のホール名" }
        : entry;
    let pending!: Promise<void>;
    act(() => {
      pending = Promise.resolve(
        editor === "simple in simple editor"
          ? h.result.current.commands.handleUpdateMaplessHalls(
              values.hallDefinitions[EVENT][getMaplessKey(DAY)].map(rename),
            )
          : h.result.current.commands.handleUpdateHalls(
              [
                ...values.hallDefinitions[EVENT][MAP],
                ...values.hallDefinitions[EVENT][getMaplessKey(DAY)],
              ].map(rename),
            ),
      );
    });
    await act(async () => {
      await h.result.current.application.coordinator.enqueue(() => undefined);
    });
    while (h.result.current.application.confirmations.length) {
      await act(async () => {
        h.result.current.application.confirm(
          h.result.current.application.confirmations[0].token,
        );
        await h.result.current.application.coordinator.enqueue(() => undefined);
      });
    }
    await act(async () => {
      await pending;
      await h.result.current.application.flush();
    });
    const durable = (await readApplicationSnapshot()).snapshot;
    expect(
      durable.eventConsistency[EVENT].days[DAY].maps[MAP].hallOrder,
    ).toEqual(hallOrder);
    expect(
      durable.eventConsistency[EVENT].days[DAY].maps[MAP].hallVisitLists,
    ).toEqual(hallVisitLists);
    expect(durable.executeModeItems).toEqual(seed.executeModeItems);
    expect(durable.eventConsistency[EVENT].days[OTHER_DAY]).toEqual(
      seed.eventConsistency[EVENT].days[OTHER_DAY],
    );
    expect(h.result.current.application.raw).toEqual(durable);
    expect(
      await h.result.current.application.coordinator.readExportSnapshot(),
    ).toEqual(durable);
    expect(
      durable.hallDefinitions[EVENT][
        editor === "detailed" ? MAP : getMaplessKey(DAY)
      ][0],
    ).toMatchObject({ name: "変更後のホール名" });
    expect(h.result.current.application.failure).toBeNull();
  },
);

it.each([
  "add detailed",
  "add simple",
  "delete detailed",
  "delete simple",
  "failed rename",
] as const)("preserves valid mixed groups during %s", async (operation) => {
  const h = await harness();
  const simpleRef = { kind: "simple" as const, dayKey: DAY, hallId: "simple" };
  const mapRef = { kind: "map" as const, mapKey: MAP, hallId: "hall" };
  const hallOrder = [
    { hall: simpleRef, priority: "none" as const },
    { hall: mapRef, priority: "none" as const },
    { hall: simpleRef, priority: "highest" as const },
    { hall: null, priority: "priority" as const },
  ];
  await h.otherTab((snapshot) => {
    Object.assign(snapshot.eventConsistency[EVENT].days[DAY].maps[MAP], {
      assignments: { "1": simpleRef, "2": mapRef },
      hallOrder,
      hallVisitLists: [
        { group: hallOrder[0], itemIds: ["1"] },
        { group: hallOrder[1], itemIds: ["2"] },
      ],
    });
  });
  const seed = (await readApplicationSnapshot()).snapshot;
  act(() => {
    h.result.current.application.hydrationSetters.setEventConsistency(
      seed.eventConsistency,
    );
  });
  const values = h.result.current.application.values;
  let halls = [
    ...values.hallDefinitions[EVENT][MAP],
    ...values.hallDefinitions[EVENT][getMaplessKey(DAY)],
  ];
  let expectedOrder = hallOrder;
  if (operation.startsWith("add")) {
    const detailed = operation === "add detailed";
    halls = [
      ...halls,
      { ...(detailed ? hall : simpleHall), id: "new-hall", name: "追加ホール" },
    ];
    expectedOrder = [
      ...hallOrder,
      {
        hall: detailed
          ? { ...mapRef, hallId: "new-hall" }
          : { ...simpleRef, hallId: "new-hall" },
        priority: "none",
      },
    ];
  } else if (operation.startsWith("delete")) {
    const detailed = operation === "delete detailed";
    halls = halls.filter((entry) =>
      detailed ? !entry.vertices.length : entry.vertices.length > 0,
    );
    expectedOrder = hallOrder.filter(
      (group) =>
        !group.hall || group.hall.kind !== (detailed ? "map" : "simple"),
    );
  } else {
    halls = halls.map((entry) => ({ ...entry, name: "変更後の名前" }));
    h.commit.mockRejectedValueOnce(new Error("transaction aborted"));
  }
  let pending!: Promise<void>;
  act(() => {
    pending = Promise.resolve(
      h.result.current.commands.handleUpdateHalls(halls),
    );
  });
  await act(async () => {
    await h.result.current.application.coordinator.enqueue(() => undefined);
  });
  while (h.result.current.application.confirmations.length) {
    await act(async () => {
      h.result.current.application.confirm(
        h.result.current.application.confirmations[0].token,
      );
      await h.result.current.application.coordinator.enqueue(() => undefined);
    });
  }
  await act(async () => {
    await pending;
    await h.result.current.application.flush();
  });
  const durable = (await readApplicationSnapshot()).snapshot;
  if (operation === "failed rename") {
    expect(durable).toEqual(seed);
    expect(h.applied).not.toHaveBeenCalled();
    expect(h.result.current.application.failure).toBe("transaction aborted");
  } else {
    expect(
      durable.eventConsistency[EVENT].days[DAY].maps[MAP].hallOrder,
    ).toEqual(expectedOrder);
    expect(durable.eventConsistency[EVENT].days[OTHER_DAY]).toEqual(
      seed.eventConsistency[EVENT].days[OTHER_DAY],
    );
    expect(durable.executeModeItems).toEqual(seed.executeModeItems);
    expect(h.result.current.application.failure).toBeNull();
    expect(h.applied).toHaveBeenCalledOnce();
  }
  expect(h.result.current.application.raw).toEqual(durable);
  expect(h.commit).toHaveBeenCalledOnce();
});
