import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PersistenceCommandPort } from "../../../app/ports/PersistenceCommandPort";
import {
  emptyApplicationSnapshot,
  useApplicationSnapshot,
} from "../../../app/state/useApplicationSnapshot";
import BackupRestoreDialog from "../../../components/BackupRestoreDialog";
import { useModalDialogBehavior } from "../../../hooks/useModalDialogBehavior";
import { requestModalSafeFocus } from "../../../utils/modalFocusBoundary";
import { MutationConfirmationDialog } from "./MutationConfirmationDialog";

function harness({ layeredRestore = false } = {}) {
  const current = { ...emptyApplicationSnapshot(), eventLists: { event: [] } };
  const commit = vi.fn(async () => {});
  const port = {
    readApplicationSnapshot: async () => ({
      snapshot: structuredClone(current),
      expectedRoots: {},
      consistencyMissing: false,
    }),
    commitApplicationSnapshotAtomically: commit,
    bindApplicationSettings: () => () => {},
  } as unknown as PersistenceCommandPort;
  let application!: ReturnType<typeof useApplicationSnapshot>;
  let showNested!: (open: boolean) => void;
  let showRestore!: (open: boolean) => void;
  const restore = vi.fn(async () => showRestore(false));
  function Nested({ close }: { close(): void }) {
    const { dialogRef, onDialogKeyDown } = useModalDialogBehavior({
      isOpen: true,
      onEscape: close,
      containExternalFocus: true,
    });
    return (
      <div
        role="dialog"
        aria-label="入れ子"
        ref={dialogRef}
        onKeyDown={onDialogKeyDown}
      >
        <button onClick={close}>内側を閉じる</button>
      </div>
    );
  }
  function Host() {
    const app = useApplicationSnapshot(port, "event", "1日目");
    application = app;
    const retryRef = useRef<HTMLButtonElement>(null);
    const latestFailures = useRef(app.retryableFailures);
    latestFailures.current = app.retryableFailures;
    const [nested, setNested] = useState(false);
    showNested = setNested;
    const [restoreOpen, setRestoreOpen] = useState(false);
    showRestore = setRestoreOpen;
    useEffect(() => {
      const failures = app.retryableFailures;
      if (failures.length)
        requestModalSafeFocus(
          () => retryRef.current,
          () => latestFailures.current === failures && failures.length > 0,
        );
    }, [app.retryableFailures]);
    const begin = (id: string) => {
      void application
        .request({
          id,
          events: ["event"],
          plan: (snapshot) => ({
            snapshot,
            confirmation: {
              title: `確認${id}`,
              details: ["ユーザー登録"],
              comparison: id,
            },
          }),
        })
        .catch(() => {});
    };
    return (
      <>
        <button
          onClick={() => {
            begin("A");
            begin("B");
          }}
        >
          確認を開く
        </button>
        <button>画面の別操作</button>
        {app.retryableFailures.length > 0 && (
          <button ref={retryRef} onClick={app.retryPending}>
            保留の再試行
          </button>
        )}
        {layeredRestore && (
          <style>{`
            .z-\\[21000\\] { position: fixed; z-index: 21000; }
            .z-\\[100\\] { position: fixed; z-index: 100; }
          `}</style>
        )}
        <MutationConfirmationDialog application={app} />
        {nested && <Nested close={() => setNested(false)} />}
        <BackupRestoreDialog
          isOpen={restoreOpen}
          backupEventNames={["復元元"]}
          currentEventNames={["event"]}
          onClose={() => setRestoreOpen(false)}
          onRestore={restore}
        />
      </>
    );
  }
  const view = render(<Host />);
  return {
    ...view,
    app: () => application,
    commit,
    showNested: (open: boolean) => showNested(open),
    showRestore: (open: boolean) => showRestore(open),
    restore,
  };
}

describe("real mutation confirmation keyboard and failure focus", () => {
  it("keeps a late lower restore behind A to B until both confirmations close", async () => {
    const h = harness({ layeredRestore: true });
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "確認を開く" });
    await user.click(opener);
    const first = await screen.findByRole("dialog", { name: "確認A" });
    const initialFocus = document.activeElement;
    act(() => h.showRestore(true));
    const backup = screen.getByRole("dialog", {
      name: "バックアップからイベントを復元",
    });
    expect(getComputedStyle(first).zIndex).toBe("21000");
    expect(getComputedStyle(backup.parentElement!).zIndex).toBe("100");
    expect(document.activeElement).toBe(initialFocus);
    for (let index = 0; index < 8; index++) {
      await user.tab();
      expect(first).toContainElement(document.activeElement as HTMLElement);
    }
    within(backup).getByRole("button", { name: "別名で復元" }).focus();
    expect(first).toContainElement(document.activeElement as HTMLElement);
    await user.tab();
    await user.tab();
    expect(within(first).getByRole("button", { name: "取消" })).toHaveFocus();
    await user.keyboard("{Enter}");
    const second = await screen.findByRole("dialog", { name: "確認B" });
    expect(second).toBe(first);
    expect(h.restore).not.toHaveBeenCalled();
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(second).toContainElement(document.activeElement as HTMLElement);
    expect(h.app().confirmations).toHaveLength(1);
    expect(h.restore).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "確認B" }),
    ).not.toBeInTheDocument();
    expect(backup).toContainElement(document.activeElement as HTMLElement);
    const restoreButton = within(backup).getByRole("button", {
      name: "別名で復元",
    });
    for (
      let index = 0;
      document.activeElement !== restoreButton && index < 12;
      index++
    ) {
      await user.tab();
      expect(backup).toContainElement(document.activeElement as HTMLElement);
    }
    expect(restoreButton).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(h.restore).toHaveBeenCalledOnce();
    expect(h.commit).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  it("keeps one host through A to B, traps Tab/Shift+Tab and restores the original opener", async () => {
    const h = harness();
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "確認を開く" });
    await user.click(opener);
    const first = await screen.findByRole("dialog", { name: "確認A" });
    expect(first.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(
      within(first).getByRole("button", { name: "確認して保存" }),
    ).toHaveFocus();
    await user.tab();
    expect(
      within(first).getByRole("region", { name: "確認内容" }),
    ).toHaveFocus();
    await user.keyboard("{Escape}");
    const second = await screen.findByRole("dialog", { name: "確認B" });
    expect(second).toBe(first);
    expect(second.contains(document.activeElement)).toBe(true);
    screen.getByRole("button", { name: "画面の別操作" }).focus();
    expect(second.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it("keeps focus inside while confirm is busy and every action button is disabled", async () => {
    const h = harness();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "確認を開く" }));
    const dialog = await screen.findByRole("dialog", { name: "確認A" });
    let release!: () => void;
    h.app().handlers.current.drain = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    await user.click(
      within(dialog).getByRole("button", { name: "確認して保存" }),
    );
    await waitFor(() => expect(dialog).toHaveAttribute("aria-busy", "true"));
    for (const button of within(dialog).getAllByRole("button"))
      expect(button).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog).toHaveAccessibleName("確認A");
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    h.app().handlers.current.drain = async () => {};
    await act(async () => {
      release();
    });
    await screen.findByRole("dialog", { name: "確認B" });
    await user.keyboard("{Escape}");
  });

  it.each([false, true])(
    "defers late save failure focus until all modals close (resolved first: %s)",
    async (resolveFirst) => {
      const h = harness();
      const user = userEvent.setup();
      const opener = screen.getByRole("button", { name: "確認を開く" });
      await user.click(opener);
      const first = await screen.findByRole("dialog", { name: "確認A" });
      h.commit.mockRejectedValueOnce(
        new DOMException("保存失敗", "AbortError"),
      );
      act(() => h.app().setters.setDayModes({ event: { "1日目": "execute" } }));
      await screen.findByRole("button", { name: "保留の再試行" });
      expect(first.contains(document.activeElement)).toBe(true);
      if (resolveFirst) act(() => h.app().discardPending());
      await user.keyboard("{Escape}");
      const second = await screen.findByRole("dialog", { name: "確認B" });
      expect(second.contains(document.activeElement)).toBe(true);
      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          resolveFirst
            ? opener
            : screen.getByRole("button", { name: "保留の再試行" }),
        ).toHaveFocus(),
      );
    },
  );

  it("lets only the nested modal handle Escape and restores focus within its parent", async () => {
    const h = harness();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "確認を開く" }));
    const outer = await screen.findByRole("dialog", { name: "確認A" });
    act(() => h.showNested(true));
    const nested = screen.getByRole("dialog", { name: "入れ子" });
    screen.getByRole("button", { name: "画面の別操作" }).focus();
    expect(nested.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "入れ子" }),
    ).not.toBeInTheDocument();
    expect(outer.contains(document.activeElement)).toBe(true);
    expect(outer).toHaveAccessibleName("確認A");
    await user.keyboard("{Escape}");
    await screen.findByRole("dialog", { name: "確認B" });
    await user.keyboard("{Escape}");
  });

  it("restores the parent dialog when its original focused button is still disabled", async () => {
    const h = harness();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "確認を開く" }));
    const outer = await screen.findByRole("dialog", { name: "確認A" });
    let release!: () => void;
    h.app().handlers.current.drain = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    await user.click(
      within(outer).getByRole("button", { name: "確認して保存" }),
    );
    await waitFor(() => expect(outer).toHaveAttribute("aria-busy", "true"));
    act(() => h.showNested(true));
    await user.keyboard("{Escape}");
    expect(outer.contains(document.activeElement)).toBe(true);
    h.app().handlers.current.drain = async () => {};
    await act(async () => {
      release();
    });
    await screen.findByRole("dialog", { name: "確認B" });
    await user.keyboard("{Escape}");
  });

  it("preserves legacy explicit external navigation while keeping the default modal Tab trap", async () => {
    function LegacyDialog() {
      const { dialogRef, onDialogKeyDown } = useModalDialogBehavior({
        isOpen: true,
        onEscape: () => {},
      });
      return (
        <div
          role="dialog"
          aria-label="既存の品目追加"
          ref={dialogRef}
          onKeyDown={onDialogKeyDown}
        >
          <button>既存の先頭入力</button>
          <button>既存の末尾入力</button>
        </div>
      );
    }
    render(
      <>
        <button>既存の日付移動</button>
        <LegacyDialog />
      </>,
    );
    const user = userEvent.setup();
    const external = screen.getByRole("button", { name: "既存の日付移動" });
    external.focus();
    expect(external).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "既存の末尾入力" }));
    await user.tab();
    expect(
      screen.getByRole("button", { name: "既存の先頭入力" }),
    ).toHaveFocus();
    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "既存の末尾入力" }),
    ).toHaveFocus();
  });
});
