import { describe, expect, it, vi } from "vitest";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../../types/item";
import type { DayMapData, HallDefinition } from "../../../types/map";
import {
  createEventConsistency,
  createDayConsistency,
  createVisitContext,
} from "../../../types/consistency";
import {
  createConsistencySnapshotProjector,
  canReuseProjectedItem,
  projectConsistencySnapshot,
  projectedMembership,
} from "./projection";
import {
  reuseEqualReferences,
  reuseEqualItemLists,
} from "../../../utils/semanticEquality";

const item = (id: string): ShoppingItem => ({
  id,
  eventDate: "1日目",
  block: "A",
  number: id,
  circle: "サークル" + id,
  title: "新刊",
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "ユーザー登録",
});
function snapshot(): PersistenceSnapshot {
  return {
    eventLists: { event: [item("1"), item("2")], other: [item("3")] },
    eventMetadata: {},
    executeModeItems: { event: { "1日目": ["1", "2"] } },
    dayModes: { event: { "1日目": "edit" } },
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallDefinitions: {
      event: {
        "__mapless__:1日目": [
          { id: "hall", name: "東館", vertices: [], blockNames: ["A"] },
        ],
      },
    },
    hallRouteSettings: {},
    eventConsistency: {
      event: createEventConsistency(),
      other: createEventConsistency(),
    },
  };
}
function expectProjection(
  actual: PersistenceSnapshot,
  source: PersistenceSnapshot,
  event = "event",
  day = "1日目",
) {
  const expected = projectConsistencySnapshot(source, event, day);
  expect(actual).toEqual(expected);
  for (const [name, values] of Object.entries(expected.eventLists))
    for (let index = 0; index < values.length; index++)
      expect(
        projectedMembership(actual.eventLists[name][index] as ShoppingItem),
      ).toEqual(projectedMembership(values[index] as ShoppingItem));
}
describe("immutable UI projection", () => {
  it("reuses list and map inputs across mode, viewport, and unrelated event changes", () => {
    const project = createConsistencySnapshotProjector();
    const source = snapshot();
    const initial = project(source, "event", "1日目");
    expect(project(source, "event", "1日目")).toBe(initial);
    const next = reuseEqualReferences(source, {
      ...structuredClone(source),
      dayModes: { event: { "1日目": "focus" } },
      mapViewportSettings: {
        event: { map: { zoomLevel: 2, offsetX: 5, offsetY: 7 } },
      },
    });
    const result = project(next, "event", "1日目");
    expectProjection(result, next);
    expect(result.eventLists).toBe(initial.eventLists);
    expect(result.hallDefinitions).toBe(initial.hallDefinitions);
    expect(result.executeModeItems).toBe(initial.executeModeItems);
    const changed = {
      ...next,
      eventLists: { ...next.eventLists, other: [item("4")] },
    };
    const other = project(changed, "event", "1日目");
    expectProjection(other, changed);
    expect(other.eventLists.event).toBe(initial.eventLists.event);
  });
  it("updates purchase fields without losing shared membership or replacing untouched cards", () => {
    const project = createConsistencySnapshotProjector();
    const source = snapshot();
    const initial = project(source, "event", "1日目");
    const next = {
      ...source,
      eventLists: {
        ...source.eventLists,
        event: (source.eventLists.event as ShoppingItem[]).map(
          (value, index) =>
            index
              ? value
              : {
                  ...value,
                  purchaseStatus: "Purchased" as const,
                  price: 800,
                  quantity: 2,
                },
        ),
      },
    };
    const result = project(next, "event", "1日目");
    expectProjection(result, next);
    expect(result.eventLists.event[0]).not.toBe(initial.eventLists.event[0]);
    expect(result.eventLists.event[1]).toBe(initial.eventLists.event[1]);
    expect(result.hallDefinitions).toBe(initial.hallDefinitions);
    expect(
      projectedMembership(result.eventLists.event[0] as ShoppingItem),
    ).toBe(projectedMembership(initial.eventLists.event[0] as ShoppingItem));
  });
  it("invalidates hidden membership when definitions, maps, peers, or assignments change", () => {
    const project = createConsistencySnapshotProjector();
    let source = snapshot();
    project(source, "event", "1日目");
    source = {
      ...source,
      hallDefinitions: { event: { "__mapless__:1日目": [] } },
    };
    expectProjection(project(source, "event", "1日目"), source);
    source = {
      ...source,
      eventLists: {
        ...source.eventLists,
        event: [item("1"), { ...item("2"), number: "1" }],
      },
    };
    expectProjection(project(source, "event", "1日目"), source);
    source = {
      ...source,
      eventConsistency: {
        ...source.eventConsistency,
        event: createEventConsistency(),
      },
    };
    expectProjection(project(source, "event", "1日目"), source);
    expectProjection(
      project(source, "other", "2日目"),
      source,
      "other",
      "2日目",
    );
    source = { ...source, eventLists: { event: source.eventLists.event } };
    expectProjection(project(source, "event", "1日目"), source);
  });
});

it("preserves event order when equal projected branches are reused", () => {
  const first = snapshot();
  const projector = createConsistencySnapshotProjector();
  projector(first, "event", "1日目");
  const reordered = {
    ...first,
    eventLists: Object.fromEntries(Object.entries(first.eventLists).reverse()),
  };
  const result = projector(reordered, "event", "1日目");
  const expected = projectConsistencySnapshot(reordered, "event", "1日目");
  expect(Object.keys(result.eventLists)).toEqual(
    Object.keys(expected.eventLists),
  );
  expect(Object.keys(result.hallDefinitions)).toEqual(
    Object.keys(expected.hallDefinitions),
  );
  expect(Object.keys(result.hallRouteSettings)).toEqual(
    Object.keys(expected.hallRouteSettings),
  );
});

function contextualSnapshot() {
  const source = snapshot();
  source.eventConsistency.event.days["1日目"] = {
    ...createDayConsistency(),
    mapless: createVisitContext(),
  };
  return source;
}

describe("projected item reference retention", () => {
  it("retains objects and the list through route-only context changes with fresh membership results", () => {
    const source = contextualSnapshot();
    const project = createConsistencySnapshotProjector();
    const before = project(source, "event", "1日目");
    const consistency = structuredClone(source.eventConsistency);
    consistency.event.days["1日目"].mapless!.hallOrder = [
      {
        hall: { kind: "simple", dayKey: "1日目", hallId: "hall" },
        priority: "none",
      },
    ];
    const next = { ...source, eventConsistency: consistency };
    const after = project(next, "event", "1日目");
    expectProjection(after, next);
    expect(after.hallRouteSettings).not.toBe(before.hallRouteSettings);
    expect(after.eventLists).toBe(before.eventLists);
    expect(after.eventLists.event).toBe(before.eventLists.event);
  });

  it("retains equivalent durable item clones and only replaces changed content", () => {
    const source = contextualSnapshot();
    const project = createConsistencySnapshotProjector();
    const before = project(source, "event", "1日目");
    const acknowledged = {
      ...source,
      eventLists: structuredClone(source.eventLists),
    };
    const ack = project(acknowledged, "event", "1日目");
    expectProjection(ack, acknowledged);
    expect(ack.eventLists).toBe(before.eventLists);
    const updated = {
      ...acknowledged,
      eventLists: structuredClone(acknowledged.eventLists),
    };
    (updated.eventLists.event[0] as ShoppingItem).price = 900;
    const after = project(updated, "event", "1日目");
    expectProjection(after, updated);
    expect(after.eventLists.event[0]).not.toBe(before.eventLists.event[0]);
    expect(after.eventLists.event[1]).toBe(before.eventLists.event[1]);
  });

  it("retains matching objects by stable ID when raw order changes", () => {
    const source = contextualSnapshot();
    const project = createConsistencySnapshotProjector();
    const before = project(source, "event", "1日目");
    const next = {
      ...source,
      eventLists: {
        ...source.eventLists,
        event: [...source.eventLists.event].reverse(),
      },
    };
    const after = project(next, "event", "1日目");
    expectProjection(after, next);
    expect(after.eventLists.event).not.toBe(before.eventLists.event);
    expect(after.eventLists.event[0]).toBe(before.eventLists.event[1]);
    expect(after.eventLists.event[1]).toBe(before.eventLists.event[0]);
  });

  it("replaces unchanged payload objects when membership peers or reason changes", () => {
    const source = contextualSnapshot();
    const project = createConsistencySnapshotProjector();
    const before = project(source, "event", "1日目");
    const consistency = structuredClone(source.eventConsistency);
    consistency.event.days["1日目"].mapless!.assignments["1"] = {
      kind: "simple",
      dayKey: "1日目",
      hallId: "hall",
    };
    const assigned = { ...source, eventConsistency: consistency };
    const manual = project(assigned, "event", "1日目");
    expectProjection(manual, assigned);
    expect(manual.eventLists.event[0]).toEqual(before.eventLists.event[0]);
    expect(manual.eventLists.event[0]).not.toBe(before.eventLists.event[0]);
    expect(
      reuseEqualItemLists(
        before.eventLists,
        manual.eventLists,
        canReuseProjectedItem,
      ).event[0],
    ).toBe(manual.eventLists.event[0]);
    expect(
      projectedMembership(before.eventLists.event[0] as ShoppingItem)?.reason,
    ).toBe("automatic");
    expect(
      projectedMembership(manual.eventLists.event[0] as ShoppingItem)?.reason,
    ).toBe("manual");
    const joined = {
      ...assigned,
      eventLists: {
        ...assigned.eventLists,
        event: [
          assigned.eventLists.event[0],
          { ...(assigned.eventLists.event[1] as ShoppingItem), number: "1" },
        ],
      },
    };
    const peers = project(joined, "event", "1日目");
    expectProjection(peers, joined);
    expect(peers.eventLists.event[0]).not.toBe(manual.eventLists.event[0]);
    expect(
      reuseEqualItemLists(
        manual.eventLists,
        peers.eventLists,
        canReuseProjectedItem,
      ).event[0],
    ).toBe(peers.eventLists.event[0]);
    expect(
      projectedMembership(peers.eventLists.event[0] as ShoppingItem)?.memberIds,
    ).toEqual(["1", "2"]);
    expect(
      projectedMembership(manual.eventLists.event[0] as ShoppingItem)
        ?.memberIds,
    ).toEqual(["1"]);
  });
});

it("keeps new location metadata when map geometry changes with the same displayed hall", () => {
  const source = contextualSnapshot();
  source.mapData.event = {
    "1日目マップ": {
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
          endCol: 5,
          numberCells: [
            { row: 2, col: 2, value: 1 },
            { row: 3, col: 2, value: 2 },
          ],
        },
      ],
    },
  };
  source.hallDefinitions.event = {
    "1日目マップ": [
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
  };
  source.eventConsistency.event.days["1日目"].selectedMapKey = "1日目マップ";
  source.eventConsistency.event.days["1日目"].maps["1日目マップ"] =
    createVisitContext();
  const project = createConsistencySnapshotProjector();
  const before = project(source, "event", "1日目");
  const maps = structuredClone(source.mapData) as Record<
    string,
    Record<string, DayMapData>
  >;
  maps.event["1日目マップ"].blocks[0].numberCells[0].col = 3;
  const next = { ...source, mapData: maps };
  const after = project(next, "event", "1日目");
  expectProjection(after, next);
  expect(after.eventLists.event[0]).toEqual(before.eventLists.event[0]);
  expect(after.eventLists.event[0]).not.toBe(before.eventLists.event[0]);
  const location = projectedMembership(
    after.eventLists.event[0] as ShoppingItem,
  )!.location;
  expect(location?.status).toBe("resolved");
  if (location?.status !== "resolved")
    throw new Error("Expected mapped location");
  expect(location.location.cell).toEqual({ row: 2, col: 3 });
  expect(location.location.block).toBe(maps.event["1日目マップ"].blocks[0]);
  const retained = reuseEqualItemLists(
    before.eventLists,
    after.eventLists,
    canReuseProjectedItem,
  );
  expect(retained.event[0]).toBe(after.eventLists.event[0]);
  const oldLocation = projectedMembership(
    before.eventLists.event[0] as ShoppingItem,
  )!.location;
  if (oldLocation?.status !== "resolved")
    throw new Error("Expected previous location");
  expect(oldLocation.location.cell).toEqual({ row: 2, col: 2 });
});

it("updates peer removals, priority content, and new event scopes without reusing obsolete metadata", () => {
  const source = contextualSnapshot();
  (source.eventLists.event[1] as ShoppingItem).number = "1";
  const project = createConsistencySnapshotProjector();
  const before = project(source, "event", "1日目");
  const next = {
    ...source,
    eventLists: {
      ...source.eventLists,
      event: [
        {
          ...(source.eventLists.event[0] as ShoppingItem),
          priorityLevel: "priority",
        },
      ],
    },
  };
  const after = project(next, "event", "1日目");
  expectProjection(after, next);
  expect(after.eventLists.event[0]).not.toBe(before.eventLists.event[0]);
  expect(
    projectedMembership(after.eventLists.event[0] as ShoppingItem)?.memberIds,
  ).toEqual(["1"]);
  expect(
    projectedMembership(before.eventLists.event[0] as ShoppingItem)?.memberIds,
  ).toEqual(["1", "2"]);
  project(
    { ...next, eventLists: { other: source.eventLists.other } },
    "other",
    "1日目",
  );
  const reopened = project(next, "event", "1日目");
  expectProjection(reopened, next);
  expect(reopened.eventLists.event[0]).not.toBe(after.eventLists.event[0]);
});

function instrumentedMapSnapshot() {
  const source = contextualSnapshot();
  const cells = [
    { row: 2, col: 2, value: 1 },
    { row: 3, col: 2, value: 2 },
  ];
  const lookup = vi.fn(() => cells);
  const block = {
    name: "A",
    startRow: 1,
    startCol: 1,
    endRow: 5,
    endCol: 5,
    get numberCells() {
      return lookup();
    },
  };
  source.mapData.event = {
    "1日目マップ": {
      maxRow: 5,
      maxCol: 5,
      cells: [],
      mergedCells: [],
      blocks: [block],
    },
  };
  source.hallDefinitions.event = {
    "1日目マップ": [
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
  };
  source.eventConsistency.event.days["1日目"].mapless = null;
  source.eventConsistency.event.days["1日目"].maps["1日目マップ"] =
    createVisitContext();
  return { source, lookup };
}

describe("pure immutable item reordering", () => {
  it("reorders current projected objects without geometry lookups and preserves current optional fields", () => {
    const { source, lookup } = instrumentedMapSnapshot();
    const members = source.eventLists.event as ShoppingItem[];
    members[1] = { ...members[1], number: "1" };
    const project = createConsistencySnapshotProjector();
    project(source, "event", "1日目");
    const latest = {
      ...source,
      eventLists: {
        ...source.eventLists,
        event: [
          {
            ...members[0],
            quantity: 7,
            remarks: "更新済みのメモ",
            url: "https://example.test/latest",
            sheetRemarks: "最新の備考",
            sheetIdentityVerified: true,
            limitedPurchasedQuantity: 2,
            priorityLevel: "highest" as const,
            protectionLevel: "full" as const,
            assignedTo: "担当者",
            lastSyncedAt: "2026-10-21T12:00:00Z",
          },
          members[1],
        ],
      },
    };
    const current = project(latest, "event", "1日目");
    const consistency = structuredClone(source.eventConsistency);
    const context = consistency.event.days["1日目"].maps["1日目マップ"];
    const group = {
      hall: { kind: "map" as const, mapKey: "1日目マップ", hallId: "hall" },
      priority: "none" as const,
    };
    context.hallOrder = [group];
    context.hallVisitLists = [{ group, itemIds: ["2", "1"] }];
    const next = {
      ...latest,
      eventLists: {
        ...latest.eventLists,
        event: [...latest.eventLists.event].reverse(),
      },
      eventConsistency: consistency,
    };
    lookup.mockClear();
    const after = project(next, "event", "1日目");
    expect(lookup).not.toHaveBeenCalled();
    expect(after.eventLists.event[0]).toBe(current.eventLists.event[1]);
    expect(after.eventLists.event[1]).toBe(current.eventLists.event[0]);
    expect(after.hallRouteSettings).not.toBe(current.hallRouteSettings);
    expect(
      projectedMembership(after.eventLists.event[1] as ShoppingItem)?.memberIds,
    ).toEqual(["1", "2"]);
    expectProjection(after, next);
  });

  it.each([
    "add",
    "remove",
    "new-object",
    "duplicate-next",
    "duplicate-base",
    "content",
    "multiple-candidates",
    "ambiguous-location",
    "assignment",
    "geometry",
    "definitions",
    "scope-day",
    "scope-event",
  ] as const)(
    "uses the uncached geometry path for %s changes during a reorder",
    (kind) => {
      const { source, lookup } = instrumentedMapSnapshot();
      if (kind === "duplicate-base")
        source.eventLists.event = [
          source.eventLists.event[0],
          source.eventLists.event[0],
          source.eventLists.event[1],
        ];
      if (kind === "multiple-candidates") {
        const halls = source.hallDefinitions.event["1日目マップ"];
        halls.push({ ...(halls[0] as HallDefinition), id: "second-hall" });
      }
      if (kind === "ambiguous-location") {
        const map = source.mapData.event["1日目マップ"] as DayMapData;
        map.blocks.push({
          ...map.blocks[0],
          numberCells: [
            { row: 4, col: 4, value: 1 },
            { row: 4, col: 5, value: 2 },
          ],
        });
      }
      const project = createConsistencySnapshotProjector();
      project(source, "event", "1日目");
      let members = [...source.eventLists.event].reverse() as ShoppingItem[];
      if (kind === "add") members.push(item("3"));
      if (kind === "remove") members = members.slice(0, 1);
      if (kind === "new-object") members[0] = { ...members[0] };
      if (kind === "duplicate-next") members[1] = members[0];
      if (kind === "content")
        members[0] = {
          ...members[0],
          quantity: 3,
          url: "https://example.test/new",
        };
      const next = {
        ...source,
        eventLists: { ...source.eventLists, event: members },
      };
      if (kind === "assignment") {
        next.eventConsistency = structuredClone(source.eventConsistency);
        next.eventConsistency.event.days["1日目"].maps[
          "1日目マップ"
        ].assignments["1"] = {
          kind: "map",
          mapKey: "1日目マップ",
          hallId: "hall",
        };
      }
      if (kind === "geometry")
        next.mapData = {
          ...source.mapData,
          event: { ...source.mapData.event },
        };
      if (kind === "definitions")
        next.hallDefinitions = {
          ...source.hallDefinitions,
          event: { ...source.hallDefinitions.event },
        };
      const event = kind === "scope-event" ? "other" : "event";
      const day = kind === "scope-day" ? "2日目" : "1日目";
      lookup.mockClear();
      const after = project(next, event, day);
      expect(lookup.mock.calls.length).toBeGreaterThan(0);
      expectProjection(after, next, event, day);
    },
  );
});
it("skips geometry lookups for route-only context changes while freshly projecting route settings", () => {
  const { source, lookup } = instrumentedMapSnapshot();
  const project = createConsistencySnapshotProjector();
  const before = project(source, "event", "1日目");
  expect(lookup.mock.calls.length).toBeGreaterThan(0);
  const consistency = structuredClone(source.eventConsistency);
  const context = consistency.event.days["1日目"].maps["1日目マップ"];
  const group = {
    hall: { kind: "map" as const, mapKey: "1日目マップ", hallId: "hall" },
    priority: "none" as const,
  };
  context.hallOrder = [group];
  context.hallVisitLists = [{ group, itemIds: ["2", "1"] }];
  context.route = {
    isRouteVisible: true,
    visitOrder: [
      { row: 3, col: 2, blockName: "A", number: 2, order: 0, itemIds: ["2"] },
    ],
  };
  const next = { ...source, eventConsistency: consistency };
  lookup.mockClear();
  const after = project(next, "event", "1日目");
  expect(lookup).not.toHaveBeenCalled();
  expect(after.eventLists).toBe(before.eventLists);
  expect(after.hallDefinitions).toBe(before.hallDefinitions);
  expect(after.hallRouteSettings).not.toBe(before.hallRouteSettings);
  expect(after.routeSettings.event["1日目マップ"]).toBe(context.route);
  expectProjection(after, next);
  expect(lookup.mock.calls.length).toBeGreaterThan(0); // The public uncached adapter still resolves current geometry.
});

it.each([
  "assignment",
  "map-selection",
  "day-key",
  "definitions",
  "peer-add",
  "number",
  "block",
  "day",
] as const)(
  "rechecks geometry when membership dependency %s changes",
  (kind) => {
    const { source, lookup } = instrumentedMapSnapshot();
    const project = createConsistencySnapshotProjector();
    project(source, "event", "1日目");
    const consistency = structuredClone(source.eventConsistency);
    const next = { ...source, eventConsistency: consistency };
    if (kind === "assignment")
      consistency.event.days["1日目"].maps["1日目マップ"].assignments["1"] = {
        kind: "map",
        mapKey: "1日目マップ",
        hallId: "hall",
      };
    if (kind === "map-selection")
      consistency.event.days["1日目"].selectedMapKey = "1日目マップ";
    if (kind === "day-key")
      consistency.event.days["2日目"] = createDayConsistency();
    if (kind === "definitions")
      next.hallDefinitions = {
        ...source.hallDefinitions,
        event: structuredClone(source.hallDefinitions.event),
      };
    if (["peer-add", "number", "block", "day"].includes(kind)) {
      const members = [...source.eventLists.event] as ShoppingItem[];
      if (kind === "peer-add") members.push({ ...item("3"), number: "1" });
      if (kind === "number") members[0] = { ...members[0], number: "3" };
      if (kind === "block") members[0] = { ...members[0], block: "B" };
      if (kind === "day") members[0] = { ...members[0], eventDate: "2日目" };
      next.eventLists = { ...source.eventLists, event: members };
    }
    lookup.mockClear();
    const after = project(next, "event", "1日目");
    expect(lookup.mock.calls.length).toBeGreaterThan(0);
    expectProjection(after, next);
  },
);

it.each(["name", "id", "key"] as const)(
  "freshly projects raw hall definition %s changes",
  (field) => {
    const source = contextualSnapshot();
    const project = createConsistencySnapshotProjector();
    const before = project(source, "event", "1日目");
    const halls = structuredClone(
      source.hallDefinitions.event["__mapless__:1日目"],
    ) as HallDefinition[];
    if (field === "name") halls[0].name = "更新後の東館";
    if (field === "id") halls[0].id = "replacement-hall";
    const next = {
      ...source,
      hallDefinitions: {
        ...source.hallDefinitions,
        event: {
          [field === "key" ? "__mapless__:2日目" : "__mapless__:1日目"]: halls,
        },
      },
    };
    const after = project(next, "event", "1日目");
    expect(after.hallDefinitions.event).not.toBe(before.hallDefinitions.event);
    expectProjection(after, next);
  },
);
