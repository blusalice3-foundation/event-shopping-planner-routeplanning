import type {
  BlockDefinition,
  CellData,
  CellGroup,
  NumberCellInfo,
} from "../../../types/map";
import type { MapEditorSession } from "./mapEditorSession";

export type BlockSelectionType =
  | "corner"
  | "multiCorner"
  | "rangeStart"
  | "individual";
export type BlockEditMode = "normal" | "multi" | "wall";
export interface MultiRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}
export interface BlockEditTarget {
  originalName: string;
  baselineBlock: BlockDefinition;
}
export interface EditingBlockData {
  block: Partial<BlockDefinition>;
  isAddingNew: boolean;
  target: BlockEditTarget | null;
  editMode: BlockEditMode;
  wallCellGroups: CellGroup[];
  multiRanges: MultiRange[];
  currentBlocks: BlockDefinition[];
  sessionId: string;
  editId: number;
  draftRevision: number;
  blocksRevision: number;
  selectionRequestKey: string;
  reservedResumeEditId: number;
  nextSequence: number;
  consumedSelectionKey: string | null;
}
export interface BlockSelectionResult {
  session?: MapEditorSession;
  type: BlockSelectionType | "cancelled";
  cells: { row: number; col: number }[];
  editingData?: EditingBlockData;
  selectionRequestKey: string;
}
export interface BlockEditingState {
  blocks: BlockDefinition[];
  block: Partial<BlockDefinition> | null;
  target: BlockEditTarget | null;
  isAddingNew: boolean;
  editMode: BlockEditMode;
  wallCellGroups: CellGroup[];
  multiRanges: MultiRange[];
  activeTab: "list" | "edit";
  sessionId: string;
  editId: number;
  draftRevision: number;
  blocksRevision: number;
  nextSequence: number;
  selectionRequestKey: string | null;
  reservedResumeEditId: number | null;
  consumedSelectionKey: string | null;
}
export function cloneBlock(block: BlockDefinition): BlockDefinition {
  return {
    ...block,
    numberCells: block.numberCells.map((c) => ({ ...c })),
    ...(block.nameCells
      ? { nameCells: block.nameCells.map((c) => ({ ...c })) }
      : {}),
    ...(block.cellGroups ? { cellGroups: cloneGroups(block.cellGroups) } : {}),
  };
}
function cloneGroups(groups: CellGroup[]): CellGroup[] {
  return groups.map((g) => ({
    ...g,
    ...(g.cells ? { cells: g.cells.map((c) => ({ ...c })) } : {}),
  }));
}
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      sameValue(Reflect.get(a, k), Reflect.get(b, k)),
  );
}
export const sameBlock = (a: BlockDefinition, b: BlockDefinition): boolean =>
  sameValue(a, b);
export function createBlockEditingState(
  blocks: BlockDefinition[],
  sessionId: string,
): BlockEditingState {
  return {
    blocks,
    block: null,
    target: null,
    isAddingNew: false,
    editMode: "normal",
    wallCellGroups: [],
    multiRanges: [],
    activeTab: "list",
    sessionId,
    editId: 0,
    draftRevision: 0,
    blocksRevision: 0,
    nextSequence: 1,
    selectionRequestKey: null,
    reservedResumeEditId: null,
    consumedSelectionKey: null,
  };
}
function closeEdit(state: BlockEditingState): BlockEditingState {
  return {
    ...state,
    block: null,
    target: null,
    isAddingNew: false,
    wallCellGroups: [],
    multiRanges: [],
    editMode: "normal",
    activeTab: "list",
    selectionRequestKey: null,
    reservedResumeEditId: null,
  };
}
export function beginBlockEdit(
  state: BlockEditingState,
  block: BlockDefinition,
  editId: number,
  nextSequence: number,
): BlockEditingState {
  const baselineBlock = cloneBlock(block);
  const editMode = block.isWallBlock
    ? "wall"
    : block.cellGroups?.length
      ? "multi"
      : "normal";
  return {
    ...state,
    block: cloneBlock(block),
    target: { originalName: block.name, baselineBlock },
    isAddingNew: false,
    editMode,
    wallCellGroups:
      editMode === "wall" ? cloneGroups(block.cellGroups || []) : [],
    multiRanges:
      editMode === "multi"
        ? (block.cellGroups || [])
            .filter((g) => g.type === "range")
            .map((g) => ({
              startRow: g.startRow || 0,
              startCol: g.startCol || 0,
              endRow: g.endRow || 0,
              endCol: g.endCol || 0,
            }))
        : [],
    activeTab: "edit",
    editId,
    nextSequence,
    draftRevision: 0,
    selectionRequestKey: null,
    reservedResumeEditId: null,
  };
}
export function selectionSnapshot(
  state: BlockEditingState,
  selectionRequestKey: string,
  reservedResumeEditId: number,
  nextSequence: number,
): EditingBlockData {
  return {
    block: state.block || {},
    isAddingNew: state.isAddingNew,
    target: state.target,
    editMode: state.editMode,
    wallCellGroups: state.wallCellGroups,
    multiRanges: state.multiRanges,
    currentBlocks: state.blocks,
    sessionId: state.sessionId,
    editId: state.editId,
    draftRevision: state.draftRevision,
    blocksRevision: state.blocksRevision,
    selectionRequestKey,
    reservedResumeEditId,
    nextSequence,
    consumedSelectionKey: state.consumedSelectionKey,
  };
}
function stateFromSnapshot(data: EditingBlockData): BlockEditingState {
  return {
    ...createBlockEditingState(data.currentBlocks, data.sessionId),
    block: data.block,
    target: data.target,
    isAddingNew: data.isAddingNew,
    editMode: data.editMode,
    wallCellGroups: data.wallCellGroups,
    multiRanges: data.multiRanges,
    activeTab: "edit",
    editId: data.editId,
    draftRevision: data.draftRevision,
    blocksRevision: data.blocksRevision,
    selectionRequestKey: data.selectionRequestKey,
    reservedResumeEditId: data.reservedResumeEditId,
    nextSequence: data.nextSequence,
    consumedSelectionKey: data.consumedSelectionKey,
  };
}
export function restoreBlockSelection(
  state: BlockEditingState,
  result: BlockSelectionResult,
): BlockEditingState {
  const data = result.editingData;
  if (
    !data ||
    !result.selectionRequestKey ||
    state.sessionId !== data.sessionId ||
    (result.session && result.session.sessionId !== state.sessionId) ||
    state.selectionRequestKey !== result.selectionRequestKey ||
    data.selectionRequestKey !== result.selectionRequestKey ||
    state.reservedResumeEditId !== data.reservedResumeEditId ||
    state.editId !== data.editId ||
    state.draftRevision !== data.draftRevision ||
    state.blocksRevision !== data.blocksRevision ||
    state.consumedSelectionKey === result.selectionRequestKey
  )
    return state;
  const next = {
    ...stateFromSnapshot(data),
    editId: data.reservedResumeEditId,
    draftRevision: data.draftRevision + 1,
    selectionRequestKey: null,
    reservedResumeEditId: null,
    consumedSelectionKey: result.selectionRequestKey,
  };
  const cells = result.cells;
  if (
    (result.type === "corner" || result.type === "multiCorner") &&
    cells.length >= 4
  ) {
    const range = {
      startRow: Math.min(...cells.map((c) => c.row)),
      startCol: Math.min(...cells.map((c) => c.col)),
      endRow: Math.max(...cells.map((c) => c.row)),
      endCol: Math.max(...cells.map((c) => c.col)),
    };
    if (result.type === "corner") next.block = { ...data.block, ...range };
    else next.multiRanges = [...data.multiRanges, range];
  } else if (
    result.type === "rangeStart" &&
    cells.length >= 2 &&
    data.wallCellGroups.length < 6
  ) {
    const [a, b] = cells;
    next.wallCellGroups = [
      ...data.wallCellGroups,
      {
        type: "range",
        startRow: Math.min(a.row, b.row),
        startCol: Math.min(a.col, b.col),
        endRow: Math.max(a.row, b.row),
        endCol: Math.max(a.col, b.col),
      },
    ];
  } else if (
    result.type === "individual" &&
    cells.length > 0 &&
    data.wallCellGroups.length < 6
  )
    next.wallCellGroups = [
      ...data.wallCellGroups,
      { type: "individual", cells: cells.map((c) => ({ ...c })) },
    ];
  return next;
}
export function initializeBlockEditingState(
  blocks: BlockDefinition[],
  sessionId: string,
  result?: BlockSelectionResult | null,
): BlockEditingState {
  const state = createBlockEditingState(blocks, sessionId);
  if (
    !result?.editingData ||
    result.editingData.sessionId !== sessionId ||
    !result.selectionRequestKey ||
    result.selectionRequestKey !== result.editingData.selectionRequestKey ||
    (result.session && result.session.sessionId !== sessionId)
  )
    return state;
  return restoreBlockSelection(stateFromSnapshot(result.editingData), result);
}
export function detectBlockNumberCells(
  cellsMap: ReadonlyMap<string, CellData>,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): NumberCellInfo[] {
  const cells: NumberCellInfo[] = [];
  for (
    let row = Math.min(startRow, endRow);
    row <= Math.max(startRow, endRow);
    row++
  )
    for (
      let col = Math.min(startCol, endCol);
      col <= Math.max(startCol, endCol);
      col++
    ) {
      const cell = cellsMap.get(`${row}-${col}`);
      if (cell && !cell.isMerged && cell.value !== null) {
        const value =
          typeof cell.value === "number"
            ? cell.value
            : Number(String(cell.value).trim());
        if (!isNaN(value) && value > 0 && value <= 100)
          cells.push({ row, col, value });
      }
    }
  return cells.sort((a, b) => a.value - b.value);
}
export function detectGroupedNumberCells(
  cellsMap: ReadonlyMap<string, CellData>,
  groups: CellGroup[],
): NumberCellInfo[] {
  const all: NumberCellInfo[] = [];
  for (const g of groups) {
    if (g.type === "range" && g.startRow && g.startCol && g.endRow && g.endCol)
      all.push(
        ...detectBlockNumberCells(
          cellsMap,
          g.startRow,
          g.startCol,
          g.endRow,
          g.endCol,
        ),
      );
    else if (g.type === "individual")
      for (const c of g.cells || [])
        all.push(
          ...detectBlockNumberCells(cellsMap, c.row, c.col, c.row, c.col),
        );
  }
  const seen = new Set<string>();
  return all
    .filter((c) => {
      const key = `${c.row}-${c.col}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.value - b.value);
}
export interface BlockSavePlan {
  editId: number;
  draftRevision: number;
  blocksRevision: number;
  candidate: BlockDefinition;
  kind: "new" | "replace" | "edit";
  originalName?: string;
  baselineBlock?: BlockDefinition;
}
export type BlockSaveResult =
  | { ok: true; plan: BlockSavePlan }
  | { ok: false; message: string };
const failure = (message: string): BlockSaveResult => ({ ok: false, message });
export function prepareBlockSave(
  state: BlockEditingState,
  cellsMap: ReadonlyMap<string, CellData>,
  bounds: { maxRow: number; maxCol: number },
  defaultColor: string,
): BlockSaveResult {
  const draft = state.block;
  if (!draft?.name?.trim()) return failure("ブロック名を入力してください");
  const name = draft.name.trim();
  let groups: CellGroup[] | undefined;
  let ranges: MultiRange[];
  if (state.editMode === "wall") {
    if (!state.wallCellGroups.length)
      return failure("セル群を定義してください");
    groups = cloneGroups(state.wallCellGroups);
    if (groups.length > 6) return failure("セル群は6つまで指定してください");
    ranges = [];
    for (const g of groups) {
      if (g.type === "range")
        ranges.push({
          startRow: g.startRow || 0,
          startCol: g.startCol || 0,
          endRow: g.endRow || 0,
          endCol: g.endCol || 0,
        });
      else {
        if (!g.cells?.length) return failure("セル群を定義してください");
        ranges.push(
          ...g.cells.map((c) => ({
            startRow: c.row,
            startCol: c.col,
            endRow: c.row,
            endCol: c.col,
          })),
        );
      }
    }
  } else if (state.editMode === "multi") {
    if (!state.multiRanges.length)
      return failure("少なくとも1つの範囲を定義してください");
    ranges = state.multiRanges;
    groups = ranges.map((r) => ({ type: "range", ...r }));
  } else {
    if (!draft.startRow || !draft.endRow)
      return failure("マップ上で4つの角をクリックして範囲を指定してください");
    ranges = [
      {
        startRow: draft.startRow,
        startCol: draft.startCol || 1,
        endRow: draft.endRow,
        endCol: draft.endCol || 1,
      },
    ];
  }
  const validPoint = (row: number, col: number) =>
    Number.isInteger(row) &&
    row >= 1 &&
    row <= bounds.maxRow &&
    Number.isInteger(col) &&
    col >= 1 &&
    col <= bounds.maxCol;
  if (
    ranges.some(
      (r) =>
        !validPoint(r.startRow, r.startCol) ||
        !validPoint(r.endRow, r.endCol) ||
        r.startRow > r.endRow ||
        r.startCol > r.endCol,
    )
  )
    return failure("マップ内の有効な範囲を指定してください");
  const candidate: BlockDefinition = {
    ...(state.target?.baselineBlock.id !== undefined
      ? { id: state.target.baselineBlock.id }
      : {}),
    name,
    color: draft.color || defaultColor,
    startRow: Math.min(...ranges.map((r) => r.startRow)),
    startCol: Math.min(...ranges.map((r) => r.startCol)),
    endRow: Math.max(...ranges.map((r) => r.endRow)),
    endCol: Math.max(...ranges.map((r) => r.endCol)),
    numberCells: groups
      ? detectGroupedNumberCells(cellsMap, groups)
      : detectBlockNumberCells(
          cellsMap,
          ranges[0].startRow,
          ranges[0].startCol,
          ranges[0].endRow,
          ranges[0].endCol,
        ),
    isAutoDetected: false,
    isWallBlock: state.editMode === "wall",
    ...(groups ? { cellGroups: groups } : {}),
  };
  const nameCells: { row: number; col: number }[] = [];
  for (let row = candidate.startRow; row <= candidate.endRow; row++)
    for (let col = candidate.startCol; col <= candidate.endCol; col++) {
      const cell = cellsMap.get(`${row}-${col}`);
      if (cell && cell.value !== null && String(cell.value).trim() === name)
        nameCells.push({ row, col });
    }
  if (nameCells.length) candidate.nameCells = nameCells;
  const base = {
    editId: state.editId,
    draftRevision: state.draftRevision,
    blocksRevision: state.blocksRevision,
    candidate,
  };
  if (state.isAddingNew) {
    const matches = state.blocks.filter((b) => b.name === name);
    if (matches.length > 1)
      return failure(
        "同じ名前のブロックが複数あります。対象を確認してください",
      );
    return {
      ok: true,
      plan: {
        ...base,
        kind: matches.length ? "replace" : "new",
        ...(matches.length
          ? { originalName: name, baselineBlock: cloneBlock(matches[0]) }
          : {}),
      },
    };
  }
  if (!state.target) return failure("編集対象を選び直してください");
  const matches = state.blocks.filter(
    (b) => b.name === state.target?.originalName,
  );
  if (
    matches.length !== 1 ||
    !sameBlock(matches[0], state.target.baselineBlock)
  )
    return failure("編集対象が変更されています。対象を選び直してください");
  if (state.blocks.some((b) => b !== matches[0] && b.name === name))
    return failure("同じ名前の別のブロックがあります。名前を変更してください");
  return {
    ok: true,
    plan: {
      ...base,
      kind: "edit",
      originalName: state.target.originalName,
      baselineBlock: state.target.baselineBlock,
    },
  };
}
export function applyBlockSave(
  state: BlockEditingState,
  plan: BlockSavePlan,
): BlockEditingState {
  if (
    !state.block ||
    state.selectionRequestKey ||
    state.editId !== plan.editId ||
    state.draftRevision !== plan.draftRevision ||
    state.blocksRevision !== plan.blocksRevision
  )
    return state;
  const matches = state.blocks.filter((b) => b.name === plan.originalName);
  let blocks: BlockDefinition[];
  if (plan.kind === "new") {
    if (
      !state.isAddingNew ||
      state.blocks.some((b) => b.name === plan.candidate.name)
    )
      return state;
    blocks = [...state.blocks, plan.candidate];
  } else {
    if (
      matches.length !== 1 ||
      !plan.baselineBlock ||
      !sameBlock(matches[0], plan.baselineBlock)
    )
      return state;
    if (plan.kind === "edit") {
      if (
        state.isAddingNew ||
        state.target?.originalName !== plan.originalName ||
        state.blocks.some(
          (b) => b !== matches[0] && b.name === plan.candidate.name,
        )
      )
        return state;
      blocks = state.blocks.map((b) => (b === matches[0] ? plan.candidate : b));
    } else {
      if (!state.isAddingNew) return state;
      blocks = [
        ...state.blocks.filter((b) => b !== matches[0]),
        plan.candidate,
      ];
    }
  }
  return closeEdit({
    ...state,
    blocks,
    blocksRevision: state.blocksRevision + 1,
  });
}
export type BlockEditingAction =
  | {
      type: "begin";
      block: BlockDefinition;
      editId: number;
      nextSequence: number;
    }
  | { type: "new"; color: string; editId: number; nextSequence: number }
  | { type: "patch"; patch: Partial<BlockDefinition> }
  | { type: "mode"; mode: BlockEditMode }
  | { type: "tab"; tab: "list" | "edit" }
  | { type: "remove-range"; index: number }
  | { type: "remove-group"; index: number }
  | { type: "delete"; block: BlockDefinition }
  | { type: "delete-all" }
  | { type: "cancel" }
  | { type: "start-selection"; data: EditingBlockData }
  | { type: "restore-selection"; result: BlockSelectionResult }
  | { type: "save"; plan: BlockSavePlan };
export function blockEditingReducer(
  state: BlockEditingState,
  action: BlockEditingAction,
): BlockEditingState {
  switch (action.type) {
    case "begin":
      return beginBlockEdit(
        state,
        action.block,
        action.editId,
        action.nextSequence,
      );
    case "new":
      return {
        ...closeEdit(state),
        block: {
          name: "",
          startRow: 0,
          startCol: 0,
          endRow: 0,
          endCol: 0,
          numberCells: [],
          color: action.color,
        },
        isAddingNew: true,
        activeTab: "edit",
        editId: action.editId,
        nextSequence: action.nextSequence,
        draftRevision: 0,
      };
    case "patch":
      return state.block
        ? {
            ...state,
            block: { ...state.block, ...action.patch },
            draftRevision: state.draftRevision + 1,
          }
        : state;
    case "mode":
      return {
        ...state,
        editMode: action.mode,
        wallCellGroups: [],
        multiRanges: [],
        block:
          state.block && action.mode !== "normal"
            ? { ...state.block, startRow: 0, startCol: 0, endRow: 0, endCol: 0 }
            : state.block,
        draftRevision: state.draftRevision + 1,
      };
    case "tab":
      return { ...state, activeTab: action.tab };
    case "remove-range":
      return {
        ...state,
        multiRanges: state.multiRanges.filter((_, i) => i !== action.index),
        draftRevision: state.draftRevision + 1,
      };
    case "remove-group":
      return {
        ...state,
        wallCellGroups: state.wallCellGroups.filter(
          (_, i) => i !== action.index,
        ),
        draftRevision: state.draftRevision + 1,
      };
    case "cancel":
      return closeEdit(state);
    case "delete-all":
      return closeEdit({
        ...state,
        blocks: [],
        blocksRevision: state.blocksRevision + 1,
      });
    case "delete": {
      const index = state.blocks.indexOf(action.block);
      if (index < 0) return state;
      const next = {
        ...state,
        blocks: state.blocks.filter((_, i) => i !== index),
        blocksRevision: state.blocksRevision + 1,
      };
      return state.target?.originalName === action.block.name
        ? closeEdit(next)
        : next;
    }
    case "start-selection":
      return !state.block ||
        state.selectionRequestKey ||
        !action.data.selectionRequestKey ||
        action.data.sessionId !== state.sessionId ||
        action.data.editId !== state.editId ||
        action.data.draftRevision !== state.draftRevision ||
        action.data.blocksRevision !== state.blocksRevision ||
        action.data.reservedResumeEditId < state.nextSequence ||
        action.data.nextSequence <= action.data.reservedResumeEditId
        ? state
        : {
            ...state,
            selectionRequestKey: action.data.selectionRequestKey,
            reservedResumeEditId: action.data.reservedResumeEditId,
            nextSequence: action.data.nextSequence,
          };
    case "restore-selection":
      return restoreBlockSelection(state, action.result);
    case "save":
      return applyBlockSave(state, action.plan);
  }
}
