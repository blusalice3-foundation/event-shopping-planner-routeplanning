import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";
import { createEventConsistency } from "../../types/consistency";
// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EventLifecycleCommandPorts } from "./useEventLifecycleCommands";
import { useEventLifecycleCommands } from "./useEventLifecycleCommands";

const eventItem = {
  id: "item-1",
  circle: "A",
  eventDate: "1日目",
  block: "A",
  number: "01",
  title: "",
  price: null,
  purchaseStatus: "None" as const,
  quantity: 1,
  remarks: "",
};

const createPorts = (
  overrides: Partial<EventLifecycleCommandPorts> = {},
): EventLifecycleCommandPorts => {
  const ports: EventLifecycleCommandPorts = {
    requestMutation: vi.fn(async (intent) => {
      const snapshot = Object.fromEntries(
        [
          "eventLists",
          "eventMetadata",
          "executeModeItems",
          "dayModes",
          "mapData",
          "mapRotationSettings",
          "routeSettings",
          "hallDefinitions",
          "hallRouteSettings",
          "mapViewportSettings",
        ].map((key) => [key, ports[key as keyof EventLifecycleCommandPorts]]),
      ) as unknown as PersistenceSnapshot;
      snapshot.eventConsistency = Object.fromEntries(
        Object.keys(ports.eventLists).map((name) => [
          name,
          createEventConsistency(),
        ]),
      );
      return (await intent.plan(structuredClone(snapshot))).snapshot;
    }),
    persistenceCommands: {
      deleteEventAtomically: vi.fn(async () => undefined),
      renameEventAtomically: vi.fn(async () => undefined),
    },
    flushPendingSave: vi.fn(async () => undefined),
    runExclusiveRestore: vi.fn(async (_values, restore) => restore()),
    activeEventName: "イベントA",
    eventToRename: "イベントA",
    eventLists: { イベントA: [eventItem] },
    eventMetadata: {
      イベントA: {
        spreadsheetUrl: "",
        spreadsheetSheetName: "",
        lastImportDate: "2026-08-09T00:00:00.000Z",
      },
    },
    executeModeItems: { イベントA: {} },
    dayModes: { イベントA: {} },
    mapData: { イベントA: {} },
    mapRotationSettings: { イベントA: {} },
    routeSettings: { イベントA: {} },
    hallDefinitions: { イベントA: {} },
    hallRouteSettings: { イベントA: {} },
    mapViewportSettings: { イベントA: {} },
    navigation: {
      showEventList: vi.fn(),
      showImport: vi.fn(),
      openEvent: vi.fn(),
      changeDay: vi.fn(),
      showEventSurface: vi.fn(),
      toggleEventSurface: vi.fn(),
      renameActiveEvent: vi.fn(),
      removeEvent: vi.fn(),
    },
    notify: vi.fn(),
    clearSelection: vi.fn(),
    setSelectedBlockFilters: vi.fn(),
    closeEventUpdateForEvent: vi.fn(),
    setEventLists: vi.fn(),
    setEventMetadata: vi.fn(),
    updateExecuteModeItems: vi.fn((update) => update({})),
    setDayModes: vi.fn(),
    setMapData: vi.fn(),
    setMapRotationSettings: vi.fn(),
    setRouteSettings: vi.fn(),
    setHallDefinitions: vi.fn(),
    setHallRouteSettings: vi.fn(),
    setMapViewportSettings: vi.fn(),
    setFocusModeSessions: vi.fn(),
    openRename: vi.fn(),
    confirmEventOverlay: vi.fn(),
    ...overrides,
  };
  return ports;
};

describe("useEventLifecycleCommands", () => {
  it("opens the first valid day and resets list selection", () => {
    const ports = createPorts();
    const { result } = renderHook(() => useEventLifecycleCommands(ports));
    act(() => result.current.selectEvent("イベントA"));
    expect(ports.navigation.openEvent).toHaveBeenCalledWith(
      "イベントA",
      "1日目",
    );
    expect(ports.clearSelection).toHaveBeenCalledOnce();
  });
  it("submits deletion through the shared queue and navigates only after commit", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useEventLifecycleCommands(ports));
    await act(() => result.current.deleteEvent("イベントA"));
    expect(ports.requestMutation).toHaveBeenCalledOnce();
    const saved = await vi.mocked(ports.requestMutation).mock.results[0].value;
    expect(saved.eventLists).toEqual({});
    expect(saved.eventConsistency).toEqual({});
    expect(ports.setEventLists).not.toHaveBeenCalled();
    expect(
      ports.persistenceCommands.deleteEventAtomically,
    ).not.toHaveBeenCalled();
    expect(ports.navigation.removeEvent).toHaveBeenCalledWith("イベントA");
  });
  it("renames all settings in the shared snapshot without a second UI write", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useEventLifecycleCommands(ports));
    await act(() => result.current.confirmRename("イベントB"));
    const saved = await vi.mocked(ports.requestMutation).mock.results[0].value;
    expect(saved.eventLists).toEqual({ イベントB: [eventItem] });
    expect(saved.eventConsistency).toEqual({
      イベントB: createEventConsistency(),
    });
    expect(ports.setEventLists).not.toHaveBeenCalled();
    expect(ports.navigation.renameActiveEvent).toHaveBeenCalledWith(
      "イベントA",
      "イベントB",
    );
    expect(ports.closeEventUpdateForEvent).toHaveBeenCalledWith("イベントA");
  });
  it("plans against current queue state, retaining unrelated event changes", async () => {
    const ports = createPorts();
    const { result } = renderHook(() => useEventLifecycleCommands(ports));
    ports.eventLists["更新された別イベント"] = [
      { ...eventItem, remarks: "最新メモ" },
    ];
    await act(() => result.current.deleteEvent("イベントA"));
    const saved = await vi.mocked(ports.requestMutation).mock.results[0].value;
    expect(saved.eventLists["更新された別イベント"]).toEqual([
      { ...eventItem, remarks: "最新メモ" },
    ]);
  });
  it.each(["delete", "rename"] as const)(
    "keeps the screen and operation context on %s failure",
    async (operation) => {
      const ports = createPorts({
        requestMutation: vi.fn(async () => {
          throw new Error("transaction failed");
        }),
      });
      const { result } = renderHook(() => useEventLifecycleCommands(ports));
      await act(async () => {
        if (operation === "delete")
          await result.current.deleteEvent("イベントA");
        else await result.current.confirmRename("イベントB");
      });
      expect(ports.navigation.removeEvent).not.toHaveBeenCalled();
      expect(ports.navigation.renameActiveEvent).not.toHaveBeenCalled();
      expect(ports.closeEventUpdateForEvent).not.toHaveBeenCalled();
      expect(ports.setFocusModeSessions).not.toHaveBeenCalled();
      expect(ports.notify).toHaveBeenCalled();
    },
  );
});
