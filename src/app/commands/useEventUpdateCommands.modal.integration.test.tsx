import { useRef, useState, type ComponentProps } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AppOverlayLayer from "../../features/app-shell/components/AppOverlayLayer";
import {
  createInitialAppOverlayState,
  reduceAppOverlayState,
  selectAppOverlayReadModel,
} from "../state/appOverlayState";
import type {
  EventUpdateCommitState,
  PendingEventUpdate,
} from "../../features/events/updateFlow";
import { sheetCsv, sheetItem } from "../../test/sheetImportOptionalUrlFixtures";
import { useEventUpdateCommands } from "./useEventUpdateCommands";

const EVENT = "確認対象";
const SOURCE = {
  url: "https://docs.google.com/spreadsheets/d/original/edit",
  sheetName: "品目表",
};
const NEXT_SOURCE = {
  url: "https://docs.google.com/spreadsheets/d/replacement/edit",
  sheetName: "品目表",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["items-only", "source-switch"] as const)(
  "%s: automatically matches items and preserves quantity choices through a failed pending save",
  async (kind) => {
    const items = ["A", "B"].map((id) => ({
      ...sheetItem(0),
      id,
      title: `旧品目${id}`,
      purchaseStatus: "Purchased" as const,
      quantity: 2,
      remarks: `${id}の購入記録`,
      futureOptionalField: { preserved: true },
    }));
    const durable: { current: EventUpdateCommitState } = {
      current: {
        eventLists: { [EVENT]: items },
        eventMetadata: {
          [EVENT]: {
            spreadsheetUrl: SOURCE.url,
            spreadsheetSheetName: SOURCE.sheetName,
            lastImportDate: "2026-10-17T00:00:00Z",
          },
        },
        executeModeItems: { [EVENT]: { "1日目": ["A", "B"] } },
      },
    };
    const cells = Array<string>(27).fill("");
    Object.assign(cells, {
      12: items[0].circle,
      13: items[0].eventDate,
      14: items[0].block,
      15: items[0].number,
      16: "更新された品目",
      17: "500",
      22: "シート備考",
      26: "4",
    });
    const excluded = [...cells];
    excluded[14] = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          [sheetCsv(0), cells.join(","), excluded.join(",")].join("\n"),
      })),
    );
    let failFirstSave!: (reason: unknown) => void;
    const firstSave = new Promise<boolean>((_resolve, reject) => {
      failFirstSave = reject;
    });
    const commit = vi.fn(async (next: EventUpdateCommitState) => {
      if (commit.mock.calls.length === 1) return firstSave;
      durable.current = next;
      return true;
    });
    const notify = vi.fn();
    function Harness() {
      const [pending, setPending] = useState<PendingEventUpdate | null>(null);
      const eventListsRef = useRef(durable.current.eventLists);
      const eventMetadataRef = useRef(durable.current.eventMetadata);
      const executeModeItemsRef = useRef(durable.current.executeModeItems);
      const pendingEventUpdateBaseItemsRef = useRef<typeof items | null>(null);
      const eventUpdatePreviewEpochRef = useRef(0);
      const commands = useEventUpdateCommands({
        state: {
          eventLists: eventListsRef.current,
          eventMetadata: eventMetadataRef.current,
          pendingDuplicateEvent: null,
          pendingEventUpdate: pending,
          pendingUpdateEventName: EVENT,
          eventListsRef,
          eventMetadataRef,
          executeModeItemsRef,
          pendingEventUpdateBaseItemsRef,
          eventUpdatePreviewEpochRef,
        },
        actions: {
          applyBulkAdd: vi.fn(async () => ({ status: "failed" as const })),
          commitEventUpdateState: commit,
          openEventUpdate: setPending,
          openUrlUpdate: vi.fn(),
          closeEventOverlay: () => setPending(null),
          confirmEventOverlay: () => setPending(null),
        },
        effects: { notify, reportError: vi.fn() },
      });
      const overlayProps = {
        overlay: pending
          ? selectAppOverlayReadModel(
              reduceAppOverlayState(createInitialAppOverlayState(), {
                type: "event/open-update",
                requestId: "review",
                pending,
              }),
            )
          : selectAppOverlayReadModel(createInitialAppOverlayState()),
        overlayCommands: { item: {}, event: {}, mapEditor: {} },
        model: {
          item: { items: [] },
          event: {
            activeEventName: EVENT,
            eventMetadata: eventMetadataRef.current,
          },
          mapEditor: {},
          visitList: {},
          imports: {},
          list: {},
        },
        actions: {
          item: {
            handleConfirmUpdate: commands.handleConfirmUpdate,
            handleCancelUpdate: commands.handleCancelUpdate,
          },
          event: {},
          mapEditor: {},
          visitList: {},
          imports: {},
          list: {},
        },
      } as unknown as ComponentProps<typeof AppOverlayLayer>;
      return (
        <>
          <button
            onClick={() =>
              kind === "items-only"
                ? commands.handleUpdateEvent(EVENT)
                : commands.handleUrlUpdate(
                    NEXT_SOURCE.url,
                    NEXT_SOURCE.sheetName,
                  )
            }
          >
            確認を開始
          </button>
          <AppOverlayLayer {...overlayProps} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "確認を開始" }));
    await screen.findByRole("button", {
      name: kind === "items-only" ? "更新を実行" : "更新元を切り替えて更新",
    });
    expect(
      screen.queryByRole("combobox", { name: /行目の対応/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "シート取込結果" }),
    ).toHaveTextContent("取込対象: 1件、必須項目不足による除外: 1行");

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /スプレッドシートの予定数量へ変更する/,
      }),
    );
    const confirmName =
      kind === "items-only" ? "更新を実行" : "更新元を切り替えて更新";
    fireEvent.click(screen.getByRole("button", { name: confirmName }));
    await waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(
      commit.mock.calls[0][0].eventLists[EVENT].find(({ id }) => id === "A")
        ?.quantity,
    ).toBe(4);
    expect(durable.current.eventLists[EVENT]).toBe(items);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /スプレッドシートの予定数量へ変更する/,
      }),
    );
    expect(
      screen.getByRole("checkbox", {
        name: /スプレッドシートの予定数量へ変更する/,
      }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: confirmName }));
    expect(commit).toHaveBeenCalledOnce();
    await act(async () => {
      failFirstSave(
        Object.assign(new Error("容量不足"), { name: "QuotaExceededError" }),
      );
    });
    expect(durable.current.eventLists[EVENT]).toBe(items);
    expect(notify).toHaveBeenCalledWith(
      "イベントを保存できませんでした。表示内容は変更されていません。",
    );
    expect(
      screen.getByRole("region", { name: "シート取込結果" }),
    ).toHaveTextContent("必須項目不足による除外: 1行");

    fireEvent.click(screen.getByRole("button", { name: confirmName }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(
      durable.current.eventLists[EVENT].find(({ id }) => id === "A"),
    ).toMatchObject({
      quantity: 2,
      title: "更新された品目",
      remarks: "Aの購入記録",
      futureOptionalField: { preserved: true },
    });
    expect(durable.current.eventMetadata[EVENT].spreadsheetUrl).toBe(
      kind === "items-only" ? SOURCE.url : NEXT_SOURCE.url,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: confirmName }),
      ).not.toBeInTheDocument(),
    );
  },
);
