// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import ExcelJS from "exceljs";
import { xlsxWorkerExecutor } from "../../xlsx/worker/workerExecutor";
import { exportToXlsx } from "../../xlsx/engine/eventWorkbookEngine";
import {
  buildXlsxEventRestoreSource,
  toImportedEventData,
} from "../../features/events/fileImport";
import { createAppBackup, parseAppBackup } from "../../utils/appBackup";
import { extractEventDates } from "../../utils/eventDates";
import { DEFAULT_UI_VISIBILITY } from "../../hooks/useUIVisibilitySettings";
import AppHeaderShell from "../../features/app-shell/components/AppHeaderShell";
import type { ShoppingItem } from "../../types/item";
const item: ShoppingItem = {
  id: "A",
  circle: "サークル",
  eventDate: "1日目",
  block: "A",
  number: "01a",
  title: "ユーザー登録",
  price: 700,
  catalogPrice: 700,
  quantity: 5,
  purchaseStatus: "None",
  remarks: "エラーが発生しました",
  sheetRemarks: "シート備考",
  url: "https://example.com/item",
  source: "spreadsheet",
};
async function workbookCase(change: (row: ExcelJS.Row) => void) {
  const blob = await exportToXlsx(
    "検証イベント",
    [item],
    {
      includeItems: true,
      includeLayoutInfo: true,
      includeMapData: false,
      includeRouteInfo: false,
      format: "full",
    },
    { executeModeItems: { 検証イベント: { "1日目": ["A"] } } },
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  change(wb.getWorksheet("アイテムデータ")!.getRow(2));
  const data = await wb.xlsx.writeBuffer();
  const response = await xlsxWorkerExecutor.importWorkbook(
    {
      kind: "event-import",
      input: new Uint8Array(data).buffer,
      fileName: "audit.xlsx",
    },
    new AbortController().signal,
    () => {},
  );
  if (response.kind !== "event-import") throw new Error("Unexpected kind");
  const result = response.value;
  expect(result.success, result.errors.join("\n")).toBe(true);
  const restored = buildXlsxEventRestoreSource(toImportedEventData(result));
  expect(parseAppBackup(createAppBackup(restored.data)).ok).toBe(true);
  return result;
}
describe("Excelセル形式の横断整合性", () => {
  it("通常の数値・文字列セルは保持する", async () => {
    const r = await workbookCase(() => {});
    expect(r.items[0]).toMatchObject(item);
  });
  it("数量とカタログ価格の数式キャッシュは保持する", async () => {
    const r = await workbookCase((row) => {
      row.getCell(8).value = { formula: "2+3", result: 5 };
      row.getCell(17).value = { formula: "350*2", result: 700 };
    });
    expect(r.items[0]).toMatchObject({ quantity: 5, catalogPrice: 700 });
  });
  it("購入価格も同じ数式キャッシュを保持すべき", async () => {
    const r = await workbookCase((row) => {
      row.getCell(7).value = { formula: "350*2", result: 700 };
      row.getCell(17).value = { formula: "350*2", result: 700 };
    });
    expect(r.items[0].price).toBe(r.items[0].catalogPrice);
  });
  it("外部リンク付きセルは本番の事前検査で拒否されるため破損指摘から除外する", async () => {
    await expect(
      workbookCase((row) => {
        row.getCell(11).value = { text: item.url!, hyperlink: item.url! };
      }),
    ).rejects.toMatchObject({ code: "SECURITY_REJECTED" });
  });
  it("装飾付き文字列は文字列としてタイトル・備考を保持すべき", async () => {
    const r = await workbookCase((row) => {
      row.getCell(6).value = {
        richText: [{ font: { bold: true }, text: item.title }],
      };
      row.getCell(10).value = {
        richText: [{ font: { bold: true }, text: item.remarks }],
      };
      row.getCell(18).value = {
        richText: [{ font: { bold: true }, text: item.sheetRemarks! }],
      };
    });
    expect(r.items[0]).toMatchObject({
      title: item.title,
      remarks: item.remarks,
      sheetRemarks: item.sheetRemarks,
    });
  });
});
type MutableDomainFields<T> = {
  -readonly [Domain in keyof T]: {
    -readonly [Field in keyof T[Domain]]: T[Domain][Field];
  };
};

type MutableAppHeaderShellProps = {
  model: MutableDomainFields<ComponentProps<typeof AppHeaderShell>["model"]>;
  actions: MutableDomainFields<
    ComponentProps<typeof AppHeaderShell>["actions"]
  >;
};

const makeHeaderProps = (): MutableAppHeaderShellProps => ({
  model: {
    navigation: {
      activeEventDate: "Day1",
      activeEventName: "Event",
      activeTab: "Day1",
      currentMode: "execute",
      eventDates: ["Day1"],
      isMapTab: false,
    },
    map: {
      currentHalls: [],
      currentMapData: null,
      currentMapTabName: null,
      currentMapTabRotationState: {
        initialAngle: 0,
        mapTabAngle: 0,
        focusModeAngle: 0,
      },
      globalHallOrderHalls: [],
      globalHallOrderMapTabName: null,
      hasUndefinedPriorityItems: false,
      mapHallSelectorOpen: false,
      mapIsRouteVisible: false,
      mapSelectedHallId: "all",
      mapSmartInsertEnabled: false,
      mapSmartInsertMode: "map",
      mapTabMenuOpen: null,
      mapToggleButtonRef: { current: null },
      mapToggleLongPressFiredRef: { current: false },
      mapToggleLongPressRef: { current: null },
      mapToggleMenuRef: { current: null },
      mapViewActive: false,
      smartInsertLongPressRef: { current: null },
      smartInsertLongPressTriggeredRef: { current: false },
    },
    list: {
      blockSortDirection: null,
      candidateMovePlan: {
        requested: [],
        effective: [],
        implicit: [],
        excluded: { missing: [], wrongDate: [], notInSourceColumn: [] },
      },
      currentSearchIndex: -1,
      executeMovePlan: {
        requested: [],
        effective: [],
        implicit: [],
        excluded: { missing: [], wrongDate: [], notInSourceColumn: [] },
      },
      executeSpaceGroupingEnabled: false,
      hasCandidateSelection: false,
      hasExecuteSelection: false,
      items: [],
      searchKeyword: "",
      selectedItemIds: new Set(),
      showMoveButtons: false,
      sortDisplayLabel: "Manual",
      visibleSearchMatches: [],
    },
    preferences: {
      DEFAULT_OUTLINE_STYLE: "rounded",
      DEFAULT_PURCHASE_STATUS_CONTROL_MODE: "cycle",
      DEFAULT_SKIP_LIMITED_PURCHASE_FOR_SINGLE_QUANTITY: true,
      DEFAULT_UI_VISIBILITY,
      disableLimitedPurchaseQuantityCheck: false,
      disablePriceUndefinedCheck: false,
      numberCellOutlineStyle: "rounded",
      postEventDistributionCheckEnabled: true,
      purchaseStatusControlMode: "cycle",
      skipLimitedPurchaseForSingleQuantity: true,
      themeMode: "system",
      uiVisibilitySettings: DEFAULT_UI_VISIBILITY,
      zoomLevel: 100,
    },
    ui: {
      layoutMode: "pc",
      mainContentVisible: true,
      showHeaderBar: true,
      showTabBar: false,
      TabButton: ({ label }) => <button>{label}</button>,
      uiSettingsPanelOpen: true,
    },
  },
  actions: {
    navigation: {
      getMapTabForDate: vi.fn(() => null),
      handleSetViewMode: vi.fn(),
      onShowEventList: vi.fn(),
      onShowImport: vi.fn(),
      onToggleEventSurface: vi.fn(),
    },
    map: {
      getHallExecuteCount: vi.fn(() => 0),
      getHallTotalItemCount: vi.fn(() => 0),
      handleMapTabRotationAngleChange: vi.fn(),
      openVisitListPanel: vi.fn(),
      setBlockDefinitionMode: vi.fn(),
      setGlobalHallOrderPanelOpen: vi.fn(),
      setHallDefinitionMode: vi.fn(),
      setMapHallSelectorOpen: vi.fn(),
      setMapIsHallOrderOpen: vi.fn(),
      setMapIsRouteVisible: vi.fn(),
      setMapSelectedHallId: vi.fn(),
      setMapSmartInsertEnabled: vi.fn(),
      setMapSmartInsertMode: vi.fn(),
      setMapTabMenuOpen: vi.fn(),
      setSimpleHallDefinitionMode: vi.fn(),
      showSmartInsertToast: vi.fn(),
    },
    list: {
      handleBlockSortToggle: vi.fn(),
      handleBlockSortToggleCandidate: vi.fn(),
      handleBulkSort: vi.fn(),
      handleClearRangeSelection: vi.fn(),
      handleClearSelection: vi.fn(),
      handleMoveToExecuteColumn: vi.fn(),
      handleRemoveFromExecuteColumn: vi.fn(),
      handleSearchNext: vi.fn(),
      handleSortToggle: vi.fn(),
      setExecuteCollapsedSpaces: vi.fn(),
      setExecuteSpaceGroupingEnabled: vi.fn(),
      setItemToEdit: vi.fn(),
      setSearchKeyword: vi.fn(),
      setSelectedBlockFilters: vi.fn(),
    },
    preferences: {
      handleZoomChange: vi.fn(),
      setDisableLimitedPurchaseQuantityCheck: vi.fn(),
      setDisablePriceUndefinedCheck: vi.fn(),
      setNumberCellOutlineStyle: vi.fn(),
      setPostEventDistributionCheckEnabled: vi.fn(),
      setPurchaseStatusControlMode: vi.fn(),
      setSkipLimitedPurchaseForSingleQuantity: vi.fn(),
      setThemeMode: vi.fn(),
      setUiVisibilitySettings: vi.fn(),
      updateUIVisibilityConfig: vi.fn(),
    },
    ui: {
      onCloseUiSettingsPanel: vi.fn(),
      onToggleUiSettingsPanel: vi.fn(),
      setLayoutMode: vi.fn(),
    },
  },
});
describe("日付タブと一覧の日付正規化", () => {
  it.each(["1日目", " １日目　"])(
    "%s の品目数はタブと一致すべき",
    (eventDate) => {
      const props = makeHeaderProps();
      const items = [{ ...item, eventDate }];
      props.model.navigation.eventDates = extractEventDates(items);
      props.model.navigation.activeTab = props.model.navigation.eventDates[0];
      props.model.list.items = items;
      props.model.ui.showTabBar = true;
      props.model.ui.uiSettingsPanelOpen = false;
      props.model.ui.TabButton = ({ label, count }) => (
        <button>
          {label}
          {count === undefined ? "" : ` (${count})`}
        </button>
      );
      render(<AppHeaderShell {...props} />);
      expect(
        screen.getAllByRole("button").map((button) => button.textContent),
      ).toContain(`${props.model.navigation.eventDates[0]} (1)`);
    },
  );
});

describe("Excel・JSONの状態と価格の往復確認", () => {
  it.each(["full", "simple"] as const)(
    "%s: 全7状態・4価格・3数量を往復できる",
    async (format) => {
      const statuses = [
        "None",
        "Purchased",
        "SoldOut",
        "Absent",
        "Postpone",
        "Late",
        "LimitedPurchase",
      ] as const;
      const items: ShoppingItem[] = statuses.flatMap((purchaseStatus) =>
        [null, -1, 0, 700].flatMap((price) =>
          [1, 5, 21].map((quantity) => ({
            ...item,
            id: `${purchaseStatus}-${price}-${quantity}`,
            purchaseStatus,
            price,
            quantity,
            source: "app" as const,
            priorityLevel: "highest" as const,
            protectionLevel: "full" as const,
            ...(purchaseStatus === "LimitedPurchase" && quantity > 1
              ? { limitedPurchasedQuantity: 1 }
              : {}),
          })),
        ),
      );
      const blob = await exportToXlsx(
        "往復確認",
        items,
        {
          includeItems: true,
          includeLayoutInfo: false,
          includeMapData: false,
          includeRouteInfo: false,
          format,
        },
        {},
      );
      const response = await xlsxWorkerExecutor.importWorkbook(
        {
          kind: "event-import",
          input: await blob.arrayBuffer(),
          fileName: "matrix.xlsx",
        },
        new AbortController().signal,
        () => {},
      );
      expect(response.kind).toBe("event-import");
      if (response.kind !== "event-import") throw new Error("Unexpected kind");
      expect(response.value.success, response.value.errors.join("\n")).toBe(
        true,
      );
      expect(response.value.items).toHaveLength(84);
      response.value.items.forEach((actual, i) => {
        const expected = items[i];
        expect(actual).toMatchObject({
          id: expected.id,
          circle: expected.circle,
          eventDate: expected.eventDate,
          block: expected.block,
          number: expected.number,
          title: expected.title,
          remarks: expected.remarks,
          price: expected.price === -1 ? null : expected.price,
          quantity: expected.quantity,
          purchaseStatus: expected.purchaseStatus,
        });
        expect(actual.limitedPurchasedQuantity).toBe(
          expected.limitedPurchasedQuantity,
        );
      });
      const restored = buildXlsxEventRestoreSource(
        toImportedEventData(response.value),
      );
      expect(parseAppBackup(createAppBackup(restored.data)).ok).toBe(true);
    },
  );
});
