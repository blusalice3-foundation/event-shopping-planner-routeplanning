import { describe, expect, it } from "vitest";
import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../types/item";
import { createEventConsistency } from "../../types/consistency";
import { projectConsistencySnapshot } from "../../features/consistency/domain/projection";
import {
  selectExecuteColumnItems,
  selectMapVisitListItems,
} from "./appListViewSelectors";
import { createAppListViewProjectors } from "./incrementalAppListView";

const day = "1日目";
const item = (id: string, number: string): ShoppingItem => ({
  id,
  eventDate: day,
  block: "A",
  number,
  circle: id,
  title: "新刊",
  price: 500,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "ユーザー登録",
});
function confirmed(items: ShoppingItem[], hall: string): ShoppingItem[] {
  const source: PersistenceSnapshot = {
    eventLists: { event: items },
    eventMetadata: {},
    executeModeItems: {},
    dayModes: {},
    mapData: {},
    mapRotationSettings: {},
    mapViewportSettings: {},
    routeSettings: {},
    hallRouteSettings: {},
    hallDefinitions: {
      event: {
        [`__mapless__:${day}`]: [
          { id: hall, name: hall, vertices: [], blockNames: ["A"] },
        ],
      },
    },
    eventConsistency: { event: createEventConsistency() },
  };
  return projectConsistencySnapshot(source, "event", day).eventLists
    .event as ShoppingItem[];
}

describe("upstream execution placement projection", () => {
  it("retains each confirmed hall's raw first-visit order before downstream rendering", () => {
    const [aX, aZ] = confirmed(
      [item("A-X", "01a"), item("A-Z", "03a")],
      "east",
    );
    const [bY, bX] = confirmed(
      [item("B-Y", "02a"), item("B-X", "01a")],
      "west",
    );
    const items = [aX, bY, bX, aZ];
    const rawIds = items.map((record) => record.id);
    const input = {
      activeEventName: "event",
      activeEventDate: day,
      items,
      executeModeItems: { event: { [day]: rawIds } },
    };
    const expected = ["A-X", "A-Z", "B-Y", "B-X"];
    expect(selectExecuteColumnItems(input).map((record) => record.id)).toEqual(
      expected,
    );
    expect(
      createAppListViewProjectors()
        .execute(input)
        .map((record) => record.id),
    ).toEqual(expected);
    expect(
      selectMapVisitListItems({
        ...input,
        dayName: day,
        mapTabName: "map",
      }).map((record) => record.id),
    ).toEqual(expected);
    expect(input.executeModeItems.event[day]).toEqual([
      "A-X",
      "B-Y",
      "B-X",
      "A-Z",
    ]);
  });
});
