// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HallDefinition } from "../../types/map";
import type { MapEditorSession } from "../../features/map/domain/mapEditorSession";
import type {
  HallEditorSave,
  HallEditorSync,
  HallWriteResult,
} from "../../app/ports/HallEditorCommandPort";
import { encodeHallRef } from "../../features/consistency/domain/projection";
import HallDefinitionPanel from "./HallDefinitionPanel";
import SimpleHallDefinitionPanel from "./SimpleHallDefinitionPanel";

const hall: HallDefinition = {
  id: encodeHallRef({ kind: "simple", dayKey: "1日目", hallId: "same" }),
  name: "東館",
  color: "#FFE0B2",
  vertices: [],
  blockNames: ["A"],
};
const mapData = {
  maxRow: 8,
  maxCol: 8,
  cells: [],
  mergedCells: [],
  blocks: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(
  simple: boolean,
  onSave: HallEditorSave,
  onSync: HallEditorSync,
) {
  const session: MapEditorSession = {
    sessionId: "editor-owner",
    eventName: "イベント",
    eventGeneration: 0,
    day: "1日目",
    mapKey: simple ? "__MAPLESS__:1日目" : "会場図",
    editorKind: simple ? "simple-hall-definition" : "hall-definition",
  };
  const onClose = vi.fn();
  const panel = (halls = [hall]) =>
    simple ? (
      <SimpleHallDefinitionPanel
        isOpen
        session={session}
        onClose={onClose}
        halls={halls}
        onUpdateHalls={onSave}
        onSyncToOtherDates={onSync}
        availableBlocks={["A"]}
        activeEventDate="1日目"
        eventDates={["1日目", "2日目", "3日目"]}
      />
    ) : (
      <HallDefinitionPanel
        isOpen
        session={session}
        onClose={onClose}
        mapData={mapData}
        halls={halls}
        onUpdateHalls={onSave}
        onSyncToOtherDates={onSync}
        onStartVertexSelection={vi.fn()}
        activeEventDate="1日目"
        mapTabDates={["1日目", "2日目", "3日目"]}
      />
    );
  const view = render(panel());
  const finalButton = () =>
    view.getByRole("button", { name: simple ? "保存" : "適用" });
  const editName = (name: string) => {
    fireEvent.click(
      view.getByRole("button", { name: /東館.*ブロック|ブロック.*東館/ }),
    );
    fireEvent.change(view.getByRole("textbox"), { target: { value: name } });
  };
  const acceptEditing = () =>
    fireEvent.click(
      view.getByRole("button", { name: simple ? "確定" : "保存" }),
    );
  const startSync = () => {
    fireEvent.click(view.getByRole("button", { name: "他の日に同期" }));
    fireEvent.click(view.getByRole("checkbox", { name: "2日目" }));
    fireEvent.click(view.getByRole("button", { name: /選択した日に同期/ }));
  };
  return {
    ...view,
    session,
    onClose,
    panel,
    finalButton,
    editName,
    acceptEditing,
    startSync,
  };
}

beforeEach(() =>
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe.each([true, false])(
  "hall editor saved results (simple=%s)",
  (simple) => {
    it("keeps the draft and sync selection through props updates and a failed atomic save, then uses committed display IDs", async () => {
      const first = deferred<HallWriteResult>();
      const onSave = vi.fn<HallEditorSave>();
      const onSync = vi
        .fn<HallEditorSync>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValue({
          status: "saved",
          sessionId: "editor-owner",
          committedHalls: [{ ...hall, name: "保存済みの表示" }],
        });
      const view = setup(simple, onSave, onSync);
      view.editName("編集中の名前");
      view.rerender(
        view.panel([{ ...hall, name: "無関係な購入更新後のprops" }]),
      );
      expect(view.getByRole("textbox")).toHaveValue("編集中の名前");
      expect(view.getByText(/先に個別編集を/)).toBeInTheDocument();
      if (!simple) expect(view.finalButton()).toBeDisabled();
      view.acceptEditing();
      view.startSync();
      expect(onSync).toHaveBeenCalledWith(
        ["2日目"],
        [{ ...hall, name: "編集中の名前", color: "#FFE0B2" }],
        view.session,
      );
      expect(view.finalButton()).toBeDisabled();
      fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
      expect(view.onClose).not.toHaveBeenCalled();
      await act(async () =>
        first.reject(new DOMException("容量不足", "QuotaExceededError")),
      );
      expect(view.getByRole("alert")).toHaveTextContent("入力を保持");
      expect(view.getByRole("checkbox", { name: "2日目" })).toBeChecked();
      expect(
        view.getByRole("button", {
          name: /ブロック.*編集中の名前|編集中の名前.*ブロック/,
        }),
      ).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: /選択した日に同期/ }));
      await waitFor(() =>
        expect(
          view.getByRole("button", {
            name: /ブロック.*保存済みの表示|保存済みの表示.*ブロック/,
          }),
        ).toBeInTheDocument(),
      );
      expect(view.onClose).not.toHaveBeenCalled();
      fireEvent.click(view.getByRole("button", { name: "他の日に同期" }));
      fireEvent.click(view.getByRole("checkbox", { name: "3日目" }));
      fireEvent.click(view.getByRole("button", { name: /選択した日に同期/ }));
      await waitFor(() => expect(onSync).toHaveBeenCalledTimes(3));
      expect(onSync.mock.calls[2][1]).toEqual([
        { ...hall, name: "保存済みの表示" },
      ]);
      expect(onSync.mock.calls[2][1][0].id).toBe(hall.id);
    });

    it("only closes after an owned saved result and keeps input after confirmation cancellation", async () => {
      const pending = deferred<HallWriteResult>();
      const onSave = vi
        .fn<HallEditorSave>()
        .mockResolvedValueOnce({ status: "cancelled" })
        .mockReturnValueOnce(pending.promise);
      const view = setup(simple, onSave, vi.fn<HallEditorSync>());
      fireEvent.click(view.finalButton());
      await waitFor(() => expect(view.finalButton()).toBeEnabled());
      expect(view.onClose).not.toHaveBeenCalled();
      fireEvent.click(view.finalButton());
      fireEvent.click(view.finalButton());
      expect(onSave).toHaveBeenCalledTimes(2);
      expect(view.onClose).not.toHaveBeenCalled();
      await act(async () =>
        pending.resolve({
          status: "saved",
          sessionId: "editor-owner",
          committedHalls: [hall],
        }),
      );
      expect(view.onClose).toHaveBeenCalledOnce();
    });

    it.each(["CommittedStateApplyError", "PersistenceOutcomeUnknownError"])(
      "blocks retries for %s while keeping the draft",
      async (name) => {
        const failure = Object.assign(new Error("再読込が必要"), { name });
        const onSave = vi.fn<HallEditorSave>().mockRejectedValue(failure);
        const view = setup(simple, onSave, vi.fn<HallEditorSync>());
        fireEvent.click(view.finalButton());
        await waitFor(() =>
          expect(view.getByRole("alert")).toHaveTextContent("再送せず"),
        );
        expect(view.finalButton()).toBeDisabled();
        fireEvent.click(view.finalButton());
        expect(onSave).toHaveBeenCalledOnce();
        expect(view.onClose).not.toHaveBeenCalled();
        expect(
          view.getByRole("button", { name: /東館.*ブロック|ブロック.*東館/ }),
        ).toBeInTheDocument();
      },
    );
  },
);
