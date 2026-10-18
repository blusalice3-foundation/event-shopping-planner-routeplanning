// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { FocusModeSessionState } from "../types/focus";
import type { ShoppingItem } from "../types/item";
import FocusMode from "./FocusMode";
import {
  completedFixture,
  minimalProps,
  singleVisitNoneItemFixture,
} from "./FocusMode.fixtures";

describe("FocusMode TICKET-05 resume completion semantics", () => {
  it("does not render the completion screen until the pointer resume choice is selected", async () => {
    render(
      <FocusMode
        {...minimalProps({
          resumeState: completedFixture,
          ...singleVisitNoneItemFixture,
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText("全ての訪問先を確認しました")).toBeNull();
    });
  });
});

const phaseItem = (
  id: string,
  number: string,
  purchaseStatus: ShoppingItem["purchaseStatus"],
): ShoppingItem => ({
  ...singleVisitNoneItemFixture.items[0],
  id,
  number,
  title: id,
  circle: id,
  purchaseStatus,
});
const postponedSession: FocusModeSessionState = {
  ...completedFixture,
  phase: "postponed",
  isCompleted: false,
  postponedItemIds: ["後回し対象"],
  lateItemIds: ["遅参対象"],
};

describe("OP09 actual FocusMode phase recovery", () => {
  it.each([true, false])(
    "leaves the postponed phase after its last target is deleted (late remains: %s)",
    async (hasLate) => {
      const normal = phaseItem("通常対象", "01a", "None");
      const postponed = phaseItem("後回し対象", "02a", "Postpone");
      const late = phaseItem("遅参対象", "03a", "Late");
      const initial = [normal, postponed, ...(hasLate ? [late] : [])];
      const onSessionStateChange = vi.fn();
      const onUpdateItem = vi.fn();
      const props = (items: ShoppingItem[]) =>
        minimalProps({
          items,
          executeModeItemIds: items.map((item) => item.id),
          resumeState: postponedSession,
          onSessionStateChange,
          onUpdateItem,
        });
      const view = render(<FocusMode {...props(initial)} />);
      await screen.findAllByText("後回し対象", { exact: true });
      const before = onSessionStateChange.mock.calls.length;
      view.rerender(
        <FocusMode {...props(initial.filter((item) => item !== postponed))} />,
      );
      if (hasLate) {
        await screen.findAllByText("遅参対象", { exact: true });
        expect(screen.queryByText("全ての訪問先を確認しました")).toBeNull();
        await waitFor(() =>
          expect(onSessionStateChange.mock.calls.at(-1)?.[0]).toMatchObject({
            phase: "late",
            isCompleted: false,
            postponedItemIds: [],
            lateItemIds: ["遅参対象"],
          }),
        );
      } else {
        await screen.findByText("全ての訪問先を確認しました");
        await waitFor(() =>
          expect(onSessionStateChange.mock.calls.at(-1)?.[0]).toMatchObject({
            isCompleted: true,
            postponedItemIds: [],
            lateItemIds: [],
          }),
        );
      }
      const later = onSessionStateChange.mock.calls
        .slice(before)
        .map(([state]) => state as FocusModeSessionState);
      expect(
        later.filter((state) => state.phase === "late" || state.isCompleted)
          .length,
      ).toBeLessThanOrEqual(2);
      expect(onUpdateItem).not.toHaveBeenCalled();
    },
  );

  it("waits for initial resume synchronization before replacing obsolete postponed targets", async () => {
    const items = [
      phaseItem("通常対象", "01a", "None"),
      phaseItem("新しい後回し対象", "02a", "Postpone"),
    ];
    const onSessionStateChange = vi.fn();
    render(
      <FocusMode
        {...minimalProps({
          items,
          executeModeItemIds: items.map((item) => item.id),
          resumeState: postponedSession,
          onSessionStateChange,
        })}
      />,
    );
    await screen.findAllByText("新しい後回し対象", { exact: true });
    await waitFor(() =>
      expect(onSessionStateChange.mock.calls.at(-1)?.[0]).toMatchObject({
        phase: "postponed",
        isCompleted: false,
        postponedItemIds: ["新しい後回し対象"],
        lateItemIds: [],
      }),
    );
    expect(screen.queryByText("全ての訪問先を確認しました")).toBeNull();
    expect(
      onSessionStateChange.mock.calls.some(([state]) => state.isCompleted),
    ).toBe(false);
  });

  it("does not advance while a newly received resume choice synchronizes obsolete targets", async () => {
    const items = [
      phaseItem("通常対象", "01a", "None"),
      phaseItem("新しい後回し対象", "02a", "Postpone"),
    ];
    const onSessionStateChange = vi.fn();
    const base = minimalProps({
      items,
      executeModeItemIds: items.map((item) => item.id),
      onSessionStateChange,
    });
    const view = render(<FocusMode {...base} />);
    const resume: FocusModeSessionState = {
      ...postponedSession,
      lastPurchaseChangeAt: {
        phase: "postponed",
        phaseIndex: 0,
        visitKey: "obsolete",
      },
    };
    view.rerender(<FocusMode {...base} resumeState={resume} />);
    await screen.findByText("集中モードを再開しますか？");
    expect(screen.queryByText("全ての訪問先を確認しました")).toBeNull();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /離脱時のポインタ位置/ }),
    );
    await screen.findAllByText("新しい後回し対象", { exact: true });
    await waitFor(() =>
      expect(onSessionStateChange.mock.calls.at(-1)?.[0]).toMatchObject({
        phase: "postponed",
        isCompleted: false,
        postponedItemIds: ["新しい後回し対象"],
      }),
    );
    expect(
      onSessionStateChange.mock.calls.some(([state]) => state.isCompleted),
    ).toBe(false);
  });
});
