import type {
  ContentManifest,
  WorkbookContentSection,
} from "../xlsx/domain/consistencyWorkbook";
import React, { useState } from "react";
import { ExportOptions } from "../types/export";

interface ExportOptionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  hasMapData: boolean;
  previewManifest?: (options: ExportOptions) => ContentManifest;
}

const ExportOptionsDialog: React.FC<ExportOptionsDialogProps> = ({
  isOpen,
  onClose,
  onExport,
  hasMapData,
  previewManifest,
}) => {
  const [options, setOptions] = useState<ExportOptions>({
    includeItems: true,
    includeLayoutInfo: true,
    includeMapData: hasMapData,
    includeRouteInfo: true,
    format: "full",
  });

  const handleFormatChange = (format: "full" | "simple") => {
    if (format === "simple") {
      setOptions({
        includeItems: true,
        includeLayoutInfo: false,
        includeMapData: false,
        includeRouteInfo: false,
        format: "simple",
      });
    } else {
      setOptions({
        includeItems: true,
        includeLayoutInfo: true,
        includeMapData: hasMapData,
        includeRouteInfo: true,
        format: "full",
      });
    }
  };

  const handleExport = () => {
    onExport(options);
    onClose();
  };

  let manifest: ContentManifest | undefined;
  let previewError: string | undefined;
  try {
    manifest = previewManifest?.(options);
  } catch (error) {
    previewError =
      error instanceof Error ? error.message : "出力範囲を確認できません。";
  }
  const sectionLabels: Record<WorkbookContentSection, string> = {
    items: "品目",
    metadata: "イベント情報",
    layout: "配置・モード",
    maps: "図面",
    mapSettings: "回転・表示位置",
    blockDetectionSettings: "ブロック検出設定",
    selectedMaps: "利用マップ選択",
    simpleHalls: "簡易ホール",
    mapHalls: "詳細ホール",
    maplessAssignments: "マップなしの所属",
    mapAssignments: "マップ別の所属",
    maplessOrder: "マップなしのホール順",
    mapOrder: "マップ別のホール順",
    maplessVisits: "マップなしの訪問品目",
    mapVisits: "マップ別の訪問品目",
    routes: "保存経路",
    legacyPending: "保留中の旧設定",
  };
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-auto">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            エクスポート設定
          </h2>
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

        {/* コンテンツ */}
        <div className="px-6 py-4 space-y-6">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            エクスポート内容を選択してください：
          </p>

          {/* チェックボックス */}
          <div className="space-y-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options.includeItems}
                disabled
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                アイテムデータ（必須）
              </span>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options.includeLayoutInfo}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    includeLayoutInfo: e.target.checked,
                  })
                }
                disabled={options.format === "simple"}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span
                className={`text-sm ${options.format === "simple" ? "text-slate-400" : "text-slate-700 dark:text-slate-300"}`}
              >
                配置情報（実行列・候補リストの順序）
              </span>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options.includeMapData}
                onChange={(e) =>
                  setOptions({ ...options, includeMapData: e.target.checked })
                }
                disabled={options.format === "simple"}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span
                className={`text-sm ${options.format === "simple" ? "text-slate-400" : "text-slate-700 dark:text-slate-300"}`}
              >
                マップ・表示位置・ブロック検出設定
              </span>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={options.includeRouteInfo}
                onChange={(e) =>
                  setOptions({ ...options, includeRouteInfo: e.target.checked })
                }
                disabled={options.format === "simple"}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <span
                className={`text-sm ${options.format === "simple" ? "text-slate-400" : "text-slate-700 dark:text-slate-300"}`}
              >
                ホール定義・所属・巡回設定
              </span>
            </label>
          </div>

          {previewError && (
            <p role="alert" className="text-red-600">
              {previewError}
            </p>
          )}
          {manifest && (
            <section className="text-sm" aria-live="polite">
              <h3 className="font-semibold">出力する情報</h3>
              <ul>
                {Object.entries(manifest.sections)
                  .filter(([, value]) => value.included)
                  .map(([key, value]) => (
                    <li key={key}>
                      {sectionLabels[key as WorkbookContentSection]}:{" "}
                      {value.count}件
                    </li>
                  ))}
              </ul>
              <h3 className="font-semibold mt-2">省略する情報</h3>
              {manifest.omissions.length ? (
                <ul>
                  {manifest.omissions.map((entry) => (
                    <li key={entry.section}>
                      {sectionLabels[entry.section]}: {entry.count}件 —{" "}
                      {entry.reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>省略される保存情報はありません。</p>
              )}
            </section>
          )}
          {/* 区切り線 */}
          <hr className="border-slate-200 dark:border-slate-700" />

          {/* ファイル形式 */}
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              📁 ファイル形式
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-3">
                <input
                  type="radio"
                  name="format"
                  checked={options.format === "full"}
                  onChange={() => handleFormatChange("full")}
                  className="w-4 h-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    完全版（.xlsx）
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    全データ含む
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="radio"
                  name="format"
                  checked={options.format === "simple"}
                  onChange={() => handleFormatChange("simple")}
                  className="w-4 h-4 border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    簡易版（.xlsx）
                  </span>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    アイテムのみ（v1互換）
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 rounded-b-lg">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={handleExport}
            disabled={!!previewError}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            エクスポート
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportOptionsDialog;
