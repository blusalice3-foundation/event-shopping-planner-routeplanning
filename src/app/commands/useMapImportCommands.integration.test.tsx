// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "../state/useApplicationSnapshot";
import { useAppOverlayController } from "../state/useAppOverlayController";
import { useMapImportCommands } from "./useMapImportCommands";
import type { PersistenceCommandPort } from "../ports/PersistenceCommandPort";
import { migrateLegacyConsistency } from "../../features/consistency/domain/migration";
import {
  commitApplicationSnapshotAtomically,
  readApplicationSnapshot,
} from "../../persistence/db/atomicRestoreTransaction";
import { resetDatabaseConnection } from "../../persistence/db/openDatabase";
import { DEFAULT_BLOCK_DETECTION_SETTINGS } from "../../types/map";

const EVENT = "地図取込の取消";
const DAY = "1日目";
const MAP = "1日目マップ";
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
      numberCells: [{ row: 2, col: 2, value: 1 }],
    },
  ],
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
});
afterEach(() => {
  resetDatabaseConnection();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function connectedImport(withMap: boolean) {
  const { eventConsistency: _old, ...empty } = emptyApplicationSnapshot();
  const seed = migrateLegacyConsistency({
    ...empty,
    eventLists: {
      [EVENT]: [
        {
          id: "1",
          eventDate: DAY,
          block: "A",
          number: "1",
          circle: "ユーザー登録",
          title: "新刊",
          quantity: 1,
          price: 500,
          purchaseStatus: "None",
          remarks: "保持",
        },
      ],
    },
    executeModeItems: { [EVENT]: { [DAY]: ["1"] } },
    mapData: { [EVENT]: withMap ? { [MAP]: map } : {} },
    hallDefinitions: {
      [EVENT]: withMap
        ? {
            [MAP]: [
              {
                id: "hall",
                name: "東館",
                vertices: [
                  { row: 1, col: 1 },
                  { row: 1, col: 5 },
                  { row: 5, col: 5 },
                  { row: 5, col: 1 },
                ],
              },
            ],
          }
        : {},
    },
  }).data;
  const first = await readApplicationSnapshot();
  await commitApplicationSnapshotAtomically(seed, {
    expectedRoots: first.expectedRoots,
  });
  const saved = (await readApplicationSnapshot()).snapshot;
  const control: { readGate: ReturnType<typeof deferred> | null } = {
    readGate: null,
  };
  const read = vi.fn(async () => {
    const gate = control.readGate;
    if (gate) await gate.promise;
    return readApplicationSnapshot();
  });
  const commit = vi.fn(commitApplicationSnapshotAtomically);
  const port = {
    readApplicationSnapshot: read,
    commitApplicationSnapshotAtomically: commit,
    bindApplicationSettings: () => () => {},
  } as unknown as PersistenceCommandPort;
  let nextId = 0;
  const navigate = vi.fn();
  const notify = vi.fn();
  const hook = renderHook(() => {
    const application = useApplicationSnapshot(port, EVENT, DAY);
    const overlay = useAppOverlayController();
    const commands = useMapImportCommands({
      fileInput: { current: null },
      state: {
        ...application.values,
        pendingEventName: overlay.readModel.mapImportPendingEventName,
        pendingReimport: overlay.readModel.pendingMapReimport,
        mapViewActive: true,
        importSessionId:
          overlay.state.mapImport.kind === "inactive"
            ? null
            : overlay.state.mapImport.requestId,
      },
      actions: {
        setEventLists: vi.fn(),
        setMapData: vi.fn(),
        setMapRotationSettings: vi.fn(),
        setRouteSettings: vi.fn(),
        setHallDefinitions: vi.fn(),
        setHallRouteSettings: vi.fn(),
        setMapViewportSettings: vi.fn(),
        openImport: overlay.commands.mapImport.open,
        requestReimport: overlay.commands.mapImport.requestReimport,
        closeImportDialog: overlay.commands.mapImport.closeDialog,
        cancelReimport: overlay.commands.mapImport.cancelReimport,
        confirmReimport: overlay.commands.mapImport.confirmReimport,
      },
      settings: {
        commitApplicationSnapshotPatch: application.commitPatch,
        startImportMutation: (intent) => {
          const id = `owned-import-${++nextId}`;
          const result = application.request({ ...intent, id });
          return {
            result,
            cancel: () => application.cancelPendingMutation(id),
            getState: () => application.getPendingMutationState(id),
          };
        },
      },
      navigation: { openEvent: navigate },
      effects: { notify, reportDiagnostic: vi.fn() },
    });
    return { application, overlay, commands };
  });
  act(() => {
    for (const [key, value] of Object.entries(saved)) {
      const setters = hook.result.current.application.hydrationSetters;
      const name =
        `set${key[0].toUpperCase()}${key.slice(1)}` as keyof typeof setters;
      setters[name](value as never);
    }
  });
  function choose(name: string) {
    const file = new File([name], name);
    const target = {
      files: [file],
      dataset: { eventName: EVENT },
      value: name,
    } as unknown as HTMLInputElement;
    act(() =>
      hook.result.current.commands.selectFile({
        target,
      } as ChangeEvent<HTMLInputElement>),
    );
    return file;
  }
  choose("A.xlsx");
  return { ...hook, control, read, commit, navigate, notify, choose };
}

it.each(["initial", "reimport-review", "reimport-direct"] as const)(
  "terminates a %s request during the first durable read and preserves the next file",
  async (kind) => {
    const h = await connectedImport(kind !== "initial");
    if (kind !== "initial") {
      await act(async () =>
        h.result.current.commands.prepareImport(
          { [MAP]: map },
          DEFAULT_BLOCK_DETECTION_SETTINGS,
          {},
        ),
      );
      expect(h.result.current.overlay.state.mapImport.kind).toBe("reimport");
    }
    const gate = deferred();
    h.control.readGate = gate;
    let operation!: Promise<void>;
    act(() => {
      operation =
        kind === "initial"
          ? h.result.current.commands.prepareImport(
              { [MAP]: map },
              DEFAULT_BLOCK_DETECTION_SETTINGS,
              {},
            )
          : h.result.current.commands.confirmReimport({
              preserveMaplessHalls: true,
              skipImpactConfirmation: kind === "reimport-direct",
            });
    });
    await waitFor(() => expect(h.read).toHaveBeenCalled());
    expect(h.result.current.commands.requestPending).toBe(true);
    expect(h.result.current.commands.canCancel).toBe(true);
    act(() =>
      kind === "initial"
        ? h.result.current.commands.closeImport()
        : h.result.current.commands.cancelReimport(),
    );
    const fileB = h.choose("B.xlsx");
    h.control.readGate = null;
    await act(async () => {
      gate.resolve();
      await operation;
      await h.result.current.application.coordinator.enqueue(() => undefined);
    });
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.result.current.application.confirmations).toEqual([]);
    expect(h.result.current.application.isPending()).toBe(false);
    expect(h.result.current.overlay.readModel.mapImportPendingFile).toBe(fileB);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "uses current confirmation busy to accept or refuse map import cancellation (confirm accepted=%s)",
  async (accept) => {
    const h = await connectedImport(true);
    await act(async () =>
      h.result.current.commands.prepareImport(
        { [MAP]: map },
        DEFAULT_BLOCK_DETECTION_SETTINGS,
        {},
      ),
    );
    let operation!: Promise<void>;
    act(() => {
      operation = h.result.current.commands.confirmReimport({
        preserveMaplessHalls: true,
      });
    });
    await waitFor(() =>
      expect(h.result.current.application.confirmations).toHaveLength(1),
    );
    expect(h.result.current.commands.canCancel).toBe(true);
    if (!accept) {
      act(() => h.result.current.commands.cancelReimport());
      await act(async () => operation);
      expect(h.result.current.application.confirmations).toEqual([]);
      expect(h.commit).not.toHaveBeenCalled();
      expect(h.result.current.overlay.state.mapImport.kind).toBe("inactive");
    } else {
      const gate = deferred();
      h.control.readGate = gate;
      act(() => {
        h.result.current.application.confirm(
          h.result.current.application.confirmations[0].token,
        );
        h.result.current.commands.cancelReimport();
      });
      expect(h.result.current.commands.requestPending).toBe(true);
      expect(h.result.current.commands.canCancel).toBe(false);
      expect(h.result.current.overlay.state.mapImport.kind).toBe("reimport");
      h.control.readGate = null;
      await act(async () => {
        gate.resolve();
        await operation;
      });
      expect(h.commit).toHaveBeenCalledOnce();
      expect(h.result.current.overlay.state.mapImport.kind).toBe("inactive");
      expect(h.navigate).toHaveBeenCalledOnce();
    }
  },
);
