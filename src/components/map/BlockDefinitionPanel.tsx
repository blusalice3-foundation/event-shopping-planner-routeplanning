import { useModalDialogBehavior } from "../../hooks/useModalDialogBehavior";
import type { MapEditorSession } from "../../features/map/domain/mapEditorSession";
import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useId,
  useReducer,
  useRef,
} from "react";
import { DayMapData, BlockDefinition, CellData } from "../../types/map";
import {
  blockEditingReducer,
  detectBlockNumberCells,
  detectGroupedNumberCells,
  initializeBlockEditingState,
  prepareBlockSave,
  selectionSnapshot,
  type BlockEditMode,
  type BlockSelectionResult,
  type BlockSelectionType,
  type EditingBlockData,
} from "../../features/map/domain/blockDefinitionEditing";

interface BlockDefinitionPanelProps {
  isOpen: boolean;
  session?: MapEditorSession;
  onClose: () => void;
  mapData: DayMapData;
  onUpdateBlocks: (
    blocks: BlockDefinition[],
    session?: MapEditorSession,
  ) => void;
  onStartCellSelection: (
    type: BlockSelectionType,
    editingData: EditingBlockData,
  ) => void;
  pendingCellSelection?: BlockSelectionResult | null;
  onClearPendingCellSelection?: (selectionRequestKey: string) => void;
}
const BLOCK_COLORS = [
  "#E3F2FD",
  "#E8F5E9",
  "#FFF3E0",
  "#F3E5F5",
  "#E0F7FA",
  "#FBE9E7",
  "#F1F8E9",
  "#FCE4EC",
  "#E8EAF6",
  "#FFFDE7",
  "#EFEBE9",
  "#ECEFF1",
];
type SortDirection = "asc" | "desc";
const BlockDefinitionPanel: React.FC<BlockDefinitionPanelProps> = ({
  isOpen,
  session,
  onClose,
  mapData,
  onUpdateBlocks,
  onStartCellSelection,
  pendingCellSelection,
  onClearPendingCellSelection,
}) => {
  const localSessionId = useId();
  const sessionId =
    session?.sessionId ||
    pendingCellSelection?.editingData?.sessionId ||
    localSessionId;
  const [state, dispatch] = useReducer(blockEditingReducer, undefined, () =>
    initializeBlockEditingState(
      mapData.blocks,
      sessionId,
      pendingCellSelection,
    ),
  );
  const {
    blocks,
    block: editingBlock,
    isAddingNew,
    editMode,
    wallCellGroups,
    multiRanges,
    activeTab,
  } = state;
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const nextSequence = useRef(state.nextSequence);
  const selectionInFlight = useRef<string | null>(null);
  const saving = useRef(false);
  const submitted = useRef<string | null>(null);
  const reserveEdit = () => {
    const editId = nextSequence.current++;
    return { editId, nextSequence: nextSequence.current };
  };
  const setActiveTab = (tab: "list" | "edit") => dispatch({ type: "tab", tab });
  const cellsMap = useMemo(() => {
    const map = new Map<string, CellData>();
    mapData.cells.forEach((cell) => map.set(`${cell.row}-${cell.col}`, cell));
    return map;
  }, [mapData.cells]);
  const sortedBlocks = useMemo(
    () =>
      [...blocks].sort((a, b) => {
        const cmp = a.name.localeCompare(b.name, "ja");
        return sortDirection === "asc" ? cmp : -cmp;
      }),
    [blocks, sortDirection],
  );
  const selectedBlock = useMemo(() => {
    const matches = state.target
      ? blocks.filter((b) => b.name === state.target?.originalName)
      : [];
    return matches.length === 1 ? matches[0] : null;
  }, [blocks, state.target]);
  const detectNumberCells = useCallback(
    (startRow: number, startCol: number, endRow: number, endCol: number) =>
      detectBlockNumberCells(cellsMap, startRow, startCol, endRow, endCol),
    [cellsMap],
  );

  // 復帰は初期化と同じ純粋な遷移を使い、消費済みの要求だけ解除する。
  useEffect(() => {
    if (!pendingCellSelection || !isOpen) return;
    if (state.consumedSelectionKey === pendingCellSelection.selectionRequestKey)
      onClearPendingCellSelection?.(state.consumedSelectionKey);
  }, [
    pendingCellSelection,
    isOpen,
    state.consumedSelectionKey,
    onClearPendingCellSelection,
  ]);

  const handleStartSelection = useCallback(
    (type: BlockSelectionType) => {
      if (
        !state.block ||
        state.selectionRequestKey ||
        selectionInFlight.current
      )
        return;
      const key = `${state.sessionId}:${nextSequence.current++}`;
      const reservedResumeEditId = nextSequence.current++;
      const editingData = selectionSnapshot(
        state,
        key,
        reservedResumeEditId,
        nextSequence.current,
      );
      selectionInFlight.current = key;
      dispatch({ type: "start-selection", data: editingData });
      onStartCellSelection(type, editingData);
    },
    [state, onStartCellSelection],
  );
  const handleStartCornerSelection = () => handleStartSelection("corner");
  const handleStartMultiCornerSelection = () =>
    handleStartSelection("multiCorner");
  const handleStartRangeSelection = () => handleStartSelection("rangeStart");
  const handleStartIndividualSelection = () =>
    handleStartSelection("individual");
  const wallBlockNumberCells = useMemo(
    () =>
      editMode === "wall"
        ? detectGroupedNumberCells(cellsMap, wallCellGroups)
        : [],
    [editMode, wallCellGroups, cellsMap],
  );
  const multiRangeNumberCells = useMemo(
    () =>
      editMode === "multi"
        ? detectGroupedNumberCells(
            cellsMap,
            multiRanges.map((r) => ({ type: "range", ...r })),
          )
        : [],
    [editMode, multiRanges, cellsMap],
  );
  const startRow = editingBlock?.startRow,
    startCol = editingBlock?.startCol,
    endRow = editingBlock?.endRow,
    endCol = editingBlock?.endCol;
  const previewNumberCells = useMemo(() => {
    if (editMode === "wall") return wallBlockNumberCells;
    if (editMode === "multi") return multiRangeNumberCells;
    if (!startRow || !endRow) return [];
    return detectNumberCells(startRow, startCol || 1, endRow, endCol || 1);
  }, [
    startRow,
    startCol,
    endRow,
    endCol,
    editMode,
    wallBlockNumberCells,
    multiRangeNumberCells,
    detectNumberCells,
  ]);
  const handleSaveBlock = useCallback(() => {
    const signature = `${state.editId}:${state.draftRevision}:${state.blocksRevision}`;
    if (saving.current || submitted.current === signature) return;
    saving.current = true;
    try {
      const result = prepareBlockSave(
        state,
        cellsMap,
        mapData,
        BLOCK_COLORS[0],
      );
      if (!result.ok) {
        alert(result.message);
        return;
      }
      if (
        result.plan.kind === "replace" &&
        !confirm(
          `「${result.plan.candidate.name}」は既に存在します。置き換えますか？`,
        )
      )
        return;
      submitted.current = signature;
      dispatch({ type: "save", plan: result.plan });
    } finally {
      saving.current = false;
    }
  }, [state, cellsMap, mapData]);
  const handleCancelEdit = () => {
    selectionInFlight.current = null;
    dispatch({ type: "cancel" });
  };
  const handleSwitchMode = (mode: BlockEditMode) =>
    dispatch({ type: "mode", mode });
  const titleId = useId();
  const handleClose = () => {
    onClose();
  };
  const { dialogRef, onDialogKeyDown } = useModalDialogBehavior({
    isOpen,
    containExternalFocus: true,
    onEscape: handleClose,
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
        className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h2
            id={titleId}
            className="text-lg font-bold text-slate-900 dark:text-white"
          >
            ブロック定義
          </h2>
          <button
            onClick={handleClose}
            className="text-2xl text-slate-500 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setActiveTab("list")}
              className={`px-3 py-1.5 text-sm rounded ${
                activeTab === "list"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
              }`}
            >
              一覧
            </button>
            <button
              onClick={() => setActiveTab("edit")}
              className={`px-3 py-1.5 text-sm rounded ${
                activeTab === "edit"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
              }`}
            >
              編集
            </button>
          </div>

          {activeTab === "list" && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  定義済みブロック ({blocks.length}件)
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
                    }
                    className="px-2 py-1 text-xs rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
                  >
                    {sortDirection === "asc" ? "↑昇順" : "↓降順"}
                  </button>
                  <button
                    onClick={() => {
                      selectionInFlight.current = null;
                      dispatch({
                        type: "new",
                        color:
                          BLOCK_COLORS[blocks.length % BLOCK_COLORS.length],
                        ...reserveEdit(),
                      });
                    }}
                    className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                  >
                    + 新規
                  </button>
                  <button
                    onClick={() =>
                      confirm("全て削除？") && dispatch({ type: "delete-all" })
                    }
                    className="px-3 py-1.5 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                  >
                    全削除
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {sortedBlocks.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
                    ブロックが定義されていません。
                  </p>
                ) : (
                  sortedBlocks.map((b, i) => (
                    <div
                      key={`${b.name}-${i}`}
                      className={`p-3 rounded-lg border transition-colors ${
                        selectedBlock === b
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                          : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => {
                            selectionInFlight.current = null;
                            dispatch({
                              type: "begin",
                              block: b,
                              ...reserveEdit(),
                            });
                          }}
                          className="flex flex-1 items-center gap-2 text-left"
                        >
                          <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded text-xs font-bold">
                            <svg
                              className="absolute inset-0 h-full w-full"
                              viewBox="0 0 32 32"
                              aria-hidden="true"
                            >
                              <rect
                                width="32"
                                height="32"
                                fill={b.color || "#E3F2FD"}
                              />
                            </svg>
                            <span className="relative">{b.name}</span>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-slate-900 dark:text-white">
                              {b.name}
                              {b.isWallBlock && (
                                <span className="ml-2 text-xs text-orange-600 dark:text-orange-400">
                                  [壁]
                                </span>
                              )}
                              {!b.isWallBlock &&
                                b.cellGroups &&
                                b.cellGroups.length > 0 && (
                                  <span className="ml-2 text-xs text-purple-600 dark:text-purple-400">
                                    [複数範囲]
                                  </span>
                                )}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {b.numberCells.length}セル
                              {b.isAutoDetected && (
                                <span className="ml-2 text-blue-600 dark:text-blue-400">
                                  自動検出
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`「${b.name}」を削除？`)) {
                              dispatch({ type: "delete", block: b });
                            }
                          }}
                          className="p-1 text-red-500 hover:text-red-700"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === "edit" && (
            <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-900">
              {editingBlock ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {isAddingNew ? "新規ブロック追加" : "ブロック編集"}
                    </h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleSwitchMode("normal")}
                        className={`px-2 py-1 text-xs rounded ${editMode === "normal" ? "bg-blue-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"}`}
                      >
                        通常
                      </button>
                      <button
                        onClick={() => handleSwitchMode("multi")}
                        className={`px-2 py-1 text-xs rounded ${editMode === "multi" ? "bg-purple-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"}`}
                      >
                        複数範囲
                      </button>
                      <button
                        onClick={() => handleSwitchMode("wall")}
                        className={`px-2 py-1 text-xs rounded ${editMode === "wall" ? "bg-orange-700 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300"}`}
                      >
                        壁
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      ブロック名
                    </label>
                    <input
                      type="text"
                      value={editingBlock.name || ""}
                      onChange={(e) =>
                        dispatch({
                          type: "patch",
                          patch: { name: e.target.value },
                        })
                      }
                      placeholder="例: ア, め, N"
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    />
                  </div>

                  {editMode === "normal" && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        範囲指定
                      </label>
                      <button
                        onClick={handleStartCornerSelection}
                        className="w-full rounded bg-blue-100 px-3 py-2 text-sm text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400"
                      >
                        マップ上で4つの角をクリックして選択
                      </button>
                      {editingBlock.startRow !== undefined &&
                        editingBlock.startRow > 0 &&
                        editingBlock.endRow !== undefined &&
                        editingBlock.endRow > 0 && (
                          <div className="mt-2 rounded bg-green-50 p-2 dark:bg-green-900/20">
                            <div className="text-xs text-green-700 dark:text-green-400">
                              範囲: 行{editingBlock.startRow}-
                              {editingBlock.endRow}, 列{editingBlock.startCol}-
                              {editingBlock.endCol}
                            </div>
                          </div>
                        )}
                    </div>
                  )}

                  {editMode === "multi" && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        複数範囲指定（Nブロックなど）
                      </label>
                      {multiRanges.length > 0 && (
                        <div className="mb-2 space-y-1">
                          {multiRanges.map((r, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800"
                            >
                              <span className="text-xs text-slate-600 dark:text-slate-400">
                                範囲{i + 1}: 行{r.startRow}-{r.endRow}, 列
                                {r.startCol}-{r.endCol}
                              </span>
                              <button
                                onClick={() =>
                                  dispatch({ type: "remove-range", index: i })
                                }
                                className="text-sm text-red-500"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={handleStartMultiCornerSelection}
                        className="w-full rounded bg-purple-100 px-3 py-2 text-sm text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400"
                      >
                        マップ上で4つの角をクリックして範囲を追加
                      </button>
                    </div>
                  )}

                  {editMode === "wall" && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        セル群 (最大6)
                      </label>
                      {wallCellGroups.length > 0 && (
                        <div className="mb-2 space-y-1">
                          {wallCellGroups.map((g, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between rounded border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-800"
                            >
                              <span className="text-xs text-slate-600 dark:text-slate-400">
                                {g.type === "range"
                                  ? `範囲(${g.startRow},${g.startCol})-(${g.endRow},${g.endCol})`
                                  : `個別${g.cells?.length}セル`}
                              </span>
                              <button
                                onClick={() =>
                                  dispatch({ type: "remove-group", index: i })
                                }
                                className="text-sm text-red-500"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleStartRangeSelection}
                          disabled={wallCellGroups.length >= 6}
                          className="flex-1 rounded bg-blue-100 px-3 py-2 text-xs text-blue-700 hover:bg-blue-200 disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-400"
                        >
                          + 範囲追加
                        </button>
                        <button
                          onClick={handleStartIndividualSelection}
                          disabled={wallCellGroups.length >= 6}
                          className="flex-1 rounded bg-orange-100 px-3 py-2 text-xs text-orange-700 hover:bg-orange-200 disabled:opacity-50 dark:bg-orange-900/30 dark:text-orange-400"
                        >
                          + 個別追加
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      色
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {BLOCK_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() =>
                            dispatch({ type: "patch", patch: { color: c } })
                          }
                          className={`relative h-8 w-8 overflow-hidden rounded border-2 ${editingBlock.color === c ? "border-blue-500" : "border-transparent"}`}
                        >
                          <svg
                            className="absolute inset-0 h-full w-full"
                            viewBox="0 0 32 32"
                            aria-hidden="true"
                          >
                            <rect width="32" height="32" fill={c} />
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                    <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                      検出セル: {previewNumberCells.length}個
                    </div>
                    {previewNumberCells.length > 0 ? (
                      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                        {previewNumberCells.map((c, i) => (
                          <span
                            key={i}
                            className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          >
                            {c.value}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        範囲を指定してください
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSaveBlock}
                      className="flex-1 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                    >
                      {isAddingNew ? "追加" : "保存"}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="rounded bg-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center text-slate-500 dark:text-slate-400">
                  <p className="mb-2">
                    編集するブロックを一覧から選択してください。
                  </p>
                  <button
                    onClick={() => setActiveTab("list")}
                    className="rounded bg-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                  >
                    一覧へ戻る
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-700">
          <button
            onClick={handleClose}
            className="rounded bg-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          >
            キャンセル
          </button>
          <button
            onClick={() => {
              onUpdateBlocks(blocks, session);
              onClose();
            }}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            適用
          </button>
        </div>
      </div>
    </div>
  );
};

export default BlockDefinitionPanel;
