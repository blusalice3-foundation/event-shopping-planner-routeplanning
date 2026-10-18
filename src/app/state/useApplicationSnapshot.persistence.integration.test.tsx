// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  eventUpdateSourceMatches,
  EventUpdateInvalidatedError,
} from "../../features/events/updateFlow";
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
  const atomicOriginal = db.commitApplicationSnapshotAtomically;
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
        stopWrites: persistence.stopWrites,
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
  return { ...hook, single, atomic, seed, mount, commands, atomicOriginal };
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

it("excludes a moved limited target from accepted display and export, then saves the valid memo after review", async () => {
  const { createItemContentGuard } =
    await import("../../utils/itemContentGuard");
  const h = await harness();
  const baseline = h.result.current.application.values.eventLists[EVENT][0];
  const guard = createItemContentGuard(
    h.result.current.application.raw,
    EVENT,
    baseline,
    "limited-focus",
    0,
  );
  const remote = await db.readApplicationSnapshot();
  remote.snapshot.executeModeItems[EVENT][DAY] = ["2"];
  await db.commitApplicationSnapshotAtomically(remote.snapshot, {
    expectedRoots: remote.expectedRoots,
    changedStoresOnly: true,
  });
  act(() => {
    h.result.current.application.updateItemFields([
      {
        eventName: EVENT,
        itemId: "1",
        baseline,
        guard,
        changes: {
          purchaseStatus: "LimitedPurchase",
          limitedPurchasedQuantity: 1,
        },
      },
      {
        eventName: EVENT,
        itemId: "1",
        baseline,
        changes: { remarks: "保持する正常入力" },
      },
    ]);
  });
  await waitFor(() =>
    expect(h.result.current.application.confirmations).toHaveLength(1),
  );
  expect(h.result.current.application.confirmations[0].confirmation.title).toBe(
    "対象外になった限数入力を確認",
  );
  expect(
    h.result.current.application.values.eventLists[EVENT][0],
  ).toMatchObject({ purchaseStatus: "Purchased", remarks: "保持する正常入力" });
  const accepted =
    await h.result.current.application.coordinator.readExportSnapshot();
  expect(accepted.eventLists[EVENT][0]).not.toHaveProperty(
    "limitedPurchasedQuantity",
  );
  expect(accepted.eventLists[EVENT][0]).toMatchObject({
    remarks: "保持する正常入力",
  });
  const token = h.result.current.application.confirmations[0].token;
  await act(async () => {
    h.result.current.application.confirm(token);
    await h.result.current.application.flush();
  });
  await waitFor(() =>
    expect(h.result.current.application.confirmations).toHaveLength(0),
  );
  const saved = (await db.readApplicationSnapshot()).snapshot;
  expect(saved.eventLists[EVENT][0]).toMatchObject({
    purchaseStatus: "Purchased",
    remarks: "保持する正常入力",
  });
  expect(saved.eventLists[EVENT][0]).not.toHaveProperty(
    "limitedPurchasedQuantity",
  );
  expect(saved.executeModeItems[EVENT][DAY]).toEqual(["2"]);
});

it("keeps the order of normal, guarded, then normal field edits in one accepted batch", async () => {
  const { createItemContentGuard } =
    await import("../../utils/itemContentGuard");
  const h = await harness();
  const baseline = h.result.current.application.values.eventLists[EVENT][0];
  const guard = createItemContentGuard(
    h.result.current.application.rawRef.current,
    EVENT,
    baseline,
    "limited-single",
    0,
  );
  act(() => {
    h.result.current.application.updateItemFields({
      eventName: EVENT,
      itemId: baseline.id,
      baseline,
      changes: { quantity: 3 },
    });
    h.result.current.application.updateItemFields({
      eventName: EVENT,
      itemId: baseline.id,
      baseline: { ...baseline, quantity: 3 },
      guard,
      changes: { quantity: 4 },
    });
    h.result.current.application.updateItemFields({
      eventName: EVENT,
      itemId: baseline.id,
      baseline: { ...baseline, quantity: 4 },
      changes: { quantity: 5 },
    });
  });
  expect(
    h.result.current.application.values.eventLists[EVENT][0].quantity,
  ).toBe(5);
  await act(async () => h.result.current.application.flush());
  await waitFor(() =>
    expect(h.result.current.application.pendingCount).toBe(0),
  );
  expect(
    (
      (await db.readApplicationSnapshot()).snapshot.eventLists[
        EVENT
      ][0] as import("../../types/item").ShoppingItem
    ).quantity,
  ).toBe(5);
  expect(h.result.current.application.confirmations).toEqual([]);
});

it("retains entered amounts through no-op acceptance, quantity review and a second remote change", async () => {
  const { createItemContentGuard } =
    await import("../../utils/itemContentGuard");
  const h = await harness();
  const baseline = h.result.current.application.values.eventLists[EVENT][0];
  const guard = createItemContentGuard(
    h.result.current.application.raw,
    EVENT,
    baseline,
    "limited-single",
    0,
  );
  const remote = await db.readApplicationSnapshot();
  Object.assign(remote.snapshot.eventLists[EVENT][0]!, {
    quantity: 9,
    remarks: "他タブのメモ",
  });
  await db.commitApplicationSnapshotAtomically(remote.snapshot, {
    expectedRoots: remote.expectedRoots,
    changedStoresOnly: true,
  });
  act(() =>
    h.result.current.application.updateItemFields({
      eventName: EVENT,
      itemId: baseline.id,
      baseline,
      guard,
      changes: {},
      limitedPurchase: {
        kind: "purchased",
        actual: 2,
        planned: 2,
        plannedEdited: false,
        observedPlanned: 2,
      },
    }),
  );
  await waitFor(() =>
    expect(h.result.current.application.confirmations).toHaveLength(1),
  );
  expect(
    h.result.current.application.confirmations[0].confirmation.details.join(
      "\n",
    ),
  ).toContain("実購入数は2個");
  const exported =
    await h.result.current.application.coordinator.readExportSnapshot();
  expect(exported.eventLists[EVENT][0]).toMatchObject({
    quantity: 2,
    purchaseStatus: "Purchased",
  });
  const oldToken = h.result.current.application.confirmations[0].token;
  const newer = await db.readApplicationSnapshot();
  Object.assign(newer.snapshot.eventLists[EVENT][0]!, { quantity: 7 });
  await db.commitApplicationSnapshotAtomically(newer.snapshot, {
    expectedRoots: newer.expectedRoots,
    changedStoresOnly: true,
  });
  await act(async () => {
    h.result.current.application.confirm(oldToken);
    await expect(h.result.current.application.flush()).rejects.toThrow(
      "保存前の確認を完了してください。",
    );
  });
  await waitFor(() =>
    expect(
      h.result.current.application.confirmations[0]?.token.signature,
    ).not.toBe(oldToken.signature),
  );
  expect(
    (await db.readApplicationSnapshot()).snapshot.eventLists[EVENT][0],
  ).not.toHaveProperty("limitedPurchasedQuantity");
  const token = h.result.current.application.confirmations[0].token;
  await act(async () => {
    h.result.current.application.confirm(token);
    await h.result.current.application.flush();
  });
  await waitFor(() =>
    expect(h.result.current.application.pendingCount).toBe(0),
  );
  const saved = (await db.readApplicationSnapshot()).snapshot;
  expect(saved.eventLists[EVENT][0]).toMatchObject({
    quantity: 7,
    purchaseStatus: "LimitedPurchase",
    limitedPurchasedQuantity: 2,
    remarks: "他タブのメモ",
  });
  expect(saved.eventLists[EVENT][0]).not.toHaveProperty("limitedPurchase");
  expect(saved.eventLists[EVENT].slice(1)).toEqual(
    h.seed.eventLists[EVENT].slice(1),
  );
  expect(saved.executeModeItems).toEqual(h.seed.executeModeItems);
});

it.each(["queued", "cas-retry", "confirmation", "manual-retry"] as const)(
  "rechecks a sheet-update source against the serialized snapshot after %s",
  async (phase) => {
    const commitOriginal = db.commitApplicationSnapshotAtomically.bind(db);
    const h = await harness();
    const source = {
      spreadsheetUrl: "https://example.com/A",
      spreadsheetSheetName: "一覧",
      lastImportDate: "",
    };
    await act(() =>
      h.result.current.application.commitPatch({
        eventMetadata: { [EVENT]: source },
      }),
    );
    const baseline = h.result.current.application.values;
    const commitReviewed = h.result.current.application.commitPatch;
    let expectedItems = baseline.eventLists;
    const proposed = {
      eventLists: {
        [EVENT]: baseline.eventLists[EVENT].map((item) => ({
          ...item,
          sheetRemarks: "取得したAの値",
        })),
      },
    };
    const changedSource = {
      [EVENT]: { ...source, spreadsheetUrl: "https://example.com/B" },
    };
    const guard = vi.fn(
      (
        latest: import("../ports/PersistenceCommandPort").PersistenceSnapshot,
      ) => {
        if (
          !eventUpdateSourceMatches(
            latest.eventMetadata[EVENT] as typeof source,
            {
              url: source.spreadsheetUrl,
              sheetName: source.spreadsheetSheetName,
            },
          )
        )
          throw new EventUpdateInvalidatedError();
      },
    );
    if (phase === "queued") {
      act(() =>
        h.result.current.application.setters.setEventMetadata(changedSource),
      );
    } else if (phase === "cas-retry") {
      h.atomic.mockImplementationOnce(async () => {
        const latest = await db.readApplicationSnapshot();
        await commitOriginal(
          { ...latest.snapshot, eventMetadata: changedSource },
          { expectedRoots: latest.expectedRoots },
        );
        throw Object.assign(new Error("retry"), {
          name: "PersistenceConflict",
        });
      });
    } else if (phase === "manual-retry") {
      for (let i = 0; i < 3; i++)
        h.atomic.mockRejectedValueOnce(
          Object.assign(new Error("retry"), { name: "PersistenceConflict" }),
        );
    } else {
      expectedItems = {
        [EVENT]: baseline.eventLists[EVENT].map((item) => ({
          ...item,
          sheetRemarks: "保存済みの別の変更",
        })),
      };
      await act(() =>
        h.result.current.application.commitPatch({ eventLists: expectedItems }),
      );
    }
    let saving!: Promise<unknown>;
    act(() => {
      saving = commitReviewed(proposed, undefined, undefined, guard).catch(
        (error: unknown) => error,
      );
    });
    if (phase === "manual-retry") {
      await waitFor(() =>
        expect(h.result.current.application.retryableFailures).toHaveLength(1),
      );
      await act(() =>
        h.result.current.application.commitPatch({
          eventMetadata: changedSource,
        }),
      );
      act(() => h.result.current.application.retryPending());
    } else if (phase === "confirmation") {
      await waitFor(() =>
        expect(h.result.current.application.confirmations).toHaveLength(1),
      );
      const token = h.result.current.application.confirmations[0].token;
      await act(() =>
        h.result.current.application.commitPatch({
          eventMetadata: changedSource,
        }),
      );
      act(() => h.result.current.application.confirm(token));
    }
    let outcome: unknown;
    await act(async () => {
      outcome = await saving;
    });
    expect(outcome).toBeInstanceOf(EventUpdateInvalidatedError);
    const saved = (await db.readApplicationSnapshot()).snapshot;
    expect(saved.eventLists).toEqual(expectedItems);
    expect(saved.eventMetadata).toEqual(changedSource);
    expect(saved.executeModeItems).toEqual(baseline.executeModeItems);
    expect(h.result.current.application.confirmations).toEqual([]);
    expect(h.result.current.application.retryableFailures).toEqual([]);
    if (phase !== "queued") expect(guard.mock.calls.length).toBeGreaterThan(1);
  },
);

it("App handler wiring synchronously stops retry/flush before rerender and exports a later accepted edit without writing", async () => {
  const h = await harness(true);
  const original = h.atomicOriginal;
  let release!: () => void;
  h.atomic.mockImplementationOnce(async (...args) => {
    await original(...args);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  let first!: Promise<unknown>;
  act(() => {
    first = h.result.current.application
      .commitPatch({
        eventLists: {
          [EVENT]: items.map((item) =>
            item.id === "1" ? { ...item, remarks: "保存済み" } : item,
          ),
        },
      })
      .catch((error: unknown) => error);
  });
  await waitFor(() => expect(release).toBeTypeOf("function"));
  act(() =>
    h.result.current.application.setters.setEventLists((lists) => ({
      ...lists,
      [EVENT]: lists[EVENT].map((item) =>
        item.id === "2" ? { ...item, remarks: "停止前に受理した入力" } : item,
      ),
    })),
  );
  let flush!: Promise<unknown>;
  let stoppedReason: unknown;
  h.result.current.application.handlers.current.stopWrites = (reason) => {
    stoppedReason = reason;
    h.result.current.persistence.stopWrites(reason);
    h.result.current.persistence.retrySave();
    flush = h.result.current.persistence
      .flushPendingSave()
      .catch((error: unknown) => error);
  };
  h.result.current.application.handlers.current.applied = (snapshot) => {
    h.result.current.persistence.acceptCommittedSnapshot(snapshot);
    throw new Error("App effect failed after durable save");
  };
  await act(async () => {
    release();
    await first;
  });
  expect(await first).toMatchObject({ name: "CommittedStateApplyError" });
  expect(await flush).toBe(stoppedReason);
  expect(h.result.current.application.requiresReload).toBe(true);
  expect(h.result.current.application.pendingCount).toBe(0);
  expect(h.atomic).toHaveBeenCalledOnce();
  h.result.current.persistence.retrySave();
  await expect(h.result.current.persistence.flushPendingSave()).rejects.toBe(
    stoppedReason,
  );
  const file =
    await h.result.current.application.coordinator.createBackupFile();
  const exported = JSON.parse(await file.blob.text());
  expect(exported.data.eventLists[EVENT][1].remarks).toBe(
    "停止前に受理した入力",
  );
  expect(
    (await db.readApplicationSnapshot()).snapshot.eventLists[EVENT][1],
  ).toMatchObject({ remarks: "ユーザー登録" });
  expect(h.atomic).toHaveBeenCalledOnce();
  const writes = vi.spyOn(db, "saveEventLists");
  act(() => h.result.current.persistence.acceptCommittedSnapshot(h.seed));
  await expect(h.commands.saveEventLists({})).rejects.toBe(stoppedReason);
  expect(writes).not.toHaveBeenCalled();
});
