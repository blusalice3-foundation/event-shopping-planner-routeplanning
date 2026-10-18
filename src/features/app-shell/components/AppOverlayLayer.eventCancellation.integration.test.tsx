// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAppOverlayController } from "../../../app/state/useAppOverlayController";
import AppOverlayLayer from "./AppOverlayLayer";

const EVENT_NAME = "Event";

const renderEventOverlays = () => {
  const confirmRename = vi.fn();
  const confirmExport = vi.fn();
  let controller: ReturnType<typeof useAppOverlayController>;
  const Harness = () => {
    controller = useAppOverlayController();
    const props = {
      overlay: controller.readModel,
      overlayCommands: controller.commands,
      model: {
        item: { items: [] },
        event: { activeEventName: EVENT_NAME, eventMetadata: {} },
        mapEditor: { mapData: {} },
        visitList: {},
        imports: {},
        list: {},
      },
      actions: {
        item: {},
        event: {
          handleConfirmRename: confirmRename,
          handleConfirmExport: confirmExport,
        },
        mapEditor: {},
        visitList: {},
        imports: {},
        list: {},
      },
    } as unknown as ComponentProps<typeof AppOverlayLayer>;
    return (
      <>
        <button
          onClick={() => controller.commands.event.openRename(EVENT_NAME)}
        >
          Open rename
        </button>
        <button
          onClick={() => controller.commands.event.openExport(EVENT_NAME)}
        >
          Open export
        </button>
        <AppOverlayLayer {...props} />
      </>
    );
  };
  render(<Harness />);
  return {
    confirmRename,
    confirmExport,
    getController: () => controller,
  };
};

describe("event cancellation through the real overlay controller and dialogs", () => {
  it("cancels rename, reopens it, and ignores a close callback from the old request", () => {
    const { confirmRename, confirmExport, getController } =
      renderEventOverlays();
    fireEvent.click(screen.getByRole("button", { name: "Open rename" }));
    expect(screen.getByLabelText("新しい即売会名")).toHaveValue(EVENT_NAME);
    const staleClose = getController().commands.event.close;

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(screen.queryByText("即売会名を変更")).not.toBeInTheDocument();
    expect(getController().state.event.kind).toBe("inactive");
    expect(confirmRename).not.toHaveBeenCalled();
    expect(confirmExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open rename" }));
    const currentRequest = getController().state.event;
    act(() => staleClose());
    expect(getController().state.event).toBe(currentRequest);
    expect(screen.getByLabelText("新しい即売会名")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^変更$/ }));
    expect(getController().state.event.kind).toBe("inactive");
    expect(confirmRename).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open rename" }));
    fireEvent.change(screen.getByLabelText("新しい即売会名"), {
      target: { value: "Renamed event" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^変更$/ }));
    expect(confirmRename).toHaveBeenCalledExactlyOnceWith("Renamed event");
  });

  it("cancels export with the footer or close icon and preserves normal export", () => {
    const { confirmRename, confirmExport, getController } =
      renderEventOverlays();
    fireEvent.click(screen.getByRole("button", { name: "Open export" }));
    const staleClose = getController().commands.event.close;
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByText("エクスポート設定")).not.toBeInTheDocument();
    expect(getController().state.event.kind).toBe("inactive");
    expect(confirmRename).not.toHaveBeenCalled();
    expect(confirmExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open export" }));
    const currentRequest = getController().state.event;
    act(() => staleClose());
    expect(getController().state.event).toBe(currentRequest);
    expect(screen.getByText("エクスポート設定")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^$/ }));
    expect(getController().state.event.kind).toBe("inactive");
    expect(confirmExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open export" }));
    fireEvent.click(screen.getByRole("button", { name: /^エクスポート$/ }));
    expect(confirmExport).toHaveBeenCalledExactlyOnceWith({
      includeItems: true,
      includeLayoutInfo: true,
      includeMapData: false,
      includeRouteInfo: true,
      format: "full",
    });
    expect(getController().state.event.kind).toBe("inactive");
    expect(screen.queryByText("エクスポート設定")).not.toBeInTheDocument();
  });
});
