import { getExactImportItemKey } from "../features/events/duplicateEvent";
import type { BulkImportResult } from "../types/import";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { ShoppingItem } from "../types/item";
import { getItemKey } from "../utils/itemComparison";
import type {
  BulkAddLayoutInfo,
  BulkAddMetadata,
} from "../features/events/bulkAdd";
import {
  SPREADSHEET_PASTE_COLUMN_GUIDE,
  SPREADSHEET_PASTE_COLUMN_LABELS,
  parseSpreadsheetPaste,
} from "../features/events/pasteColumns";
import { decideSheetQuantity } from "../features/events/quantitySync";
import {
  fetchGoogleSheetCsv,
  readEventCsv,
  type EventCsvOptions,
} from "../features/events/sheetImport";
import { normalizeSheetItemsUrls } from "../features/events/updateDiff";

interface ImportScreenProps {
  onBulkAdd: (
    eventName: string,
    items: Omit<ShoppingItem, "id" | "purchaseStatus">[],
    metadata?: BulkAddMetadata,
  ) => Promise<BulkImportResult>;
  activeEventName: string | null;
  itemToEdit: ShoppingItem | null;
  onUpdateItem: (item: ShoppingItem) => void;
  onDoneEditing: () => void;
  newItemDefaults?: { eventDate: string; block: string; number: string } | null;
  onClearNewItemDefaults?: () => void;
}

const ImportScreen: React.FC<ImportScreenProps> = ({
  onBulkAdd,
  activeEventName,
  itemToEdit,
  onUpdateItem,
  onDoneEditing,
  newItemDefaults,
  onClearNewItemDefaults,
}) => {
  // State for bulk add (creating new list)
  const [eventName, setEventName] = useState("");
  const [circles, setCircles] = useState("");
  const [eventDates, setEventDates] = useState("");
  const [blocks, setBlocks] = useState("");
  const [numbers, setNumbers] = useState("");
  const [titles, setTitles] = useState("");
  const [prices, setPrices] = useState("");
  const [remarks, setRemarks] = useState("");
  const [urls, setUrls] = useState("");
  const [spreadsheetUrl, setSpreadsheetUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInFlight = useRef(false);
  const [importPhase, setImportPhase] = useState<string | null>(null);
  const [importRequiresReload, setImportRequiresReload] = useState(false);
  const [fileFormat, setFileFormat] = useState("auto");
  const [fileText, setFileText] = useState<string | null>(null);
  const inputGeneration = useRef(0);
  useEffect(() => {
    const generation = inputGeneration;
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [activeEventName, itemToEdit?.id]);
  const runImport = async (work: () => Promise<boolean>): Promise<boolean> => {
    if (importInFlight.current || importRequiresReload) return false;
    importInFlight.current = true;
    setImportPhase(
      "取込処理中です。保存が保留された場合は未保存データの再試行・取消を確認してください。",
    );
    try {
      return await work();
    } catch (error) {
      alert(error instanceof Error ? error.message : "取込みに失敗しました。");
      return false;
    } finally {
      importInFlight.current = false;
      setImportPhase(null);
    }
  };
  const submitImport = async (
    name: string,
    items: Omit<ShoppingItem, "id" | "purchaseStatus">[],
    metadata?: BulkAddMetadata,
  ) => {
    const generation = inputGeneration.current;
    const result = await onBulkAdd(name, items, {
      ...metadata,
      request: {
        id: crypto.randomUUID(),
        isCurrent: () => generation === inputGeneration.current,
        progress: (phase) => {
          if (generation !== inputGeneration.current) return;
          setImportPhase(
            phase === "review"
              ? "取込内容の確認待ちです。"
              : "保存処理中です。",
          );
        },
      },
    });
    const saved = result.status === "saved";
    if (result.status === "committed-ui-failed" || result.status === "unknown")
      setImportRequiresReload(true);
    if (result.status === "committed-ui-failed")
      alert(
        "データは保存済みですが画面に反映できませんでした。再取込みせず再読み込みしてください。",
      );
    return saved && generation === inputGeneration.current;
  };

  // State for single item add/edit
  const [singleCircle, setSingleCircle] = useState("");
  const [singleEventDate, setSingleEventDate] = useState("1日目");
  const [singleBlock, setSingleBlock] = useState("");
  const [singleNumber, setSingleNumber] = useState("");
  const [singleTitle, setSingleTitle] = useState("");
  const [singlePrice, setSinglePrice] = useState("0");
  const [singleQuantity, setSingleQuantity] = useState("1");
  const [singleRemarks, setSingleRemarks] = useState("");
  const [singleUrl, setSingleUrl] = useState("");
  const [isCustomEventDate, setIsCustomEventDate] = useState(false);

  const isEditing = itemToEdit !== null;
  const isCreatingNew = activeEventName === null;

  useEffect(() => {
    if (isEditing) {
      setSingleCircle(itemToEdit.circle);
      setSingleEventDate(itemToEdit.eventDate);
      setSingleBlock(itemToEdit.block);
      setSingleNumber(itemToEdit.number);
      setSingleTitle(itemToEdit.title);
      setSinglePrice(itemToEdit.price === null ? "" : String(itemToEdit.price));
      setSingleQuantity(String(itemToEdit.quantity ?? 1));
      setSingleRemarks(itemToEdit.remarks);
      setSingleUrl(itemToEdit.url || "");
      // 編集時は、1日目～4日目に含まれない場合はカスタムモードにする
      const defaultDates = ["1日目", "2日目", "3日目", "4日目"];
      setIsCustomEventDate(!defaultDates.includes(itemToEdit.eventDate));
    }
  }, [itemToEdit, isEditing]);

  // マップからの新規アイテム追加時に初期値を設定
  useEffect(() => {
    if (newItemDefaults && !isEditing) {
      setSingleEventDate(newItemDefaults.eventDate);
      setSingleBlock(newItemDefaults.block);
      setSingleNumber(newItemDefaults.number);
      // 1日目～4日目に含まれない場合はカスタムモードにする
      const defaultDates = ["1日目", "2日目", "3日目", "4日目"];
      setIsCustomEventDate(!defaultDates.includes(newItemDefaults.eventDate));
      // 初期値を消費したらクリア
      if (onClearNewItemDefaults) {
        onClearNewItemDefaults();
      }
    }
  }, [newItemDefaults, isEditing, onClearNewItemDefaults]);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const result = parseSpreadsheetPaste(e.clipboardData.getData("text"));
    if (!result.ok) {
      window.alert(result.message);
      return;
    }

    inputGeneration.current++;
    setCircles(result.columns.circles);
    setEventDates(result.columns.eventDates);
    setBlocks(result.columns.blocks);
    setNumbers(result.columns.numbers);
    setTitles(result.columns.titles);
    setPrices(result.columns.prices);
    setRemarks(result.columns.remarks);
  };

  const processImportData = (text: string, options?: EventCsvOptions) => {
    const parsed = readEventCsv(text, options);
    const items: Omit<ShoppingItem, "id" | "purchaseStatus">[] = [];
    const sourceRows: NonNullable<BulkAddMetadata["sourceRows"]>[number][] = [];
    const layoutInfo: BulkAddLayoutInfo[] = [];
    const invalidQuantityRows: Array<{ lineNumber: number; value: string }> =
      [];
    const normalized = normalizeSheetItemsUrls(
      parsed.rows.map((row) => row.item),
    );
    parsed.rows.forEach((row, index) => {
      const { rawQuantity, ...data } = normalized[index];
      const decision = decideSheetQuantity(rawQuantity ?? data.quantity, "new");
      if (decision.kind === "invalid") {
        invalidQuantityRows.push({
          lineNumber: row.lineNumber,
          value: rawQuantity ?? "",
        });
        return;
      }
      const item = {
        ...data,
        quantity: decision.kind === "apply" ? decision.quantity : 1,
      };
      items.push(item);
      sourceRows.push({ sourceRowId: row.sourceRowId, item });
      if (row.layout)
        layoutInfo.push({
          ...row.layout,
          sourceRowId: row.sourceRowId,
          itemKey: getItemKey(item),
          eventDate: item.eventDate,
        });
    });
    const placements = new Map<string, string>();
    const layoutsByRow = new Map(
      layoutInfo.map((entry) => [entry.sourceRowId, entry]),
    );
    sourceRows.forEach((row) => {
      const key = getExactImportItemKey(row.item);
      const layout = layoutsByRow.get(row.sourceRowId);
      const placement = JSON.stringify(
        layout ? [layout.columnType, layout.order] : null,
      );
      const previous = placements.get(key);
      if (previous !== undefined && previous !== placement)
        parsed.warnings.push(
          "完全重複の品目に異なる配置があります。重複行は除外し、先に現れた行の配置を使用します。",
        );
      placements.set(key, previous ?? placement);
    });
    return { ...parsed, items, sourceRows, layoutInfo, invalidQuantityRows };
  };

  const buildInvalidQuantityImportMessage = (
    invalidRows: Array<{ lineNumber: number; value: string }>,
  ): string =>
    invalidRows.length === 0
      ? ""
      : `数量が1～20の整数ではない${invalidRows.length}行は取り込みませんでした（${invalidRows
          .slice(0, 5)
          .map(({ lineNumber, value }) => `${lineNumber}行目「${value}」`)
          .join("、")}${invalidRows.length > 5 ? "、ほか" : ""}）。`;

  const importFileText = (text: string) =>
    runImport(async () => {
      const options: EventCsvOptions | undefined =
        fileFormat === "auto"
          ? undefined
          : {
              format: fileFormat.startsWith("google") ? "google" : "legacy",
              header: fileFormat.endsWith("-header"),
            };
      const result = processImportData(text, options);
      if (
        result.warnings.length &&
        !window.confirm(
          result.warnings.join("\n") + "\nこの内容で取込みますか？",
        )
      )
        return false;
      if (!result.items.length) {
        alert(
          "インポートできる品目がありません。" +
            buildInvalidQuantityImportMessage(result.invalidQuantityRows),
        );
        return false;
      }
      const accepted = await submitImport(
        eventName || "インポートリスト",
        result.items,
        {
          url: result.spreadsheetUrl,
          sourceRows: result.sourceRows,
          layoutInfo: result.layoutInfo,
        },
      );
      if (!accepted) return false;
      setFileText(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (result.invalidQuantityRows.length)
        alert(buildInvalidQuantityImportMessage(result.invalidQuantityRows));
      return true;
    });
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || importInFlight.current) return;
    const generation = inputGeneration.current;
    const text = await file.text();
    if (generation !== inputGeneration.current) return;
    setFileText(text);
    await importFileText(text);
  };

  const handleUrlImport = async () => {
    if (!spreadsheetUrl.trim()) {
      alert("スプレッドシートのURLを入力してください。");
      return;
    }
    if (!eventName.trim()) {
      alert("即売会名を入力してください。");
      return;
    }
    await runImport(async () => {
      const generation = inputGeneration.current;
      const sheetName = "品目表";
      const text = await fetchGoogleSheetCsv(spreadsheetUrl, sheetName);
      if (generation !== inputGeneration.current) return false;
      const result = processImportData(text, {
        format: "google",
        header: true,
      });
      if (
        result.warnings.length &&
        !window.confirm(
          result.warnings.join("\n") + "\nこの内容で取込みますか？",
        )
      )
        return false;
      if (!result.items.length) {
        alert(
          "インポートできる品目がありません。" +
            buildInvalidQuantityImportMessage(result.invalidQuantityRows),
        );
        return false;
      }
      const accepted = await submitImport(eventName.trim(), result.items, {
        url: spreadsheetUrl,
        sheetName,
        sourceRows: result.sourceRows,
      });
      if (!accepted) return false;
      setSpreadsheetUrl("");
      if (result.invalidQuantityRows.length)
        alert(buildInvalidQuantityImportMessage(result.invalidQuantityRows));
      return true;
    });
  };

  const resetSingleForm = () => {
    setSingleCircle("");
    setSingleEventDate("1日目");
    setSingleBlock("");
    setSingleNumber("");
    setSingleTitle("");
    setSinglePrice("");
    setSingleQuantity("1");
    setSingleRemarks("");
    setSingleUrl("");
    setIsCustomEventDate(false);
  };

  const handleEventDateSelectChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const value = e.target.value;
    if (value === "__custom__") {
      setIsCustomEventDate(true);
      setSingleEventDate("");
    } else {
      setIsCustomEventDate(false);
      setSingleEventDate(value);
    }
  };

  const handleEventDateInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value;
    setSingleEventDate(value);
  };

  const handleEventDateInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    // 1日目～4日目のいずれかが入力されたら、セレクトボックスに戻す
    const defaultDates = ["1日目", "2日目", "3日目", "4日目"];
    if (defaultDates.includes(value)) {
      setIsCustomEventDate(false);
      setSingleEventDate(value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isEditing) {
      if (!singleCircle.trim() && !singleTitle.trim()) {
        alert("サークル名かタイトルを入力してください。");
        return;
      }
      // 空欄の場合はnull、0と入力されている場合は0を設定
      const priceStr = String(singlePrice).trim();
      const price =
        priceStr === ""
          ? null
          : parseInt(priceStr.replace(/[^0-9]/g, ""), 10) || 0;
      const quantity = Math.max(
        1,
        Math.min(20, parseInt(singleQuantity.replace(/[^0-9]/g, ""), 10) || 1),
      );
      const parsedQuantity =
        parseInt(singleQuantity.replace(/[^0-9]/g, ""), 10) || 1;
      const updatedItem: ShoppingItem = {
        ...itemToEdit,
        circle: singleCircle.trim(),
        eventDate: singleEventDate,
        block: singleBlock.trim(),
        number: singleNumber.trim(),
        title: singleTitle.trim(),
        price: price,
        quantity:
          parsedQuantity === itemToEdit.quantity && parsedQuantity > 20
            ? parsedQuantity
            : quantity,
        remarks: singleRemarks.trim(),
        url: singleUrl.trim() || undefined,
      };
      onUpdateItem(updatedItem);
      onDoneEditing();
      return;
    }

    if (isCreatingNew) {
      if (!eventName.trim()) {
        alert("即売会名を入力してください。");
        return;
      }
      const finalEventName = eventName.trim();
      const circlesArr = circles.split("\n").map((s) => s.trim());
      const eventDatesArr = eventDates.split("\n").map((s) => s.trim());
      const blocksArr = blocks.split("\n").map((s) => s.trim());
      const numbersArr = numbers.split("\n").map((s) => s.trim());
      const titlesArr = titles.split("\n").map((s) => s.trim());
      const pricesArr = prices.split("\n").map((s) => s.trim());
      const remarksArr = remarks.split("\n").map((s) => s.trim());
      const urlsArr = urls.split("\n").map((s) => s.trim());
      const numItems = Math.max(
        circlesArr.length,
        eventDatesArr.length,
        blocksArr.length,
        numbersArr.length,
        titlesArr.length,
        pricesArr.length,
        remarksArr.length,
        urlsArr.length,
      );
      if (numItems === 0 || (circlesArr.length === 1 && circlesArr[0] === "")) {
        alert("インポートするデータがありません。");
        return;
      }
      const newItems: Omit<ShoppingItem, "id" | "purchaseStatus">[] = [];
      for (let i = 0; i < numItems; i++) {
        const circle = circlesArr[i] || "";
        const eventDate = eventDatesArr[i] || "";
        const block = blocksArr[i] || "";
        const number = numbersArr[i] || "";
        // A列からD列（サークル、参加日、ブロック、ナンバー）の値が全て入力されている行のみをインポート
        if (!circle || !eventDate || !block || !number) {
          continue;
        }
        // 空欄の場合はnull、0と入力されている場合は0を設定
        const priceString = pricesArr[i] || "";
        const price =
          priceString === ""
            ? null
            : parseInt(priceString.replace(/[^0-9]/g, ""), 10) || 0;
        const url = urlsArr[i] || "";
        newItems.push({
          circle,
          eventDate,
          block,
          number,
          title: titlesArr[i] || "",
          price: price,
          quantity: 1,
          remarks: remarksArr[i] || "",
          ...(url ? { url } : {}),
        });
      }

      // 各参加日タブ中でサークル名が重複するアイテムのURL転記処理
      const eventDateGroups = new Map<
        string,
        Omit<ShoppingItem, "id" | "purchaseStatus">[]
      >();
      newItems.forEach((item) => {
        if (!eventDateGroups.has(item.eventDate)) {
          eventDateGroups.set(item.eventDate, []);
        }
        eventDateGroups.get(item.eventDate)!.push(item);
      });

      eventDateGroups.forEach((items) => {
        // サークル名でグループ化
        const circleGroups = new Map<
          string,
          Omit<ShoppingItem, "id" | "purchaseStatus">[]
        >();
        items.forEach((item) => {
          if (!circleGroups.has(item.circle)) {
            circleGroups.set(item.circle, []);
          }
          circleGroups.get(item.circle)!.push(item);
        });

        // サークル名が重複するアイテムが2つ以上ある場合
        circleGroups.forEach((circleItems) => {
          if (circleItems.length >= 2) {
            // URLが入力されているアイテムを探す
            const itemWithUrl = circleItems.find(
              (item) => item.url && item.url.trim() !== "",
            );

            if (itemWithUrl && itemWithUrl.url) {
              // URLが入力されていないアイテムにURLを転記
              circleItems.forEach((item) => {
                if (!item.url || item.url.trim() === "") {
                  item.url = itemWithUrl.url;
                }
              });
            }
          }
        });
      });

      if (newItems.length > 0) {
        const accepted = await runImport(() =>
          submitImport(finalEventName, newItems),
        );
        if (!accepted) return;

        setEventName("");
        setCircles("");
        setEventDates("");
        setBlocks("");
        setNumbers("");
        setTitles("");
        setPrices("");
        setRemarks("");
        setUrls("");
      } else {
        alert(
          "有効なアイテムデータが見つかりませんでした。A列からD列の値が全て入力されている行が必要です。",
        );
      }
    } else {
      // Adding single item to existing list
      if (!singleCircle.trim() && !singleTitle.trim()) {
        alert("サークル名かタイトルを入力してください。");
        return;
      }
      // 空欄の場合はnull、0と入力されている場合は0を設定
      const priceStr = String(singlePrice).trim();
      const price =
        priceStr === ""
          ? null
          : parseInt(priceStr.replace(/[^0-9]/g, ""), 10) || 0;
      const quantity = Math.max(
        1,
        Math.min(20, parseInt(singleQuantity.replace(/[^0-9]/g, ""), 10) || 1),
      );
      const newItem: Omit<ShoppingItem, "id" | "purchaseStatus"> = {
        circle: singleCircle.trim(),
        eventDate: singleEventDate,
        block: singleBlock.trim(),
        number: singleNumber.trim(),
        title: singleTitle.trim(),
        price: price,
        quantity: quantity,
        remarks: singleRemarks.trim(),
        url: singleUrl.trim() || undefined,
      };
      const accepted = await runImport(() =>
        submitImport(activeEventName, [newItem], { source: "app" }),
      );
      if (accepted) resetSingleForm();
    }
  };

  const priceOptions = useMemo(() => {
    const options: number[] = [0];
    for (let i = 100; i <= 15000; i += 100) {
      options.push(i);
    }
    return options;
  }, []);

  const formTextareaClass =
    "w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow duration-200 h-32 resize-y font-mono text-sm";
  const formInputClass =
    "block w-full p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition";
  const labelClass =
    "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1";

  const handlePriceInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only numbers
    if (/^\d*$/.test(value)) {
      setSinglePrice(value);
    }
  };

  const handlePriceSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSinglePrice(e.target.value);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6 sm:p-8 animate-fade-in">
      <h2 className="text-xl sm:text-2xl font-bold mb-2 text-slate-900 dark:text-white text-center">
        {isEditing
          ? "アイテムを編集"
          : isCreatingNew
            ? "新規リスト作成"
            : `「${activeEventName}」にアイテムを追加`}
      </h2>
      <p className="text-center text-slate-600 dark:text-slate-400 mb-6">
        {isCreatingNew
          ? `スプレッドシートの${SPREADSHEET_PASTE_COLUMN_GUIDE}をこの順番でコピーし、下の「${SPREADSHEET_PASTE_COLUMN_LABELS.circles}」欄に貼り付けてください。データが自動で振り分けられます。`
          : isEditing
            ? "アイテムの情報を編集してください。"
            : "追加するアイテムのデータを入力してください。"}
      </p>

      {importRequiresReload && (
        <p role="alert">
          保存結果の確認が必要です。再取込みせず、画面を再読み込みして保存内容を確認してください。
        </p>
      )}
      {importPhase && <p role="status">{importPhase}</p>}
      <form
        onSubmit={handleSubmit}
        onChangeCapture={() => {
          inputGeneration.current++;
        }}
        className="space-y-6"
      >
        {isCreatingNew ? (
          <>
            <div>
              <label htmlFor="eventName" className={labelClass}>
                即売会名
              </label>
              <input
                type="text"
                id="eventName"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className={`mt-1 ${formInputClass.replace("p-2", "p-2 mt-1")}`}
                placeholder="例: C105"
                required
              />
            </div>

            {/* インポート方法の選択 */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
                インポート方法
              </h3>

              {/* URLインポート */}
              <div className="mb-4">
                <label htmlFor="spreadsheetUrl" className={labelClass}>
                  スプレッドシートURLからインポート
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    id="spreadsheetUrl"
                    value={spreadsheetUrl}
                    onChange={(e) => setSpreadsheetUrl(e.target.value)}
                    className={formInputClass}
                    placeholder="https://docs.google.com/spreadsheets/d/..../edit"
                  />
                  <button
                    type="button"
                    onClick={handleUrlImport}
                    className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-md transition-colors whitespace-nowrap"
                  >
                    URLからインポート
                  </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  シート名「品目表」のM列からR列とW列をインポートします
                </p>
              </div>

              <label className="block text-sm">
                CSVの列形式
                <select
                  aria-label="CSVの列形式"
                  value={fileFormat}
                  onChange={(e) => setFileFormat(e.target.value)}
                >
                  <option value="auto">見出しから自動判定</option>
                  <option value="legacy-header">A列開始・見出しあり</option>
                  <option value="legacy-data">A列開始・見出しなし</option>
                  <option value="google-header">M列開始・見出しあり</option>
                  <option value="google-data">M列開始・見出しなし</option>
                </select>
              </label>
              {fileText !== null && (
                <button
                  type="button"
                  disabled={importPhase !== null}
                  onClick={() => void importFileText(fileText)}
                >
                  選択したCSVを再試行
                </button>
              )}
              {/* CSVファイルインポート */}
              <div className="mb-4">
                <label htmlFor="csvFile" className={labelClass}>
                  CSVファイルからインポート
                </label>
                <input
                  type="file"
                  id="csvFile"
                  ref={fileInputRef}
                  accept=".csv"
                  disabled={importPhase !== null}
                  onChange={handleFileImport}
                  className={formInputClass}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  見出しから形式を判定します。見出しがない場合は列形式を指定してください。
                </p>
              </div>

              <div className="text-center text-slate-500 dark:text-slate-400 my-4">
                または
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <div className="md:col-span-1">
                <label htmlFor="circles" className={labelClass}>
                  {SPREADSHEET_PASTE_COLUMN_LABELS.circles}{" "}
                </label>
                <textarea
                  id="circles"
                  value={circles}
                  onChange={(e) => setCircles(e.target.value)}
                  onPaste={handlePaste}
                  className={formTextareaClass}
                  placeholder="サークルA&#10;サークルB"
                />
              </div>
              <div className="md:col-span-1">
                <label htmlFor="event-dates" className={labelClass}>
                  {SPREADSHEET_PASTE_COLUMN_LABELS.eventDates}{" "}
                </label>
                <textarea
                  id="event-dates"
                  value={eventDates}
                  onChange={(e) => setEventDates(e.target.value)}
                  className={formTextareaClass}
                  placeholder="1日目&#10;2日目"
                />
              </div>
              <div className="md:col-span-1">
                <label htmlFor="blocks" className={labelClass}>
                  {SPREADSHEET_PASTE_COLUMN_LABELS.blocks}{" "}
                </label>
                <textarea
                  id="blocks"
                  value={blocks}
                  onChange={(e) => setBlocks(e.target.value)}
                  className={formTextareaClass}
                  placeholder="G&#10;カ"
                />
              </div>
              <div className="md:col-span-1">
                <label htmlFor="numbers" className={labelClass}>
                  {SPREADSHEET_PASTE_COLUMN_LABELS.numbers}{" "}
                </label>
                <textarea
                  id="numbers"
                  value={numbers}
                  onChange={(e) => setNumbers(e.target.value)}
                  className={formTextareaClass}
                  placeholder="01a&#10;03b"
                />
              </div>
              <div className="md:col-span-1">
                <label htmlFor="titles" className={labelClass}>
                  {SPREADSHEET_PASTE_COLUMN_LABELS.titles}{" "}
                </label>
                <textarea
                  id="titles"
                  value={titles}
                  onChange={(e) => setTitles(e.target.value)}
                  className={formTextareaClass}
                  placeholder="新刊セット&#10;既刊1"
                />
              </div>
              <div className="md:col-span-1">
                <label htmlFor="prices" className={labelClass}>
                  {SPREADSHEET_PASTE_COLUMN_LABELS.prices}{" "}
                </label>
                <textarea
                  id="prices"
                  value={prices}
                  onChange={(e) => setPrices(e.target.value)}
                  className={formTextareaClass}
                  placeholder="1000&#10;500"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="remarks" className={labelClass}>
                  {SPREADSHEET_PASTE_COLUMN_LABELS.remarks}{" "}
                </label>
                <textarea
                  id="remarks"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className={`${formTextareaClass} h-16`}
                  placeholder="スケブお願い&#10;挨拶に行く"
                />
              </div>
              <div>
                <label htmlFor="urls" className={labelClass}>
                  URL（7列貼り付け対象外）{" "}
                </label>
                <textarea
                  id="urls"
                  value={urls}
                  onChange={(e) => setUrls(e.target.value)}
                  className={`${formTextareaClass} h-16`}
                  placeholder="https://example.com&#10;https://example2.com"
                />
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="singleCircle" className={labelClass}>
                  サークル名
                </label>
                <input
                  type="text"
                  id="singleCircle"
                  value={singleCircle}
                  onChange={(e) => setSingleCircle(e.target.value)}
                  className={formInputClass}
                  placeholder="サークル名"
                />
              </div>
              <div>
                <label htmlFor="singleTitle" className={labelClass}>
                  タイトル
                </label>
                <input
                  type="text"
                  id="singleTitle"
                  value={singleTitle}
                  onChange={(e) => setSingleTitle(e.target.value)}
                  className={formInputClass}
                  placeholder="新刊セット"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="singleEventDate" className={labelClass}>
                  参加日
                </label>
                {isCustomEventDate ? (
                  <input
                    type="text"
                    id="singleEventDate"
                    value={singleEventDate}
                    onChange={handleEventDateInputChange}
                    onBlur={handleEventDateInputBlur}
                    className={formInputClass}
                    placeholder="1日目"
                  />
                ) : (
                  <select
                    id="singleEventDate"
                    value={singleEventDate}
                    onChange={handleEventDateSelectChange}
                    className={formInputClass}
                  >
                    <option value="1日目">1日目</option>
                    <option value="2日目">2日目</option>
                    <option value="3日目">3日目</option>
                    <option value="4日目">4日目</option>
                    <option value="__custom__">任意の値を入力</option>
                  </select>
                )}
              </div>
              <div>
                <label htmlFor="singleBlock" className={labelClass}>
                  ブロック
                </label>
                <input
                  type="text"
                  id="singleBlock"
                  value={singleBlock}
                  onChange={(e) => setSingleBlock(e.target.value)}
                  className={formInputClass}
                  placeholder="東1"
                />
              </div>
              <div>
                <label htmlFor="singleNumber" className={labelClass}>
                  ナンバー
                </label>
                <input
                  type="text"
                  id="singleNumber"
                  value={singleNumber}
                  onChange={(e) => setSingleNumber(e.target.value)}
                  className={formInputClass}
                  inputMode="text"
                  pattern="[a-zA-Z0-9-]*"
                  placeholder="A-01a"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div className="relative">
                <label htmlFor="singlePrice" className={labelClass}>
                  頒布価格
                </label>
                <input
                  type="text"
                  id="singlePrice"
                  value={singlePrice}
                  onChange={handlePriceInputChange}
                  className={`${formInputClass} pr-12`}
                  placeholder="0"
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
                <span className="absolute right-3 top-9 text-slate-500 dark:text-slate-400">
                  円
                </span>
              </div>
              <div>
                <label htmlFor="price-quick-select" className={labelClass}>
                  クイック選択
                </label>
                <select
                  id="price-quick-select"
                  onChange={handlePriceSelectChange}
                  className={formInputClass}
                  value={
                    priceOptions.includes(Number(singlePrice))
                      ? singlePrice
                      : ""
                  }
                >
                  <option value="" disabled>
                    金額を選択...
                  </option>
                  {priceOptions.map((p) => (
                    <option key={p} value={p}>
                      {p.toLocaleString()}円
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="singleQuantity" className={labelClass}>
                  数量
                </label>
                <select
                  id="singleQuantity"
                  value={singleQuantity}
                  onChange={(e) => setSingleQuantity(e.target.value)}
                  className={formInputClass}
                >
                  {Number(singleQuantity) > 20 && (
                    <option value={singleQuantity}>
                      {singleQuantity}（現在の値）
                    </option>
                  )}
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((num) => (
                    <option key={num} value={num}>
                      {num}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="singleRemarks" className={labelClass}>
                  備考
                </label>
                <input
                  type="text"
                  id="singleRemarks"
                  value={singleRemarks}
                  onChange={(e) => setSingleRemarks(e.target.value)}
                  className={formInputClass}
                  placeholder="スケブお願い"
                />
              </div>
              <div>
                <label htmlFor="singleUrl" className={labelClass}>
                  URL
                </label>
                <input
                  type="text"
                  id="singleUrl"
                  value={singleUrl}
                  onChange={(e) => setSingleUrl(e.target.value)}
                  className={formInputClass}
                  placeholder="https://example.com"
                />
              </div>
            </div>
          </div>
        )}

        <div className="pt-4 flex flex-col sm:flex-row-reverse sm:justify-start sm:space-x-4 sm:space-x-reverse space-y-4 sm:space-y-0">
          <button
            type="submit"
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-slate-400 dark:disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors duration-200"
          >
            {isEditing
              ? "アイテムを更新"
              : isCreatingNew
                ? "リストを作成"
                : "リストに追加"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ImportScreen;
