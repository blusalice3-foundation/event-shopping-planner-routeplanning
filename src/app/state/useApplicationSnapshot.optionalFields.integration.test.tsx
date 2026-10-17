import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApplicationSnapshot } from "./useApplicationSnapshot";
import { useIndexedDbPersistence } from "../../hooks/useIndexedDbPersistence";
import { resetDatabaseConnection } from "../../persistence/db/openDatabase";
import { db } from "../../utils/indexedDB";
import {
  fresh,
  port,
  seed,
} from "../../test/sheetImportOptionalUrlPersistence";
import {
  SHEET_EVENT,
  sheetItem,
  sheetSnapshot,
} from "../../test/sheetImportOptionalUrlFixtures";
const options = { interval: 1, timeout: 10000 };
afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function harness(mode: string) {
  fresh();
  await seed(sheetSnapshot());
  const commands = port(mode);
  const atomic = vi.spyOn(commands, "commitApplicationSnapshotAtomically");
  const partial = commands.commitItemContentEdits
    ? vi.spyOn(commands, "commitItemContentEdits")
    : null;
  const h = renderHook(() => {
    const application = useApplicationSnapshot(commands, SHEET_EVENT, "1日目");
    const persistence = useIndexedDbPersistence({
      values: application.raw,
      setters: application.hydrationSetters,
      onHydratedSnapshot: application.coordinator.initializeEventGenerations,
      persistenceCommands: commands,
      externalMutations: true,
    });
    application.handlers.current = {
      drain: persistence.flushPendingSave,
      observeSnapshot: persistence.observeSnapshot,
      applied: persistence.acceptCommittedSnapshot,
    };
    return { application, persistence };
  });
  await waitFor(
    () => expect(h.result.current.persistence.isInitialized).toBe(true),
    options,
  );
  return { ...h, commands, atomic, partial };
}
for (const mode of ["direct", "worker"])
  describe(`optional fields queued operations: ${mode}`, () => {
    it("replans an accepted undefined-URL addition without losing later edits or operation order", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const h = await harness(mode);
      const failed = vi
        .spyOn(h.commands, "commitApplicationSnapshotAtomically")
        .mockRejectedValueOnce(new DOMException("injected", "AbortError"));
      act(() =>
        h.result.current.application.setters.setEventLists((lists) => ({
          ...lists,
          [SHEET_EVENT]: [
            ...lists[SHEET_EVENT],
            { ...sheetItem(2), url: undefined, assignedTo: undefined },
          ],
        })),
      );
      await waitFor(
        () => expect(h.result.current.application.confirmations.length).toBe(1),
        options,
      );
      act(() =>
        h.result.current.application.confirm(
          h.result.current.application.confirmations[0].token,
        ),
      );
      await waitFor(
        () =>
          expect(h.result.current.application.retryableFailures).toHaveLength(
            1,
          ),
        options,
      );
      expect(
        (await db.readApplicationSnapshot()).snapshot.eventLists[SHEET_EVENT],
      ).toHaveLength(2);
      act(() =>
        h.result.current.application.updateItemFields({
          eventName: SHEET_EVENT,
          itemId: "item-0",
          baseline: sheetItem(),
          changes: { remarks: "保存待ち中の編集" },
        }),
      );
      act(() => h.result.current.application.retryPending());
      await waitFor(
        () =>
          expect(
            h.result.current.application.pendingCount === 0 ||
              h.result.current.application.confirmations.length > 0,
          ).toBe(true),
        options,
      );
      if (h.result.current.application.confirmations.length)
        act(() =>
          h.result.current.application.confirm(
            h.result.current.application.confirmations[0].token,
          ),
        );
      await waitFor(
        () => expect(h.result.current.application.pendingCount).toBe(0),
        options,
      );
      const stored = (await h.commands.readApplicationSnapshot()).snapshot;
      expect(stored.eventLists[SHEET_EVENT]).toHaveLength(3);
      expect(stored.eventLists[SHEET_EVENT][0]).toMatchObject({
        remarks: "保存待ち中の編集",
      });
      const added = stored.eventLists[SHEET_EVENT][2];
      expect(Object.prototype.hasOwnProperty.call(added, "url")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(added, "assignedTo")).toBe(
        false,
      );
      expect(h.result.current.application.raw.eventLists[SHEET_EVENT]).toEqual(
        stored.eventLists[SHEET_EVENT],
      );
      expect(failed.mock.calls.length).toBeGreaterThanOrEqual(2);
      h.unmount();
    });
    it("keeps purchase and quantity edits on the item-command path with no URL structural change", async () => {
      const h = await harness(mode);
      const { atomic, partial } = h;
      act(() =>
        h.result.current.application.updateItemFields({
          eventName: SHEET_EVENT,
          itemId: "item-0",
          baseline: sheetItem(),
          changes: { purchaseStatus: "Purchased", quantity: 3 },
        }),
      );
      await waitFor(
        () => expect(partial ?? atomic).toHaveBeenCalledOnce(),
        options,
      );
      await waitFor(
        () => expect(h.result.current.application.pendingCount).toBe(0),
        options,
      );
      if (partial) {
        expect(atomic).not.toHaveBeenCalled();
        const edits = partial.mock.calls[0][0];
        expect(
          edits.every(
            (edit) => !Object.prototype.hasOwnProperty.call(edit.fields, "url"),
          ),
        ).toBe(true);
      } else {
        expect(
          Object.prototype.hasOwnProperty.call(
            atomic.mock.calls[0][0].eventLists[SHEET_EVENT][0],
            "url",
          ),
        ).toBe(false);
      }
      expect(
        (await db.readApplicationSnapshot()).snapshot.eventLists[
          SHEET_EVENT
        ][0],
      ).toMatchObject({ quantity: 3, purchaseStatus: "Purchased" });
      h.unmount();
    });
  });
