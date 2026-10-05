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
  it("retries a failed event-list discard without losing the session or cancel baseline", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    act(() => h.result.current.requestTabChange("eventList"));
    h.rerender();
    vi.mocked(h.ports.requestMutation).mockRejectedValueOnce(
      new Error("abort"),
    );
    await expect(
      act(() => h.result.current.discardPendingTransition()),
    ).rejects.toThrow("abort");
    h.rerender();
    expect(h.ids()).toEqual(["A", "B", "C"]);
    expect(h.state.originalOrder).toEqual(["B", "A", "C"]);
    expect(h.state.panelOpen).toBe(true);
    expect(h.state.hasUnsavedChanges).toBe(true);
    expect(h.ports.navigation.navigateToTab).not.toHaveBeenCalled();
    await act(() => h.result.current.discardPendingTransition());
    expect(h.ids()).toEqual(["B", "A", "C"]);
    expect(h.ports.navigation.navigateToTab).toHaveBeenCalledExactlyOnceWith(
      "eventList",
    );
    expect(h.state.panelOpen).toBe(false);
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

describe("long-press mode changes finish before navigation", () => {
  it("waits for the mode commit and ignores a duplicate press while saving", async () => {
    const h = harness();
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
    act(() => {
      expect(h.result.current.requestDayModeChange("2日目")).toBe("pending");
      expect(h.result.current.requestDayModeChange("2日目")).toBe("ignored");
      expect(h.result.current.requestTabChange("1日目")).toBe("ignored");
    });
    expect(h.ports.navigation.navigateToTab).not.toHaveBeenCalled();
    expect(h.snapshot().dayModes).toEqual({});
    await act(async () => {
      release();
      await gate;
    });
    expect(h.snapshot().dayModes.event).toEqual({ "2日目": "execute" });
    expect(h.ports.navigation.navigateToTab).toHaveBeenCalledExactlyOnceWith(
      "2日目",
    );
  });
  it("preserves the current tab and open visit panel after a failed mode save", async () => {
    const h = harness();
    h.open();
    vi.mocked(h.ports.requestMutation).mockRejectedValueOnce(
      new Error("abort"),
    );
    await act(async () => {
      h.result.current.requestDayModeChange("2日目");
    });
    expect(h.state.panelOpen).toBe(true);
    expect(h.actions.closePanel).not.toHaveBeenCalled();
    expect(h.ports.navigation.navigateToTab).not.toHaveBeenCalled();
    expect(h.snapshot().dayModes).toEqual({});
  });
  it.each(["confirm", "discard"])(
    "keeps order and cancel baseline when the %s transition mode save fails",
    async (choice) => {
      const h = harness();
      h.open();
      await h.update(["A", "B", "C"]);
      act(() => {
        h.result.current.requestDayModeChange("2日目");
      });
      h.rerender();
      const before = structuredClone(h.snapshot());
      vi.mocked(h.ports.requestMutation).mockRejectedValueOnce(
        new Error("abort"),
      );
      await expect(
        act(() =>
          choice === "confirm"
            ? h.result.current.confirmPendingTransition()
            : h.result.current.discardPendingTransition(),
        ),
      ).rejects.toThrow("abort");
      expect(h.snapshot()).toEqual(before);
      expect(h.state.originalOrder).toEqual(["B", "A", "C"]);
      expect(h.state.hasUnsavedChanges).toBe(true);
      expect(h.state.confirmDialogOpen).toBe(true);
      expect(h.ports.navigation.navigateToTab).not.toHaveBeenCalled();
    },
  );
  it("commits confirm and the target mode together before closing the source panel", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    act(() => h.result.current.requestDayModeChange("2日目"));
    h.rerender();
    vi.mocked(h.ports.requestMutation).mockClear();
    await act(() => h.result.current.confirmPendingTransition());
    expect(h.ports.requestMutation).toHaveBeenCalledOnce();
    expect(h.ids()).toEqual(["A", "B", "C"]);
    expect(h.snapshot().dayModes.event).toEqual({ "2日目": "execute" });
    expect(h.state.originalOrder).toEqual(["A", "B", "C"]);
    expect(h.ports.navigation.navigateToTab).toHaveBeenCalledExactlyOnceWith(
      "2日目",
    );
  });

  it.each(["cancelled", "source merge save failed"])(
    "keeps the target mode unchanged when confirm's source merge is %s",
    async (reason) => {
      const h = harness();
      h.open();
      await h.update(["C", "A", "B"]);
      h.mutate((snapshot) => {
        snapshot.dayModes.event = {
          "1日目": "edit",
          [DAY]: "execute",
          "2日目": "edit",
        };
      });
      act(() => h.result.current.requestDayModeChange("2日目"));
      h.rerender();
      const before = structuredClone(h.snapshot());
      const implementation = vi
        .mocked(h.ports.requestMutation)
        .getMockImplementation()!;
      vi.mocked(h.ports.requestMutation).mockClear();
      vi.mocked(h.ports.requestMutation).mockImplementation(async (intent) => {
        const plan = intent.plan(structuredClone(h.snapshot()));
        if (plan.confirmation) throw new Error(reason);
        return implementation(intent);
      });
      await expect(
        act(() => h.result.current.confirmPendingTransition()),
      ).rejects.toThrow(reason);
      expect(h.ports.requestMutation).toHaveBeenCalledOnce();
      expect(h.snapshot()).toEqual(before);
      expect(h.state.originalOrder).toEqual(["B", "A", "C"]);
      expect(h.state.hasUnsavedChanges).toBe(true);
      expect(h.state.confirmDialogOpen).toBe(true);
      expect(h.result.current.historyVersion).toBe(0);
      expect(h.ports.navigation.navigateToTab).not.toHaveBeenCalled();
    },
  );
  it("commits discard and the target mode together before closing the source panel", async () => {
    const h = harness();
    h.open();
    await h.update(["A", "B", "C"]);
    act(() => {
      h.result.current.requestDayModeChange("2日目");
    });
    h.rerender();
    vi.mocked(h.ports.requestMutation).mockClear();
    await act(() => h.result.current.discardPendingTransition());
    expect(h.ports.requestMutation).toHaveBeenCalledOnce();
    expect(h.ids()).toEqual(["B", "A", "C"]);
    expect(h.snapshot().dayModes.event).toEqual({ "2日目": "execute" });
    expect(h.ports.navigation.navigateToTab).toHaveBeenCalledExactlyOnceWith(
      "2日目",
    );
  });
});

it("does not reuse a cancelled long-press intent for a later ordinary transition", async () => {
  const h = harness();
  h.open();
  await h.update(["A", "B", "C"]);
  act(() => {
    h.result.current.requestDayModeChange("2日目");
  });
  h.rerender();
  h.state.confirmDialogOpen = false;
  h.state.pendingTabChange = null;
  h.rerender();
  act(() => {
    h.result.current.requestTabChange("1日目");
  });
  h.rerender();
  await act(() => h.result.current.confirmPendingTransition());
  expect(h.snapshot().dayModes).toEqual({});
  expect(h.ports.navigation.navigateToTab).toHaveBeenCalledExactlyOnceWith(
    "1日目",
  );
});

it("merges settings-only duplicate source days before combining discard with a same-day mode toggle", async () => {
  const h = harness();
  h.open();
  await h.update(["A", "B", "C"]);
  h.mutate((snapshot) => {
    snapshot.dayModes.event = {
      "1日目": "edit",
      " 1日目　": "execute",
      "2日目": "focus",
    };
  });
  act(() => {
    h.result.current.requestDayModeChange("1日目");
  });
  h.rerender();
  vi.mocked(h.ports.requestMutation).mockClear();
  const before = structuredClone(h.snapshot());
  const implementation = vi
    .mocked(h.ports.requestMutation)
    .getMockImplementation()!;
  let plan!: ReturnType<
    Parameters<MapVisitListCommandPorts["requestMutation"]>[0]["plan"]
  >;
  vi.mocked(h.ports.requestMutation).mockImplementationOnce(async (intent) => {
    plan = intent.plan(structuredClone(before));
    return implementation(intent);
  });
  await act(() => h.result.current.discardPendingTransition());
  expect(plan.confirmation?.details.join("\n")).toContain("訪問順");
  expect(plan.snapshot.dayModes.event).toEqual({
    "1日目": "execute",
    "2日目": "focus",
  });
  expect(plan.snapshot.executeModeItems.event["1日目"]).toEqual([
    "B",
    "A",
    "C",
  ]);
  expect(h.ports.requestMutation).toHaveBeenCalledOnce();
  expect(h.ports.navigation.navigateToTab).toHaveBeenCalledExactlyOnceWith(
    "1日目",
  );
});

describe("visit sessions wait for duplicate-day review", () => {
  function holdMutation(h: ReturnType<typeof harness>) {
    let intent!: Parameters<MapVisitListCommandPorts["requestMutation"]>[0];
    let resolve!: (snapshot: PersistenceSnapshot) => void;
    let reject!: (reason: Error) => void;
    const pending = new Promise<PersistenceSnapshot>((accept, cancel) => {
      resolve = accept;
      reject = cancel;
    });
    vi.mocked(h.ports.requestMutation).mockImplementationOnce((value) => {
      intent = value;
      return pending;
    });
    return {
      plan: (choices?: Record<string, string>) =>
        intent.plan(structuredClone(h.snapshot()), choices),
      accept: (choices?: Record<string, string>) => {
        const plan = intent.plan(structuredClone(h.snapshot()), choices);
        h.mutate((snapshot) => Object.assign(snapshot, plan.snapshot));
        resolve(h.snapshot());
      },
      reject,
    };
  }

  it("reviews duplicate execution keys before opening and uses the selected destination", async () => {
    const h = harness();
    h.mutate((snapshot) => {
      snapshot.executeModeItems.event["1日目"] = ["D", "A"];
    });
    const before = structuredClone(h.snapshot());
    const review = holdMutation(h);
    h.open();
    expect(h.actions.openPanel).not.toHaveBeenCalled();
    const plan = review.plan();
    expect(plan.confirmation?.title).toContain("保存先を統合");
    expect(h.snapshot()).toEqual(before);
    await act(async () =>
      review.accept({ destination: DAY, executeOrder: DAY }),
    );
    expect(h.state.originalOrder).toEqual(["B", "A", "C", "D"]);
    await h.update(["D", "C", "A", "B"]);
    await act(() => h.result.current.discardChanges());
    expect(h.ids()).toEqual(["B", "A", "C", "D"]);
    expect(h.snapshot().executeModeItems.event["1日目"]).toBeUndefined();
    expect(h.snapshot().executeModeItems.event["2日目"]).toEqual(["E"]);
  });

  it.each(["cancelled", "save failed"])(
    "keeps duplicate keys and the panel closed when review is %s",
    async (reason) => {
      const h = harness();
      h.mutate((snapshot) => {
        snapshot.executeModeItems.event["1日目"] = ["D", "A"];
      });
      const before = structuredClone(h.snapshot());
      const review = holdMutation(h);
      h.open();
      expect(review.plan().confirmation).toBeDefined();
      await act(async () => review.reject(new Error(reason)));
      expect(h.snapshot()).toEqual(before);
      expect(h.actions.openPanel).not.toHaveBeenCalled();
      expect(h.state.panelOpen).toBe(false);
      // A later attempt can establish a new session.
      h.open();
      await act(async () => {});
      expect(h.state.panelOpen).toBe(true);
    },
  );

  it.each(["day", "event generation", "navigation"])(
    "does not open a delayed session after %s changes",
    async (change) => {
      const h = harness();
      h.mutate((snapshot) => {
        snapshot.executeModeItems.event["1日目"] = ["D", "A"];
      });
      const review = holdMutation(h);
      h.open();
      act(() => {
        if (change === "day")
          Object.assign(h.state, { activeEventDate: "2日目" });
        else if (change === "event generation")
          Object.assign(h.state, { generation: 1 });
        else h.result.current.requestTabChange("eventList");
      });
      h.rerender();
      expect(() => review.plan()).toThrow("訪問リストの操作は終了しています。");
      await act(async () => review.reject(new Error("expired")));
      expect(h.actions.openPanel).not.toHaveBeenCalled();
    },
  );

  it.each(["reorder", "discard", "save"])(
    "reviews settings-only duplicates introduced while open before %s",
    async (operation) => {
      const h = harness();
      h.open();
      await h.update(["C", "A", "B"]);
      h.mutate((snapshot) => {
        snapshot.dayModes.event = {
          "1日目": "edit",
          [DAY]: "execute",
          "2日目": "focus",
        };
      });
      const before = structuredClone(h.snapshot());
      const review = holdMutation(h);
      let pending!: Promise<void>;
      act(() => {
        pending =
          operation === "reorder"
            ? h.result.current.updateOrder([item("A"), item("B"), item("C")])
            : operation === "discard"
              ? h.result.current.discardChanges()
              : h.result.current.saveChanges();
      });
      await act(async () => {});
      const plan = review.plan({ destination: "1日目", mode: "execute" });
      expect(plan.confirmation?.title).toContain("保存先を統合");
      expect(h.snapshot()).toEqual(before);
      await act(async () => {
        review.accept({ destination: "1日目", mode: "execute" });
        await pending;
      });
      expect(h.snapshot().dayModes.event).toEqual({
        "1日目": "execute",
        "2日目": "focus",
      });
      expect(h.result.current.historyVersion).toBe(1);
      expect(h.snapshot().executeModeItems.event[DAY]).toBeUndefined();
      await act(() => h.result.current.discardChanges());
      expect(h.snapshot().executeModeItems.event[DAY]).toBeUndefined();
      expect(h.snapshot().executeModeItems.event["2日目"]).toEqual(["E"]);
    },
  );

  it.each(["confirm", "discard"] as const)(
    "keeps source and target merge choices separate during %s and mode navigation",
    async (operation) => {
      const h = harness();
      h.open();
      await h.update(["C", "A", "B"]);
      h.mutate((snapshot) => {
        snapshot.dayModes.event = {
          "1日目": "edit",
          [DAY]: "execute",
          "2日目": "edit",
          " 2日目　": "execute",
        };
      });
      act(() => h.result.current.requestDayModeChange("2日目"));
      h.rerender();
      const review = holdMutation(h);
      let pending!: Promise<void>;
      act(() => {
        pending =
          operation === "discard"
            ? h.result.current.discardPendingTransition()
            : h.result.current.confirmPendingTransition();
      });
      await act(async () => {});
      const choices = {
        destination: " 2日目　",
        mode: "execute",
        "source:destination": DAY,
        "source:mode": "edit",
      };
      const plan = review.plan(choices);
      expect(plan.confirmation?.choices?.map((choice) => choice.id)).toEqual(
        expect.arrayContaining([
          "destination",
          "source:destination",
          "mode",
          "source:mode",
        ]),
      );
      expect(plan.snapshot.dayModes.event).toEqual({
        [DAY]: "edit",
        " 2日目　": "execute",
      });
      expect(h.ids()).toEqual(["C", "A", "B"]);
      await act(async () => {
        review.accept(choices);
        await pending;
      });
      expect(h.ids()).toEqual(
        operation === "discard" ? ["B", "A", "C"] : ["C", "A", "B"],
      );
      expect(h.snapshot().executeModeItems.event[" 2日目　"]).toEqual(["E"]);
      expect(h.ports.navigation.navigateToTab).toHaveBeenCalledExactlyOnceWith(
        "2日目",
      );
    },
  );

  it.each(["reorder", "discard", "save"])(
    "preserves history and the cancel baseline when %s merge review fails",
    async (operation) => {
      const h = harness();
      h.open();
      await h.update(["C", "A", "B"]);
      h.mutate((snapshot) => {
        snapshot.dayModes.event = { "1日目": "edit", [DAY]: "execute" };
      });
      const before = structuredClone(h.snapshot());
      const review = holdMutation(h);
      let pending!: Promise<void>;
      act(() => {
        pending =
          operation === "reorder"
            ? h.result.current.updateOrder([item("A"), item("B"), item("C")])
            : operation === "discard"
              ? h.result.current.discardChanges()
              : h.result.current.saveChanges();
      });
      const rejected = expect(pending).rejects.toThrow("abort");
      await act(async () => {});
      expect(review.plan().confirmation).toBeDefined();
      await act(async () => {
        review.reject(new Error("abort"));
        await rejected;
      });
      expect(h.snapshot()).toEqual(before);
      expect(h.state.originalOrder).toEqual(["B", "A", "C"]);
      expect(h.state.hasUnsavedChanges).toBe(true);
      expect(h.result.current.historyVersion).toBe(0);
    },
  );
});
