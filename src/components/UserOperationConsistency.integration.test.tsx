// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  TemporaryPhaseChoiceDialog,
  TemporaryRemainingSpacesDialog,
} from "./focus/FocusModeDialogs";
import { useAutoSkipEmptyVisit } from "./focus/hooks/useAutoSkipEmptyVisit";
afterEach(cleanup);
it.each(["choice", "remaining"])(
  "keeps Tab and Enter within the temporary %s dialog",
  async (kind) => {
    const user = userEvent.setup();
    const background = vi.fn(),
      cancel = vi.fn();
    render(
      <>
        <button onClick={background}>背景操作</button>
        {kind === "choice" ? (
          <TemporaryPhaseChoiceDialog
            isOpen
            title="巡回先"
            choices={[]}
            onSelect={vi.fn()}
            onCancel={cancel}
          />
        ) : (
          <TemporaryRemainingSpacesDialog
            isOpen
            sections={[]}
            onSelect={vi.fn()}
            onEnd={vi.fn()}
            onCancel={cancel}
          />
        )}
      </>,
    );
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard("{Enter}");
    expect(background).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  },
);
it("waits for resume readiness, then recovers consecutive empty formal phases", () => {
  const finishPhase = vi.fn();
  const setIndex = vi.fn();
  const props = {
    paused: true,
    isCompleted: false,
    allVisitsLength: 2,
    currentVisitDisplayItemsLength: 0,
    currentPhaseVisits: [],
    currentPhaseIndex: 0,
    currentPhase: "postponed" as const,
    postponedPhaseItemIds: new Set<string>(),
    latePhaseItemIds: new Set<string>(),
    executeItems: [],
    isResumeChoiceOpen: false,
    clearAutoAdvanceTimer: vi.fn(),
    setPostponedPhaseItemIds: vi.fn(),
    setLatePhaseItemIds: vi.fn(),
    setNotification: vi.fn(),
    setCurrentPhase: vi.fn(),
    setCurrentPhaseIndex: setIndex,
    setIsCompleted: vi.fn(),
    finishPhase,
  };
  const { result, rerender } = renderHook(
    (p: { paused: boolean; currentPhase: "postponed" | "late" }) =>
      useAutoSkipEmptyVisit({ ...props, ...p }),
    { initialProps: { paused: true, currentPhase: "postponed" } },
  );
  expect(finishPhase).not.toHaveBeenCalled();
  expect(result.current).toBe(false);
  act(() => rerender({ paused: false, currentPhase: "postponed" }));
  expect(finishPhase).toHaveBeenCalledTimes(1);
  act(() => rerender({ paused: false, currentPhase: "late" }));
  expect(finishPhase).toHaveBeenCalledTimes(2);
  expect(setIndex).not.toHaveBeenCalled();
});
