import { useRef } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportScreen from "../../components/ImportScreen";
import { useApplicationSnapshot } from "../state/useApplicationSnapshot";
import { useIndexedDbPersistence } from "../../hooks/useIndexedDbPersistence";
import {
  useShoppingItemMutationCommands,
  type ShoppingItemMutationCommandPorts,
} from "./useShoppingItemMutationCommands";
import {
  fresh,
  port,
  seed,
} from "../../test/sheetImportOptionalUrlPersistence";
import {
  sheetSnapshot,
  SHEET_EVENT,
} from "../../test/sheetImportOptionalUrlFixtures";
import { db } from "../../utils/indexedDB";
import { resetDatabaseConnection } from "../../persistence/db/openDatabase";
import type { BulkAddMetadata } from "../../features/events/bulkAdd";
import type { ShoppingItem } from "../../types/item";
const options = { interval: 1, timeout: 10000 };
afterEach(() => {
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
for (const mode of ["direct", "worker"])
  describe(`bulk import identity and persistence: ${mode}`, () => {
    it.each([false, true])(
      "keeps exact source references, generated IDs, ordering and layout across normalization and retry=%s",
      async (retry) => {
        fresh();
        vi.spyOn(window, "alert").mockImplementation(() => {});
        vi.spyOn(window, "confirm").mockReturnValue(true);
        vi.spyOn(console, "error").mockImplementation(() => {});
        const empty = sheetSnapshot(0);
        delete empty.eventLists[SHEET_EVENT];
        delete empty.eventConsistency[SHEET_EVENT];
        delete empty.dayModes[SHEET_EVENT];
        delete empty.executeModeItems[SHEET_EVENT];
        await seed(empty);
        const persistenceCommands = port(mode);
        let application!: ReturnType<typeof useApplicationSnapshot>;
        const submissions: Array<{
          items: Omit<ShoppingItem, "id" | "purchaseStatus">[];
          metadata?: BulkAddMetadata;
        }> = [];
        function Harness() {
          application = useApplicationSnapshot(
            persistenceCommands,
            null,
            "1日目",
          );
          const persistence = useIndexedDbPersistence({
            values: application.raw,
            setters: application.hydrationSetters,
            onHydratedSnapshot:
              application.coordinator.initializeEventGenerations,
            persistenceCommands,
            externalMutations: true,
          });
          application.handlers.current = {
            drain: persistence.flushPendingSave,
            observeSnapshot: persistence.observeSnapshot,
            applied: persistence.acceptCommittedSnapshot,
          };
          const eventListsRef = useRef(application.values.eventLists);
          eventListsRef.current = application.values.eventLists;
          const executeModeItemsRef = useRef(
            application.values.executeModeItems,
          );
          executeModeItemsRef.current = application.values.executeModeItems;
          const commandPorts = {
            state: {
              activeEventName: null,
              activeEventDate: "1日目",
              eventLists: application.values.eventLists,
              eventListsRef,
              eventMetadata: application.values.eventMetadata,
              dayModes: application.values.dayModes,
              items: [],
              executeModeItemsRef,
              eventUpdatePreviewEpochRef: useRef(0),
            },
            actions: {
              ...application.setters,
              updateExecuteModeItems: application.setters.setExecuteModeItems,
              navigation: { openEvent: vi.fn(), showImport: vi.fn() },
            },
            selectors: {},
            alerts: { notify: vi.fn() },
            persistence: {
              commitApplicationSnapshotPatch: application.commitPatch,
            },
          } as unknown as ShoppingItemMutationCommandPorts;
          const commands = useShoppingItemMutationCommands(commandPorts);
          return persistence.isInitialized ? (
            <ImportScreen
              activeEventName={null}
              itemToEdit={null}
              onUpdateItem={vi.fn()}
              onDoneEditing={vi.fn()}
              onBulkAdd={(name, items, metadata) => {
                submissions.push({ items, metadata });
                return commands.handleBulkAdd(name, items, metadata);
              }}
            />
          ) : (
            <p>起動中</p>
          );
        }
        const h = render(<Harness />);
        await screen.findByLabelText("即売会名");
        const commit = retry
          ? vi
              .spyOn(persistenceCommands, "commitApplicationSnapshotAtomically")
              .mockRejectedValue(
                Object.assign(new Error("injected CAS conflict"), {
                  name: "PersistenceConflict",
                }),
              )
          : null;
        fireEvent.change(screen.getByLabelText("即売会名"), {
          target: { value: "新規配置" },
        });
        const csv = [
          "サークル名,参加日,ブロック,番号,タイトル,価格,数量,状態,備考,列,順序,URL",
          "同一サークル,1日目,,1,新刊,100,1,,,実行列,1,https://excluded.test",
          "同一サークル,1日目,A,1,新刊,500,1,,,実行列,3,",
          "同一サークル,1日目,A,1,新刊,700,1,,,候補リスト,1,",
          "同一サークル,1日目,A,1,新刊,900,21,,,実行列,1,https://quantity.test",
        ].join("\n");
        const file = new File([csv], "items.csv", { type: "text/csv" });
        Object.defineProperty(file, "text", { value: async () => csv });
        fireEvent.change(screen.getByLabelText("CSVファイルからインポート"), {
          target: { files: [file] },
        });
        await waitFor(
          () => expect(application.confirmations.length).toBe(1),
          options,
        );
        act(() => application.confirm(application.confirmations[0].token));
        if (retry) {
          await waitFor(
            () => expect(application.retryableFailures).toHaveLength(1),
            options,
          );
          expect(
            (await db.readApplicationSnapshot()).snapshot.eventLists,
          ).toEqual({});
          commit!.mockRestore();
          act(() => application.retryPending());
          await waitFor(
            () =>
              expect(
                application.confirmations.length ||
                  application.pendingCount === 0,
              ).toBeTruthy(),
            options,
          );
          if (application.confirmations.length)
            act(() => application.confirm(application.confirmations[0].token));
        }
        await waitFor(
          () =>
            expect(
              screen.queryByRole("button", { name: "選択したCSVを再試行" }),
            ).not.toBeInTheDocument(),
          options,
        );
        await waitFor(
          async () =>
            expect(
              (await db.readApplicationSnapshot()).snapshot.eventLists[
                "新規配置"
              ],
            ).toHaveLength(2),
          options,
        );
        expect(submissions).toHaveLength(1);
        const { items, metadata } = submissions[0];
        expect(items.map((item) => item.price)).toEqual([500, 700]);
        metadata!.sourceRows!.forEach((row, index) =>
          expect(row.item).toBe(items[index]),
        );
        expect(metadata!.sourceRows!.map((row) => row.sourceRowId)).toEqual([
          "csv:2:3",
          "csv:3:4",
        ]);
        const stored = (await persistenceCommands.readApplicationSnapshot())
          .snapshot;
        const saved = stored.eventLists["新規配置"] as ShoppingItem[];
        expect(saved.map((item) => [item.price, item.url])).toEqual([
          [500, "https://quantity.test"],
          [700, "https://quantity.test"],
        ]);
        expect(stored.executeModeItems["新規配置"]["1日目"]).toEqual([
          saved[0].id,
        ]);
        expect(new Set(saved.map((item) => item.id)).size).toBe(2);
        expect((await db.readApplicationSnapshot()).snapshot).toEqual(stored);
        expect(application.raw.eventLists["新規配置"]).toEqual(saved);
        commit?.mockRestore();
        h.unmount();
      },
    );
  });
