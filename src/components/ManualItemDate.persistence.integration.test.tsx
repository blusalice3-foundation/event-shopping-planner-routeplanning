import { useRef } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import { createEventConsistency } from "../types/consistency";
import { createIndexedDbPersistenceCommandAdapter } from "../persistence/adapters/indexedDbPersistenceCommandAdapter";
import { resetDatabaseConnection } from "../persistence/db/openDatabase";
import { useIndexedDbPersistence } from "../hooks/useIndexedDbPersistence";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "../app/state/useApplicationSnapshot";
import { useShoppingItemMutationCommands } from "../app/commands/useShoppingItemMutationCommands";
import { selectItemsForExecutionDay } from "../app/selectors/appListViewSelectors";
import { planItemEdit } from "../features/consistency/domain/itemEdit";
import { db } from "../utils/indexedDB";
import { extractEventDates } from "../utils/eventDates";
import { normalizeExecutionVisitDay } from "../utils/visitProjection";
import ImportScreen from "./ImportScreen";
import { ItemEditDialog } from "./ItemEditDialog";

const EVENT = "手動保存の検証";
const DAY = "1日目";
const original: ShoppingItem = {
  id: "original",
  circle: "サークルA",
  title: "新刊",
  eventDate: DAY,
  block: "A",
  number: "01a",
  price: 900,
  quantity: 25,
  purchaseStatus: "LimitedPurchase",
  limitedPurchasedQuantity: 2,
  remarks: "ユーザー登録",
};

beforeEach(() => {
  resetDatabaseConnection();
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  resetDatabaseConnection();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(kind: "add" | "edit" | "detail", seedItem = original) {
  const initial = await db.readApplicationSnapshot();
  await db.commitApplicationSnapshotAtomically(
    {
      ...emptyApplicationSnapshot(),
      eventLists: { [EVENT]: [seedItem] },
      eventConsistency: { [EVENT]: createEventConsistency() },
    },
    { expectedRoots: initial.expectedRoots },
  );
  const commands = createIndexedDbPersistenceCommandAdapter();
  const mount = () =>
    renderHook(() => {
      const application = useApplicationSnapshot(commands, EVENT, DAY);
      const persistence = useIndexedDbPersistence({
        persistenceCommands: commands,
        values: application.raw,
        setters: application.hydrationSetters,
        externalMutations: true,
        onHydratedSnapshot: application.coordinator.initializeEventGenerations,
      });
      application.handlers.current = {
        drain: persistence.flushPendingSave,
        observeSnapshot: persistence.observeSnapshot,
        applied: persistence.acceptCommittedSnapshot,
      };
      const values = application.values;
      const eventListsRef = useRef(values.eventLists);
      const executeModeItemsRef = useRef(values.executeModeItems);
      eventListsRef.current = values.eventLists;
      executeModeItemsRef.current = values.executeModeItems;
      const mutations = useShoppingItemMutationCommands({
        state: {
          activeEventName: EVENT,
          activeEventDate: DAY,
          getEventGeneration: application.coordinator.generation,
          eventLists: values.eventLists,
          eventListsRef,
          eventMetadata: values.eventMetadata,
          dayModes: values.dayModes,
          items: values.eventLists[EVENT] ?? [],
          selectedItemIds: new Set(),
          selectedBlockFilters: new Set(),
          blockSortDirection: null,
          candidateNumberSortDirection: null,
          itemToDelete: null,
          executeModeItemsRef,
          spaceGroupDragItemIdsRef: useRef(null),
          eventUpdatePreviewEpochRef: useRef(0),
        },
        actions: {
          setEventLists: application.setters.setEventLists,
          updateItemFields: application.updateItemFields,
          setEventMetadata: application.setters.setEventMetadata,
          setDayModes: application.setters.setDayModes,
          updateExecuteModeItems: application.setters.setExecuteModeItems,
          setRecentlyChangedItemIds: vi.fn(),
          openDuplicateEvent: vi.fn(),
          clearRangeSelection: vi.fn(),
          clearSelection: vi.fn(),
          removeSelectedItemIds: vi.fn(),
          queueShoppingMovePatch: vi.fn(() => ({
            status: "blocked" as const,
            reason: "unused",
          })),
          setSortState: vi.fn(),
          setBlockSortDirection: vi.fn(),
          setCandidateNumberSortDirection: vi.fn(),
          confirmItemDelete: vi.fn(),
          navigation: { openEvent: vi.fn(), showImport: vi.fn() },
        },
        selectors: {
          areItemsInSameHall: () => true,
          areItemsInSameHallGroup: () => true,
        },
        alerts: { notify: vi.fn() },
        persistence: {
          commitApplicationSnapshotPatch: application.commitPatch,
        },
      });
      return { application, persistence, mutations };
    });
  const h = mount();
  await waitFor(() =>
    expect(h.result.current.persistence.isInitialized).toBe(true),
  );
  const atomic = vi.spyOn(commands, "commitApplicationSnapshotAtomically");
  const content = commands.commitItemContentEdits
    ? vi.spyOn(commands, "commitItemContentEdits")
    : vi.fn();
  const done = vi.fn();
  const add = vi.fn(
    (...args: Parameters<typeof h.result.current.mutations.handleBulkAdd>) =>
      h.result.current.mutations.handleBulkAdd(...args),
  );
  const edit = vi.fn((item: ShoppingItem) =>
    h.result.current.mutations.updateItem(item),
  );
  const save = vi.fn(
    (item: ShoppingItem, selection: Parameters<typeof planItemEdit>[4]) =>
      h.result.current.application
        .request({
          events: [EVENT],
          plan: (snapshot, choices) =>
            planItemEdit(snapshot, EVENT, seedItem, item, selection, choices),
        })
        .then(() => {}),
  );
  const view = render(
    kind === "detail" ? (
      <ItemEditDialog item={seedItem} onSave={save} onClose={done} />
    ) : (
      <ImportScreen
        activeEventName={EVENT}
        itemToEdit={kind === "edit" ? seedItem : null}
        onBulkAdd={add}
        onUpdateItem={edit}
        onDoneEditing={done}
      />
    ),
  );
  if (kind === "add") {
    fireEvent.change(screen.getByLabelText("サークル名"), {
      target: { value: "追加サークル" },
    });
    fireEvent.change(screen.getByLabelText("タイトル"), {
      target: { value: "追加タイトル" },
    });
    fireEvent.change(screen.getByLabelText("備考"), {
      target: { value: "保持するメモ" },
    });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.test/item" },
    });
  }
  const submit = () =>
    fireEvent.click(
      screen.getByRole("button", {
        name:
          kind === "add"
            ? "リストに追加"
            : kind === "edit"
              ? "アイテムを更新"
              : "保存",
      }),
    );
  const setDay = (value: string) => {
    const control = screen.getByLabelText("参加日");
    if (control.tagName === "SELECT") {
      fireEvent.change(control, { target: { value: "__custom__" } });
    }
    fireEvent.change(screen.getByLabelText("参加日"), { target: { value } });
  };
  const flush = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await waitFor(() =>
        expect(
          h.result.current.application.pendingCount === 0 ||
            h.result.current.application.confirmations.length > 0,
        ).toBe(true),
      );
      const pending = h.result.current.application.confirmations[0];
      if (!pending) {
        await act(async () => h.result.current.application.flush());
        return;
      }
      act(() => h.result.current.application.confirm(pending.token));
      await waitFor(() =>
        expect(h.result.current.application.isConfirmationBusy).toBe(false),
      );
    }
    throw new Error("Expected the existing mutation confirmation to finish");
  };
  return {
    flush,
    h,
    view,
    mount,
    atomic,
    content,
    done,
    add,
    edit,
    save,
    submit,
    setDay,
  };
}

describe.each(["add", "edit", "detail"] as const)(
  "manual date validation through %s persistence",
  (kind) => {
    it.each(["", "   ", "　　"])(
      "rejects a blank date %j before mutation and retains all inputs",
      async (day) => {
        const h = await setup(kind);
        h.setDay(day);
        h.submit();
        const input = screen.getByLabelText("参加日");
        expect(input).toHaveFocus();
        expect(input).toHaveAttribute("aria-invalid", "true");
        expect(input).toHaveAccessibleDescription("参加日を入力してください。");
        expect(screen.getByRole("alert")).toHaveTextContent(
          "参加日を入力してください。",
        );
        expect(screen.getByLabelText("タイトル")).toHaveValue(
          kind === "add" ? "追加タイトル" : "新刊",
        );
        expect(screen.getByLabelText("URL")).toHaveValue(
          kind === "add" ? "https://example.test/item" : "",
        );
        if (kind === "detail") {
          expect(screen.getByLabelText("実購入数")).toHaveValue("2");
          expect(screen.getByLabelText("購入予定量")).toHaveValue("25");
        } else {
          expect(screen.getByLabelText("備考")).toHaveValue(
            kind === "add" ? "保持するメモ" : "ユーザー登録",
          );
          expect(screen.getByLabelText("数量")).toHaveValue(
            kind === "add" ? "1" : "25",
          );
        }
        await h.flush();
        expect(h.add).not.toHaveBeenCalled();
        expect(h.edit).not.toHaveBeenCalled();
        expect(h.save).not.toHaveBeenCalled();
        expect(h.done).not.toHaveBeenCalled();
        expect(h.atomic).not.toHaveBeenCalled();
        expect(h.content).not.toHaveBeenCalled();
        expect(
          (await db.readApplicationSnapshot()).snapshot.eventLists[EVENT],
        ).toEqual([original]);
      },
    );

    it.each([DAY, "前夜祭", " 　特別参加日　 "])(
      "saves a corrected nonempty date %j verbatim and restores it on reload",
      async (day) => {
        const h = await setup(kind);
        h.setDay("");
        h.submit();
        h.setDay(day);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByLabelText("参加日")).not.toHaveAttribute(
          "aria-invalid",
        );
        h.submit();
        await waitFor(() =>
          expect(
            kind === "add" ? h.add : kind === "edit" ? h.edit : h.save,
          ).toHaveBeenCalledOnce(),
        );
        await h.flush();
        const saved = (await db.readApplicationSnapshot()).snapshot.eventLists[
          EVENT
        ] as ShoppingItem[];
        const savedItem =
          kind === "add"
            ? saved.find((item) => item.id !== original.id)!
            : saved[0];
        expect(savedItem.eventDate).toBe(day);
        if (kind !== "add") {
          expect(savedItem).toMatchObject({
            id: original.id,
            purchaseStatus: "LimitedPurchase",
            limitedPurchasedQuantity: 2,
            quantity: 25,
          });
        }
        const normalized = normalizeExecutionVisitDay(day);
        expect(extractEventDates(saved)).toContain(normalized);
        expect(selectItemsForExecutionDay(saved, normalized)).toContainEqual(
          savedItem,
        );
        h.view.unmount();
        h.h.unmount();
        const reloaded = h.mount();
        await waitFor(() =>
          expect(reloaded.result.current.persistence.isInitialized).toBe(true),
        );
        const restored =
          reloaded.result.current.application.values.eventLists[EVENT];
        expect(
          restored.find((item) => item.id === savedItem.id)?.eventDate,
        ).toBe(day);
        expect(selectItemsForExecutionDay(restored, normalized)).toContainEqual(
          savedItem,
        );
      },
    );
  },
);

it("requires an explicit valid date to repair a legacy empty-date item without losing purchase records", async () => {
  const h = await setup("detail", { ...original, eventDate: "" });
  h.submit();
  expect(h.save).not.toHaveBeenCalled();
  h.setDay("復旧日");
  h.submit();
  await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
  await h.flush();
  expect(
    (await db.readApplicationSnapshot()).snapshot.eventLists[EVENT][0],
  ).toMatchObject({
    id: original.id,
    eventDate: "復旧日",
    purchaseStatus: "LimitedPurchase",
    limitedPurchasedQuantity: 2,
    quantity: 25,
  });
});

it("clears a manual date error when changing the edited item", async () => {
  const h = await setup("edit");
  h.setDay("");
  h.submit();
  h.view.rerender(
    <ImportScreen
      activeEventName={EVENT}
      itemToEdit={{ ...original, id: "next", eventDate: "次の日" }}
      onBulkAdd={h.add}
      onUpdateItem={h.edit}
      onDoneEditing={h.done}
    />,
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("参加日")).toHaveValue("次の日");
});
