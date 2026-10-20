import { getMaplessKey } from "../../../types/map";
import { getCommittedEditorHalls } from "./hallOperations";
import { encodeHallRef } from "../../consistency/domain/projection";
import { describe, expect, it } from "vitest";
import type { HallDefinition } from "../../../types/map";
import type { ShoppingItem } from "../../../types/item";
import {
  getCombinedHallRouteSettingsForDate,
  getGlobalHallItemCount,
  mergeHallOrder,
  remapHallRouteSettings,
  reorderExecuteIdsByHallOrder,
  splitGlobalHallRouteSettings,
} from "./hallOperations";

const makeItem = (
  id: string,
  block: string,
  priorityLevel: ShoppingItem["priorityLevel"] = "none",
): ShoppingItem => ({
  id,
  circle: id,
  eventDate: "2026-01-01",
  block,
  number: "01",
  title: "",
  price: null,
  purchaseStatus: "None",
  quantity: 1,
  remarks: "",
  priorityLevel,
});

const halls: HallDefinition[] = [
  { id: "hall-a", name: "Hall A", vertices: [], blockNames: ["A"] },
  { id: "hall-b", name: "Hall B", vertices: [], blockNames: ["B"] },
];

describe("hallOperations regressions", () => {
  it("keeps priority groups while merging refreshed hall ids", () => {
    expect(
      mergeHallOrder(
        ["hall-a:highest", "hall-a:priority", "hall-a"],
        ["hall-a"],
      ),
    ).toEqual(["hall-a:highest", "hall-a:priority", "hall-a"]);
  });

  it("keeps legacy suffixed hall groups and appends the base hall id when needed", () => {
    expect(mergeHallOrder(["hall-a:priority"], ["hall-a"])).toEqual([
      "hall-a:priority",
      "hall-a",
    ]);
  });

  it("remaps cloned hall route settings without dropping priority suffixes", () => {
    const result = remapHallRouteSettings(
      {
        hallOrder: ["hall-a:highest", "hall-a:priority", "hall-a"],
        hallVisitLists: [
          { hallId: "hall-a", itemIds: ["a1"] },
          { hallId: "hall-a:priority", itemIds: ["a-priority-1"] },
          { hallId: "hall-missing", itemIds: ["missing-1"] },
        ],
      },
      new Map([["hall-a", "hall-next"]]),
    );

    expect(result.hallOrder).toEqual([
      "hall-next:highest",
      "hall-next:priority",
      "hall-next",
    ]);
    expect(result.hallVisitLists).toEqual([
      { hallId: "hall-next", itemIds: ["a1"] },
      { hallId: "hall-next:priority", itemIds: ["a-priority-1"] },
    ]);
  });

  it("splits global route settings by extracted base hall id", () => {
    const result = splitGlobalHallRouteSettings({
      settings: {
        hallOrder: ["hall-a:priority", "hall-b", "undefined:highest"],
        hallVisitLists: [
          { hallId: "hall-a:priority", itemIds: ["a1"] },
          { hallId: "hall-b", itemIds: ["b1"] },
        ],
      },
      mapHallIds: new Set(["hall-a"]),
      maplessHallIds: new Set(["hall-b"]),
      hasMapTab: true,
    });

    expect(result.mapSettings.hallOrder).toEqual([
      "hall-a:priority",
      "undefined:highest",
    ]);
    expect(result.maplessSettings.hallOrder).toEqual(["hall-b"]);
    expect(result.mapSettings.hallVisitLists).toEqual([
      { hallId: "hall-a:priority", itemIds: ["a1"] },
    ]);
    expect(result.maplessSettings.hallVisitLists).toEqual([
      { hallId: "hall-b", itemIds: ["b1"] },
    ]);
  });

  it("reorders hall priority groups while preserving current execution order", () => {
    const items = [
      makeItem("a-normal", "A"),
      makeItem("a-priority-2", "A", "priority"),
      makeItem("b-normal", "B"),
      makeItem("a-priority-1", "A", "priority"),
    ];

    const result = reorderExecuteIdsByHallOrder({
      hallOrder: ["hall-a:priority", "hall-b", "hall-a"],
      dayItems: ["a-normal", "a-priority-2", "b-normal", "a-priority-1"],
      items,
      halls,
      mapData: undefined,
      hallRouteSettings: {
        hallOrder: ["hall-a:priority", "hall-b", "hall-a"],
        hallVisitLists: [
          {
            hallId: "hall-a:priority",
            itemIds: ["a-priority-1", "a-priority-2"],
          },
        ],
      },
    });

    expect(result).toEqual([
      "a-priority-2",
      "a-priority-1",
      "b-normal",
      "a-normal",
    ]);
  });

  it("keeps a legacy non-contiguous visit together after an explicit hall reorder", () => {
    const items = [
      { ...makeItem("a1", "A"), number: "01a" },
      { ...makeItem("other", "A"), number: "02a" },
      { ...makeItem("a2", "A"), number: "01a2" },
    ];

    expect(
      reorderExecuteIdsByHallOrder({
        hallOrder: ["hall-a"],
        dayItems: ["a1", "other", "a2"],
        items,
        halls,
        mapData: undefined,
        hallRouteSettings: {
          hallOrder: ["hall-a"],
          hallVisitLists: [
            { hallId: "hall-a", itemIds: ["a1", "other", "a2"] },
          ],
        },
      }),
    ).toEqual(["a1", "a2", "other"]);
  });

  it("indexes item ids while preserving the first-match counting behavior", () => {
    const first = makeItem("duplicate", "A");
    const laterDuplicate = makeItem("duplicate", "B");

    expect(
      getGlobalHallItemCount({
        groupId: "hall-a",
        executeIds: ["duplicate", "duplicate", "missing"],
        items: [first, laterDuplicate],
        getItemHallId: (item) => (item.block === "A" ? "hall-a" : "hall-b"),
      }),
    ).toBe(2);
  });

  it("combines mapped and mapless route settings for a date", () => {
    const result = getCombinedHallRouteSettingsForDate({
      eventName: "event",
      dayName: "2026-01-01",
      mapTabName: "map",
      hallRouteSettings: {
        event: {
          map: {
            hallOrder: ["hall-a"],
            hallVisitLists: [{ hallId: "hall-a", itemIds: ["a1"] }],
          },
          "__mapless__:2026-01-01": {
            hallOrder: ["hall-b"],
            hallVisitLists: [{ hallId: "hall-b", itemIds: ["b1"] }],
          },
        },
      },
    });

    expect(result).toEqual({
      hallOrder: ["hall-a", "hall-b"],
      hallVisitLists: [
        { hallId: "hall-a", itemIds: ["a1"] },
        { hallId: "hall-b", itemIds: ["b1"] },
      ],
    });
  });
});

it.each(["west:priority", "west:highest", "west:priority:highest"])(
  "keeps hall ID %s through splitting, remapping and counting",
  (id) => {
    const settings = {
      hallOrder: [`${id}:priority`, `${id}:highest`],
      hallVisitLists: [{ hallId: `${id}:priority`, itemIds: ["one"] }],
    };
    const split = splitGlobalHallRouteSettings({
      settings,
      mapHallIds: new Set([id]),
      maplessHallIds: new Set(),
      hasMapTab: true,
    });
    expect(split.mapSettings).toEqual(settings);
    expect(split.maplessSettings.hallOrder).toEqual([]);
    expect(
      remapHallRouteSettings(settings, new Map([[id, "next:priority"]])),
    ).toEqual({
      hallOrder: ["next:priority:priority", "next:priority:highest"],
      hallVisitLists: [{ hallId: "next:priority:priority", itemIds: ["one"] }],
    });
    expect(
      getGlobalHallItemCount({
        groupId: `${id}:priority`,
        executeIds: ["one"],
        items: [makeItem("one", "A", "priority")],
        getItemHallId: () => id,
      }),
    ).toBe(1);
  },
);

it("returns committed detailed and simple halls in their distinct display ID namespaces", () => {
  const same = { id: "same", name: "確定済み", vertices: [] };
  const definitions = {
    event: {
      map: [same],
      [getMaplessKey("1日目")]: [{ ...same, blockNames: ["A"] }],
      [getMaplessKey("2日目")]: [{ ...same, name: "別日" }],
    },
  };
  const session = {
    sessionId: "owner",
    eventName: "event",
    eventGeneration: 1,
    day: "1日目",
    mapKey: "map",
    editorKind: "hall-definition" as const,
  };
  expect(
    getCommittedEditorHalls(definitions, session).map((hall) => hall.id),
  ).toEqual([
    encodeHallRef({ kind: "map", mapKey: "map", hallId: "same" }),
    encodeHallRef({ kind: "simple", dayKey: "1日目", hallId: "same" }),
  ]);
  expect(
    getCommittedEditorHalls(definitions, {
      ...session,
      editorKind: "simple-hall-definition",
    }),
  ).toEqual([
    {
      ...same,
      blockNames: ["A"],
      id: encodeHallRef({ kind: "simple", dayKey: "1日目", hallId: "same" }),
    },
  ]);
});

it("preserves the committed simple hall reference spelling for an existing normalized day alias", () => {
  const hall = { id: "simple", name: "簡易", vertices: [], blockNames: ["A"] };
  const session = {
    sessionId: "owner",
    eventName: "event",
    eventGeneration: 1,
    day: "1日目",
    mapKey: "unused",
    editorKind: "simple-hall-definition" as const,
  };
  expect(
    getCommittedEditorHalls(
      { event: { [getMaplessKey(" 1日目　")]: [hall] } },
      session,
    )[0].id,
  ).toBe(
    encodeHallRef({ kind: "simple", dayKey: " 1日目　", hallId: "simple" }),
  );
});
