import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FocusMode from "./FocusMode";
import {
  incompleteSessionFixture,
  minimalProps,
  singleVisitNoneItemFixture,
} from "./FocusMode.fixtures";
import type { FocusModeSessionState, FocusPhase } from "../types/focus";
import type { ShoppingItem } from "../types/item";

const cases = [
  ["normal", "None", "通常"],
  ["postponed", "Postpone", "後回し"],
  ["late", "Late", "遅参"],
] as const;

const next = () =>
  fireEvent.click(screen.getByRole("button", { name: "次の訪問先へ移動" }));
const previous = () =>
  fireEvent.click(screen.getByRole("button", { name: "前の訪問先へ移動" }));

const createItems = (status: ShoppingItem["purchaseStatus"]) =>
  [1, 2, 3, 4].map((number) => ({
    ...singleVisitNoneItemFixture.items[0],
    id: `visit-${number}`,
    number: `0${number}a`,
    title: `訪問${number}`,
    purchaseStatus: number === 4 ? ("None" as const) : status,
  }));

async function enterPhase(phase: FocusPhase) {
  if (phase === "normal") return;
  fireEvent.change(screen.getByRole("combobox", { name: "phase" }), {
    target: { value: phase },
  });
  fireEvent.click(await screen.findByRole("button", { name: /最初から開始/ }));
}

describe("FocusMode visit removal position recovery", () => {
  it.each(cases)(
    "keeps %s display, navigation and resumed position aligned after removing its last visit",
    async (phase, status, label) => {
      let items = createItems(status);
      const onSessionStateChange =
        vi.fn<(state: FocusModeSessionState) => void>();
      const props = () =>
        minimalProps({
          items,
          executeModeItemIds: items.map((item) => item.id),
          resumeState: incompleteSessionFixture,
          onSessionStateChange,
        });
      const view = render(<FocusMode {...props()} />);
      await enterPhase(phase);
      next();
      next();
      expect(await screen.findByText("訪問3")).toBeInTheDocument();

      // The normal phase includes the fourth, unrelated visit. Remove both trailing visits.
      items = items.filter(
        (item) =>
          item.id !== "visit-3" &&
          (phase !== "normal" || item.id !== "visit-4"),
      );
      view.rerender(<FocusMode {...props()} />);
      expect(await screen.findByText("訪問2")).toBeInTheDocument();
      expect(screen.getByText(`${label}: 2/2`)).toBeInTheDocument();
      await waitFor(() =>
        expect(onSessionStateChange.mock.calls.at(-1)?.[0]).toMatchObject({
          phase,
          phaseIndex: 1,
          savedPhaseIndices: { [phase]: 1 },
        }),
      );
      const savedPosition = onSessionStateChange.mock.calls.at(-1)![0];

      previous();
      expect(await screen.findByText("訪問1")).toBeInTheDocument();
      expect(screen.getByText(`${label}: 1/2`)).toBeInTheDocument();

      view.unmount();
      render(
        <FocusMode
          {...minimalProps({
            items,
            executeModeItemIds: items.map((item) => item.id),
            resumeState: savedPosition,
          })}
        />,
      );

      expect(await screen.findByText("訪問2")).toBeInTheDocument();
      expect(screen.getByText(`${label}: 2/2`)).toBeInTheDocument();
      previous();
      expect(await screen.findByText("訪問1")).toBeInTheDocument();
    },
  );
});
