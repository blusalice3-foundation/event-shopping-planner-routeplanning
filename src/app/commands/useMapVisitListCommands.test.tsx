// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../../types/item";
import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";
import { createEventConsistency } from "../../types/consistency";
import {
  useMapVisitListCommands,
  type MapVisitListCommandPorts,
  type MapVisitListStatePort,
} from "./useMapVisitListCommands";
const DAY = " 1日目　",
  MAP = "１日目マップ";
const item = (id: string, eventDate = "1日目"): ShoppingItem => ({
  id,
  circle: id,
  title: id,
  eventDate,
  block: "A",
  number: id,
  quantity: 1,
  price: 100,
  purchaseStatus: "None",
  remarks: "",
});
function harness() {
  let saved: PersistenceSnapshot = {
    eventLists: {
      event: [item("A"), item("B"), item("C"), item("D"), item("E", "2日目")],
    },
    eventMetadata: {},
    executeModeItems: { event: { [DAY]: ["B", "A", "C"], "2日目": ["E"] } },
    dayModes: {},
    mapData: {
      event: {
        [MAP]: { cells: [], mergedCells: [], blocks: [], maxRow: 1, maxCol: 1 },
      },
    },
    mapRotationSettings: {},
    mapViewportSettings: {},
    hallDefinitions: {},
    routeSettings: {},
    hallRouteSettings: {},
    eventConsistency: { event: createEventConsistency() },
  };
  const state = {
    generation: 0,
    activeEventName: "event",
    activeEventDate: "1日目",
    currentMapTabName: MAP,
    isMapTab: true,
    executeModeItems: saved.executeModeItems,
    panelOpen: false,
    panelMapTab: null as string | null,
    hasUnsavedChanges: false,
    originalOrder: [] as string[],
    confirmDialogOpen: false,
    pendingTabChange: null,
  } as MapVisitListStatePort & {
    panelOpen: boolean;
    panelMapTab: string | null;
    hasUnsavedChanges: boolean;
    originalOrder: string[];
    confirmDialogOpen: boolean;
    pendingTabChange: string | null;
  };
  const close = () => {
    Object.assign(state, {
      panelOpen: false,
      hasUnsavedChanges: false,
      confirmDialogOpen: false,
      pendingTabChange: null,
    });
  };
  const actions: MapVisitListCommandPorts["actions"] = {
    updateExecuteModeItems: vi.fn(),
    openPanel: vi.fn((map, ids) => {
      Object.assign(state, {
        panelOpen: true,
        panelMapTab: map,
        originalOrder: [...ids],
        hasUnsavedChanges: false,
      });
    }),
    setUnsaved: vi.fn((value) => {
      state.hasUnsavedChanges = value;
    }),
    requestConfirmClose: vi.fn((tab) => {
      state.confirmDialogOpen = true;
      state.pendingTabChange = tab;
    }),
    closePanel: vi.fn(close),
    confirmClose: vi.fn(close),
    discardClose: vi.fn(close),
  };
  const ports: MapVisitListCommandPorts = {
    state,
    actions,
    navigation: { navigateToTab: vi.fn() },
    readCurrentSnapshot: () => saved,
    requestMutation: vi.fn(async (intent) => {
      const plan = await intent.plan(structuredClone(saved));
      saved = plan.snapshot;
      Object.assign(state, { executeModeItems: saved.executeModeItems });
      return saved;
    }),
  };
  const hook = renderHook(() => useMapVisitListCommands(ports));
  const open = () => {
    act(() => hook.result.current.openPanel(MAP));
    hook.rerender();
  };
  const update = async (ids: string[]) => {
    await act(() =>
      hook.result.current.updateOrder(
        ids.map(
          (id) =>
            (saved.eventLists.event as ShoppingItem[]).find(
              (item) => item.id === id,
            )!,
        ),
      ),
    );
    hook.rerender();
  };
  const mutate = (fn: (snapshot: PersistenceSnapshot) => void) => {
    fn(saved);
    Object.assign(state, { executeModeItems: saved.executeModeItems });
    hook.rerender();
  };
  return {
    ...hook,
    ports,
    state,
    actions,
    open,
    update,
    mutate,
    snapshot: () => saved,
    ids: () => saved.executeModeItems.event[DAY],
  };
}
describe("visit list commands share one session and successful save baseline", () => {
  it("uses the original day key, independently from the map spelling", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    expect(h.ids()).toEqual(["A", "B", "C"]);
    expect(Object.keys(h.snapshot().executeModeItems.event)).toEqual([
      DAY,
      "2日目",
    ]);
    expect(h.snapshot().executeModeItems.event["2日目"]).toEqual(["E"]);
    expect(h.actions.updateExecuteModeItems).not.toHaveBeenCalled();
  });
  it("rejects a map that is not the current resolved map", () => {
    const h = harness();
    act(() => h.result.current.openPanel("1日目"));
    expect(h.actions.openPanel).not.toHaveBeenCalled();
  });
  it("cancels to the most recently saved order", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    await act(() => h.result.current.saveChanges());
    h.rerender();
    expect(h.state.originalOrder).toEqual(["A", "B", "C"]);
    await h.update(["C", "B", "A"]);
    await act(() => h.result.current.discardChanges());
    expect(h.ids()).toEqual(["A", "B", "C"]);
    expect(h.state.hasUnsavedChanges).toBe(false);
  });
  it("includes current external additions when establishing a new save baseline", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    h.mutate((snapshot) => {
      snapshot.executeModeItems.event[DAY] = ["D", "A", "B", "C"];
    });
    await act(() => h.result.current.saveChanges());
    h.rerender();
    await h.update(["C", "B", "A", "D"]);
    await act(() => h.result.current.discardChanges());
    expect(h.ids()).toEqual(["D", "A", "B", "C"]);
  });
  it("preserves new visit slots while cancel reorders only surviving known visits", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    h.mutate((snapshot) => {
      snapshot.executeModeItems.event[DAY] = ["A", "D", "B", "C"];
    });
    await act(() => h.result.current.discardChanges());
    expect(h.ids()).toEqual(["B", "D", "A", "C"]);
  });
  it("does not resurrect deleted items or revert purchase records", async () => {
    const h = harness();
    h.open();
    await h.update(["C", "B", "A"]);
    h.mutate((snapshot) => {
      snapshot.eventLists.event = (snapshot.eventLists.event as ShoppingItem[])
        .filter((item) => item.id !== "B")
        .map((item) =>
          item.id === "A"
            ? { ...item, purchaseStatus: "Purchased", remarks: "最新" }
            : item,
        );
      snapshot.executeModeItems.event[DAY] = ["C", "A"];
    });
    await act(() => h.result.current.discardChanges());
    expect(h.ids()).toEqual(["A", "C"]);
    expect(h.snapshot().eventLists.event).toContainEqual(
      expect.objectContaining({
        id: "A",
        purchaseStatus: "Purchased",
        remarks: "最新",
      }),
    );
  });
  it("does not move an item back from another day on cancel", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    h.mutate((snapshot) => {
      (snapshot.eventLists.event as ShoppingItem[]).find(
        (item) => item.id === "B",
      )!.eventDate = "2日目";
      snapshot.executeModeItems.event[DAY] = ["A", "C"];
      snapshot.executeModeItems.event["2日目"] = ["E", "B"];
    });
    await act(() => h.result.current.discardChanges());
    expect(h.ids()).toEqual(["A", "C"]);
    expect(h.snapshot().executeModeItems.event["2日目"]).toEqual(["E", "B"]);
  });
  it("keeps history and order after a failed save", async () => {
    const h = harness();
    h.open();
    vi.mocked(h.ports.requestMutation).mockRejectedValueOnce(
      new Error("abort"),
    );
    await expect(
      act(() =>
        h.result.current.updateOrder([item("A"), item("B"), item("C")]),
      ),
    ).rejects.toThrow("abort");
    expect(h.ids()).toEqual(["B", "A", "C"]);
    expect(h.state.originalOrder).toEqual(["B", "A", "C"]);
    expect(h.actions.setUnsaved).not.toHaveBeenCalled();
  });
  it("waits for save or discard before one guarded tab and mode transition", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    const changeMode = vi.fn();
    act(() => {
      expect(h.result.current.requestTabChange("2日目", changeMode)).toBe(
        "confirmation",
      );
    });
    h.rerender();
    expect(h.ports.navigation.navigateToTab).not.toHaveBeenCalled();
    expect(changeMode).not.toHaveBeenCalled();
    act(() => {
      expect(h.result.current.requestTabChange("1日目")).toBe("ignored");
    });
    await act(() => h.result.current.confirmPendingTransition());
    h.rerender();
    await act(() => h.result.current.confirmPendingTransition());
    expect(h.ports.navigation.navigateToTab).toHaveBeenCalledExactlyOnceWith(
      "2日目",
    );
    expect(changeMode).toHaveBeenCalledOnce();
  });
  it("waits for an in-flight reorder before running the map-selection callback", async () => {
    const h = harness();
    h.open();
    const implementation = vi
      .mocked(h.ports.requestMutation)
      .getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(h.ports.requestMutation).mockImplementationOnce(
      async (intent) => {
        await gate;
        return implementation(intent);
      },
    );
    let update!: Promise<void>;
    act(() => {
      update = h.result.current.updateOrder([item("A"), item("B"), item("C")]);
    });
    const selectMap = vi.fn();
    act(() => {
      expect(h.result.current.requestTabChange("1日目", selectMap)).toBe(
        "confirmation",
      );
    });
    h.rerender();
    expect(selectMap).not.toHaveBeenCalled();
    expect(h.ids()).toEqual(["B", "A", "C"]);
    await act(async () => {
      release();
      await update;
    });
    h.rerender();
    expect(selectMap).not.toHaveBeenCalled();
    await act(() => h.result.current.confirmPendingTransition());
    expect(h.ids()).toEqual(["A", "B", "C"]);
    expect(selectMap).toHaveBeenCalledOnce();
  });
  it("does not run the map-selection callback when discarding the source order fails", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    const selectMap = vi.fn();
    act(() => {
      h.result.current.requestTabChange("1日目", selectMap);
    });
    h.rerender();
    vi.mocked(h.ports.requestMutation).mockRejectedValueOnce(
      new Error("abort"),
    );
    await expect(
      act(() => h.result.current.discardPendingTransition()),
    ).rejects.toThrow("abort");
    expect(selectMap).not.toHaveBeenCalled();
    expect(h.ports.navigation.navigateToTab).not.toHaveBeenCalled();
    expect(h.state.panelOpen).toBe(true);
    expect(h.state.hasUnsavedChanges).toBe(true);
    expect(h.state.originalOrder).toEqual(["B", "A", "C"]);
    expect(h.ids()).toEqual(["A", "B", "C"]);
  });
  it("restores the baseline before discard completes navigation", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    act(() => {
      h.result.current.requestTabChange("2日目");
    });
    h.rerender();
    await act(() => h.result.current.discardPendingTransition());
    expect(h.ids()).toEqual(["B", "A", "C"]);
    expect(h.ports.navigation.navigateToTab).toHaveBeenCalledExactlyOnceWith(
      "2日目",
    );
  });
  it("ends the old session and delayed navigation after event replacement", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    const callback = vi.fn();
    act(() => {
      h.result.current.requestTabChange("2日目", callback);
    });
    h.rerender();
    Object.assign(h.state, { generation: 1 });
    h.rerender();
    await act(() => h.result.current.discardPendingTransition());
    expect(h.actions.closePanel).toHaveBeenCalled();
    expect(h.ports.navigation.navigateToTab).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(h.ids()).toEqual(["A", "B", "C"]);
  });
  it("closes a clean panel immediately and requests confirmation for a dirty close", async () => {
    const h = harness();
    h.open();
    act(() => {
      expect(h.result.current.requestClose()).toBe("navigated");
    });
    h.rerender();
    h.open();
    await h.update(["A", "B", "C"]);
    act(() => {
      expect(h.result.current.requestClose()).toBe("confirmation");
    });
    expect(h.state.panelOpen).toBe(true);
    expect(h.state.pendingTabChange).toBeNull();
  });
});
