import { describe, expect, it } from "vitest";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../../types/item";
import { createEventConsistency } from "../../../types/consistency";
import {
  createConsistencySnapshotProjector,
  projectConsistencySnapshot,
  projectedMembership,
} from "./projection";
import { reuseEqualReferences } from "../../../utils/semanticEquality";

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
