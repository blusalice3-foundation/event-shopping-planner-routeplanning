import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "../../types/item";
import type { EventUpdateDiff } from "./updateDiff";
import {
  applyPendingEventUpdate,
  eventUpdateItemsMatch,
  type EventUpdateCommitState,
  type PendingEventUpdate,
} from "./updateFlow";

const EVENT_NAME = "イベントA";

const item = (
  id: string,
  title: string,
  overrides: Partial<ShoppingItem> = {},
): ShoppingItem => ({
  id,
  circle: `サークル-${id}`,
  eventDate: "1日目",
  block: "東A",
  number: "01a",
  title,
  price: 1000,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "",
  source: "spreadsheet",
  ...overrides,
});

const diff = (overrides: Partial<EventUpdateDiff> = {}): EventUpdateDiff => ({
  itemsToDelete: [],
  itemsToUpdate: [],
  itemsToAdd: [],
  appFieldSyncCandidates: [],
  protectedFromDelete: 0,
  protectedFromUpdate: 0,
  quantityWarnings: [],
  pendingPurchasedQuantityChanges: [],
  limitedPurchaseQuantityConflicts: [],
  ...overrides,
});

const createState = (eventItems: ShoppingItem[]): EventUpdateCommitState => ({
  eventLists: { [EVENT_NAME]: eventItems },
  eventMetadata: {
    [EVENT_NAME]: {
      spreadsheetUrl: "https://example.com/old",
      spreadsheetSheetName: "旧シート",
      lastImportDate: "2026-08-02T00:00:00.000Z",
    },
  },
  executeModeItems: {
    [EVENT_NAME]: {
      "1日目": eventItems.map(({ id }) => id),
    },
  },
});

describe("applyPendingEventUpdate", () => {
  it("commits items, execute lists, and a source switch from one current snapshot", () => {
    const deletedItem = item("delete", "削除対象");
    const retainedItem = item("keep", "維持対象");
    const baseItems = [deletedItem, retainedItem];
    const state = createState(baseItems);
    const pending: PendingEventUpdate = {
      kind: "source-switch",
      eventName: EVENT_NAME,
      baseSource: { url: "https://example.com/old", sheetName: "旧シート" },
      diff: diff({ itemsToDelete: [deletedItem] }),
      nextSource: {
        url: "https://example.com/new",
        sheetName: "新シート",
      },
    };

    const result = applyPendingEventUpdate({
      state,
      pending,
      baseItems,
      options: {},
    });

    expect(result).not.toBeNull();
    expect(result?.eventLists[EVENT_NAME]).toEqual([retainedItem]);
    expect(result?.executeModeItems[EVENT_NAME]["1日目"]).toEqual(["keep"]);
    expect(result?.eventMetadata[EVENT_NAME]).toEqual({
      spreadsheetUrl: "https://example.com/new",
      spreadsheetSheetName: "新シート",
      lastImportDate: "2026-08-02T00:00:00.000Z",
    });
    expect(state.eventLists[EVENT_NAME]).toBe(baseItems);
    expect(state.eventMetadata[EVENT_NAME].spreadsheetUrl).toBe(
      "https://example.com/old",
    );
  });

  it("keeps metadata unchanged for an items-only confirmation", () => {
    const baseItems = [item("keep", "更新前")];
    const state = createState(baseItems);
    const pending: PendingEventUpdate = {
      kind: "items-only",
      eventName: EVENT_NAME,
      baseSource: { url: "https://example.com/old", sheetName: "旧シート" },
      diff: diff({
        itemsToUpdate: [{ ...baseItems[0], title: "更新後" }],
      }),
    };

    const result = applyPendingEventUpdate({
      state,
      pending,
      baseItems,
      options: {},
    });

    expect(result?.eventLists[EVENT_NAME][0].title).toBe("更新後");
    expect(result?.eventMetadata).toBe(state.eventMetadata);
  });

  it("promotes a surviving visit member into the deleted representative slot", () => {
    const firstVisitMember = item("A1", "訪問Aの先頭");
    const unrelatedItem = item("B", "別の訪問", {
      block: "東B",
      number: "02a",
    });
    const survivingVisitMember = item("A2", "訪問Aの残存商品");
    const baseItems = [firstVisitMember, unrelatedItem, survivingVisitMember];
    const state = createState(baseItems);
    const pending: PendingEventUpdate = {
      kind: "items-only",
      eventName: EVENT_NAME,
      baseSource: { url: "https://example.com/old", sheetName: "旧シート" },
      diff: diff({ itemsToDelete: [firstVisitMember] }),
    };

    const result = applyPendingEventUpdate({
      state,
      pending,
      baseItems,
      options: {},
    });

    expect(result?.executeModeItems[EVENT_NAME]["1日目"]).toEqual(["A2", "B"]);
  });

  it.each(["edited", "deleted"] as const)(
    "rejects a confirmation after the target event was %s",
    (change) => {
      const baseItems = [item("keep", "確認時")];
      const state = createState(baseItems);
      const pending: PendingEventUpdate = {
        kind: "source-switch",
        eventName: EVENT_NAME,
        baseSource: { url: "https://example.com/old", sheetName: "旧シート" },
        diff: diff(),
        nextSource: {
          url: "https://example.com/new",
          sheetName: "新シート",
        },
      };
      const currentState: EventUpdateCommitState =
        change === "edited"
          ? {
              ...state,
              eventLists: {
                [EVENT_NAME]: [{ ...baseItems[0], title: "確認後の編集" }],
              },
            }
          : {
              ...state,
              eventLists: {},
            };

      expect(
        applyPendingEventUpdate({
          state: currentState,
          pending,
          baseItems,
          options: {},
        }),
      ).toBeNull();
      expect(currentState.eventMetadata).toBe(state.eventMetadata);
      expect(currentState.executeModeItems).toBe(state.executeModeItems);
    },
  );
});

it.each(["items-only", "source-switch"] as const)(
  "validates source values before applying %s choices",
  (kind) => {
    const baseItems = [item("keep", "確認時")];
    const state = createState(baseItems);
    const source = { url: "https://example.com/old", sheetName: "旧シート" };
    const pending: PendingEventUpdate = {
      kind,
      eventName: EVENT_NAME,
      baseSource: source,
      diff: diff({
        itemsToUpdate: [{ ...baseItems[0], title: "旧シートからの更新" }],
      }),
      nextSource: { url: "https://example.com/new", sheetName: "新シート" },
    };
    for (const metadata of [
      undefined,
      {
        ...state.eventMetadata[EVENT_NAME],
        spreadsheetUrl: "https://example.com/changed",
      },
      { ...state.eventMetadata[EVENT_NAME], spreadsheetSheetName: "別シート" },
    ]) {
      const current: EventUpdateCommitState = {
        ...state,
        eventMetadata: metadata ? { [EVENT_NAME]: metadata } : {},
      };
      expect(
        applyPendingEventUpdate({
          state: current,
          pending,
          baseItems,
          options: {},
        }),
      ).toBeNull();
      expect(current.eventLists).toBe(state.eventLists);
      expect(current.executeModeItems).toBe(state.executeModeItems);
    }
  },
);

it("permits the first source assignment only while the event still has no source", () => {
  const baseItems = [item("keep", "確認時")];
  const state = { ...createState(baseItems), eventMetadata: {} };
  const pending: PendingEventUpdate = {
    kind: "source-switch",
    eventName: EVENT_NAME,
    baseSource: null,
    diff: diff(),
    nextSource: { url: "https://example.com/first", sheetName: "" },
  };
  const result = applyPendingEventUpdate({
    state,
    pending,
    baseItems,
    options: {},
  });
  expect(result?.eventMetadata[EVENT_NAME].spreadsheetUrl).toBe(
    pending.nextSource.url,
  );
  expect(
    applyPendingEventUpdate({
      state: createState(baseItems),
      pending,
      baseItems,
      options: {},
    }),
  ).toBeNull();
});

describe("eventUpdateItemsMatch", () => {
  it("compares cloned unknown JSON fields by value while retaining scalar guards", () => {
    const current = [
      {
        ...item("keep", "ユーザー登録"),
        futureOptionalField: {
          preserved: true,
          nested: [0, false, null, { message: "エラーが発生しました" }],
        },
      },
    ];
    const base = structuredClone(current);
    expect(eventUpdateItemsMatch(current, base)).toBe(true);
    base[0].futureOptionalField.nested[3] = { message: "変更" };
    expect(eventUpdateItemsMatch(current, base)).toBe(false);
    expect(
      eventUpdateItemsMatch(current, [{ ...current[0], quantity: 2 }]),
    ).toBe(false);
    expect(
      eventUpdateItemsMatch(current, [
        { ...current[0], purchaseStatus: "Purchased" },
      ]),
    ).toBe(false);
    const addedField = [
      { ...current[0], anotherFutureField: { enabled: false } },
    ];
    expect(eventUpdateItemsMatch(addedField, current)).toBe(false);
    expect(eventUpdateItemsMatch(current, addedField)).toBe(false);
  });
});

it.each<unknown>([
  null,
  [],
  {},
  [0, false, null, { message: "ユーザー登録", optional: undefined }],
  { b: [], a: { preserved: true, optional: undefined } },
])(
  "accepts an unchanged cloned unknown value (%j) alongside known optional fields",
  (futureOptionalField) => {
    const current = [
      {
        ...item("keep", "確認中"),
        assignedTo: undefined,
        postponed: false,
        catalogPrice: null,
        futureOptionalField,
      },
    ];
    const base = structuredClone(current);
    delete base[0].assignedTo;
    expect(eventUpdateItemsMatch(current, base)).toBe(true);
  },
);

it("ignores unknown object key order without ignoring nested own undefined values", () => {
  const withFuture = (futureOptionalField: unknown): ShoppingItem =>
    ({ ...item("keep", "確認中"), futureOptionalField }) as ShoppingItem;
  expect(
    eventUpdateItemsMatch(
      [withFuture({ first: 1, second: { value: false } })],
      [withFuture({ second: { value: false }, first: 1 })],
    ),
  ).toBe(true);
  for (const [current, base] of [
    [{ optional: undefined }, {}],
    [{ nested: { optional: undefined } }, { nested: {} }],
    [[undefined], [null]],
    [new Array(1), [undefined]],
    [[undefined], []],
    [[], {}],
    [null, {}],
  ]) {
    expect(
      eventUpdateItemsMatch([withFuture(current)], [withFuture(base)]),
    ).toBe(false);
    expect(
      eventUpdateItemsMatch([withFuture(base)], [withFuture(current)]),
    ).toBe(false);
  }
});
