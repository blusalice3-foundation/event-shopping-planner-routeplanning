import { describe, expect, it, vi } from "vitest";
import type { BlockDefinition, CellData, CellGroup } from "../../../types/map";
import {
  applyBlockSave,
  beginBlockEdit,
  blockEditingReducer,
  createBlockEditingState,
  detectBlockNumberCells,
  detectGroupedNumberCells,
  initializeBlockEditingState,
  prepareBlockSave,
  restoreBlockSelection,
  selectionSnapshot,
  type BlockEditMode,
  type BlockEditingState,
  type BlockSelectionResult,
  type BlockSelectionType,
} from "./blockDefinitionEditing";
const block = (name: string, id?: string): BlockDefinition => ({
  name,
  startRow: 1,
  startCol: 1,
  endRow: 3,
  endCol: 3,
  numberCells: [{ row: 1, col: 2, value: 1 }],
  nameCells: [{ row: 1, col: 1 }],
  isAutoDetected: true,
  ...(id ? { id } : {}),
});
const cells = new Map<string, CellData>();
for (const [row, col, value, isMerged] of [
  [1, 1, "b", false],
  [1, 2, 1, false],
  [1, 3, "2.5", false],
  [2, 1, 0, false],
  [2, 2, 4, true],
  [2, 3, 101, false],
  [3, 1, " 新名 ", false],
] as const)
  cells.set(`${row}-${col}`, {
    row,
    col,
    value,
    isMerged,
    backgroundColor: null,
    borders: { top: null, bottom: null, left: null, right: null },
  });
const bounds = { maxRow: 10, maxCol: 10 };
const prepare = (state: BlockEditingState) =>
  prepareBlockSave(state, cells, bounds, "#default");
function prepared(state: BlockEditingState) {
  const result = prepare(state);
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}
const edit = (blocks = [block("b"), block("B"), block("ヤ")]) =>
  beginBlockEdit(createBlockEditingState(blocks, "session"), blocks[0], 1, 2);
const patch = (state: BlockEditingState, value: Partial<BlockDefinition>) =>
  blockEditingReducer(state, { type: "patch", patch: value });
function newState(mode: BlockEditMode) {
  let state = blockEditingReducer(
    createBlockEditingState([block("b", "old-id"), block("other")], "session"),
    { type: "new", color: "", editId: 1, nextSequence: 2 },
  );
  state = blockEditingReducer(state, { type: "mode", mode });
  return patch(state, { name: "b" });
}
function complete(
  state: BlockEditingState,
  mode: BlockEditMode,
): BlockEditingState {
  return {
    ...state,
    editMode: mode,
    block: { ...state.block, startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
    wallCellGroups: [
      {
        type: "individual",
        cells: [
          { row: 1, col: 1 },
          { row: 1, col: 2 },
        ],
      },
    ],
    multiRanges: [{ startRow: 1, startCol: 1, endRow: 3, endCol: 3 }],
  };
}
function startSelection(
  state: BlockEditingState,
  type: BlockSelectionType,
  sequence = state.nextSequence,
) {
  const data = selectionSnapshot(
    state,
    `session:${sequence}`,
    sequence + 1,
    sequence + 2,
  );
  const selecting = blockEditingReducer(state, {
    type: "start-selection",
    data,
  });
  const result: BlockSelectionResult = {
    type,
    cells: [
      { row: 4, col: 4 },
      { row: 5, col: 5 },
      { row: 4, col: 5 },
      { row: 5, col: 4 },
    ],
    editingData: data,
    selectionRequestKey: data.selectionRequestKey,
  };
  return { selecting, result, data };
}
describe("block definition atomic saves", () => {
  it.each(["normal", "wall", "multi"] as const)(
    "keeps original same-name block and draft on incomplete %s addition",
    (mode) => {
      const state = newState(mode),
        original = structuredClone(state.blocks);
      expect(prepare(state).ok).toBe(false);
      expect(state.blocks).toEqual(original);
      const cancelled = blockEditingReducer(state, { type: "cancel" });
      expect(cancelled.blocks).toBe(state.blocks);
      expect(cancelled.blocks).toEqual(original);
    },
  );
  it("replaces a validated new definition once, without inheriting an id", () => {
    const state = complete(newState("normal"), "normal"),
      plan = prepared(state),
      other = state.blocks[1];
    expect(plan.kind).toBe("replace");
    expect(plan.candidate).not.toHaveProperty("id");
    expect(state.blocks[0].id).toBe("old-id");
    const saved = applyBlockSave(state, plan);
    expect(saved.blocks).toHaveLength(2);
    expect(saved.blocks[0]).toBe(other);
    expect(saved.blocks[1]).toEqual(plan.candidate);
    expect(saved.block).toBeNull();
    expect(applyBlockSave(saved, plan)).toBe(saved);
  });
  it("retains exactly the target across locale ordering and b/B names", () => {
    let state = edit();
    const original = state.blocks;
    state = patch(state, { name: "b監査" });
    const plan = prepared(state);
    const saved = applyBlockSave(state, plan);
    expect(saved.blocks.map((b) => b.name)).toEqual(["b監査", "B", "ヤ"]);
    expect(saved.blocks[1]).toBe(original[1]);
    expect(saved.blocks[2]).toBe(original[2]);
    expect(original[0].name).toBe("b");
    expect(saved.blocks[0]).not.toHaveProperty("nameCells");
  });
  it("preserves unrelated deletion, rejects changed/deleted/ambiguous targets and rename collisions", () => {
    const state = edit(),
      original = state.blocks;
    const withoutOther = blockEditingReducer(state, {
      type: "delete",
      block: original[2],
    });
    expect(prepare(withoutOther).ok).toBe(true);
    expect(withoutOther.target).toBe(state.target);
    expect(prepare({ ...state, blocks: original.slice(1) }).ok).toBe(false);
    expect(
      prepare({
        ...state,
        blocks: [{ ...original[0], color: "changed" }, ...original.slice(1)],
      }).ok,
    ).toBe(false);
    expect(prepare({ ...state, blocks: [...original, block("b")] }).ok).toBe(
      false,
    );
    expect(prepare(patch(state, { name: "B" })).ok).toBe(false);
    expect(
      blockEditingReducer(state, { type: "delete", block: original[0] }).block,
    ).toBeNull();
    expect(blockEditingReducer(state, { type: "delete-all" }).block).toBeNull();
    expect(
      prepare(
        complete(
          { ...newState("normal"), blocks: [block("b"), block("b")] },
          "normal",
        ),
      ).ok,
    ).toBe(false);
  });
  it("rejects stale revisions, target changes, new edits and old approved candidates", () => {
    const state = edit(),
      plan = prepared(state);
    for (const changed of [
      patch(state, { color: "#new" }),
      blockEditingReducer(state, { type: "delete", block: state.blocks[2] }),
      beginBlockEdit(state, state.blocks[1], 2, 3),
      {
        ...state,
        blocks: [
          { ...state.blocks[0], color: "changed" },
          ...state.blocks.slice(1),
        ],
      },
    ])
      expect(applyBlockSave(changed, plan)).toBe(changed);
  });
  it.each([false, true])(
    "regenerates all editable attributes, id present=%s",
    (withId) => {
      for (const from of ["normal", "wall", "multi"] as const)
        for (const to of ["normal", "wall", "multi"] as const) {
          const original = block("b", withId ? "retained" : undefined);
          if (from !== "normal")
            original.cellGroups = [
              { type: "range", startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
            ];
          original.isWallBlock = from === "wall";
          let state = complete(
            beginBlockEdit(
              createBlockEditingState([original], "session"),
              original,
              1,
              2,
            ),
            to,
          );
          state = patch(state, { name: "新名", color: "#new" });
          const candidate = prepared(state).candidate;
          expect(candidate.id).toBe(withId ? "retained" : undefined);
          expect(Object.prototype.hasOwnProperty.call(candidate, "id")).toBe(
            withId,
          );
          if (candidate.endRow >= 3)
            expect(candidate.nameCells).toEqual([{ row: 3, col: 1 }]);
          else expect(candidate).not.toHaveProperty("nameCells");
          expect(candidate.isAutoDetected).toBe(false);
          expect(candidate.isWallBlock).toBe(to === "wall");
          if (to === "normal")
            expect(candidate).not.toHaveProperty("cellGroups");
          else
            expect(
              candidate.cellGroups?.every(
                (g) => to === "wall" || g.type === "range",
              ),
            ).toBe(true);
          expect(original.nameCells).toEqual([{ row: 1, col: 1 }]);
        }
    },
  );
  it("regenerates name cells for color-only and range-only saves and clones nested arrays", () => {
    const original = block("b", "id");
    original.cellGroups = [
      {
        type: "individual",
        cells: [
          { row: 1, col: 1 },
          { row: 1, col: 2 },
        ],
      },
    ];
    original.isWallBlock = true;
    const state = beginBlockEdit(
      createBlockEditingState([original], "session"),
      original,
      1,
      2,
    );
    const candidate = prepared(patch(state, { color: "#new" })).candidate;
    expect(candidate.nameCells).toEqual([{ row: 1, col: 1 }]);
    expect(candidate.cellGroups).not.toBe(original.cellGroups);
    expect(candidate.cellGroups?.[0].cells).not.toBe(
      original.cellGroups[0].cells,
    );
    expect(state.wallCellGroups[0].cells).not.toBe(
      state.target?.baselineBlock.cellGroups?.[0].cells,
    );
    const moved = patch(complete(state, "normal"), {
      startRow: 2,
      startCol: 1,
      endRow: 3,
      endCol: 3,
    });
    expect(prepared(moved).candidate).not.toHaveProperty("nameCells");
  });
  it("validates bounds before reading cells and uses default columns without accepting malformed coordinates", () => {
    const state = patch(edit(), { startCol: 0, endCol: 0 });
    expect(prepared(state).candidate.startCol).toBe(1);
    const source = new Map(cells);
    const spy = vi.spyOn(source, "get");
    expect(
      prepareBlockSave(patch(state, { endRow: 11 }), source, bounds, "#default")
        .ok,
    ).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
describe("block selection identity and restoration", () => {
  it.each(["corner", "multiCorner", "rangeStart", "individual"] as const)(
    "consumes first %s terminal exactly once and preserves local list",
    (type) => {
      const mode =
        type === "corner"
          ? "normal"
          : type === "multiCorner"
            ? "multi"
            : "wall";
      const state = complete(edit(), mode);
      state.blocks = [
        state.blocks[0],
        { ...state.blocks[1], color: "locally-saved" },
      ];
      const { selecting, result, data } = startSelection(state, type);
      for (const terminals of [
        [result, result],
        [result, { ...result, type: "cancelled" as const }],
        [{ ...result, type: "cancelled" as const }, result],
      ]) {
        const restored = restoreBlockSelection(selecting, terminals[0]);
        expect(restoreBlockSelection(restored, terminals[1])).toBe(restored);
        expect(
          initializeBlockEditingState([], "session", terminals[0]),
        ).toEqual(restored);
        expect(restored.editId).toBe(data.reservedResumeEditId);
        expect(restored.draftRevision).toBe(data.draftRevision + 1);
        expect(restored.blocksRevision).toBe(state.blocksRevision);
        expect(restored.blocks).toBe(state.blocks);
        expect(restored.target).toBe(state.target);
        if (terminals[0].type === "cancelled") {
          expect(restored.block).toBe(state.block);
          expect(restored.wallCellGroups).toBe(state.wallCellGroups);
          expect(restored.multiRanges).toBe(state.multiRanges);
        } else if (type === "multiCorner")
          expect(restored.multiRanges).toHaveLength(
            state.multiRanges.length + 1,
          );
        else if (type !== "corner")
          expect(restored.wallCellGroups).toHaveLength(
            state.wallCellGroups.length + 1,
          );
      }
    },
  );
  it("rejects old restores after typing, another target, K2 start and K2 completion, and invalidates old saves", () => {
    const state = complete(edit(), "multi"),
      oldPlan = prepared(state),
      k1 = startSelection(state, "multiCorner");
    const resumed = restoreBlockSelection(k1.selecting, k1.result);
    expect(applyBlockSave(resumed, oldPlan)).toBe(resumed);
    const typed = patch(resumed, { name: "new-input" });
    const k2 = startSelection(typed, "multiCorner");
    const resumed2 = restoreBlockSelection(k2.selecting, k2.result);
    for (const current of [
      typed,
      beginBlockEdit(
        resumed,
        state.blocks[1],
        resumed.nextSequence,
        resumed.nextSequence + 1,
      ),
      k2.selecting,
      resumed2,
    ])
      expect(restoreBlockSelection(current, k1.result)).toBe(current);
    expect(k2.data.selectionRequestKey).not.toBe(k1.data.selectionRequestKey);
    expect(k2.data.reservedResumeEditId).toBeGreaterThan(
      k1.data.reservedResumeEditId,
    );
    expect(resumed2.block?.name).toBe("new-input");
  });
  it("ignores missing/mismatched keys, reservations, session, and never allocates from pure restore", () => {
    const { selecting, result } = startSelection(edit(), "corner");
    const data = result.editingData!;
    for (const invalid of [
      { ...result, selectionRequestKey: "" },
      { ...result, selectionRequestKey: "other" },
      { ...result, editingData: undefined },
      { ...result, editingData: { ...data, sessionId: "old-session" } },
      { ...result, editingData: { ...data, reservedResumeEditId: 999 } },
    ])
      expect(restoreBlockSelection(selecting, invalid)).toBe(selecting);
    const typed = patch(edit(), { name: "new input" });
    expect(blockEditingReducer(typed, { type: "start-selection", data })).toBe(
      typed,
    );
    const empty = initializeBlockEditingState([], "session", {
      ...result,
      selectionRequestKey: "other",
    });
    expect(empty.block).toBeNull();
    const a = restoreBlockSelection(selecting, result),
      b = restoreBlockSelection(selecting, result);
    expect(a).toEqual(b);
    expect(a.nextSequence).toBe(data.nextSequence);
  });
  it("keeps list/cell-group/range references on names and colors, with tab changes preserving revisions", () => {
    const state = complete(edit(), "wall");
    const typed = patch(patch(state, { name: "b監査" }), { color: "#new" });
    expect(typed.blocks).toBe(state.blocks);
    expect(typed.wallCellGroups).toBe(state.wallCellGroups);
    expect(typed.multiRanges).toBe(state.multiRanges);
    const tab = blockEditingReducer(typed, { type: "tab", tab: "list" });
    expect(tab.draftRevision).toBe(typed.draftRevision);
    expect(tab.blocksRevision).toBe(typed.blocksRevision);
  });
  it("retains numeric acceptance, merged exclusion, value order and grouped coordinate de-duplication", () => {
    expect(
      detectBlockNumberCells(cells, 1, 1, 3, 3).map((c) => c.value),
    ).toEqual([1, 2.5]);
    const groups: CellGroup[] = [
      { type: "range", startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
      {
        type: "individual",
        cells: [
          { row: 1, col: 2 },
          { row: 2, col: 2 },
        ],
      },
    ];
    expect(detectGroupedNumberCells(cells, groups).map((c) => c.value)).toEqual(
      [1, 2.5],
    );
  });
});
