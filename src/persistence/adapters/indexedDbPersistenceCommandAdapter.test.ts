import { createEventConsistency } from "../../types/consistency";
import { DEFAULT_BLOCK_DETECTION_SETTINGS } from "../../types/map";
import { describe, expect, it, vi } from "vitest";
import { type PersistenceSnapshot } from "../../app/ports/PersistenceCommandPort";
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
