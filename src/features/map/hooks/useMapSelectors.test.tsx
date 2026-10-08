// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  getMaplessKey,
  type HallDefinitionsStore,
  type HallRouteSettingsStore,
} from "../../../types/map";
import { useMapSelectors } from "./useMapSelectors";

it("reuses day hall and derived order arrays until their definitions or settings change", () => {
  const key = getMaplessKey("1日目");
  const halls: HallDefinitionsStore = {
    event: { [key]: [{ id: "east", name: "東", vertices: [] }] },
  };
  const settings: HallRouteSettingsStore = {};
  const params = {
    activeEventName: "event",
    activeTab: "1日目",
    activeEventDate: "1日目",
    mapViewActive: false,
    mapData: {},
    hallDefinitions: halls,
    hallRouteSettings: settings,
  };
  const { result, rerender } = renderHook(useMapSelectors, {
    initialProps: params,
  });
  const first = result.current.getHallsForDate("1日目");
  const order = result.current.getHallOrderForDate("1日目");
  expect(order).toEqual(["east"]);
  expect(result.current.getHallsForDate("1日目")).toBe(first);
  expect(result.current.getHallOrderForDate("1日目")).toBe(order);
  // Unrelated accepted/saved state may replace store containers without changing inputs.
  rerender({
    ...params,
    mapData: {},
    hallDefinitions: { ...halls },
    hallRouteSettings: {},
  });
  expect(result.current.getHallsForDate("1日目")).toBe(first);
  expect(result.current.getHallOrderForDate("1日目")).toBe(order);
  rerender({
    ...params,
    hallDefinitions: {
      event: { [key]: [...first, { id: "west", name: "西", vertices: [] }] },
    },
  });
  expect(result.current.getHallsForDate("1日目")).not.toBe(first);
  expect(result.current.getHallOrderForDate("1日目")).toEqual(["east", "west"]);
});
