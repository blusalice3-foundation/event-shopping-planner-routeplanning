// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockDefinition, CellData, DayMapData } from "../../types/map";
import type { MapEditorSession } from "../../features/map/domain/mapEditorSession";
import type {
  BlockSelectionType,
  EditingBlockData,
} from "../../features/map/domain/blockDefinitionEditing";
import { useAppOverlayController } from "../../app/state/useAppOverlayController";
import BlockDefinitionPanel from "./BlockDefinitionPanel";
const session: MapEditorSession = {
  sessionId: "panel-session",
  eventName: "event",
  eventGeneration: 1,
  day: "day",
  mapKey: "map",
  editorKind: "block-definition",
};
const makeBlock = (name: string): BlockDefinition => ({
  name,
  id: `id-${name}`,
  startRow: 1,
  startCol: 1,
  endRow: 3,
  endCol: 3,
  numberCells: [{ row: 1, col: 2, value: 1 }],
  nameCells: [{ row: 1, col: 1 }],
});
const makeCell = (value: number): CellData => ({
  row: 1,
  col: 2,
  value,
  backgroundColor: null,
  borders: { top: null, right: null, bottom: null, left: null },
});
const mapData: DayMapData = {
  maxRow: 10,
  maxCol: 10,
  cells: [makeCell(1)],
  mergedCells: [],
  blocks: [makeBlock("b"), makeBlock("B")],
};
const corners = [
  { row: 4, col: 4 },
  { row: 4, col: 5 },
  { row: 5, col: 4 },
  { row: 5, col: 5 },
];
type Terminals = {
  confirm: () => void;
  cancel: () => void;
  clear: () => void;
  key: string;
};
function Harness({
  onReady,
  onStart,
  onUpdate,
}: {
  onReady: (value: Terminals) => void;
  onStart: (type: BlockSelectionType, data: EditingBlockData) => void;
  onUpdate: (blocks: BlockDefinition[]) => void;
}) {
  const controller = useAppOverlayController();
  const { readModel, commands } = controller;
  const selection = readModel.cellSelectionMode;
  useEffect(() => {
    if (!selection) return;
    const finish = (type: BlockSelectionType | "cancelled") =>
      commands.mapEditor.finishCellSelection(
        {
          session,
          type,
          cells: type === "cancelled" ? [] : corners,
          editingData: selection.editingBlockData,
          selectionRequestKey: selection.selectionRequestKey,
        },
        selection.selectionRequestKey,
      );
    onReady({
      confirm: () => finish(selection.type),
      cancel: () => finish("cancelled"),
      clear: () =>
        commands.mapEditor.clearPendingCellSelection(
          selection.selectionRequestKey,
        ),
      key: selection.selectionRequestKey,
    });
  }, [selection, commands.mapEditor, onReady]);
  return (
    <>
      <button
        onClick={() => commands.mapEditor.openBlockDefinition(null, session)}
      >
        open
      </button>
      {readModel.blockDefinitionMode && (
        <BlockDefinitionPanel
          isOpen
          session={session}
          mapData={mapData}
          onClose={() => commands.mapEditor.close()}
          onUpdateBlocks={onUpdate}
          pendingCellSelection={readModel.pendingCellSelection}
          onClearPendingCellSelection={
            commands.mapEditor.clearPendingCellSelection
          }
          onStartCellSelection={(type, data) => {
            onStart(type, data);
            commands.mapEditor.startCellSelection({
              session,
              type,
              clickedCells: [],
              editingBlockData: data,
              selectionRequestKey: data.selectionRequestKey,
            });
          }}
        />
      )}
      {selection && <div role="status">selecting</div>}
    </>
  );
}
function selectBlock(name: string) {
  fireEvent.click(
    screen.getByText(name, { selector: "span.relative" }).closest("button")!,
  );
}
function changeName(value: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
}
const typeButtons: Record<BlockSelectionType, string> = {
  corner: "マップ上で4つの角をクリックして選択",
  multiCorner: "マップ上で4つの角をクリックして範囲を追加",
  rangeStart: "+ 範囲追加",
  individual: "+ 個別追加",
};
afterEach(() => vi.restoreAllMocks());
describe("BlockDefinitionPanel atomic editing", () => {
  it("retains the exact target while sorting and cancels incomplete same-name replacement without deleting", () => {
    const onUpdate = vi.fn();
    const onStart = vi.fn();
    const view = render(
      <BlockDefinitionPanel
        isOpen
        session={session}
        mapData={mapData}
        onClose={vi.fn()}
        onUpdateBlocks={onUpdate}
        onStartCellSelection={onStart}
      />,
    );
    selectBlock("b");
    changeName("b監査");
    fireEvent.click(screen.getByRole("button", { name: "一覧" }));
    fireEvent.click(screen.getByRole("button", { name: "↑昇順" }));
    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 新規" }));
    changeName("B");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("B");
    fireEvent.click(view.getAllByRole("button", { name: "キャンセル" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "適用" }));
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(
      onUpdate.mock.calls[0][0].map((b: BlockDefinition) => b.name),
    ).toEqual(["b監査", "B"]);
    expect(onUpdate.mock.calls[0][0][1]).toBe(mapData.blocks[1]);
    expect(onStart).not.toHaveBeenCalled();
  });
  it("keeps a valid replacement on cancellation, supports retry and applies it once under StrictMode", () => {
    const onReady = vi.fn<(value: Terminals) => void>(),
      onStart =
        vi.fn<(type: BlockSelectionType, data: EditingBlockData) => void>(),
      onUpdate = vi.fn();
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(
      <StrictMode>
        <Harness onReady={onReady} onStart={onStart} onUpdate={onUpdate} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 新規" }));
    changeName("b");
    fireEvent.click(screen.getByRole("button", { name: typeButtons.corner }));
    act(() => onReady.mock.lastCall![0].confirm());
    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox")).toHaveValue("b");
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "適用" }));
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(
      onUpdate.mock.calls[0][0].map((b: BlockDefinition) => b.name),
    ).toEqual(["B", "b"]);
    expect(onUpdate.mock.calls[0][0][0]).toBe(mapData.blocks[1]);
    expect(onUpdate.mock.calls[0][0][1]).not.toHaveProperty("id");
    expect(mapData.blocks[0].id).toBe("id-b");
  });
});
describe("connected block panel and overlay under StrictMode", () => {
  for (const type of [
    "corner",
    "multiCorner",
    "rangeStart",
    "individual",
  ] as const)
    for (const first of ["confirm", "cancel"] as const) {
      it(`${type}: ${first} consumes one result, survives remount and ignores old terminals around K2`, () => {
        const onReady = vi.fn<(value: Terminals) => void>(),
          onStart =
            vi.fn<(type: BlockSelectionType, data: EditingBlockData) => void>(),
          onUpdate = vi.fn();
        render(
          <StrictMode>
            <Harness onReady={onReady} onStart={onStart} onUpdate={onUpdate} />
          </StrictMode>,
        );
        fireEvent.click(screen.getByRole("button", { name: "open" }));
        selectBlock("B");
        changeName("B変更");
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        selectBlock("b");
        changeName("b監査");
        if (type !== "corner")
          fireEvent.click(
            screen.getByRole("button", {
              name: type === "multiCorner" ? "複数範囲" : "壁",
            }),
          );
        fireEvent.click(screen.getByRole("button", { name: "一覧" }));
        fireEvent.click(screen.getByRole("button", { name: "↑昇順" }));
        fireEvent.click(screen.getByRole("button", { name: "編集" }));
        fireEvent.click(
          screen.getByRole("button", { name: typeButtons[type] }),
        );
        const k1 = onReady.mock.lastCall![0];
        act(() => {
          k1[first]();
          k1.confirm();
          k1.cancel();
        });
        expect(screen.getByRole("textbox")).toHaveValue("b監査");
        expect(
          onStart.mock.calls[0][1].currentBlocks.map((b) => b.name),
        ).toEqual(["b", "B変更"]);
        expect(onUpdate).not.toHaveBeenCalled();
        if (type === "multiCorner")
          expect(screen.queryAllByText(/^範囲1:/)).toHaveLength(
            first === "confirm" ? 1 : 0,
          );
        else if (type !== "corner")
          expect(
            screen.queryAllByText(
              type === "individual" ? "個別4セル" : "範囲(4,4)-(4,5)",
            ),
          ).toHaveLength(first === "confirm" ? 1 : 0);
        changeName("b監査追記");
        fireEvent.click(
          screen.getByRole("button", { name: typeButtons[type] }),
        );
        const k2 = onReady.mock.lastCall![0];
        expect(k2.key).not.toBe(k1.key);
        expect(onStart.mock.calls[1][1].editId).toBe(
          onStart.mock.calls[0][1].reservedResumeEditId,
        );
        expect(onStart.mock.calls[1][1].nextSequence).toBeGreaterThan(
          onStart.mock.calls[0][1].nextSequence,
        );
        act(() => {
          k1.confirm();
          k1.cancel();
          k1.clear();
        });
        expect(screen.getByRole("status")).toHaveTextContent("selecting");
        act(() => k2.cancel());
        expect(screen.getByRole("textbox")).toHaveValue("b監査追記");
        act(() => {
          k1.confirm();
          k1.cancel();
          k1.clear();
          k2.confirm();
          k2.cancel();
          k2.clear();
        });
        expect(screen.getByRole("textbox")).toHaveValue("b監査追記");
        expect(onUpdate).not.toHaveBeenCalled();
        // Return to normal to make every cancelled-first case saveable without adding a range.
        fireEvent.click(screen.getByRole("button", { name: "通常" }));
        if (type === "corner") {
          fireEvent.click(screen.getByRole("button", { name: "保存" }));
          fireEvent.click(screen.getByRole("button", { name: "適用" }));
          expect(onUpdate).toHaveBeenCalledOnce();
          expect(
            onUpdate.mock.calls[0][0].map((b: BlockDefinition) => b.name),
          ).toEqual(["b監査追記", "B変更"]);
          expect(onUpdate.mock.calls[0][0][0].id).toBe("id-b");
        }
      });
    }
});
describe("number preview dependencies", () => {
  it.each(["normal", "multi", "wall-range", "wall-individual"])(
    "does not scan cells for name/color inputs in %s, and refreshes new cell values",
    (mode) => {
      const source = makeBlock("b");
      if (mode !== "normal")
        source.cellGroups = [
          mode === "wall-individual"
            ? { type: "individual", cells: [{ row: 1, col: 2 }] }
            : { type: "range", startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        ];
      source.isWallBlock = mode.startsWith("wall");
      const read = vi.fn(() => 1);
      const cell = makeCell(1);
      Object.defineProperty(cell, "value", { get: read });
      const data = { ...mapData, cells: [cell], blocks: [source] };
      const props = {
        isOpen: true,
        session,
        mapData: data,
        onClose: vi.fn(),
        onUpdateBlocks: vi.fn(),
        onStartCellSelection: vi.fn(),
      };
      const view = render(<BlockDefinitionPanel {...props} />);
      selectBlock("b");
      expect(read).toHaveBeenCalled();
      read.mockClear();
      changeName("b監査");
      changeName("b監査追記");
      const color = view.container
        .querySelectorAll("button svg rect[fill='#E8F5E9']")[0]
        .closest("button")!;
      fireEvent.click(color);
      expect(read).not.toHaveBeenCalled();
      expect(screen.getByText("検出セル: 1個")).toBeInTheDocument();
      view.rerender(
        <BlockDefinitionPanel
          {...props}
          mapData={{ ...data, cells: [makeCell(9)] }}
        />,
      );
      expect(screen.getByText("9", { selector: "span" })).toBeInTheDocument();
      expect(
        screen.queryByText("1", { selector: "span" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "壁" }));
      expect(screen.getByText("検出セル: 0個")).toBeInTheDocument();
    },
  );
});
