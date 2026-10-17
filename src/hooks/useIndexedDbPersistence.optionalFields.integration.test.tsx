import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIndexedDbPersistence } from "./useIndexedDbPersistence";
import { emptyApplicationSnapshot } from "../app/state/useApplicationSnapshot";
import {
  resetDatabaseConnection,
  openDatabase,
} from "../persistence/db/openDatabase";
import { CONSISTENCY_ARCHIVE_KEY } from "../persistence/db/constants";
import { db } from "../utils/indexedDB";
import {
  fresh,
  port,
  seed,
  setters,
  commits,
} from "../test/sheetImportOptionalUrlPersistence";
import {
  SHEET_EVENT,
  sheetSnapshot,
} from "../test/sheetImportOptionalUrlFixtures";
const options = { interval: 1, timeout: 10000 };
afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
for (const mode of ["direct", "worker"]) {
  describe(`optional fields startup using ${mode} storage`, () => {
    for (const prepared of [false, true])
      for (const url of [undefined, "", "　 "]) {
        it(`normalizes legacy URL ${String(url)} with prepared=${prepared}, updates roots, and never repeats the migration`, async () => {
          fresh();
          const targetSetters = setters();
          const original = sheetSnapshot();
          Object.assign(original.eventLists[SHEET_EVENT][0], {
            url,
            assignedTo: undefined,
          });
          await seed(original, prepared);
          const commands = port(mode);
          const observed = vi.fn();
          const counter = commits();
          const h = renderHook(() =>
            useIndexedDbPersistence({
              values: {
                ...emptyApplicationSnapshot(),
                mapViewportSettings: {},
              },
              setters: targetSetters,
              persistenceCommands: commands,
              externalMutations: true,
              onHydratedSnapshot: observed,
            }),
          );
          await waitFor(
            () => expect(h.result.current.isInitialized).toBe(true),
            options,
          );
          const read = observed.mock.calls[0][0];
          expect(
            Object.prototype.hasOwnProperty.call(
              read.snapshot.eventLists[SHEET_EVENT][0],
              "url",
            ),
          ).toBe(false);
          expect(
            Object.prototype.hasOwnProperty.call(
              read.snapshot.eventLists[SHEET_EVENT][0],
              "assignedTo",
            ),
          ).toBe(false);
          expect(counter.result.successes).toBe(
            mode === "worker" && !prepared ? 2 : 1,
          );
          expect(
            Object.prototype.hasOwnProperty.call(
              original.eventLists[SHEET_EVENT][0],
              "url",
            ),
          ).toBe(true);
          const saved = await db.readApplicationSnapshot();
          expect(saved.snapshot).toEqual(read.snapshot);
          expect(
            Object.prototype.hasOwnProperty.call(
              saved.snapshot.eventLists[SHEET_EVENT][0],
              "url",
            ),
          ).toBe(false);
          await commands.commitApplicationSnapshotAtomically(read.snapshot, {
            expectedRoots: read.expectedRoots,
          });
          h.unmount();
          const successes = counter.result.successes;
          const again = renderHook(() =>
            useIndexedDbPersistence({
              values: {
                ...emptyApplicationSnapshot(),
                mapViewportSettings: {},
              },
              setters: targetSetters,
              persistenceCommands: commands,
              externalMutations: true,
            }),
          );
          await waitFor(
            () => expect(again.result.current.isInitialized).toBe(true),
            options,
          );
          expect(counter.result.successes).toBe(successes);
          counter.stop();
          again.unmount();
        });
      }
    it.each([false, true])(
      "canonical data adds no URL migration save (prepared=%s)",
      async (prepared) => {
        fresh();
        const targetSetters = setters();
        await seed(sheetSnapshot(), prepared);
        const commands = port(mode);
        const counter = commits();
        const h = renderHook(() =>
          useIndexedDbPersistence({
            values: { ...emptyApplicationSnapshot(), mapViewportSettings: {} },
            setters: targetSetters,
            persistenceCommands: commands,
            externalMutations: true,
          }),
        );
        await waitFor(
          () => expect(h.result.current.isInitialized).toBe(true),
          options,
        );
        expect(counter.result.successes).toBe(
          mode === "worker" && !prepared ? 1 : 0,
        );
        counter.stop();
        h.unmount();
      },
    );
    it("B06: aborts a lower atomic transaction, retains source data, and retries both preparation and compatibility work", async () => {
      fresh();
      const targetSetters = setters();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const original = sheetSnapshot();
      Object.assign(original.eventLists[SHEET_EVENT][0], { url: "" });
      await seed(original, false);
      const counter = commits();
      counter.failNext();
      const commands = port(mode);
      const observed = vi.fn();
      const h = renderHook(() =>
        useIndexedDbPersistence({
          values: { ...emptyApplicationSnapshot(), mapViewportSettings: {} },
          setters: targetSetters,
          persistenceCommands: commands,
          externalMutations: true,
          onHydratedSnapshot: observed,
        }),
      );
      await waitFor(
        () =>
          expect(h.result.current.startupState.status).toBe(
            "recovery-required",
          ),
        options,
      );
      expect(observed).not.toHaveBeenCalled();
      expect(
        (await db.readApplicationSnapshot()).snapshot.eventLists[
          SHEET_EVENT
        ][0],
      ).toHaveProperty("url", "");
      expect(counter.result.aborted).toBe(1);
      await act(async () => h.result.current.retryInitialization());
      await waitFor(
        () => expect(h.result.current.isInitialized).toBe(true),
        options,
      );
      expect(counter.result.successes).toBe(mode === "worker" ? 2 : 1);
      expect((await db.readApplicationSnapshot()).snapshot).toEqual(
        observed.mock.calls[0][0].snapshot,
      );
      counter.stop();
      h.unmount();
    });
    it("keeps the original legacy migration archive while sharing one compatibility commit and hydrating fresh roots", async () => {
      fresh();
      const targetSetters = setters();
      const original = sheetSnapshot();
      Object.assign(original.eventLists[SHEET_EVENT][0], { url: undefined });
      await db.readApplicationSnapshot();
      await db.saveEventLists(original.eventLists as never);
      await db.saveExecuteModeItems(original.executeModeItems as never);
      const counter = commits();
      const observed = vi.fn();
      const commands = port(mode);
      const h = renderHook(() =>
        useIndexedDbPersistence({
          values: { ...emptyApplicationSnapshot(), mapViewportSettings: {} },
          setters: targetSetters,
          persistenceCommands: commands,
          externalMutations: true,
          onHydratedSnapshot: observed,
        }),
      );
      await waitFor(
        () => expect(h.result.current.isInitialized).toBe(true),
        options,
      );
      expect(counter.result.successes).toBe(1);
      const database = await openDatabase();
      const archive = await new Promise<{ source: typeof original }>(
        (resolve, reject) => {
          const request = database
            .transaction("syncQueue")
            .objectStore("syncQueue")
            .get(CONSISTENCY_ARCHIVE_KEY);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      expect(
        Object.prototype.hasOwnProperty.call(
          archive.source.eventLists[SHEET_EVENT][0],
          "url",
        ),
      ).toBe(true);
      const read = observed.mock.calls[0][0];
      expect(
        Object.prototype.hasOwnProperty.call(
          read.snapshot.eventLists[SHEET_EVENT][0],
          "url",
        ),
      ).toBe(false);
      await commands.commitApplicationSnapshotAtomically(read.snapshot, {
        expectedRoots: read.expectedRoots,
      });
      counter.stop();
      h.unmount();
    });
    it("uses a changed durable revision on retry without overwriting accepted remote values", async () => {
      fresh();
      const targetSetters = setters();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const original = sheetSnapshot();
      Object.assign(original.eventLists[SHEET_EVENT][0], { url: "" });
      await seed(original);
      const commands = port(mode);
      const commit =
        commands.commitApplicationSnapshotAtomically.bind(commands);
      vi.spyOn(
        commands,
        "commitApplicationSnapshotAtomically",
      ).mockImplementationOnce(async (snapshot, options) => {
        const remote = await db.readApplicationSnapshot();
        Object.assign(remote.snapshot.eventLists[SHEET_EVENT][0] as object, {
          remarks: "保存待ち中の変更",
        });
        await db.commitApplicationSnapshotAtomically(remote.snapshot, {
          expectedRoots: remote.expectedRoots,
        });
        await commit(snapshot, options);
      });
      const observed = vi.fn();
      const h = renderHook(() =>
        useIndexedDbPersistence({
          values: { ...emptyApplicationSnapshot(), mapViewportSettings: {} },
          setters: targetSetters,
          persistenceCommands: commands,
          externalMutations: true,
          onHydratedSnapshot: observed,
        }),
      );
      await waitFor(
        () =>
          expect(h.result.current.startupState.status).toBe(
            "recovery-required",
          ),
        options,
      );
      expect(observed).not.toHaveBeenCalled();
      await act(async () => h.result.current.retryInitialization());
      await waitFor(
        () => expect(h.result.current.isInitialized).toBe(true),
        options,
      );
      expect(
        observed.mock.calls[0][0].snapshot.eventLists[SHEET_EVENT][0].remarks,
      ).toBe("保存待ち中の変更");
      h.unmount();
    });
  });
}
