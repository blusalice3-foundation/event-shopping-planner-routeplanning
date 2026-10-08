// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRouteCalculation } from "./useRouteCalculation";
import type { DayMapData } from "../../../types/map";
import type { RouteJob } from "./worker/routeJob";
const map: DayMapData = {
  maxRow: 3,
  maxCol: 3,
  cells: [],
  blocks: [],
  mergedCells: [],
};
const instances: TestWorker[] = [];
class TestWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    instances.push(this);
  }
}
afterEach(() => {
  instances.length = 0;
  vi.unstubAllGlobals();
});
it("interrupts obsolete searches and exposes only results for the current route", () => {
  vi.stubGlobal("Worker", TestWorker);
  const job = (col: number): RouteJob & { kind: "segments" } => ({
    kind: "segments",
    mapData: map,
    points: [
      { row: 1, col: 1 },
      { row: 2, col },
    ],
    enabled: true,
  });
  const hook = renderHook(({ col }) => useRouteCalculation(job(col)), {
    initialProps: { col: 2 },
  });
  const first = instances[0];
  const oldReply = first.onmessage!;
  const oldKey = first.postMessage.mock.calls[0][0].key;
  hook.rerender({ col: 3 });
  expect(first.terminate).toHaveBeenCalledOnce();
  expect(hook.result.current.pending).toBe(true);
  act(() =>
    oldReply({ data: { key: oldKey, result: ["obsolete"] } } as MessageEvent),
  );
  expect(hook.result.current.result).toEqual([]);
  const current = instances[1];
  act(() =>
    current.onmessage!({
      data: { key: current.postMessage.mock.calls[0][0].key, result: [] },
    } as MessageEvent),
  );
  expect(hook.result.current.pending).toBe(false);
});
it("does not resubmit an equivalent route on an unrelated render", () => {
  vi.stubGlobal("Worker", TestWorker);
  const hook = renderHook(
    ({ memo }) => {
      void memo;
      return useRouteCalculation({
        kind: "segments",
        mapData: map,
        points: [
          { row: 1, col: 1 },
          { row: 2, col: 2 },
        ],
        enabled: true,
      });
    },
    { initialProps: { memo: "ユーザー登録" } },
  );
  hook.rerender({ memo: "エラーが発生しました" });
  expect(instances).toHaveLength(1);
  expect(instances[0].postMessage).toHaveBeenCalledOnce();
});

it("rejects a retired response when geometry returns to the same key", () => {
  vi.stubGlobal("Worker", TestWorker);
  const hook = renderHook(
    ({ col }) =>
      useRouteCalculation({
        kind: "segments",
        mapData: map,
        points: [
          { row: 1, col: 1 },
          { row: 2, col },
        ],
        enabled: true,
      }),
    { initialProps: { col: 2 } },
  );
  const first = instances[0];
  const retired = first.onmessage!;
  const key = first.postMessage.mock.calls[0][0].key;
  hook.rerender({ col: 3 });
  hook.rerender({ col: 2 });
  act(() => retired({ data: { key, result: ["retired"] } } as MessageEvent));
  expect(hook.result.current.pending).toBe(true);
  expect(hook.result.current.result).toEqual([]);
  const current = instances[instances.length - 1];
  act(() => current.onmessage!({ data: { key, result: [] } } as MessageEvent));
  expect(hook.result.current.pending).toBe(false);
});
