import { expect, test } from "@playwright/test";
import {
  acceptedScenarioFixture,
  defaultCandidateOrder,
  reverseCandidateOrderExpectation,
} from "./shopping-transfer-scenarios";

const item = (
  id: string,
  number: string,
  eventDate = "1日目",
  block = "A",
) => ({
  id,
  number,
  eventDate,
  block,
});
const fixture = (
  kind: "same" | "multiple" | "mixed" | "offscreen" | "collapsed",
) => ({
  items: [
    item("e1", kind === "collapsed" ? "95a" : "90a3"),
    item(
      "e2",
      kind === "same" ? "90a4" : kind === "offscreen" ? "9999a2" : "100a2",
    ),
    item("e3", "95a"),
    item("c0", "90a"),
    item("c1", kind === "collapsed" ? "90a2" : "100a"),
    item("c2", "110a"),
    item(
      "c3",
      kind === "same" ? "90a2" : kind === "offscreen" ? "9999a" : "120a",
    ),
  ],
  executeIds: ["e1", "e2", "e3"],
});

test("reverse same-visit order distinguishes the raw boundary from the displayed visit tail", () => {
  const before = fixture("same");
  const original = structuredClone(before);
  const result = reverseCandidateOrderExpectation(before, ["e1", "e2"], {
    anchorId: "c0",
  });
  expect(result.boundaryId).toBe("c3");
  expect(result.expectedItemOrder).toEqual([
    "c0",
    "c1",
    "e3",
    "c2",
    "e1",
    "e2",
    "c3",
  ]);
  expect(result.expectedRawCandidateIds).toEqual([
    "c0",
    "c1",
    "c2",
    "e1",
    "e2",
    "c3",
  ]);
  expect(result.expectedDisplayIds).toEqual([
    "c0",
    "c3",
    "e1",
    "e2",
    "c1",
    "c2",
  ]);
  expect(result.expectedExecuteIds).toEqual(["e3"]);
  expect(before).toEqual(original);
});

test("reverse multiple merge keeps the moved block at one raw boundary", () => {
  const result = reverseCandidateOrderExpectation(
    fixture("multiple"),
    ["e1", "e2"],
    {
      anchorId: "c0",
    },
  );
  expect(result.boundaryId).toBe("c1");
  expect(result.expectedRawCandidateIds).toEqual([
    "c0",
    "e1",
    "e2",
    "c1",
    "c2",
    "c3",
  ]);
  expect(result.expectedDisplayIds).toEqual([
    "c0",
    "e1",
    "c1",
    "e2",
    "c2",
    "c3",
  ]);
  expect(
    result.expectedRawCandidateIds.filter((id) => ["c1", "e2"].includes(id)),
  ).toEqual(["e2", "c1"]);
  expect(
    result.expectedDisplayIds.filter((id) => ["c1", "e2"].includes(id)),
  ).toEqual(["c1", "e2"]);
});

test("reverse mixed transfer preserves source order while numeric display interleaves visits", () => {
  const result = reverseCandidateOrderExpectation(
    fixture("mixed"),
    ["e1", "e2", "e3"],
    {
      anchorId: "c0",
    },
  );
  expect(result.sourceIds).toEqual(["e1", "e2", "e3"]);
  expect(result.expectedItemOrder).toEqual([
    "c0",
    "e1",
    "e2",
    "e3",
    "c1",
    "c2",
    "c3",
  ]);
  expect(result.expectedDisplayIds).toEqual([
    "c0",
    "e1",
    "e3",
    "c1",
    "e2",
    "c2",
    "c3",
  ]);
  expect(result.expectedExecuteIds).toEqual([]);
});

test("reverse offscreen destination does not relocate a moved member to an unrelated raw visit tail", () => {
  const result = reverseCandidateOrderExpectation(
    fixture("offscreen"),
    ["e1", "e2"],
    {
      anchorId: "c0",
    },
  );
  expect(result.boundaryId).toBe("c1");
  expect(result.expectedRawCandidateIds).toEqual([
    "c0",
    "e1",
    "e2",
    "c1",
    "c2",
    "c3",
  ]);
  expect(result.expectedDisplayIds).toEqual([
    "c0",
    "e1",
    "c1",
    "c2",
    "c3",
    "e2",
  ]);
});

test("collapsed candidate header uses its existing first-member boundary", () => {
  const result = reverseCandidateOrderExpectation(
    fixture("collapsed"),
    ["e1"],
    {
      anchorId: "c2",
      collapsedFirstMemberId: "c0",
    },
  );
  expect(result.boundaryKind).toBe("collapsed-first-member");
  expect(result.boundaryId).toBe("c0");
  expect(result.expectedRawCandidateIds).toEqual([
    "e1",
    "c0",
    "c1",
    "c2",
    "c3",
  ]);
  expect(result.expectedDisplayIds).toEqual(["c0", "c1", "e1", "c2", "c3"]);
  expect(result.expectedExecuteIds).toEqual(["e2", "e3"]);
});

test("reverse boundary oracle preserves another day's item slots and execution order", () => {
  const before = {
    items: [
      item("old", "01a", "2日目"),
      item("e2", "09a"),
      item("c10", "10a"),
      item("e1", "08a"),
      item("c2", "02a"),
    ],
    executeIds: ["e1", "e2"],
  };
  const result = reverseCandidateOrderExpectation(before, ["e1"], {
    anchorId: "c10",
  });
  expect(result.boundaryId).toBeNull();
  expect(result.expectedItemOrder).toEqual(["old", "e2", "c10", "c2", "e1"]);
  expect(result.expectedExecuteIds).toEqual(["e2"]);
  expect(result.expectedDisplayIds).toEqual(["c2", "e1", "c10"]);
});

test("candidate default order is stable Japanese numeric block/number order", () => {
  const values = [
    item("a10", "10a"),
    item("b2", "02a", "1日目", "B"),
    item("a2", "2a"),
    item("a2-again", "2a"),
  ];
  expect(defaultCandidateOrder(values)).toEqual([
    "a2",
    "a2-again",
    "a10",
    "b2",
  ]);
  expect(values.map((entry) => entry.id)).toEqual([
    "a10",
    "b2",
    "a2",
    "a2-again",
  ]);
});

test("reverse oracle rejects missing, duplicate, and nonexecution members", () => {
  const before = fixture("same");
  for (const ids of [["e1", "e1"], ["missing"], ["c0"]])
    expect(() =>
      reverseCandidateOrderExpectation(before, ids, { anchorId: "c0" }),
    ).toThrow();
  expect(() =>
    reverseCandidateOrderExpectation(before, ["e1"], { anchorId: "missing" }),
  ).toThrow();
});

test("mixed fixture retains raw requested order and distinct candidate display order", () => {
  const fixture = acceptedScenarioFixture({
    count: 500,
    input: "native",
    grouped: true,
    load: "light",
    direction: "candidate-to-execute",
    scenario: "mixed",
  });
  expect(fixture.requestedIds).toEqual(["c1", "c2", "c3"]);
  const selected = Object.values(fixture.backup.data.eventLists)
    .flat()
    .filter((entry) => fixture.requestedIds.includes(entry.id));
  expect(defaultCandidateOrder(selected)).toEqual(["c1", "c3", "c2"]);
  expect(fixture.effectiveIds).toEqual(["c1", "c2", "c3"]);
});
