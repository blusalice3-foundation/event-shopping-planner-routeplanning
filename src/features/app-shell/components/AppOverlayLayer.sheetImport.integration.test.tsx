import type { ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialAppOverlayState,
  reduceAppOverlayState,
  selectAppOverlayReadModel,
} from "../../../app/state/appOverlayState";
import {
  buildEventUpdateDiffFromSpreadsheet,
  type PendingEventUpdate,
} from "../../events/updateFlow";
import {
  sheetCsv,
  sheetItem,
  SHEET_EVENT,
} from "../../../test/sheetImportOptionalUrlFixtures";
import AppOverlayLayer from "./AppOverlayLayer";
import { createEventUpdateDiff } from "../../events/updateDiff";

function props(pending: PendingEventUpdate) {
  return {
    overlay: selectAppOverlayReadModel(
      reduceAppOverlayState(createInitialAppOverlayState(), {
        type: "event/open-update",
        requestId: "update-1",
        pending,
      }),
    ),
    overlayCommands: { item: {}, event: {}, mapEditor: {} },
    model: {
      item: { items: [] },
      event: { activeEventName: SHEET_EVENT, eventMetadata: {} },
      mapEditor: {},
      visitList: {},
      imports: {},
      list: {},
    },
    actions: {
      item: { handleConfirmUpdate: vi.fn(), handleCancelUpdate: vi.fn() },
      event: {},
      mapEditor: {},
      visitList: {},
      imports: {},
      list: {},
    },
  } as unknown as ComponentProps<typeof AppOverlayLayer>;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("sheet diagnostics through the actual overlay and update modal", () => {
  for (const kind of ["items-only", "source-switch"] as const) {
    it(`${kind}: shows zero accepted rows, deletion/protection counts, and keeps the normal exclusion ungated`, async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          text: async () => sheetCsv(4, "excluded"),
        })),
      );
      const diff = await buildEventUpdateDiffFromSpreadsheet(
        [sheetItem(), { ...sheetItem(1), protectionLevel: "full" }],
        {
          url: "https://docs.google.com/spreadsheets/d/new/edit",
          sheetName: "品目表",
        },
      );
      const input = props({
        kind,
        eventName: SHEET_EVENT,
        diff,
        baseSource: null,
        ...(kind === "source-switch"
          ? {
              nextSource: {
                url: "https://docs.google.com/spreadsheets/d/new/edit",
                sheetName: "品目表",
              },
            }
          : {}),
      } as PendingEventUpdate);
      render(<AppOverlayLayer {...input} />);
      const summary = await screen.findByRole("region", {
        name: "シート取込結果",
      });
      expect(summary).toHaveTextContent(
        "取込対象: 0件、必須項目不足による除外: 4行",
      );
      expect(summary).toHaveTextContent("ブロック 4行");
      expect(
        screen.getByText("削除候補: 1件、削除から保護: 1件"),
      ).toBeVisible();
      expect(
        screen.queryByLabelText("除外行と削除候補を確認しました"),
      ).not.toBeInTheDocument();
      const confirm = screen.getByRole("button", {
        name:
          kind === "source-switch" ? "更新元を切り替えて更新" : "更新を実行",
      });
      expect(confirm).toBeEnabled();
      fireEvent.click(confirm);
      expect(input.actions.item.handleConfirmUpdate).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
      expect(input.actions.item.handleCancelUpdate).toHaveBeenCalledOnce();
    });
  }
  it("confirms CSV warnings with the update button without a separate checkbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => `#METADATA,unknown,value\n${sheetCsv(4, "mixed")}`,
      })),
    );
    const diff = await buildEventUpdateDiffFromSpreadsheet([], {
      url: "https://docs.google.com/spreadsheets/d/test/edit",
      sheetName: "品目表",
    });
    const input = props({
      kind: "items-only",
      eventName: SHEET_EVENT,
      baseSource: null,
      diff,
    });
    render(<AppOverlayLayer {...input} />);
    await screen.findByRole("region", { name: "シート取込結果" });
    expect(diff.csvReview).toBeDefined();
    expect(screen.getByText(diff.csvReview!.warnings[0])).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "更新を実行" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(
      input.actions.item.handleConfirmUpdate,
    ).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        acceptCsvExclusions: true,
        priceSyncMode: "preserve",
        remarksSyncMode: "preserve",
      }),
    );
  });
  it("shows diagnostics after automatic title matching and replaces them with the next import", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => sheetCsv(4, "mixed") })),
    );
    const previous = {
      ...sheetItem(1),
      title: "旧刊",
      sheetIdentityVerified: false,
    };
    const diff = await buildEventUpdateDiffFromSpreadsheet([previous], {
      url: "https://docs.google.com/spreadsheets/d/test/edit",
      sheetName: "品目表",
    });
    const h = render(
      <AppOverlayLayer
        {...props({
          kind: "items-only",
          eventName: SHEET_EVENT,
          baseSource: null,
          diff,
        })}
      />,
    );
    const summary = await screen.findByRole("region", {
      name: "シート取込結果",
    });
    expect(
      screen.queryByRole("combobox", { name: /取込.*行目の対応/ }),
    ).not.toBeInTheDocument();
    expect(diff.itemsToUpdate.some((item) => item.id === previous.id)).toBe(
      true,
    );
    expect(summary).toHaveTextContent("必須項目不足による除外: 1行");
    expect(screen.getByRole("button", { name: "更新を実行" })).toBeEnabled();
    const next = {
      ...diff,
      sheetImport: {
        acceptedCount: 3,
        rowExclusions: {
          excludedCount: 0,
          missingFieldCounts: { circle: 0, eventDate: 0, block: 0, number: 0 },
          examples: [],
        },
      },
    };
    h.rerender(
      <AppOverlayLayer
        {...props({
          kind: "items-only",
          eventName: SHEET_EVENT,
          baseSource: null,
          diff: next,
        })}
      />,
    );
    expect(
      within(
        screen.getByRole("region", { name: "シート取込結果" }),
      ).queryByText(/除外行の例/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "シート取込結果" }),
    ).toHaveTextContent("必須項目不足による除外: 0行");
  });
});

describe("update operation state through AppOverlayLayer", () => {
  it.each(["items-only", "source-switch"] as const)(
    "%s shows the target and freezes confirmation while saving",
    (kind) => {
      const existing = {
        ...sheetItem(),
        purchaseStatus: "Purchased" as const,
        quantity: 2,
      };
      const diff = createEventUpdateDiff(
        [existing],
        [{ ...existing, rawQuantity: "4" }],
      );
      const input = props({
        kind,
        eventName: SHEET_EVENT,
        baseSource: null,
        diff,
        ...(kind === "source-switch"
          ? {
              nextSource: {
                url: "https://docs.google.com/spreadsheets/d/new/edit",
                sheetName: "品目表",
              },
            }
          : {}),
      } as PendingEventUpdate);
      input.model.item.isEventUpdateSaving = true;
      const view = render(<AppOverlayLayer {...input} />);
      expect(screen.getByText(`対象イベント: ${SHEET_EVENT}`)).toBeVisible();
      expect(screen.getByRole("checkbox")).toBeDisabled();
      expect(screen.getByRole("button", { name: "キャンセル" })).toBeDisabled();
      expect(
        screen.getByRole("button", {
          name:
            kind === "source-switch" ? "更新元を切り替えて更新" : "更新を実行",
        }),
      ).toBeDisabled();
      view.rerender(
        <AppOverlayLayer
          {...input}
          model={{
            ...input.model,
            item: { ...input.model.item, isEventUpdateSaving: false },
          }}
        />,
      );
      expect(screen.getByRole("checkbox")).toBeEnabled();
    },
  );

  it("URL cancel delegates to operation completion and restores the list; sheet name is visible and clearing stays blank", () => {
    const input = props({
      kind: "items-only",
      eventName: SHEET_EVENT,
      baseSource: null,
      diff: createEventUpdateDiff([], []),
    });
    const overlay = selectAppOverlayReadModel(
      reduceAppOverlayState(createInitialAppOverlayState(), {
        type: "event/open-url-update",
        requestId: "url-1",
        eventName: SHEET_EVENT,
      }),
    );
    input.model.event.eventMetadata = {
      [SHEET_EVENT]: {
        spreadsheetUrl:
          "https://docs.google.com/spreadsheets/d/existing/edit#gid=2",
        spreadsheetSheetName: "保存済みシート",
        lastImportDate: "",
      },
    };
    input.model.event.updateOperationId = "url-operation-1";
    input.actions.event.handleUrlUpdate = vi.fn();
    input.actions.event.handleUrlUpdateCancel = vi.fn();
    input.actions.event.onShowEventList = vi.fn();
    const view = render(<AppOverlayLayer {...input} overlay={overlay} />);
    const sheet = screen.getByDisplayValue("保存済みシート");
    fireEvent.change(sheet, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    expect(input.actions.event.handleUrlUpdate).toHaveBeenCalledWith(
      "https://docs.google.com/spreadsheets/d/existing/edit#gid=2",
      "",
      "url-operation-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(input.actions.event.handleUrlUpdateCancel).toHaveBeenCalledOnce();
    expect(input.actions.event.onShowEventList).toHaveBeenCalledOnce();
    input.model.event.updateOperationId = "url-operation-2";
    input.model.event.eventMetadata = {
      [SHEET_EVENT]: {
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/next/edit",
        spreadsheetSheetName: "次のシート",
        lastImportDate: "",
      },
    };
    input.actions.event.handleUrlUpdateCancel = vi.fn(() => false);
    view.rerender(<AppOverlayLayer {...input} overlay={overlay} />);
    expect(screen.getByDisplayValue("次のシート")).toBeVisible();
    expect(
      screen.getByDisplayValue(
        "https://docs.google.com/spreadsheets/d/next/edit",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(input.actions.event.handleUrlUpdateCancel).toHaveBeenCalledWith(
      "url-operation-2",
    );
    expect(input.actions.event.onShowEventList).toHaveBeenCalledOnce();
  });
});
