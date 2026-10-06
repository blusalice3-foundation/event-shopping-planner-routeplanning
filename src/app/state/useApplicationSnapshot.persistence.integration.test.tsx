// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../utils/indexedDB";
import { resetDatabaseConnection } from "../../persistence/db/openDatabase";
import { createIndexedDbPersistenceCommandAdapter } from "../../persistence/adapters/indexedDbPersistenceCommandAdapter";
import { useIndexedDbPersistence } from "../../hooks/useIndexedDbPersistence";
import {
  createEventConsistency,
  createDayConsistency,
  createVisitContext,
} from "../../types/consistency";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "./useApplicationSnapshot";

const EVENT = "保存経路検証";
const DAY = "1日目";
const items = ["1", "2", "3"].map((id) => ({
  id,
  circle: "サークル" + id,
  title: "新刊",
  eventDate: id === "3" ? "2日目" : DAY,
  block: "A",
  number: id,
  purchaseStatus: "Purchased" as const,
  price: 900,
  quantity: 2,
  remarks: "ユーザー登録",
}));

beforeEach(() => {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function harness(related = false, saveDelayMs = 1) {
  const consistency = createEventConsistency();
  if (related) {
    const context = createVisitContext();
    context.hallVisitLists = [
      {
        group: { hall: null, priority: "none" },
        itemIds: ["1", "2"],
      },
    ];
    consistency.days[DAY] = { ...createDayConsistency(), mapless: context };
  }
  const seed = {
    ...emptyApplicationSnapshot(),
    eventLists: { [EVENT]: items },
    executeModeItems: { [EVENT]: { [DAY]: ["1", "2"], "2日目": ["3"] } },
    eventConsistency: { [EVENT]: consistency },
  };
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(seed, {
    expectedRoots: initial.expectedRoots,
  });
  const single = vi.spyOn(db, "saveExecuteModeItems");
  const atomic = vi.spyOn(db, "commitApplicationSnapshotAtomically");
  const commands = createIndexedDbPersistenceCommandAdapter();
  const mount = () =>
    renderHook(() => {
      const application = useApplicationSnapshot(commands, EVENT, DAY);
      const persistence = useIndexedDbPersistence({
        persistenceCommands: commands,
        values: application.raw,
        setters: application.hydrationSetters,
        saveDelayMs,
      });
      application.handlers.current = {
        drain: persistence.flushPendingSave,
        observeSnapshot: persistence.observeSnapshot,
        applied: persistence.acceptCommittedSnapshot,
      };
      return { application, persistence };
    });
  const hook = mount();
  await waitFor(() =>
    expect(hook.result.current.persistence.isInitialized).toBe(true),
  );
  return { ...hook, single, atomic, seed, mount };
}
function reorder(h: Awaited<ReturnType<typeof harness>>) {
  h.result.current.application.setters.setExecuteModeItems((current) => ({
    ...current,
    [EVENT]: { ...current[EVENT], [DAY]: ["2", "1"] },
  }));
}
describe("coordinated watched and atomic persistence", () => {
  it("debounces a standalone reorder, saves only executeModeItems and persists on remount", async () => {
    const h = await harness(false, 500);
    act(() => reorder(h));
    await waitFor(() =>
      expect(h.result.current.persistence.persistenceStatus).toBe("unsaved"),
    );
    expect(h.single).not.toHaveBeenCalled();
    expect(h.atomic).not.toHaveBeenCalled();
    await act(async () => h.result.current.application.flush());
    expect(h.single).toHaveBeenCalledOnce();
    expect(h.atomic).not.toHaveBeenCalled();
    const saved = (await db.readApplicationSnapshot()).snapshot;
    expect(saved.executeModeItems[EVENT][DAY]).toEqual(["2", "1"]);
    expect(saved.executeModeItems[EVENT]["2日目"]).toEqual(["3"]);
    expect(saved.eventLists).toEqual(h.seed.eventLists);
    h.unmount();
    const remounted = h.mount();
    await waitFor(() =>
      expect(remounted.result.current.persistence.isInitialized).toBe(true),
    );
    expect(
      remounted.result.current.application.values.executeModeItems[EVENT][DAY],
    ).toEqual(["2", "1"]);
  });

  it("uses one atomic transaction when a single setter also updates saved visit lists", async () => {
    const h = await harness(true);
    await act(async () => {
      reorder(h);
      await h.result.current.application.flush();
    });
    expect(h.single).not.toHaveBeenCalled();
    expect(h.atomic).toHaveBeenCalledOnce();
    const saved = (await db.readApplicationSnapshot()).snapshot;
    expect(saved.executeModeItems[EVENT][DAY]).toEqual(["2", "1"]);
    expect(
      saved.eventConsistency[EVENT].days[DAY].mapless?.hallVisitLists[0]
        .itemIds,
    ).toEqual(["2", "1"]);
    expect(saved.eventLists).toEqual(h.seed.eventLists);
    expect(saved.executeModeItems[EVENT]["2日目"]).toEqual(["3"]);
  });

  it("retains a failed watched reorder, blocks later atomic saves, exports and retries the intent", async () => {
    const h = await harness();
    h.single.mockRejectedValueOnce(
      new DOMException("書き込み失敗", "AbortError"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => reorder(h));
    await waitFor(() =>
      expect(h.result.current.application.retryableFailures).toHaveLength(1),
    );
    expect(
      (await db.readApplicationSnapshot()).snapshot.executeModeItems,
    ).toEqual(h.seed.executeModeItems);
    expect(
      (await h.result.current.application.coordinator.readExportSnapshot())
        .executeModeItems[EVENT][DAY],
    ).toEqual(["2", "1"]);
    let pending!: Promise<unknown>;
    act(() => {
      pending = h.result.current.application.request({
        events: [EVENT],
        plan: (snapshot) => ({
          snapshot: {
            ...snapshot,
            dayModes: { [EVENT]: { [DAY]: "execute" } },
          },
        }),
      });
    });
    await expect(pending).rejects.toThrow("未保存");
    expect(h.atomic).not.toHaveBeenCalled();
    await act(async () => {
      h.result.current.application.retryPending();
      await h.result.current.application.flush();
    });
    expect(h.single).toHaveBeenCalledTimes(2);
    expect(h.atomic).not.toHaveBeenCalled();
    expect(
      (await db.readApplicationSnapshot()).snapshot.executeModeItems[EVENT][
        DAY
      ],
    ).toEqual(["2", "1"]);
    expect(h.result.current.application.retryableFailures).toEqual([]);
  });

  it("serializes a later purchase behind a watched reorder without resaving unrelated roots", async () => {
    const h = await harness(false, 100);
    act(() => reorder(h));
    await waitFor(() =>
      expect(h.result.current.persistence.persistenceStatus).toBe("unsaved"),
    );
    await act(async () => {
      h.result.current.application.setters.setEventLists((current) => ({
        ...current,
        [EVENT]: current[EVENT].map((item) =>
          item.id === "1" ? { ...item, remarks: "新しい購入メモ" } : item,
        ),
      }));
      await h.result.current.application.flush();
    });
    expect(h.single).toHaveBeenCalledOnce();
    expect(h.atomic).toHaveBeenCalledOnce();
    const saved = (await db.readApplicationSnapshot()).snapshot;
    expect(saved.executeModeItems[EVENT][DAY]).toEqual(["2", "1"]);
    expect(saved.eventLists[EVENT][0]).toMatchObject({
      remarks: "新しい購入メモ",
    });
  });
});

it("adopts a newer purchase from another writer during watched debounce", async () => {
  const h = await harness(false, 100);
  act(() => reorder(h));
  await waitFor(() =>
    expect(h.result.current.persistence.persistenceStatus).toBe("unsaved"),
  );
  await db.saveEventLists({
    [EVENT]: items.map((item) =>
      item.id === "1" ? { ...item, remarks: "別タブの購入メモ" } : item,
    ),
  });
  await act(async () => h.result.current.application.flush());
  expect(h.single).toHaveBeenCalledOnce();
  expect(h.atomic).not.toHaveBeenCalled();
  expect(h.result.current.application.values.eventLists[EVENT][0].remarks).toBe(
    "別タブの購入メモ",
  );
  expect(
    (await h.result.current.application.coordinator.readExportSnapshot())
      .eventLists[EVENT][0],
  ).toMatchObject({
    remarks: "別タブの購入メモ",
  });
});

it("replans a watched CAS conflict in the same coordinator before retrying", async () => {
  const h = await harness();
  h.single.mockRejectedValueOnce(
    Object.assign(new Error("別タブとの競合"), { name: "PersistenceConflict" }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => {
    reorder(h);
    await h.result.current.application.flush();
  });
  expect(h.single).toHaveBeenCalledTimes(2);
  expect(h.atomic).not.toHaveBeenCalled();
  expect(h.result.current.application.retryableFailures).toEqual([]);
  expect(
    (await db.readApplicationSnapshot()).snapshot.executeModeItems[EVENT][DAY],
  ).toEqual(["2", "1"]);
});

it("never resends half of a failed related reorder through the watcher", async () => {
  const h = await harness(true);
  h.atomic.mockRejectedValueOnce(
    new DOMException("一括保存の失敗", "AbortError"),
  );
  act(() => reorder(h));
  await waitFor(() =>
    expect(h.result.current.application.retryableFailures).toHaveLength(1),
  );
  expect(h.single).not.toHaveBeenCalled();
  const unchanged = (await db.readApplicationSnapshot()).snapshot;
  expect(unchanged.executeModeItems).toEqual(h.seed.executeModeItems);
  expect(unchanged.eventConsistency).toEqual(h.seed.eventConsistency);
  await act(async () => {
    h.result.current.application.retryPending();
    await h.result.current.application.flush();
  });
  expect(h.atomic).toHaveBeenCalledTimes(2);
  expect(h.single).not.toHaveBeenCalled();
  const saved = (await db.readApplicationSnapshot()).snapshot;
  expect(saved.executeModeItems[EVENT][DAY]).toEqual(["2", "1"]);
  expect(
    saved.eventConsistency[EVENT].days[DAY].mapless?.hallVisitLists[0].itemIds,
  ).toEqual(["2", "1"]);
});

it("watches an item-array reorder but keeps purchase content edits atomic", async () => {
  const h = await harness();
  const singleItems = vi.spyOn(db, "saveEventLists");
  await act(async () => {
    h.result.current.application.setters.setEventLists((current) => ({
      ...current,
      [EVENT]: [current[EVENT][1], current[EVENT][0], current[EVENT][2]],
    }));
    await h.result.current.application.flush();
  });
  expect(singleItems).toHaveBeenCalledOnce();
  expect(h.atomic).not.toHaveBeenCalled();
  expect(h.single).not.toHaveBeenCalled();
  expect(
    (await db.readApplicationSnapshot()).snapshot.eventLists[EVENT].map(
      (item) => (item as { id: string }).id,
    ),
  ).toEqual(["2", "1", "3"]);
  await act(async () => {
    h.result.current.application.setters.setEventLists((current) => ({
      ...current,
      [EVENT]: current[EVENT].map((item) =>
        item.id === "1" ? { ...item, price: 1000 } : item,
      ),
    }));
    await h.result.current.application.flush();
  });
  expect(singleItems).toHaveBeenCalledOnce();
  expect(h.atomic).toHaveBeenCalledOnce();
  expect(
    (await db.readApplicationSnapshot()).snapshot.eventLists[EVENT][1],
  ).toMatchObject({ price: 1000 });
});

it.each(
  (["abort", "quota", "conflicts"] as const).flatMap((failure) =>
    (["single setter", "related setters"] as const).flatMap((origin) =>
      (["retry", "discard"] as const).map((action) => ({
        failure,
        origin,
        action,
      })),
    ),
  ),
)(
  "keeps failed related reorder values out of UI, previews and exports: $failure, $origin, $action",
  async ({ failure, origin, action }) => {
    const h = await harness(true);
    const error =
      failure === "conflicts"
        ? Object.assign(new Error("保存競合"), { name: "PersistenceConflict" })
        : new DOMException(
            "一括保存の失敗",
            failure === "quota" ? "QuotaExceededError" : "AbortError",
          );
    const attempts = failure === "conflicts" ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++)
      h.atomic.mockRejectedValueOnce(error);
    act(() => {
      if (origin === "related setters")
        h.result.current.application.setters.setDayModes({
          [EVENT]: { [DAY]: "execute" },
        });
      reorder(h);
    });
    await waitFor(() =>
      expect(h.result.current.application.retryableFailures).toHaveLength(1),
    );
    expect(h.atomic).toHaveBeenCalledTimes(attempts);
    expect(h.single).not.toHaveBeenCalled();
    expect((await db.readApplicationSnapshot()).snapshot).toEqual(h.seed);
    for (const snapshot of [
      h.result.current.application.values,
      h.result.current.application.previewRef.current,
      await h.result.current.application.coordinator.readExportSnapshot(),
    ]) {
      expect(snapshot.executeModeItems).toEqual(h.seed.executeModeItems);
      expect(snapshot.eventConsistency).toEqual(h.seed.eventConsistency);
      expect(snapshot.dayModes).toEqual(h.seed.dayModes);
    }
    // A subsequent purchase must neither include nor silently apply the failed order.
    await act(async () => {
      h.result.current.application.setters.setEventLists((current) => ({
        ...current,
        [EVENT]: current[EVENT].map((item) =>
          item.id === "1" ? { ...item, remarks: "失敗後の最新購入メモ" } : item,
        ),
      }));
      h.result.current.application.flushDraft();
      await h.result.current.application.coordinator.enqueue(() => undefined);
    });
    expect(h.result.current.application.values.executeModeItems).toEqual(
      h.seed.executeModeItems,
    );
    const withPurchase = (await db.readApplicationSnapshot()).snapshot;
    expect(withPurchase.executeModeItems).toEqual(h.seed.executeModeItems);
    expect(withPurchase.eventLists[EVENT][0]).toMatchObject({
      remarks: "失敗後の最新購入メモ",
    });
    await act(async () => {
      if (action === "retry") {
        h.result.current.application.retryPending();
        await h.result.current.application.flush();
      } else h.result.current.application.discardPending();
    });
    const saved = (await db.readApplicationSnapshot()).snapshot;
    const expected = action === "retry" ? ["2", "1"] : ["1", "2"];
    expect(saved.executeModeItems[EVENT][DAY]).toEqual(expected);
    expect(
      saved.eventConsistency[EVENT].days[DAY].mapless?.hallVisitLists[0]
        .itemIds,
    ).toEqual(expected);
    expect(saved.executeModeItems[EVENT]["2日目"]).toEqual(["3"]);
    expect(saved.eventLists).toEqual(withPurchase.eventLists);
    expect(h.single).not.toHaveBeenCalled();
    expect(h.result.current.application.retryableFailures).toEqual([]);
    h.unmount();
    const remounted = h.mount();
    await waitFor(() =>
      expect(remounted.result.current.persistence.isInitialized).toBe(true),
    );
    expect(
      remounted.result.current.application.values.executeModeItems[EVENT][DAY],
    ).toEqual(expected);
  },
);
