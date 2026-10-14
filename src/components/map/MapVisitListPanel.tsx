import React from "react";
import { ShoppingItem } from "../../types/item";
import { BlockDefinition } from "../../types/map";
import { createLocationResolver } from "../../features/consistency/domain/membership";
import { projectItemsToExecutionVisits } from "../../utils/visitProjection";
import {
  normalizeBaseSpaceNumber,
  normalizeSpaceBlock,
} from "../../features/space-navigation/domain/visitIdentity";

interface MapVisitListPanelProps {
  isOpen: boolean;
  onClose: () => void;
  items: ShoppingItem[];
  executeModeItemIds: string[];
  blocks: BlockDefinition[];
  onJumpToCell: (row: number, col: number) => void;
}

interface VisitCellInfo {
  key: string;
  row: number;
  col: number;
  displayLabel: string;
  priorityLabel: string | null;
  order: number;
  circles: string[];
}

const MapVisitListPanel: React.FC<MapVisitListPanelProps> = ({
  isOpen,
  onClose,
  items,
  executeModeItemIds,
  blocks,
  onJumpToCell,
}) => {
  // 訪問先のセル情報を計算
  const visitCells: VisitCellInfo[] = React.useMemo(() => {
    if (!isOpen) return [];
    const resolveLocation = createLocationResolver({
      blocks,
      cells: [],
      mergedCells: [],
      maxRow: 0,
      maxCol: 0,
    });
    const cells: VisitCellInfo[] = [];
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const visits = projectItemsToExecutionVisits(
      executeModeItemIds
        .map((itemId) => itemsById.get(itemId))
        .filter((item): item is ShoppingItem => item !== undefined),
    );

    visits.forEach((visit, visitIndex) => {
      const item = visit.items[0];

      const location = resolveLocation(item);
      if (location.status !== "resolved") return;
      const numberCell = location.location.cell;

      cells.push({
        key: visit.key,
        row: numberCell.row,
        col: numberCell.col,
        displayLabel: `${normalizeSpaceBlock(item.block)}-${normalizeBaseSpaceNumber(item.number).toUpperCase()}`,
        priorityLabel:
          item.priorityLevel === "highest"
            ? "最優先"
            : item.priorityLevel === "priority"
              ? "優先"
              : null,
        order: visitIndex + 1,
        circles: Array.from(
          new Set(
            visit.items
              .map((visitItem) => visitItem.circle)
              .filter((circle) => circle.length > 0),
          ),
        ),
      });
    });

    return cells;
  }, [isOpen, items, executeModeItemIds, blocks]);

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white dark:bg-slate-800 shadow-xl z-40 flex flex-col">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-900 dark:text-white">
          訪問先リスト
        </h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* リスト */}
      <div className="flex-1 overflow-y-auto">
        {visitCells.length === 0 ? (
          <div className="p-4 text-center text-slate-500 dark:text-slate-400">
            訪問先がありません
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            {visitCells.map((cell) => (
              <button
                key={cell.key}
                onClick={() => onJumpToCell(cell.row, cell.col)}
                className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-6 h-6 bg-red-700 text-white text-sm font-bold rounded-full">
                    {cell.order}
                  </span>
                  <div className="flex-1">
                    <div className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                      <span>{cell.displayLabel}</span>
                      {cell.priorityLabel && (
                        <span className="text-xs rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          {cell.priorityLabel}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
                      {cell.circles.join(", ")}
                    </div>
                  </div>
                  <svg
                    className="w-4 h-4 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* フッター */}
      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          合計 {visitCells.length} 箇所
        </p>
      </div>
    </div>
  );
};

export default MapVisitListPanel;
