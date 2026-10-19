import type { HallDefinitionsStore } from "../../types/map";
import { encodeHallRef } from "../../features/consistency/domain/projection";
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
import type { DayModeState, ShoppingItem } from "../../types/item";
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

async function harness(mapless = false, sourceMapDates: string[] = []) {
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
          mapless
            ? null
            : date === DAY || sourceMapDates.includes(date)
              ? MAP
              : OTHER_MAP,
        getItemHallId: () =>
          mapless
            ? null
            : (values.hallDefinitions[EVENT]?.[MAP]?.[0]?.id ?? null),
        areItemsInSameHallGroup: () => true,
      },
      effects: { selectionEventTarget: window, notify: vi.fn() },
      persistence: { commitApplicationSnapshotPatch: application.commitPatch },
      readCommittedSnapshot: () => application.rawRef.current,
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
    let pending!: Promise<unknown>;
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
      let pending!: Promise<unknown>;
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
        expect(
          target.hallOrder.filter((group) => group.hall?.kind === "map"),
        ).toEqual([
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
    let pending!: Promise<unknown>;
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
    let pending!: Promise<unknown>;
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
  let pending!: Promise<unknown>;
  act(() => {
    pending = Promise.resolve(
      h.result.current.commands.handleUpdateHalls(halls),
    ).catch((error: unknown) => {
      if (operation !== "failed rename") throw error;
      expect(error).toBeInstanceOf(Error);
    });
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

it.each([false, true])(
  "saves the edited source and clone atomically across CAS retry and returns only committed display references (simple=%s)",
  async (simple) => {
    const h = await harness(simple);
    const sourceKey = simple ? getMaplessKey(DAY) : MAP;
    const targetKey = simple ? getMaplessKey(OTHER_DAY) : OTHER_MAP;
    const values = h.result.current.application.values;
    const draft = [
      ...values.hallDefinitions[EVENT][sourceKey],
      ...(simple ? [] : values.hallDefinitions[EVENT][getMaplessKey(DAY)]),
    ].map((entry) => ({ ...entry, name: `${entry.name}・編集中` }));
    const attemptedCloneIds: string[] = [];
    h.commit.mockImplementationOnce(async (snapshot, options) => {
      attemptedCloneIds.push(
        (snapshot.hallDefinitions[EVENT][targetKey][0] as { id: string }).id,
      );
      await h.otherTab((latest) => {
        latest.eventMetadata[EVENT] = {
          spreadsheetUrl: "",
          spreadsheetSheetName: "無関係な最新設定",
          lastImportDate: "2026-10-19",
        };
      });
      await commitApplicationSnapshotAtomically(snapshot, options);
    });
    let pending!: ReturnType<MapEditorCommands["handleUpdateHalls"]>;
    act(() => {
      const command = simple
        ? h.result.current.commands.handleSyncMaplessHallsToOtherDates
        : h.result.current.commands.handleSyncPolygonHallsToOtherDates;
      pending = command([OTHER_DAY], draft);
      void pending.catch(() => undefined);
    });
    await act(async () =>
      h.result.current.application.coordinator.enqueue(() => undefined),
    );
    for (
      let count = 0;
      count < 5 && h.result.current.application.confirmations.length;
      count++
    ) {
      await act(async () => {
        h.result.current.application.confirm(
          h.result.current.application.confirmations[0].token,
        );
        await h.result.current.application.coordinator.enqueue(() => undefined);
      });
    }
    let saved!: Awaited<typeof pending>;
    await act(async () => {
      saved = await pending;
    });
    const durable = (await readApplicationSnapshot()).snapshot;
    expect(h.commit).toHaveBeenCalledTimes(2);
    expect(h.applied).toHaveBeenCalledOnce();
    const clone = durable.hallDefinitions[EVENT][targetKey][0] as {
      id: string;
      name: string;
    };
    expect(clone.id).toBe(attemptedCloneIds[0]);
    expect(clone.name).toBe(draft[0].name);
    expect(
      (durable.hallDefinitions[EVENT][sourceKey][0] as { name: string }).name,
    ).toBe(draft[0].name);
    expect(durable.eventMetadata[EVENT]).toMatchObject({
      spreadsheetSheetName: "無関係な最新設定",
    });
    expect(saved.status).toBe("saved");
    if (saved.status === "saved") {
      expect(saved.committedHalls.map((entry) => entry.id)).toEqual(
        simple
          ? [encodeHallRef({ kind: "simple", dayKey: DAY, hallId: "simple" })]
          : [
              encodeHallRef({ kind: "map", mapKey: MAP, hallId: "hall" }),
              encodeHallRef({ kind: "simple", dayKey: DAY, hallId: "simple" }),
            ],
      );
      expect(saved.committedHalls.map((entry) => entry.name)).toEqual(
        draft.map((entry) => entry.name),
      );
    }
    expect(
      Object.values(durable.hallDefinitions[EVENT])
        .flat()
        .every((entry) => !(entry as { id: string }).id.startsWith("@hall:")),
    ).toBe(true);
    expect(durable.eventLists[EVENT]).toEqual(
      h.result.current.application.raw.eventLists[EVENT],
    );
  },
);

it("keeps target-day simple hall order, visits and assignment when syncing detailed halls", async () => {
  const h = await harness();
  const simpleRef = {
    kind: "simple" as const,
    dayKey: OTHER_DAY,
    hallId: "simple",
  };
  await h.otherTab((latest) => {
    const target =
      latest.eventConsistency[EVENT].days[OTHER_DAY].maps[OTHER_MAP];
    target.assignments = { "3": simpleRef };
    target.hallOrder = [
      { hall: simpleRef, priority: "none" },
      {
        hall: { kind: "map", mapKey: OTHER_MAP, hallId: "hall" },
        priority: "none",
      },
    ];
    target.hallVisitLists = [{ group: target.hallOrder[0], itemIds: ["3"] }];
  });
  const before = (await readApplicationSnapshot()).snapshot;
  act(() =>
    h.result.current.application.hydrationSetters.setEventConsistency(
      before.eventConsistency,
    ),
  );
  const values = h.result.current.application.values;
  const draft = [
    ...values.hallDefinitions[EVENT][MAP],
    ...values.hallDefinitions[EVENT][getMaplessKey(DAY)],
  ].map((entry) => ({ ...entry, name: `${entry.name}編集` }));
  let pending!: ReturnType<MapEditorCommands["handleUpdateHalls"]>;
  act(() => {
    pending = h.result.current.commands.handleSyncPolygonHallsToOtherDates(
      [OTHER_DAY],
      draft,
    );
    void pending.catch(() => undefined);
  });
  await act(async () =>
    h.result.current.application.coordinator.enqueue(() => undefined),
  );
  while (h.result.current.application.confirmations.length) {
    await act(async () => {
      h.result.current.application.confirm(
        h.result.current.application.confirmations[0].token,
      );
      await h.result.current.application.coordinator.enqueue(() => undefined);
    });
  }
  await act(async () => pending);
  const saved = (await readApplicationSnapshot()).snapshot;
  const target = saved.eventConsistency[EVENT].days[OTHER_DAY].maps[OTHER_MAP];
  expect(target.hallOrder[0]).toEqual({ hall: simpleRef, priority: "none" });
  expect(target.hallVisitLists[0]).toMatchObject({
    group: { hall: simpleRef, priority: "none" },
    itemIds: ["3"],
  });
  expect(target.assignments["3"]).toEqual(simpleRef);
  expect(saved.hallDefinitions[EVENT][getMaplessKey(OTHER_DAY)]).toEqual(
    before.hallDefinitions[EVENT][getMaplessKey(OTHER_DAY)],
  );
});

it("shares a detailed clone across target dates while retaining each day's own simple route references", async () => {
  const h = await harness();
  const third = "２日目";
  await h.otherTab((latest) => {
    (latest.eventLists[EVENT] as ShoppingItem[]).push(item("4", third));
    latest.executeModeItems[EVENT][third] = ["4"];
    latest.hallDefinitions[EVENT][getMaplessKey(third)] = [
      { ...simpleHall, name: "三日目簡易" },
    ];
    for (const [day, id] of [
      [OTHER_DAY, "3"],
      [third, "4"],
    ]) {
      const simpleRef = {
        kind: "simple" as const,
        dayKey: day,
        hallId: "simple",
      };
      const groups = [
        { hall: simpleRef, priority: "none" as const },
        {
          hall: { kind: "map" as const, mapKey: OTHER_MAP, hallId: "hall" },
          priority: "none" as const,
        },
      ];
      latest.eventConsistency[EVENT].days[day] = {
        selectedMapKey: OTHER_MAP,
        mapless: null,
        maps: {
          [OTHER_MAP]: {
            assignments: { [id]: simpleRef },
            hallOrder: groups,
            hallVisitLists: [{ group: groups[0], itemIds: [id] }],
            route: null,
          },
        },
      };
    }
  });
  const before = (await readApplicationSnapshot()).snapshot;
  act(() => {
    const setters = h.result.current.application.hydrationSetters;
    setters.setEventLists(before.eventLists as Record<string, ShoppingItem[]>);
    setters.setExecuteModeItems(before.executeModeItems);
    setters.setHallDefinitions(before.hallDefinitions as HallDefinitionsStore);
    setters.setEventConsistency(before.eventConsistency);
  });
  const values = h.result.current.application.values;
  const draft = [
    ...values.hallDefinitions[EVENT][MAP],
    ...values.hallDefinitions[EVENT][getMaplessKey(DAY)],
  ].map((entry) => ({ ...entry, name: `${entry.name}新` }));
  let pending!: ReturnType<MapEditorCommands["handleUpdateHalls"]>;
  act(() => {
    pending = h.result.current.commands.handleSyncPolygonHallsToOtherDates(
      [DAY, OTHER_DAY, third],
      draft,
    );
    void pending.catch(() => undefined);
  });
  await act(async () =>
    h.result.current.application.coordinator.enqueue(() => undefined),
  );
  while (h.result.current.application.confirmations.length) {
    await act(async () => {
      h.result.current.application.confirm(
        h.result.current.application.confirmations[0].token,
      );
      await h.result.current.application.coordinator.enqueue(() => undefined);
    });
  }
  await act(async () => pending);
  const saved = (await readApplicationSnapshot()).snapshot;
  const cloned = saved.hallDefinitions[EVENT][OTHER_MAP][0] as { id: string };
  expect(saved.hallDefinitions[EVENT][OTHER_MAP]).toHaveLength(1);
  expect((saved.hallDefinitions[EVENT][MAP][0] as { id: string }).id).toBe(
    "hall",
  );
  expect(h.commit).toHaveBeenCalledOnce();
  for (const [day, id] of [
    [OTHER_DAY, "3"],
    [third, "4"],
  ]) {
    const simpleRef = {
      kind: "simple" as const,
      dayKey: day,
      hallId: "simple",
    };
    const target = saved.eventConsistency[EVENT].days[day].maps[OTHER_MAP];
    expect(target.hallOrder.slice(0, 2)).toEqual([
      { hall: simpleRef, priority: "none" },
      {
        hall: { kind: "map", mapKey: OTHER_MAP, hallId: cloned.id },
        priority: "none",
      },
    ]);
    expect(target.hallVisitLists[0]).toMatchObject({
      group: { hall: simpleRef, priority: "none" },
      itemIds: [id],
    });
    expect(target.assignments[id]).toEqual(simpleRef);
    expect(saved.hallDefinitions[EVENT][getMaplessKey(day)]).toEqual(
      before.hallDefinitions[EVENT][getMaplessKey(day)],
    );
  }
});

it("preserves each target's simple route when detailed sync shares the source map and saves the full source draft", async () => {
  const aliases = ["１日目", "1 日目"];
  const h = await harness(false, aliases);
  const simpleRef = (dayKey: string, hallId: string) => ({
    kind: "simple" as const,
    dayKey,
    hallId,
  });
  const polygonRef = { kind: "map" as const, mapKey: MAP, hallId: "hall" };
  const newPolygon = {
    ...hall,
    id: "new-polygon",
    name: "新規詳細",
    vertices: [
      { row: 5, col: 5 },
      { row: 5, col: 6 },
      { row: 6, col: 6 },
      { row: 6, col: 5 },
    ],
  };
  await h.otherTab((latest) => {
    const source = latest.eventConsistency[EVENT].days[DAY].maps[MAP];
    source.hallOrder = [
      { hall: simpleRef(DAY, "simple"), priority: "none" },
      { hall: polygonRef, priority: "none" },
    ];
    source.assignments = { "1": simpleRef(DAY, "simple"), "2": polygonRef };
    source.hallVisitLists = [
      { group: source.hallOrder[0], itemIds: ["1"] },
      { group: source.hallOrder[1], itemIds: ["2"] },
    ];
    for (const [index, day] of aliases.entries()) {
      const ids = [`alias-${index}-c`, `alias-${index}-b`];
      (latest.eventLists[EVENT] as ShoppingItem[]).push(
        ...ids.map((id, index) => ({
          ...item(id, day),
          block: index ? "B" : "C",
        })),
      );
      latest.executeModeItems[EVENT][day] = ids;
      latest.dayModes[EVENT][day] = "execute";
      latest.hallDefinitions[EVENT][getMaplessKey(day)] = [
        { ...simpleHall, id: "b", name: "簡易B", blockNames: ["B"] },
        { ...simpleHall, id: "c", name: "簡易C", blockNames: ["C"] },
      ];
      const groups = [
        { hall: simpleRef(day, "c"), priority: "none" as const },
        { hall: simpleRef(day, "b"), priority: "none" as const },
        { hall: polygonRef, priority: "none" as const },
      ];
      latest.eventConsistency[EVENT].days[day] = {
        selectedMapKey: MAP,
        mapless: null,
        maps: {
          [MAP]: {
            assignments: { [ids[0]]: groups[0].hall, [ids[1]]: groups[1].hall },
            hallOrder: groups,
            hallVisitLists: groups.slice(0, 2).map((group, i) => ({
              group,
              itemIds: [ids[i]],
            })),
            route: null,
          },
        },
      };
    }
  });
  const before = (await readApplicationSnapshot()).snapshot;
  act(() => {
    const setters = h.result.current.application.hydrationSetters;
    setters.setEventLists(before.eventLists as Record<string, ShoppingItem[]>);
    setters.setExecuteModeItems(before.executeModeItems);
    setters.setDayModes(before.dayModes as Record<string, DayModeState>);
    setters.setHallDefinitions(before.hallDefinitions as HallDefinitionsStore);
    setters.setEventConsistency(before.eventConsistency);
  });
  const values = h.result.current.application.values;
  const draft = [
    ...values.hallDefinitions[EVENT][MAP],
    newPolygon,
    ...values.hallDefinitions[EVENT][getMaplessKey(DAY)].map((entry) => ({
      ...entry,
      name: "同期元簡易の編集",
    })),
    {
      ...simpleHall,
      id: "new-simple",
      name: "同期元の新規簡易",
      blockNames: ["Z"],
    },
  ];
  let pending!: ReturnType<MapEditorCommands["handleUpdateHalls"]>;
  act(() => {
    pending = h.result.current.commands.handleSyncPolygonHallsToOtherDates(
      [DAY, ...aliases, aliases[0]],
      draft,
    );
    void pending.catch(() => undefined);
  });
  await act(async () =>
    h.result.current.application.coordinator.enqueue(() => undefined),
  );
  while (h.result.current.application.confirmations.length) {
    await act(async () => {
      h.result.current.application.confirm(
        h.result.current.application.confirmations[0].token,
      );
      await h.result.current.application.coordinator.enqueue(() => undefined);
    });
  }
  let result!: Awaited<typeof pending>;
  await act(async () => {
    result = await pending;
  });
  const saved = (await readApplicationSnapshot()).snapshot;
  expect(result.status).toBe("saved");
  expect(h.commit).toHaveBeenCalledOnce();
  expect(h.applied).toHaveBeenCalledOnce();
  expect(saved.hallDefinitions[EVENT][MAP]).toEqual([hall, newPolygon]);
  expect(saved.hallDefinitions[EVENT][getMaplessKey(DAY)]).toEqual([
    { ...simpleHall, name: "同期元簡易の編集" },
    {
      ...simpleHall,
      id: "new-simple",
      name: "同期元の新規簡易",
      blockNames: ["Z"],
    },
  ]);
  expect(
    saved.eventConsistency[EVENT].days[DAY].maps[MAP].hallOrder.map(
      (group) => group.hall,
    ),
  ).toEqual([
    simpleRef(DAY, "simple"),
    polygonRef,
    { kind: "map", mapKey: MAP, hallId: "new-polygon" },
    simpleRef(DAY, "new-simple"),
  ]);
  for (const day of aliases) {
    const target = saved.eventConsistency[EVENT].days[day].maps[MAP];
    const previous = before.eventConsistency[EVENT].days[day].maps[MAP];
    expect(target.hallOrder).toEqual([
      ...previous.hallOrder,
      {
        hall: { kind: "map", mapKey: MAP, hallId: "new-polygon" },
        priority: "none",
      },
    ]);
    expect(
      target.hallVisitLists.filter(
        (list) => list.group.hall?.kind === "simple",
      ),
    ).toEqual(previous.hallVisitLists);
    expect(target.hallVisitLists.flatMap((list) => list.itemIds)).toEqual(
      previous.hallVisitLists.flatMap((list) => list.itemIds),
    );
    expect(target.assignments).toEqual(previous.assignments);
    expect(saved.hallDefinitions[EVENT][getMaplessKey(day)]).toEqual(
      before.hallDefinitions[EVENT][getMaplessKey(day)],
    );
  }
  expect(saved.eventLists).toEqual(before.eventLists);
  expect(saved.executeModeItems).toEqual(before.executeModeItems);
  expect(h.result.current.application.raw).toEqual(saved);
});
