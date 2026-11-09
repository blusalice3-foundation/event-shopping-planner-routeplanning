// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { MutationCancelledError } from "../state/useApplicationSnapshot";
import { describe, expect, it, vi } from "vitest";
import type { ExecuteModeItems, ShoppingItem } from "../../types/item";
import {
  getMaplessKey,
  type DayMapData,
  type HallDefinition,
  type HallRouteSettings,
} from "../../types/map";
import {
  useMapRouteCommands,
  type MapRouteActionPort,
  type MapRouteCommandPorts,
  type MapRouteStatePort,
} from "./useMapRouteCommands";

const EVENT = "イベントA";
const OTHER_EVENT = "イベントB";
const DAY_ONE = "1日目";
const DAY_TWO = "2日目";
const MAP_ONE = `${DAY_ONE}マップ`;
const MAP_TWO = `${DAY_TWO}マップ`;
const MAP_HALL = "map-hall";
const MAPLESS_HALL = "mapless-hall";

const shoppingItem = (
  id: string,
  manualHallId: string,
  eventDate = DAY_ONE,
): ShoppingItem => ({
  id,
  circle: `サークル${id}`,
  eventDate,
  block: manualHallId,
  number: "1",
  title: `商品${id}`,
  price: 1000,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  manualHallId,
});

const hall = (id: string): HallDefinition => ({
  id,
  name: id,
  vertices: [],
  blockNames: [id],
});

const dayMap = (sheetName: string): DayMapData => ({
  sheetName,
  maxRow: 1,
  maxCol: 1,
  cells: [],
  mergedCells: [],
  blocks: [],
});

const mapRouteSettings = (): HallRouteSettings => ({
  hallOrder: [MAP_HALL],
  hallVisitLists: [{ hallId: MAP_HALL, itemIds: ["three", "one"] }],
});

const maplessRouteSettings = (): HallRouteSettings => ({
  hallOrder: [MAPLESS_HALL],
  hallVisitLists: [{ hallId: MAPLESS_HALL, itemIds: ["two"] }],
});

const baseState = (): MapRouteStatePort => ({
  activeEventName: EVENT,
  activeEventDate: DAY_ONE,
  eventGeneration: 0,
  isMapTab: true,
  currentMapTabName: MAP_ONE,
  currentFocusMapName: MAP_TWO,
  routeVisible: true,
  mapRotationSettings: {
    [EVENT]: {
      [MAP_ONE]: {
        initialAngle: 10,
        mapTabAngle: 370,
        focusModeAngle: 20,
      },
      [MAP_TWO]: {
        initialAngle: -5,
        mapTabAngle: 30,
        focusModeAngle: 721,
      },
    },
  },
  mapViewportSettings: {
    [EVENT]: {
      [MAP_ONE]: { zoomLevel: 100, offsetX: 4, offsetY: 5 },
    },
  },
  mapData: {
    [EVENT]: {
      [MAP_ONE]: dayMap("one"),
      [MAP_TWO]: dayMap("two"),
    },
  },
  hallDefinitions: {
    [EVENT]: {
      [MAP_ONE]: [hall(MAP_HALL)],
      [getMaplessKey(DAY_ONE)]: [hall(MAPLESS_HALL)],
    },
  },
  hallRouteSettings: {
    [EVENT]: {
      [MAP_ONE]: mapRouteSettings(),
      [getMaplessKey(DAY_ONE)]: maplessRouteSettings(),
      preserved: { hallOrder: ["preserved"], hallVisitLists: [] },
    },
  },
  executeModeItems: {
    [EVENT]: { [DAY_ONE]: ["one", "two", "three"] },
    [OTHER_EVENT]: { [DAY_ONE]: ["other"] },
  },
  items: [
    shoppingItem("one", MAP_HALL),
    shoppingItem("two", MAPLESS_HALL),
    shoppingItem("three", MAP_HALL),
  ],
});

const createHarness = (overrides: Partial<MapRouteStatePort> = {}) => {
  const state = { ...baseState(), ...overrides };
  const stores = {
    routeVisible: state.routeVisible,
    mapRotationSettings: state.mapRotationSettings,
    mapViewportSettings: state.mapViewportSettings,
    hallRouteSettings: state.hallRouteSettings,
    executeModeItems: state.executeModeItems,
  };
  const setRouteVisible: MapRouteActionPort["setRouteVisible"] = vi.fn(
    (value) => {
      stores.routeVisible = value;
    },
  );
  const setMapRotationSettings: MapRouteActionPort["setMapRotationSettings"] =
    vi.fn((updater) => {
      stores.mapRotationSettings = updater(stores.mapRotationSettings);
    });
  const setMapViewportSettings: MapRouteActionPort["setMapViewportSettings"] =
    vi.fn((updater) => {
      stores.mapViewportSettings = updater(stores.mapViewportSettings);
    });
  const setHallRouteSettings: MapRouteActionPort["setHallRouteSettings"] =
    vi.fn((updater) => {
      stores.hallRouteSettings = updater(stores.hallRouteSettings);
    });
  const updateExecuteModeItems: MapRouteActionPort["updateExecuteModeItems"] =
    vi.fn((updater) => {
      stores.executeModeItems = updater(stores.executeModeItems);
    });
  const getMapTabForDate = vi.fn((eventDate: string) =>
    eventDate === DAY_ONE ? MAP_ONE : eventDate === DAY_TWO ? MAP_TWO : null,
  );
  const actions: MapRouteActionPort = {
    setRouteVisible,
    setMapRotationSettings,
    setMapViewportSettings,
    setHallRouteSettings,
    updateExecuteModeItems,
  };
  const ports: MapRouteCommandPorts = {
    state,
    actions,
    selectors: { getMapTabForDate },
  };

  return {
    ports,
    stores,
    spies: {
      setRouteVisible,
      setMapRotationSettings,
      setMapViewportSettings,
      setHallRouteSettings,
      updateExecuteModeItems,
      getMapTabForDate,
    },
  };
};

describe("useMapRouteCommands", () => {
  it("projects normalized map/focus rotation, viewport, and merged route inputs", () => {
    const harness = createHarness();
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    expect(result.current.currentMapTabRotation).toEqual({
      initialAngle: 10,
      mapTabAngle: 10,
      focusModeAngle: 20,
    });
    expect(result.current.currentFocusMapRotation).toEqual({
      initialAngle: 355,
      mapTabAngle: 30,
      focusModeAngle: 1,
    });
    expect(result.current.currentMapTabViewport).toEqual({
      zoomLevel: 100,
      offsetX: 4,
      offsetY: 5,
    });
    expect(result.current.globalMapTabName).toBe(MAP_ONE);
    expect(result.current.globalHallRouteSettings.hallOrder).toEqual([
      MAP_HALL,
      MAPLESS_HALL,
    ]);
    expect(result.current.globalHallRouteSettings.hallVisitLists).toHaveLength(
      2,
    );
  });

  it("owns explicit and toggle route visibility commands", () => {
    const harness = createHarness({ routeVisible: true });
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    act(() => {
      result.current.setRouteVisibility(true);
      result.current.toggleRouteVisibility();
    });

    expect(harness.spies.setRouteVisible).toHaveBeenNthCalledWith(1, true);
    expect(harness.spies.setRouteVisible).toHaveBeenNthCalledWith(2, false);
  });

  it("normalizes map-tab rotation and preserves initial/focus angles", () => {
    const harness = createHarness();
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    act(() => result.current.updateMapTabRotation(450));

    expect(harness.stores.mapRotationSettings[EVENT][MAP_ONE]).toEqual({
      initialAngle: 10,
      mapTabAngle: 90,
      focusModeAngle: 20,
    });
    expect(harness.stores.mapRotationSettings[EVENT][MAP_TWO]).toBe(
      harness.ports.state.mapRotationSettings[EVENT][MAP_TWO],
    );
  });

  it("updates focus rotation independently and keeps no-op identity", () => {
    const state = baseState();
    state.mapRotationSettings[EVENT][MAP_TWO] = {
      initialAngle: 355,
      mapTabAngle: 30,
      focusModeAngle: 90,
    };
    const harness = createHarness(state);
    const before = harness.stores.mapRotationSettings;
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    act(() => result.current.updateFocusMapRotation(450));

    expect(harness.stores.mapRotationSettings).toBe(before);

    act(() => result.current.updateFocusMapRotation(-1));

    expect(
      harness.stores.mapRotationSettings[EVENT][MAP_TWO].focusModeAngle,
    ).toBe(359);
    expect(harness.stores.mapRotationSettings[EVENT][MAP_TWO].mapTabAngle).toBe(
      30,
    );
  });

  it("updates viewport once and preserves identity for equal coordinates", () => {
    const harness = createHarness();
    const before = harness.stores.mapViewportSettings;
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    act(() =>
      result.current.updateMapViewport({
        zoomLevel: 100,
        offsetX: 4,
        offsetY: 5,
      }),
    );

    expect(harness.stores.mapViewportSettings).toBe(before);

    act(() =>
      result.current.updateMapViewport({
        zoomLevel: 125,
        offsetX: 8,
        offsetY: 9,
      }),
    );

    expect(harness.stores.mapViewportSettings[EVENT][MAP_ONE]).toEqual({
      zoomLevel: 125,
      offsetX: 8,
      offsetY: 9,
    });
  });

  it("updates only the active map hall-route input used for recalculation", () => {
    const harness = createHarness();
    const next: HallRouteSettings = {
      hallOrder: [`${MAP_HALL}:priority`, MAP_HALL],
      hallVisitLists: [{ hallId: `${MAP_HALL}:priority`, itemIds: ["one"] }],
    };
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    act(() => result.current.updateCurrentHallRouteSettings(next));

    expect(harness.stores.hallRouteSettings[EVENT][MAP_ONE]).toBe(next);
    expect(harness.stores.hallRouteSettings[EVENT].preserved).toBe(
      harness.ports.state.hallRouteSettings[EVENT].preserved,
    );
  });

  it("keeps a reviewed mixed hall order in one context", () => {
    const harness = createHarness();
    const settings: HallRouteSettings = {
      hallOrder: [MAPLESS_HALL, MAP_HALL, "undefined"],
      hallVisitLists: [
        { hallId: MAP_HALL, itemIds: ["one"] },
        { hallId: MAPLESS_HALL, itemIds: ["two"] },
        { hallId: "undefined", itemIds: ["missing"] },
      ],
    };
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    act(() => result.current.updateGlobalHallRouteSettings(settings));

    expect(harness.stores.hallRouteSettings[EVENT][MAP_ONE]).toEqual(settings);
    expect(
      harness.stores.hallRouteSettings[EVENT][getMaplessKey(DAY_ONE)],
    ).toEqual(maplessRouteSettings());
    expect(harness.stores.hallRouteSettings[EVENT].preserved).toBe(
      harness.ports.state.hallRouteSettings[EVENT].preserved,
    );
  });

  it("reorders hall groups while retaining the latest execution order", () => {
    const harness = createHarness();
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    act(() =>
      result.current.reorderExecuteListByHallOrder([MAPLESS_HALL, MAP_HALL]),
    );

    expect(harness.stores.executeModeItems[EVENT][DAY_ONE]).toEqual([
      "two",
      "one",
      "three",
    ]);
    expect(harness.stores.executeModeItems[OTHER_EVENT][DAY_ONE]).toEqual([
      "other",
    ]);
  });

  it("keeps execute-store identity when the active day is empty", () => {
    const emptyExecuteModeItems: Record<string, ExecuteModeItems> = {
      [EVENT]: { [DAY_ONE]: [] },
    };
    const harness = createHarness({ executeModeItems: emptyExecuteModeItems });
    const before = harness.stores.executeModeItems;
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    act(() => result.current.reorderExecuteListByHallOrder([MAP_HALL]));

    expect(harness.stores.executeModeItems).toBe(before);
  });

  it("rejects map-bound updates outside an active map context", () => {
    const harness = createHarness({
      activeEventName: null,
      activeEventDate: "",
      isMapTab: false,
      currentMapTabName: null,
      currentFocusMapName: "",
    });
    const { result } = renderHook(() => useMapRouteCommands(harness.ports));

    act(() => {
      result.current.updateMapTabRotation(10);
      result.current.updateFocusMapRotation(10);
      result.current.updateMapViewport({
        zoomLevel: 100,
        offsetX: 0,
        offsetY: 0,
      });
      result.current.updateCurrentHallRouteSettings({
        hallOrder: [],
        hallVisitLists: [],
      });
      result.current.updateGlobalHallRouteSettings({
        hallOrder: [],
        hallVisitLists: [],
      });
      result.current.reorderExecuteListByHallOrder([]);
    });

    expect(harness.spies.setMapRotationSettings).not.toHaveBeenCalled();
    expect(harness.spies.setMapViewportSettings).not.toHaveBeenCalled();
    expect(harness.spies.setHallRouteSettings).not.toHaveBeenCalled();
    expect(harness.spies.updateExecuteModeItems).not.toHaveBeenCalled();
  });
});

it("sends viewport cleanup for the captured source date without using the whole-state setter", () => {
  const harness = createHarness();
  const requestMutation = vi.fn().mockResolvedValue({});
  const { result } = renderHook(() =>
    useMapRouteCommands({ ...harness.ports, requestMutation }),
  );
  const before = harness.stores.mapViewportSettings;
  act(() =>
    result.current.updateMapViewport({
      zoomLevel: 100,
      offsetX: 4,
      offsetY: 5,
    }),
  );
  expect(requestMutation).not.toHaveBeenCalled();
  act(() =>
    result.current.updateMapViewport({
      zoomLevel: 125,
      offsetX: 15,
      offsetY: 25,
    }),
  );
  expect(harness.stores.mapViewportSettings).toBe(before);
  expect(requestMutation).toHaveBeenCalledWith(
    expect.objectContaining({
      events: [EVENT],
      expectedGenerations: { [EVENT]: 0 },
      dayMutation: {
        kind: "map-viewport",
        eventName: EVENT,
        day: DAY_ONE,
        mapKey: MAP_ONE,
        viewport: { zoomLevel: 125, offsetX: 15, offsetY: 25 },
      },
    }),
  );
});

describe("viewport ownership across context changes", () => {
  const viewport = { zoomLevel: 125, offsetX: 15, offsetY: 25 };

  it.each(["day", "event"] as const)(
    "saves the captured source after switching the active %s",
    (target) => {
      const harness = createHarness();
      const requestMutation = vi.fn().mockResolvedValue({});
      const { result, rerender } = renderHook(
        ({ state }) =>
          useMapRouteCommands({ ...harness.ports, state, requestMutation }),
        { initialProps: { state: harness.ports.state } },
      );
      const saveSource = result.current.updateMapViewport;
      rerender({
        state: {
          ...harness.ports.state,
          activeEventName: target === "event" ? OTHER_EVENT : EVENT,
          activeEventDate: DAY_TWO,
          eventGeneration: target === "event" ? 7 : 0,
          currentMapTabName: MAP_TWO,
          // Ordinary commits can replace the store while retaining map owners.
          mapData: { ...harness.ports.state.mapData },
        },
      });

      act(() => saveSource(viewport));

      expect(requestMutation).toHaveBeenCalledOnce();
      const intent = requestMutation.mock.calls[0][0];
      expect(intent).toEqual(
        expect.objectContaining({
          events: [EVENT],
          expectedGenerations: { [EVENT]: 0 },
          dayMutation: {
            kind: "map-viewport",
            eventName: EVENT,
            day: DAY_ONE,
            mapKey: MAP_ONE,
            viewport,
          },
        }),
      );
      expect(() => intent.assertApplicable()).not.toThrow();
      expect(harness.spies.setMapViewportSettings).not.toHaveBeenCalled();
    },
  );

  it.each(["generation", "reimport", "removed-event", "cleared-viewport"])(
    "does not recreate stale viewport state after %s",
    (change) => {
      const harness = createHarness();
      const requestMutation = vi.fn().mockResolvedValue({});
      const { result, rerender } = renderHook(
        ({ state }) =>
          useMapRouteCommands({ ...harness.ports, state, requestMutation }),
        { initialProps: { state: harness.ports.state } },
      );
      const saveSource = result.current.updateMapViewport;
      const state = harness.ports.state;
      rerender({
        state: {
          ...state,
          eventGeneration: change === "generation" ? 1 : 0,
          mapData:
            change === "removed-event"
              ? {}
              : change === "reimport"
                ? {
                    ...state.mapData,
                    [EVENT]: {
                      ...state.mapData[EVENT],
                      [MAP_ONE]: dayMap("replacement"),
                    },
                  }
                : state.mapData,
          mapViewportSettings:
            change === "cleared-viewport" ? {} : state.mapViewportSettings,
        },
      });

      act(() => saveSource(viewport));

      expect(requestMutation).not.toHaveBeenCalled();
      expect(harness.spies.setMapViewportSettings).not.toHaveBeenCalled();
    },
  );

  it("retains the captured viewport after block definitions change on the same drawing", () => {
    const harness = createHarness();
    const requestMutation = vi.fn().mockResolvedValue({});
    const { result, rerender } = renderHook(
      ({ state }) =>
        useMapRouteCommands({ ...harness.ports, state, requestMutation }),
      { initialProps: { state: harness.ports.state } },
    );
    const saveSource = result.current.updateMapViewport;
    const state = harness.ports.state;
    const sourceMap = state.mapData[EVENT][MAP_ONE];
    const editedState = {
      ...state,
      mapData: {
        ...state.mapData,
        [EVENT]: {
          ...state.mapData[EVENT],
          // The block editor replaces this object while retaining its drawing.
          [MAP_ONE]: {
            ...sourceMap,
            blocks: [
              {
                name: "A",
                startRow: 1,
                startCol: 1,
                endRow: 1,
                endCol: 1,
                numberCells: [{ row: 1, col: 1, value: 1 }],
              },
            ],
          },
        },
      },
    };
    rerender({ state: editedState });

    act(() => saveSource(viewport));

    expect(requestMutation).toHaveBeenCalledOnce();
    const intent = requestMutation.mock.calls[0][0];
    expect(() => intent.assertApplicable()).not.toThrow();
    rerender({
      state: {
        ...editedState,
        mapData: {
          ...editedState.mapData,
          [EVENT]: {
            ...editedState.mapData[EVENT],
            [MAP_ONE]: { ...editedState.mapData[EVENT][MAP_ONE], blocks: [] },
          },
        },
      },
    });
    expect(() => intent.assertApplicable()).not.toThrow();
  });
  it("rechecks the map owner after the save was queued", () => {
    const harness = createHarness();
    const requestMutation = vi.fn().mockResolvedValue({});
    const { result, rerender } = renderHook(
      ({ state }) =>
        useMapRouteCommands({ ...harness.ports, state, requestMutation }),
      { initialProps: { state: harness.ports.state } },
    );
    act(() => result.current.updateMapViewport(viewport));
    const intent = requestMutation.mock.calls[0][0];
    expect(() => intent.assertApplicable()).not.toThrow();

    rerender({ state: { ...harness.ports.state, mapData: {} } });

    expect(() => intent.assertApplicable()).toThrow(MutationCancelledError);
  });
});
