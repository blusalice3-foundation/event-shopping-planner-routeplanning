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
  it("retains existing CSV review gating alongside ordinary exclusions", async () => {
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
    render(
      <AppOverlayLayer
        {...props({
          kind: "items-only",
          eventName: SHEET_EVENT,
          baseSource: null,
          diff,
        })}
      />,
    );
    await screen.findByRole("region", { name: "シート取込結果" });
    const button = screen.getByRole("button", { name: "更新を実行" });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByLabelText("除外行と削除候補を確認しました"));
    expect(button).toBeEnabled();
  });
  it("keeps diagnostics across identity selections and replaces them with the next import", async () => {
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
    const select = screen.getByRole("combobox", { name: /取込.*行目の対応/ });
    fireEvent.change(select, { target: { value: previous.id } });
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
