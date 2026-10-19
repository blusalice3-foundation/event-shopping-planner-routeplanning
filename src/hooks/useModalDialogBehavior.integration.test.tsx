import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState, type RefObject } from "react";
import { describe, expect, it } from "vitest";
import { requestModalSafeFocus } from "../utils/modalFocusBoundary";
import { useModalDialogBehavior } from "./useModalDialogBehavior";

type OpenerState = "active" | "removed" | "disabled" | "hidden" | "aria-hidden";

function Dialog({
  close,
  fallbackFocusRef,
}: {
  close(): void;
  fallbackFocusRef: RefObject<HTMLElement | null>;
}) {
  const { dialogRef, onDialogKeyDown } = useModalDialogBehavior({
    isOpen: true,
    onEscape: close,
    fallbackFocusRef,
    containExternalFocus: true,
  });
  return (
    <div role="dialog" ref={dialogRef} onKeyDown={onDialogKeyDown}>
      <button onClick={close}>閉じる</button>
    </div>
  );
}

function Host({
  openerState = "active",
  fallbackVersion = "開始時",
}: {
  openerState?: OpenerState;
  fallbackVersion?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const fallbackRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {openerState !== "removed" && (
        <button
          disabled={openerState === "disabled"}
          hidden={openerState === "hidden"}
          aria-hidden={openerState === "aria-hidden"}
          onClick={() => setOpen(true)}
        >
          開く
        </button>
      )}
      {fallbackVersion !== null && (
        <div ref={fallbackRef} key={fallbackVersion}>
          <button disabled>無効な戻り先</button>
          <button hidden>非表示の戻り先</button>
          <button>戻り先{fallbackVersion}</button>
        </div>
      )}
      <button>保存の再試行</button>
      {open && (
        <Dialog close={() => setOpen(false)} fallbackFocusRef={fallbackRef} />
      )}
    </>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "開く" }));
  expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
    true,
  );
  return user;
}

describe("modal return focus after its opener changes", () => {
  it.each<OpenerState>(["removed", "disabled", "hidden", "aria-hidden"])(
    "uses a live fallback when the opener becomes %s",
    async (openerState) => {
      const view = render(<Host />);
      const user = await openDialog();
      view.rerender(<Host openerState={openerState} />);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "戻り先開始時" }),
      ).toHaveFocus();
    },
  );

  it("keeps a surviving opener ahead of the fallback", async () => {
    const view = render(<Host />);
    const user = await openDialog();
    view.rerender(<Host fallbackVersion="更新後" />);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "開く" })).toHaveFocus();
  });

  it("resolves the current fallback after its original DOM is replaced", async () => {
    const view = render(<Host />);
    const user = await openDialog();
    const previousFallback = screen.getByRole("button", {
      name: "戻り先開始時",
    });
    view.rerender(<Host openerState="removed" fallbackVersion="更新後" />);
    expect(previousFallback.isConnected).toBe(false);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "戻り先更新後" })).toHaveFocus();
  });

  it("does not focus disconnected targets when both opener and fallback disappear", async () => {
    const view = render(<Host />);
    const user = await openDialog();
    view.rerender(<Host openerState="removed" fallbackVersion={null} />);
    await user.keyboard("{Escape}");
    expect(document.body).toHaveFocus();
  });

  it.each([false, true])(
    "preserves deferred save-failure focus priority (failure resolved: %s)",
    async (resolved) => {
      const view = render(<Host />);
      const user = await openDialog();
      view.rerender(<Host openerState="removed" fallbackVersion="更新後" />);
      const retry = screen.getByRole("button", { name: "保存の再試行" });
      act(() =>
        requestModalSafeFocus(
          () => retry,
          () => !resolved,
        ),
      );
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
        true,
      );
      await user.keyboard("{Escape}");
      expect(
        resolved ? screen.getByRole("button", { name: "戻り先更新後" }) : retry,
      ).toHaveFocus();
    },
  );
});

function NestedHost({
  removeOpener = false,
  externalFallback = false,
}: {
  removeOpener?: boolean;
  externalFallback?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const insideRef = useRef<HTMLDivElement>(null);
  const outsideRef = useRef<HTMLDivElement>(null);
  const { dialogRef, onDialogKeyDown } = useModalDialogBehavior({
    isOpen: true,
    onEscape: () => {},
    containExternalFocus: true,
  });
  return (
    <>
      <div ref={outsideRef}>
        <button>親の外の戻り先</button>
      </div>
      <div
        role="dialog"
        aria-label="親"
        ref={dialogRef}
        onKeyDown={onDialogKeyDown}
      >
        {!removeOpener && (
          <button onClick={() => setOpen(true)}>子を開く</button>
        )}
        <div ref={insideRef}>
          <button>親の中の戻り先</button>
        </div>
        {open && (
          <Dialog
            close={() => setOpen(false)}
            fallbackFocusRef={externalFallback ? outsideRef : insideRef}
          />
        )}
      </div>
    </>
  );
}

describe("nested modal return focus after its opener disappears", () => {
  it.each([false, true])(
    "retains the parent focus boundary (external fallback: %s)",
    async (externalFallback) => {
      const user = userEvent.setup();
      const view = render(<NestedHost externalFallback={externalFallback} />);
      const parent = screen.getByRole("dialog", { name: "親" });
      await user.click(
        within(parent).getByRole("button", { name: "子を開く" }),
      );
      view.rerender(
        <NestedHost removeOpener externalFallback={externalFallback} />,
      );
      await user.keyboard("{Escape}");
      expect(screen.getAllByRole("dialog")).toEqual([parent]);
      if (externalFallback) expect(parent).toHaveFocus();
      else
        expect(
          within(parent).getByRole("button", { name: "親の中の戻り先" }),
        ).toHaveFocus();
    },
  );
});
