// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ShoppingItem } from "../types/item";
import type { DayMapData } from "../types/map";
import type { FocusModeSessionState } from "../types/focus";
import { AcceptedItemContext } from "../features/shopping-list/renderers/ViewportRowState";
import FocusMode from "../components/FocusMode";
import { minimalProps } from "../components/FocusMode.fixtures";
import ImportScreen from "../components/ImportScreen";
import {
  useShoppingItemMutationCommands,
  type ShoppingItemMutationCommandPorts,
} from "../app/commands/useShoppingItemMutationCommands";
import { removeFocusModeSessionByEvent } from "../app/commands/useEventLifecycleCommands";
import { buildFocusSessionKey } from "../app/selectors/appMapViewSelectors";
import { resolveLocation } from "../features/consistency/domain/membership";

vi.mock("../components/map/MapCanvas", () => ({
  default: (props: {
    items: ShoppingItem[];
    onCellClick: (row: number, col: number, items: ShoppingItem[]) => void;
  }) => (
    <button
      data-testid="audit-map-cell"
      onClick={() =>
        props.onCellClick(
          2,
          1,
          props.items.filter((item) => item.id === "pending"),
        )
      }
    >
      cell
    </button>
  ),
}));
vi.mock("../components/map/InsertPositionDialog", () => ({
  default: (props: {
    isOpen: boolean;
    nearbyVisitItems: { item: ShoppingItem }[];
  }) =>
    props.isOpen ? (
      <div role="dialog" aria-label="audit insertion preview">
        {props.nearbyVisitItems.map((entry) => entry.item.id).join(",")}
      </div>
    ) : null,
}));
import MapView from "../components/map/MapView";

const item = (
  id: string,
  fields: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: id,
  eventDate: "1日目",
  block: "A",
  number: "01a",
  title: id,
  price: 500,
  quantity: 5,
  remarks: "",
  purchaseStatus: "None",
  priorityLevel: "none",
  ...fields,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("focus bulk input retains the correct operation context", () => {
  async function openFlow() {
    let target = item("target");
    const peer = item("peer");
    let currentItems = [target, peer];
    const onUpdate = vi.fn();
    const view = (executeIds: string[]) => (
      <AcceptedItemContext.Provider
        value={(id) => currentItems.find((record) => record.id === id)}
      >
        <FocusMode
          {...minimalProps({
            items: currentItems,
            executeModeItemIds: executeIds,
            onUpdateItem: onUpdate,
            skipLimitedPurchaseForSingleQuantity: false,
            resumeState: null,
          })}
        />
      </AcceptedItemContext.Provider>
    );
    const rendered = render(view(["target", "peer"]));
    fireEvent.click(await screen.findByRole("button", { name: "全限数" }));
    await screen.findByRole("dialog", { name: "限数購入の数量" });
    return {
      onUpdate,
      change: (
        fields: Partial<ShoppingItem>,
        executeIds = ["target", "peer"],
      ) => {
        target = { ...target, ...fields };
        currentItems = [target, peer];
        rendered.rerender(view(executeIds));
      },
      submit: async () => {
        const dialog = screen.getByRole("dialog", { name: "限数購入の数量" });
        const [actual] = within(dialog).getAllByRole("textbox");
        fireEvent.change(actual, { target: { value: "1" } });
        fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
        await act(async () => {});
      },
    };
  }
  it("control: an unchanged target saves the requested limited quantity", async () => {
    const flow = await openFlow();
    await flow.submit();
    expect(flow.onUpdate.mock.calls[0][0]).toMatchObject({
      id: "target",
      quantity: 5,
      limitedPurchasedQuantity: 1,
      purchaseStatus: "LimitedPurchase",
    });
  });
  it("a target moved to another day and out of execution must not be updated by the old bulk dialog", async () => {
    const flow = await openFlow();
    flow.change({ eventDate: "2日目" }, ["peer"]);
    await flow.submit();
    expect(
      flow.onUpdate.mock.calls.some((args) => args[0].id === "target"),
    ).toBe(false);
  });
  it("an unchanged planned input must not silently restore the old quantity after it changes elsewhere", async () => {
    const flow = await openFlow();
    flow.change({ quantity: 9 });
    await flow.submit();
    expect(
      flow.onUpdate.mock.calls.some(
        (args) => args[0].id === "target" && args[0].quantity === 5,
      ),
    ).toBe(false);
  });
});

it("new import must not announce completion or clear its URL before persistence succeeds", async () => {
  let rejectSave!: (reason: unknown) => void;
  const save = new Promise<void>((_resolve, reject) => {
    rejectSave = reject;
  });
  const commit = vi.fn(() => save),
    notify = vi.fn();
  const ports = {
    state: {
      activeEventName: null,
      activeEventDate: "1日目",
      eventLists: {},
      eventListsRef: { current: {} },
      eventMetadata: {},
      dayModes: {},
      items: [],
      selectedItemIds: new Set(),
      selectedBlockFilters: new Set(),
      blockSortDirection: null,
      candidateNumberSortDirection: null,
      itemToDelete: null,
      executeModeItemsRef: { current: {} },
      spaceGroupDragItemIdsRef: { current: null },
      eventUpdatePreviewEpochRef: { current: 0 },
    },
    actions: {
      setEventLists: vi.fn(),
      setEventMetadata: vi.fn(),
      setDayModes: vi.fn(),
      updateExecuteModeItems: vi.fn(),
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
    alerts: { notify },
    persistence: { commitApplicationSnapshotPatch: commit },
  } as ShoppingItemMutationCommandPorts;
  const Harness = () => {
    const commands = useShoppingItemMutationCommands(ports);
    return (
      <ImportScreen
        onBulkAdd={commands.handleBulkAdd}
        activeEventName={null}
        itemToEdit={null}
        onUpdateItem={vi.fn()}
        onDoneEditing={vi.fn()}
      />
    );
  };
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  const cells = Array.from({ length: 27 }, () => "");
  cells[12] = "サークルA";
  cells[13] = "1日目";
  cells[14] = "A";
  cells[15] = "01a";
  cells[16] = "本A";
  cells[26] = "1";
  const csv = "サークル名\n" + cells.join(",");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(csv, { status: 200 })),
  );
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("即売会名"), {
    target: { value: "新規イベント" },
  });
  const url = screen.getByLabelText(
    "スプレッドシートURLからインポート",
  ) as HTMLInputElement;
  fireEvent.change(url, {
    target: { value: "https://docs.google.com/spreadsheets/d/test/edit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "URLからインポート" }));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  const premature = alert.mock.calls.map((args) => args[0]);
  const retainedUrl = url.value;
  await act(async () => {
    rejectSave(new DOMException("quota full", "QuotaExceededError"));
    await Promise.resolve();
  });
  expect(notify).toHaveBeenCalledWith(
    "イベントを保存できませんでした。表示内容は変更されていません。",
  );
  expect(premature).toEqual([]);
  expect(retainedUrl).toBe("https://docs.google.com/spreadsheets/d/test/edit");
});

const map: DayMapData = {
  sheetName: "1日目マップ",
  rows: 5,
  cols: 5,
  maxRow: 5,
  maxCol: 5,
  cells: [],
  mergedCells: [],
  blocks: [
    {
      name: "A",
      startRow: 1,
      startCol: 1,
      endRow: 5,
      endCol: 2,
      numberCells: [
        { row: 1, col: 1, value: 1 },
        { row: 2, col: 1, value: 2 },
      ],
    },
  ],
};
function mapView(pending: ShoppingItem, anchor = item("anchor"), data = map) {
  const add = vi.fn(() => ["pending"]);
  render(
    <MapView
      operationScope={JSON.stringify(["event", 0, "1日目", "1日目マップ"])}
      mapData={data}
      mapName="1日目マップ"
      items={[anchor, pending]}
      executeModeItemIds={["anchor"]}
      onAddToExecuteList={add}
      onAddToExecuteListAtPosition={vi.fn(() => ["pending"])}
      onRemoveFromExecuteList={vi.fn()}
      onMoveToFirst={vi.fn()}
      onMoveToLast={vi.fn()}
      halls={[]}
      hallRouteSettings={{ hallOrder: [], hallVisitLists: [] }}
      onUpdateHallRouteSettings={vi.fn()}
      smartInsertEnabled={true}
      smartInsertMode="preview"
    />,
  );
  fireEvent.click(screen.getByTestId("audit-map-cell"));
  fireEvent.click(screen.getByText("タップで追加"));
  return add;
}
describe("smart insertion and shared location normalization", () => {
  it("control: an ASCII number offers the existing nearby visit", () => {
    mapView(item("pending", { number: "02a" }));
    expect(
      screen.getByRole("dialog", { name: "audit insertion preview" }),
    ).toHaveTextContent("anchor");
  });
  it("a full-width number resolving to the same cell must offer the same insertion preview", () => {
    const pending = item("pending", { number: "０２ａ" });
    expect(resolveLocation(map, pending).status).toBe("resolved");
    mapView(pending);
    expect(
      screen.queryByRole("dialog", { name: "audit insertion preview" }),
    ).toHaveTextContent("anchor");
  });
  it("distinct exact-case blocks must not be combined as nearby insertion candidates", () => {
    const data = {
      ...map,
      rows: 100,
      maxRow: 100,
      blocks: [
        ...map.blocks,
        {
          name: "a",
          startRow: 90,
          startCol: 1,
          endRow: 100,
          endCol: 2,
          numberCells: [{ row: 95, col: 1, value: 1 }],
        },
      ],
    };
    const anchor = item("anchor", { block: "a" }),
      pending = item("pending", { number: "02a" });
    expect(resolveLocation(data, anchor)).toMatchObject({
      status: "resolved",
      location: { cell: { row: 95, col: 1 } },
    });
    mapView(pending, anchor, data);
    expect(
      screen.queryByRole("dialog", { name: "audit insertion preview" }),
    ).toBeNull();
  });
});

const session: FocusModeSessionState = {
  phase: "normal",
  phaseIndex: 2,
  savedPhaseIndices: { normal: 2, postponed: 0, late: 0 },
  postponedItemIds: [],
  lateItemIds: [],
  isCompleted: false,
};
describe("event deletion and focus session ownership", () => {
  it("control: deleting a different ordinary event retains its session", () => {
    const key = buildFocusSessionKey("別イベント", "1日目");
    expect(
      removeFocusModeSessionByEvent({ [key]: session }, "イベント")[key],
    ).toEqual(session);
  });
  it("deleting an event must retain a distinct event whose name starts with its name plus a separator", () => {
    const first = buildFocusSessionKey("イベント", "1日目"),
      second = buildFocusSessionKey("イベント::別会場", "1日目");
    const remaining = removeFocusModeSessionByEvent(
      { [first]: session, [second]: session },
      "イベント",
    );
    expect(remaining[second]).toEqual(session);
  });
});
