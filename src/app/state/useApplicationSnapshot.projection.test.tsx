// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PersistenceCommandPort } from "../ports/PersistenceCommandPort";
import type { ShoppingItem } from "../../types/item";
import {
  createDayConsistency,
  createEventConsistency,
  createVisitContext,
} from "../../types/consistency";
import { projectedMembership } from "../../features/consistency/domain/projection";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "./useApplicationSnapshot";

it("keeps fresh hidden membership through the real display reference reuse boundary", () => {
  const item = (id: string): ShoppingItem => ({
    id,
    eventDate: "1日目",
    block: "A",
    number: id,
    circle: "ユーザー登録",
    title: "新刊",
    remarks: "エラーが発生しました",
    price: 500,
    quantity: 1,
    purchaseStatus: "None",
  });
  const source = {
    ...emptyApplicationSnapshot(),
    eventLists: { event: [item("1"), item("2")] },
    hallDefinitions: {
      event: {
        "__mapless__:1日目": [
          { id: "hall", name: "東館", blockNames: ["A"], vertices: [] },
        ],
      },
    },
    eventConsistency: {
      event: {
        ...createEventConsistency(),
        days: {
          "1日目": { ...createDayConsistency(), mapless: createVisitContext() },
        },
      },
    },
  };
  const commit = vi.fn();
  const port = {
    readApplicationSnapshot: async () => ({
      snapshot: source,
      expectedRoots: {},
      consistencyMissing: false,
    }),
    commitApplicationSnapshotAtomically: commit,
    bindApplicationSettings: () => () => {},
  } as unknown as PersistenceCommandPort;
  const hook = renderHook(() => useApplicationSnapshot(port, "event", "1日目"));
  act(() => {
    hook.result.current.hydrationSetters.setEventLists(source.eventLists);
    hook.result.current.hydrationSetters.setHallDefinitions(
      source.hallDefinitions,
    );
    hook.result.current.hydrationSetters.setEventConsistency(
      source.eventConsistency,
    );
  });
  const before = hook.result.current.values.eventLists.event[0];
  expect(projectedMembership(before)?.reason).toBe("automatic");
  const consistency = structuredClone(source.eventConsistency);
  consistency.event.days["1日目"].mapless!.assignments["1"] = {
    kind: "simple",
    dayKey: "1日目",
    hallId: "hall",
  };
  act(() =>
    hook.result.current.hydrationSetters.setEventConsistency(consistency),
  );
  const assigned = hook.result.current.values.eventLists.event[0];
  expect(assigned).toEqual(before);
  expect(assigned).not.toBe(before);
  expect(projectedMembership(assigned)?.reason).toBe("manual");
  expect(projectedMembership(before)?.reason).toBe("automatic");
  act(() =>
    hook.result.current.hydrationSetters.setEventLists({
      event: [
        source.eventLists.event[0],
        { ...source.eventLists.event[1], number: "1" },
      ],
    }),
  );
  const joined = hook.result.current.values.eventLists.event[0];
  expect(joined).toEqual(assigned);
  expect(joined).not.toBe(assigned);
  expect(projectedMembership(joined)?.memberIds).toEqual(["1", "2"]);
  expect(projectedMembership(assigned)?.memberIds).toEqual(["1"]);
  expect(commit).not.toHaveBeenCalled();
});
