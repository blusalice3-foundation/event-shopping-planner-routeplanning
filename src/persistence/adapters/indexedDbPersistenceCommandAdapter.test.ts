import { createEventConsistency } from "../../types/consistency";
import { DEFAULT_BLOCK_DETECTION_SETTINGS } from "../../types/map";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import {
  PersistenceOutcomeUnknownError,
  type PersistenceSnapshot,
} from "../../app/ports/PersistenceCommandPort";
import { db } from "../facade/indexedDbPersistence";
import { openDatabase, resetDatabaseConnection } from "../db/openDatabase";
import { STORES } from "../db/constants";
import type { BlockDetectionSettings } from "../../types/map";
import type { StartupRecoveryCandidate } from "../../utils/persistenceResilience";
import {
  createIndexedDbPersistenceCommandAdapter,
  type AuxiliaryPersistenceCommandDelegate,
  type IndexedDbPersistenceCommandDelegate,
} from "./indexedDbPersistenceCommandAdapter";

const snapshot = (): PersistenceSnapshot => ({
  eventLists: {},
  eventMetadata: {},
  executeModeItems: {},
  dayModes: {},
  mapData: {},
  mapRotationSettings: {},
  routeSettings: {},
  hallDefinitions: {},
  hallRouteSettings: {},
  mapViewportSettings: {},
  eventConsistency: {},
});

const createDelegate = (
  overrides: Partial<IndexedDbPersistenceCommandDelegate> = {},
): IndexedDbPersistenceCommandDelegate => ({
  migrateFromLocalStorage: vi.fn(async () => ({
    status: "not-needed" as const,
  })),
  adoptRecoveryCandidate: vi.fn(async () => ({ status: "adopted" })),
  saveEventConsistency: vi.fn(async () => undefined),
  readApplicationSnapshot: vi.fn(async () => ({
    snapshot: snapshot(),
    expectedRoots: {},
    consistencyMissing: false,
  })),
  saveEventLists: vi.fn(async () => undefined),
  saveEventMetadata: vi.fn(async () => undefined),
  saveExecuteModeItems: vi.fn(async () => undefined),
  saveDayModes: vi.fn(async () => undefined),
  saveMapDataChanges: vi.fn(async () => undefined),
  saveMapRotationSettings: vi.fn(async () => undefined),
  saveRouteSettings: vi.fn(async () => undefined),
  saveHallDefinitions: vi.fn(async () => undefined),
  saveHallRouteSettings: vi.fn(async () => undefined),
  saveMapViewportSettings: vi.fn(async () => undefined),
  restoreAppDataAtomically: vi.fn(async () => undefined),
  commitApplicationSnapshotAtomically: vi.fn(async () => undefined),
  deleteEventAtomically: vi.fn(async () => undefined),
  renameEventAtomically: vi.fn(async () => undefined),
  ...overrides,
});

const createAuxiliaryDelegate = (
  overrides: Partial<AuxiliaryPersistenceCommandDelegate> = {},
): AuxiliaryPersistenceCommandDelegate => {
  const runWithBlockDetectionSettingsRestore = vi.fn(
    async (
      _eventName: string,
      _settings: BlockDetectionSettings | null,
      commit: () => Promise<unknown>,
    ) => commit(),
  ) as unknown as AuxiliaryPersistenceCommandDelegate["runWithBlockDetectionSettingsRestore"];

  return {
    loadPreference: vi.fn(() => null),
    savePreference: vi.fn(),
    readBlockDetectionSettings: vi.fn(() => null),
    readBlockDetectionSettingsForBackup: vi.fn(() => ({})),
    saveBlockDetectionSettings: vi.fn(),
    removeBlockDetectionSettingsForEvent: vi.fn(),
    renameBlockDetectionSettingsForEvent: vi.fn(),
    runWithBlockDetectionSettingsRestore,
    ...overrides,
  };
};

describe("IndexedDB persistence command adapter", () => {
  it("forwards field edits with operation identities and observes the committed snapshot", async () => {
    const committed = snapshot();
    committed.eventLists.event = [
      { id: "item-1", purchaseStatus: "Purchased" },
    ];
    committed.eventConsistency.event = {
      ...createEventConsistency(),
      blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
    };
    const read = {
      snapshot: committed,
      expectedRoots: { revision: 2 },
      consistencyMissing: false,
      eventGenerations: { event: 3 },
    };
    const result = { status: "committed" as const, read };
    const commitItemContentEdits = vi.fn(async () => result);
    const delegate = createDelegate({ commitItemContentEdits });
    const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
    const edits = [
      {
        eventName: "event",
        itemId: "item-1",
        fields: { purchaseStatus: { present: true, value: "Purchased" } },
      },
    ];
    const operationIds = ["application:1", "application:2"];
    const generations = { event: 3 };

    expect(adapter.readBlockDetectionSettings("event")).toBeNull();
    expect(
      await adapter.commitItemContentEdits!(edits, operationIds, generations),
    ).toBe(result);
    expect(commitItemContentEdits).toHaveBeenCalledExactlyOnceWith(
      edits,
      operationIds,
      generations,
    );
    expect(adapter.readBlockDetectionSettings("event")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(adapter.readBlockDetectionSettingsForBackup(["event"])).toEqual({
      event: DEFAULT_BLOCK_DETECTION_SETTINGS,
    });
    expect(delegate.commitApplicationSnapshotAtomically).not.toHaveBeenCalled();
  });

  it("retains observed settings while a field edit requires conflict review", async () => {
    const previous = snapshot();
    previous.eventLists.event = [{ id: "item-1", remarks: "previous" }];
    previous.eventConsistency.event = {
      ...createEventConsistency(),
      blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
    };
    const review = { status: "review-required" as const };
    const delegate = createDelegate({
      readApplicationSnapshot: vi.fn(async () => ({
        snapshot: previous,
        expectedRoots: {},
        consistencyMissing: false,
      })),
      commitItemContentEdits: vi.fn(async () => review),
    });
    const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
    await adapter.readApplicationSnapshot();

    const edits = [
      {
        eventName: "event",
        itemId: "item-1",
        baseline: { remarks: "previous" },
        fields: { remarks: { present: true, value: "confirmed answer" } },
      },
    ];
    expect(
      await adapter.commitItemContentEdits!(edits, ["application:3"], {
        event: 3,
      }),
    ).toBe(review);
    expect(adapter.readBlockDetectionSettings("event")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(adapter.readBlockDetectionSettingsForBackup(["event"])).toEqual({
      event: DEFAULT_BLOCK_DETECTION_SETTINGS,
    });
    expect(delegate.commitApplicationSnapshotAtomically).not.toHaveBeenCalled();
  });

  it("propagates a failed field save without replacing the last observed settings", async () => {
    const previous = snapshot();
    previous.eventLists.event = [{ id: "item-1", quantity: 1 }];
    previous.eventConsistency.event = {
      ...createEventConsistency(),
      blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
    };
    const failure = new DOMException("quota", "QuotaExceededError");
    const commitItemContentEdits = vi.fn().mockRejectedValue(failure);
    const delegate = createDelegate({
      readApplicationSnapshot: vi.fn(async () => ({
        snapshot: previous,
        expectedRoots: {},
        consistencyMissing: false,
      })),
      commitItemContentEdits,
    });
    const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
    await adapter.readApplicationSnapshot();
    const edits = [
      {
        eventName: "event",
        itemId: "item-1",
        fields: { quantity: { present: true, value: 2 } },
      },
    ];
    const operationIds = ["application:4"];
    const generations = { event: 3 };

    await expect(
      adapter.commitItemContentEdits!(edits, operationIds, generations),
    ).rejects.toBe(failure);
    expect(commitItemContentEdits).toHaveBeenCalledExactlyOnceWith(
      edits,
      operationIds,
      generations,
    );
    expect(adapter.readBlockDetectionSettings("event")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(delegate.commitApplicationSnapshotAtomically).not.toHaveBeenCalled();
  });

  it("reads and commits only the requested days and observes the durable result", async () => {
    const previous = snapshot();
    previous.eventConsistency.event = {
      ...createEventConsistency(),
      blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
    };
    const read = {
      snapshot: previous,
      expectedRoots: { revision: 1 },
      consistencyMissing: false,
      eventGenerations: { event: 3 },
    };
    const committedSettings = {
      ...DEFAULT_BLOCK_DETECTION_SETTINGS,
      maxBlockNameLength: 8,
    };
    const committed = snapshot();
    committed.eventConsistency.event = {
      ...createEventConsistency(),
      blockDetectionSettings: committedSettings,
    };
    const saved = {
      ...read,
      snapshot: committed,
      expectedRoots: { revision: 2 },
    };
    const readDayApplicationSnapshot = vi.fn(async () => read);
    const commitDayApplicationSnapshot = vi.fn(async () => saved);
    const delegate = createDelegate({
      readDayApplicationSnapshot,
      commitDayApplicationSnapshot,
    });
    const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
    const target = {
      eventName: "event",
      day: "1日目",
      additionalDays: ["2日目"],
    };

    expect(adapter.readBlockDetectionSettings("event")).toBeNull();
    expect(await adapter.readDayApplicationSnapshot!(target)).toBe(read);
    expect(readDayApplicationSnapshot).toHaveBeenCalledExactlyOnceWith(target);
    expect(adapter.readBlockDetectionSettings("event")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(
      await adapter.commitDayApplicationSnapshot!(
        previous,
        read.expectedRoots,
        target,
      ),
    ).toBe(saved);
    expect(commitDayApplicationSnapshot).toHaveBeenCalledExactlyOnceWith(
      previous,
      read.expectedRoots,
      target,
    );
    const [submitted, expectedRoots, scope] = vi.mocked(
      delegate.commitDayApplicationSnapshot!,
    ).mock.calls[0];
    expect(submitted).toBe(previous);
    expect(expectedRoots).toBe(read.expectedRoots);
    expect(scope).toBe(target);
    expect(adapter.readBlockDetectionSettingsForBackup(["event"])).toEqual({
      event: committedSettings,
    });
    expect(delegate.readApplicationSnapshot).not.toHaveBeenCalled();
    expect(delegate.commitApplicationSnapshotAtomically).not.toHaveBeenCalled();
  });

  it.each(["read", "commit"] as const)(
    "retains observed settings when the scoped %s fails",
    async (operation) => {
      const previous = snapshot();
      previous.eventConsistency.event = {
        ...createEventConsistency(),
        blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
      };
      const read = {
        snapshot: previous,
        expectedRoots: { revision: 1 },
        consistencyMissing: false,
      };
      const failure = new DOMException("quota", "QuotaExceededError");
      const delegate = createDelegate({
        readApplicationSnapshot: vi.fn(async () => read),
        readDayApplicationSnapshot: vi.fn().mockRejectedValue(failure),
        commitDayApplicationSnapshot: vi.fn().mockRejectedValue(failure),
      });
      const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
      await adapter.readApplicationSnapshot();
      const target = { eventName: "event", day: "1日目" };
      const pending =
        operation === "read"
          ? adapter.readDayApplicationSnapshot!(target)
          : adapter.commitDayApplicationSnapshot!(
              snapshot(),
              read.expectedRoots,
              target,
            );

      await expect(pending).rejects.toBe(failure);
      expect(adapter.readBlockDetectionSettingsForBackup(["event"])).toEqual({
        event: DEFAULT_BLOCK_DETECTION_SETTINGS,
      });
      expect(delegate.readApplicationSnapshot).toHaveBeenCalledOnce();
      expect(
        delegate.commitApplicationSnapshotAtomically,
      ).not.toHaveBeenCalled();
    },
  );

  it("retains observed settings when a day command needs conflict review", async () => {
    const previous = snapshot();
    previous.eventConsistency.event = {
      ...createEventConsistency(),
      blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
    };
    const review = { status: "review-required" as const };
    const commitDayMutation = vi.fn(async () => review);
    const delegate = createDelegate({
      readApplicationSnapshot: vi.fn(async () => ({
        snapshot: previous,
        expectedRoots: {},
        consistencyMissing: false,
      })),
      commitDayMutation,
    });
    const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
    await adapter.readApplicationSnapshot();
    const command = { kind: "mode" as const, eventName: "event", day: "1日目" };
    const generations = { event: 3 };

    expect(
      await adapter.commitDayMutation!(command, "application:5", generations),
    ).toBe(review);
    expect(commitDayMutation).toHaveBeenCalledExactlyOnceWith(
      command,
      "application:5",
      generations,
    );
    expect(adapter.readBlockDetectionSettings("event")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(delegate.commitApplicationSnapshotAtomically).not.toHaveBeenCalled();
  });

  it("uses the preference port for UI preferences and canonical state for event settings", async () => {
    const delegate = createDelegate(),
      auxiliary = createAuxiliaryDelegate({
        loadPreference: vi.fn(() => "dark"),
      });
    const adapter = createIndexedDbPersistenceCommandAdapter(
      delegate,
      auxiliary,
    );
    const value = snapshot();
    value.eventConsistency.event = {
      ...createEventConsistency(),
      blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
    };
    const save = vi.fn(async () => {});
    const unbind = adapter.bindApplicationSettings({ read: () => value, save });
    expect(adapter.loadPreference("theme")).toBe("dark");
    adapter.savePreference("theme", "light");
    expect(auxiliary.savePreference).toHaveBeenCalledWith("theme", "light");
    expect(adapter.readBlockDetectionSettings("event")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(
      adapter.readBlockDetectionSettingsForBackup(["event", "absent"]),
    ).toEqual({ event: DEFAULT_BLOCK_DETECTION_SETTINGS });
    await adapter.saveBlockDetectionSettings(
      "event",
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(save).toHaveBeenCalledWith(
      "event",
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(auxiliary.saveBlockDetectionSettings).not.toHaveBeenCalled();
    unbind();
    await expect(
      adapter.saveBlockDetectionSettings(
        "event",
        DEFAULT_BLOCK_DETECTION_SETTINGS,
      ),
    ).rejects.toThrow("初期化");
  });
  it("carries application data and block settings through one atomic commit", async () => {
    const delegate = createDelegate(),
      auxiliary = createAuxiliaryDelegate(),
      adapter = createIndexedDbPersistenceCommandAdapter(delegate, auxiliary);
    const value = snapshot();
    value.eventLists.event = [];
    await adapter.restoreAppDataWithBlockDetectionSettings(
      value,
      "event",
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(delegate.commitApplicationSnapshotAtomically).toHaveBeenCalledOnce();
    expect(
      vi.mocked(delegate.commitApplicationSnapshotAtomically).mock.calls[0][0]
        .eventConsistency.event.blockDetectionSettings,
    ).toEqual(DEFAULT_BLOCK_DETECTION_SETTINGS);
    expect(
      auxiliary.runWithBlockDetectionSettingsRestore,
    ).not.toHaveBeenCalled();
    expect(value.eventConsistency).toEqual({});
    expect(adapter.readBlockDetectionSettings("event")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
  });
  it("keeps observed state after failed commit without compensating localStorage writes", async () => {
    const value = snapshot();
    value.eventConsistency.event = {
      ...createEventConsistency(),
      blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
    };
    const failure = new Error("transaction aborted");
    const delegate = createDelegate({
      readApplicationSnapshot: vi.fn(async () => ({
        snapshot: value,
        expectedRoots: {},
        consistencyMissing: false,
      })),
      commitApplicationSnapshotAtomically: vi.fn(async () => {
        throw failure;
      }),
    });
    const auxiliary = createAuxiliaryDelegate(),
      adapter = createIndexedDbPersistenceCommandAdapter(delegate, auxiliary);
    await adapter.readApplicationSnapshot();
    await expect(
      adapter.restoreAppDataWithBlockDetectionSettings(value, "event", null),
    ).rejects.toBe(failure);
    expect(adapter.readBlockDetectionSettings("event")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(auxiliary.saveBlockDetectionSettings).not.toHaveBeenCalled();
    expect(
      auxiliary.runWithBlockDetectionSettingsRestore,
    ).not.toHaveBeenCalled();
  });
  it("renames and deletes settings with the event in the same snapshot", async () => {
    const delegate = createDelegate(),
      adapter = createIndexedDbPersistenceCommandAdapter(
        delegate,
        createAuxiliaryDelegate(),
      );
    const value = snapshot();
    value.eventLists.event = [];
    value.eventConsistency.event = createEventConsistency();
    await adapter.renameEventAtomically(value, "event", "renamed");
    const renamed = vi.mocked(delegate.commitApplicationSnapshotAtomically).mock
      .calls[0][0];
    expect(renamed.eventConsistency).toEqual({
      renamed: createEventConsistency(),
    });
    await adapter.deleteEventAtomically(renamed, "renamed");
    expect(
      vi.mocked(delegate.commitApplicationSnapshotAtomically).mock.calls[1][0]
        .eventConsistency,
    ).toEqual({});
    expect(() => adapter.removeBlockDetectionSettingsForEvent("event")).toThrow(
      "同じ操作",
    );
    expect(() =>
      adapter.renameBlockDetectionSettingsForEvent("event", "other"),
    ).toThrow("同じ操作");
  });
  it("passes caller-observed roots unchanged to the atomic boundary", async () => {
    const delegate = createDelegate(),
      adapter = createIndexedDbPersistenceCommandAdapter(
        delegate,
        createAuxiliaryDelegate(),
      );
    const value = snapshot(),
      options = { expectedRoots: { observation: "captured" } };
    await adapter.commitApplicationSnapshotAtomically(value, options);
    expect(delegate.commitApplicationSnapshotAtomically).toHaveBeenCalledWith(
      value,
      options,
    );
  });
  it("forwards each store save without changing its argument identity", async () => {
    const delegate = createDelegate(),
      adapter = createIndexedDbPersistenceCommandAdapter(
        delegate,
        createAuxiliaryDelegate(),
      );
    const value = snapshot();
    for (const [method, key] of [
      ["saveEventLists", "eventLists"],
      ["saveEventMetadata", "eventMetadata"],
      ["saveExecuteModeItems", "executeModeItems"],
      ["saveDayModes", "dayModes"],
      ["saveMapRotationSettings", "mapRotationSettings"],
      ["saveRouteSettings", "routeSettings"],
      ["saveHallDefinitions", "hallDefinitions"],
      ["saveHallRouteSettings", "hallRouteSettings"],
      ["saveMapViewportSettings", "mapViewportSettings"],
      ["saveEventConsistency", "eventConsistency"],
    ] as const) {
      await (adapter[method] as (input: unknown) => Promise<void>)(value[key]);
      expect(vi.mocked(delegate[method]).mock.calls[0][0]).toBe(value[key]);
    }
    await adapter.saveMapDataChanges({}, value.mapData);
    expect(delegate.saveMapDataChanges).toHaveBeenCalledWith({}, value.mapData);
    const candidate = {} as StartupRecoveryCandidate;
    await adapter.adoptRecoveryCandidate(candidate);
    expect(delegate.adoptRecoveryCandidate).toHaveBeenCalledWith(candidate);
    await adapter.migrateFromLocalStorage();
    expect(delegate.migrateFromLocalStorage).toHaveBeenCalledOnce();
  });
  it("uses browser preferences safely when a window is available or absent", () => {
    const adapter = createIndexedDbPersistenceCommandAdapter(createDelegate());
    const values = new Map<string, string>();
    const browserWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    };
    vi.stubGlobal("window", browserWindow);
    const key = "__adapter_preference_test__";
    try {
      adapter.savePreference(key, "dark");
      expect(adapter.loadPreference(key)).toBe("dark");
      vi.stubGlobal("window", undefined);
      expect(adapter.loadPreference(key)).toBeNull();
      expect(() => adapter.savePreference(key, "light")).not.toThrow();
      expect(browserWindow.localStorage.getItem(key)).toBe("dark");
    } finally {
      vi.unstubAllGlobals();
      browserWindow.localStorage.removeItem(key);
    }
  });
  it("restores into an unobserved adapter and invalidates incoming event histories", async () => {
    const delegate = createDelegate();
    const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
    expect(adapter.readBlockDetectionSettings("missing")).toBeNull();
    expect(adapter.readBlockDetectionSettingsForBackup(["missing"])).toEqual(
      {},
    );
    const incoming = snapshot();
    incoming.eventLists.restored = [];
    await adapter.restoreAppDataAtomically(incoming);
    expect(delegate.commitApplicationSnapshotAtomically).toHaveBeenCalledWith(
      incoming,
      { invalidatedEvents: ["restored"] },
    );
  });
  it("keeps a replacement settings binding when the earlier binding disconnects", async () => {
    const delegate = createDelegate();
    const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
    const previous = snapshot();
    const current = snapshot();
    current.eventConsistency.event = {
      ...createEventConsistency(),
      blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
    };
    const previousSave = vi.fn(async () => {});
    const currentSave = vi.fn(async () => {});
    const disconnectPrevious = adapter.bindApplicationSettings({
      read: () => previous,
      save: previousSave,
    });
    const disconnectCurrent = adapter.bindApplicationSettings({
      read: () => current,
      save: currentSave,
    });
    disconnectPrevious();
    expect(adapter.readBlockDetectionSettings("event")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    await adapter.saveBlockDetectionSettings(
      "event",
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(previousSave).not.toHaveBeenCalled();
    expect(currentSave).toHaveBeenCalledOnce();
    disconnectCurrent();
    expect(adapter.readBlockDetectionSettings("event")).toBeNull();
  });
  it("invalidates the union of replaced and incoming events unless the caller supplies a scope", async () => {
    const previous = snapshot();
    previous.eventLists.removed = [];
    previous.eventLists.retained = [];
    const delegate = createDelegate({
      readApplicationSnapshot: vi.fn(async () => ({
        snapshot: previous,
        expectedRoots: {},
        consistencyMissing: false,
      })),
    });
    const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
    await adapter.readApplicationSnapshot();
    const incoming = snapshot();
    incoming.eventLists.retained = [];
    incoming.eventLists.added = [];
    await adapter.restoreAppDataAtomically(incoming);
    expect(
      delegate.commitApplicationSnapshotAtomically,
    ).toHaveBeenLastCalledWith(incoming, {
      invalidatedEvents: ["removed", "retained", "added"],
    });
    const options = {
      expectedRoots: { source: "caller" },
      invalidatedEvents: [],
    };
    await adapter.restoreAppDataAtomically(incoming, options);
    expect(
      delegate.commitApplicationSnapshotAtomically,
    ).toHaveBeenLastCalledWith(incoming, options);
  });
  it("creates canonical settings for legacy snapshots and updates existing settings without mutating input", async () => {
    const delegate = createDelegate();
    const adapter = createIndexedDbPersistenceCommandAdapter(delegate);
    const legacy = snapshot();
    delete (legacy as Partial<PersistenceSnapshot>).eventConsistency;
    await adapter.restoreAppDataWithBlockDetectionSettings(
      legacy,
      "legacy",
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    expect(legacy).not.toHaveProperty("eventConsistency");
    expect(adapter.readBlockDetectionSettings("legacy")).toEqual(
      DEFAULT_BLOCK_DETECTION_SETTINGS,
    );
    const current = snapshot();
    current.eventConsistency.legacy = createEventConsistency();
    current.eventConsistency.other = {
      ...createEventConsistency(),
      blockDetectionSettings: DEFAULT_BLOCK_DETECTION_SETTINGS,
    };
    await adapter.restoreAppDataWithBlockDetectionSettings(
      current,
      "legacy",
      null,
    );
    expect(adapter.readBlockDetectionSettings("legacy")).toBeNull();
    expect(
      adapter.readBlockDetectionSettingsForBackup(["legacy", "other"]),
    ).toEqual({ other: DEFAULT_BLOCK_DETECTION_SETTINGS });
    expect(current.eventConsistency.legacy).toEqual(createEventConsistency());
    expect(
      delegate.commitApplicationSnapshotAtomically,
    ).toHaveBeenLastCalledWith(
      {
        ...current,
        eventConsistency: {
          ...current.eventConsistency,
          legacy: {
            ...current.eventConsistency.legacy,
            blockDetectionSettings: null,
          },
        },
      },
      { invalidatedEvents: ["legacy"] },
    );
  });
});

it("shares one terminal stop with every non-worker write entry while allowing only a durable backup", async () => {
  const delegate = createDelegate();
  const port = createIndexedDbPersistenceCommandAdapter(delegate);
  const reason = Object.assign(new Error("reload"), {
    name: "CommittedStateApplyError",
  });
  const listener = vi.fn();
  port.onWritesStopped!(listener);
  port.stopWrites!(reason);
  port.stopWrites!(reason);
  expect(listener).toHaveBeenCalledExactlyOnceWith(reason);
  await expect(port.saveEventLists({})).rejects.toBe(reason);
  await expect(port.saveMapDataChanges({}, {})).rejects.toBe(reason);
  await expect(
    port.commitApplicationSnapshotAtomically(snapshot()),
  ).rejects.toBe(reason);
  await expect(port.restoreAppDataAtomically(snapshot())).rejects.toBe(reason);
  await expect(
    port.saveBlockDetectionSettings("event", DEFAULT_BLOCK_DETECTION_SETTINGS),
  ).rejects.toBe(reason);
  expect(delegate.saveEventLists).not.toHaveBeenCalled();
  expect(delegate.commitApplicationSnapshotAtomically).not.toHaveBeenCalled();
  const fallback = vi.fn(() => snapshot());
  const file = await port.createBackupFile!([], fallback);
  expect(file.blob.size).toBeGreaterThan(0);
  expect(delegate.readApplicationSnapshot).toHaveBeenCalledOnce();
  expect(fallback).not.toHaveBeenCalled();
  vi.mocked(delegate.readApplicationSnapshot).mockRejectedValueOnce(
    new Error("read failed"),
  );
  await expect(port.createBackupFile!([], fallback)).rejects.toBe(reason);
  expect(fallback).not.toHaveBeenCalled();
  expect(port.getWriteStopReason!()).toBe(reason);
});

describe("non-worker adapter with real IndexedDB transactions", () => {
  let failNextStorageLength: boolean;
  const storageFailure = new DOMException("storage denied", "SecurityError");
  beforeEach(() => {
    resetDatabaseConnection();
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    vi.stubGlobal("Worker", undefined);
    failNextStorageLength = false;
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        if (failNextStorageLength) {
          failNextStorageLength = false;
          throw storageFailure;
        }
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });
  afterEach(() => {
    resetDatabaseConnection();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function seed() {
    const value = snapshot();
    value.eventLists.event = [{ id: "item-1", quantity: 1 }];
    value.eventConsistency.event = createEventConsistency();
    const initial = await db.readApplicationSnapshot();
    await db.commitApplicationSnapshotAtomically(value, {
      expectedRoots: initial.expectedRoots,
    });
    return value;
  }
  it("stops every write with the same reason when storage access fails after DB commit", async () => {
    await seed();
    const optionalWrite = vi.fn(async () => {
      throw new Error("a stopped delegate must not be invoked");
    });
    const auxiliary = createAuxiliaryDelegate();
    const port = createIndexedDbPersistenceCommandAdapter(
      {
        ...db,
        readDayApplicationSnapshot: () => db.readApplicationSnapshot(),
        commitDayApplicationSnapshot: optionalWrite,
        commitDayMutation: optionalWrite,
        commitItemContentEdits: optionalWrite,
      },
      auxiliary,
    );
    const listener = vi.fn();
    port.onWritesStopped!(listener);
    const before = await port.readApplicationSnapshot();
    const next = structuredClone(before.snapshot);
    next.eventLists.event = [{ id: "item-1", quantity: 2 }];
    const database = await openDatabase();
    const original = database.transaction;
    let startedWrites = 0;
    let completedWrites = 0;
    vi.spyOn(database, "transaction").mockImplementation(function (
      this: IDBDatabase,
      storeNames,
      mode,
      options,
    ) {
      const transaction = original.call(this, storeNames, mode, options);
      if (mode === "readwrite") {
        startedWrites++;
        transaction.addEventListener("complete", () => {
          completedWrites++;
          failNextStorageLength = true;
        });
      }
      return transaction;
    });
    const reason = await port
      .commitApplicationSnapshotAtomically(next, {
        expectedRoots: before.expectedRoots,
      })
      .catch((error: unknown) => error);
    expect(reason).toBeInstanceOf(PersistenceOutcomeUnknownError);
    expect(reason).toMatchObject({ cause: storageFailure });
    expect(port.getWriteStopReason!()).toBe(reason);
    expect(listener).toHaveBeenCalledExactlyOnceWith(reason);
    expect(startedWrites).toBe(1);
    expect(completedWrites).toBe(1);
    expect(
      (await port.readApplicationSnapshot()).snapshot.eventLists.event,
    ).toEqual([{ id: "item-1", quantity: 2 }]);

    const later = structuredClone(next);
    later.eventLists.event = [{ id: "item-1", quantity: 3 }];
    const target = { eventName: "event", day: "day-1" };
    const writes = [
      () => port.migrateFromLocalStorage(),
      () => port.adoptRecoveryCandidate({} as StartupRecoveryCandidate),
      () => port.saveEventLists(later.eventLists),
      () => port.saveEventMetadata(later.eventMetadata),
      () => port.saveExecuteModeItems(later.executeModeItems),
      () => port.saveDayModes(later.dayModes),
      () => port.saveMapDataChanges(next.mapData, later.mapData),
      () => port.saveMapRotationSettings(later.mapRotationSettings),
      () => port.saveRouteSettings(later.routeSettings),
      () => port.saveHallDefinitions(later.hallDefinitions),
      () => port.saveHallRouteSettings(later.hallRouteSettings),
      () => port.saveMapViewportSettings(later.mapViewportSettings),
      () => port.saveEventConsistency(later.eventConsistency),
      () =>
        port.saveBlockDetectionSettings(
          "event",
          DEFAULT_BLOCK_DETECTION_SETTINGS,
        ),
      () => port.commitApplicationSnapshotAtomically(later),
      () =>
        port.commitDayApplicationSnapshot!(later, before.expectedRoots, target),
      () =>
        port.commitDayMutation!(
          { kind: "mode", ...target, mode: "focus" },
          "later",
          {},
        ),
      () => port.commitItemContentEdits!([], ["later"], {}),
      () => port.restoreAppDataAtomically(later),
      () => port.deleteEventAtomically(later, "event"),
      () => port.renameEventAtomically(later, "event", "renamed"),
      () => port.restoreAppDataWithBlockDetectionSettings(later, "event", null),
    ];
    for (const write of writes) await expect(write()).rejects.toBe(reason);
    expect(() => port.savePreference("theme", "dark")).toThrow(reason);
    expect(() => port.removeBlockDetectionSettingsForEvent("event")).toThrow(
      reason,
    );
    expect(() =>
      port.renameBlockDetectionSettingsForEvent("event", "renamed"),
    ).toThrow(reason);
    expect(optionalWrite).not.toHaveBeenCalled();
    expect(auxiliary.savePreference).not.toHaveBeenCalled();
    expect(startedWrites).toBe(1);
    expect(completedWrites).toBe(1);
    expect(
      (await port.readApplicationSnapshot()).snapshot.eventLists.event,
    ).toEqual([{ id: "item-1", quantity: 2 }]);
    expect(listener).toHaveBeenCalledOnce();
  });
  it("allows retry after an explicit transaction abort without stopping writes", async () => {
    await seed();
    const port = createIndexedDbPersistenceCommandAdapter();
    const before = await port.readApplicationSnapshot();
    const next = structuredClone(before.snapshot);
    next.eventLists.event = [{ id: "item-1", quantity: 2 }];
    const failure = new Error("explicit transaction abort");
    const original = IDBObjectStore.prototype.put;
    let abortNextWrite = true;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      if (this.name === STORES.EVENT_LISTS && abortNextWrite) {
        abortNextWrite = false;
        throw failure;
      }
      return original.call(this, value, key);
    });
    await expect(
      port.commitApplicationSnapshotAtomically(next, {
        expectedRoots: before.expectedRoots,
      }),
    ).rejects.toBe(failure);
    expect(port.getWriteStopReason!()).toBeUndefined();
    expect(
      (await port.readApplicationSnapshot()).snapshot.eventLists.event,
    ).toEqual([{ id: "item-1", quantity: 1 }]);
    await port.commitApplicationSnapshotAtomically(next, {
      expectedRoots: before.expectedRoots,
    });
    expect(
      (await port.readApplicationSnapshot()).snapshot.eventLists.event,
    ).toEqual([{ id: "item-1", quantity: 2 }]);
    expect(port.getWriteStopReason!()).toBeUndefined();
  });
});
