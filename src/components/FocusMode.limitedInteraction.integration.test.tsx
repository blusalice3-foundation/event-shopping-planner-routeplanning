import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import FocusMode from "./FocusMode";
import {
  incompleteSessionFixture,
  minimalProps,
  singleVisitNoneItemFixture,
} from "./FocusMode.fixtures";
import type { ShoppingItem } from "../types/item";

const items: ShoppingItem[] = [
  {
    ...singleVisitNoneItemFixture.items[0],
    id: "first",
    title: "最初の入力",
    quantity: 5,
  },
  {
    ...singleVisitNoneItemFixture.items[0],
    id: "second",
    title: "次の入力",
    quantity: 5,
  },
  {
    ...singleVisitNoneItemFixture.items[0],
    id: "next",
    number: "02a",
    title: "次の訪問先",
  },
];

function Harness({
  update,
  smartphone = false,
}: {
  update: (item: ShoppingItem) => void;
  smartphone?: boolean;
}) {
  const [currentItems, setItems] = useState(items);
  return (
    <FocusMode
      {...minimalProps({
        items: currentItems,
        executeModeItemIds: items.map((item) => item.id),
        resumeState: incompleteSessionFixture,
        onUpdateItem: (item) => {
          update(item);
          setItems((current) =>
            current.map((candidate) =>
              candidate.id === item.id ? item : candidate,
            ),
          );
        },
      })}
      layoutMode={smartphone ? "smartphone" : "pc"}
    />
  );
}

const inputDialog = () =>
  screen.getByRole("dialog", { name: "限数購入の数量" });
const swipe = (target: HTMLElement, right = false) => {
  const from = { identifier: 1, clientX: right ? 30 : 180, clientY: 80 };
  const to = { ...from, clientX: right ? 180 : 30 };
  fireEvent.touchStart(target, { touches: [from] });
  fireEvent.touchMove(target, { touches: [to] });
  fireEvent.touchEnd(target, { changedTouches: [to] });
};

describe("FocusMode real limited dialog interaction", () => {
  it.each(["limited", "equal", "excess", "defer"])(
    "keeps focus inside consecutive bulk input after %s",
    async (kind) => {
      const user = userEvent.setup();
      const update = vi.fn();
      render(<Harness update={update} />);
      const origin = screen.getByRole("button", { name: "全限数" });
      await user.click(origin);
      const firstDialog = inputDialog();
      const actual = within(firstDialog).getByRole("textbox", {
        name: "実購入数",
      });
      expect(actual).toHaveFocus();
      if (kind === "defer") {
        await user.click(
          within(firstDialog).getByRole("button", {
            name: "この商品を後で入力",
          }),
        );
      } else {
        await user.type(
          actual,
          kind === "limited" ? "2" : kind === "equal" ? "5" : "6",
        );
        await user.click(
          within(firstDialog).getByRole("button", { name: "保存" }),
        );
        if (kind !== "limited") {
          const confirm = screen.getAllByRole("dialog")[1];
          expect(confirm).toContainElement(
            document.activeElement as HTMLElement,
          );
          await user.click(
            within(confirm).getByRole("button", { name: "購入済にする" }),
          );
        }
      }
      const nextDialog = inputDialog();
      expect(nextDialog).toBe(firstDialog);
      expect(
        within(nextDialog).getByText("対象: 次の入力"),
      ).toBeInTheDocument();
      const nextActual = within(nextDialog).getByRole("textbox", {
        name: "実購入数",
      });
      expect(nextActual).toHaveFocus();
      await user.tab();
      expect(
        within(nextDialog).getByRole("textbox", { name: "購入予定量" }),
      ).toHaveFocus();
      await user.tab({ shift: true });
      expect(nextActual).toHaveFocus();
      await user.tab({ shift: true });
      expect(
        within(nextDialog).getByRole("button", { name: "保存" }),
      ).toHaveFocus();
      const accepted = update.mock.calls.length;
      await user.keyboard("{Enter}");
      expect(update).toHaveBeenCalledTimes(accepted);
      expect(screen.getByText("A-01A")).toBeInTheDocument();
      expect(nextDialog).toContainElement(
        document.activeElement as HTMLElement,
      );
      await user.keyboard("{Escape}");
      expect(
        screen.queryByRole("dialog", { name: "限数購入の数量" }),
      ).not.toBeInTheDocument();
      expect(origin).toHaveFocus();
    },
  );

  it("contains smartphone swipes in main and confirmation then restores normal navigation", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    render(<Harness update={update} smartphone />);
    await user.click(screen.getByRole("button", { name: "全限数" }));
    const main = inputDialog();
    swipe(main);
    swipe(main, true);
    expect(screen.getByText("A-01A")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    await user.type(
      within(main).getByRole("textbox", { name: "実購入数" }),
      "5",
    );
    await user.click(within(main).getByRole("button", { name: "保存" }));
    const confirm = screen.getAllByRole("dialog")[1];
    swipe(confirm);
    swipe(confirm, true);
    expect(screen.getByText("A-01A")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    swipe(screen.getByTestId("focus-mode-scroll-region"));
    expect(await screen.findByText("A-02A")).toBeInTheDocument();
  });
});

it("does not resume a gesture cancelled inside a dialog after the dialog closes", async () => {
  const user = userEvent.setup();
  render(<Harness update={vi.fn()} smartphone />);
  const region = screen.getByTestId("focus-mode-scroll-region");
  fireEvent.touchStart(region, {
    touches: [{ identifier: 1, clientX: 180, clientY: 80 }],
  });
  await user.click(screen.getByRole("button", { name: "全限数" }));
  const dialog = inputDialog();
  fireEvent.touchMove(dialog, {
    touches: [{ identifier: 1, clientX: 30, clientY: 80 }],
  });
  fireEvent.touchCancel(dialog, {
    changedTouches: [{ identifier: 1, clientX: 30, clientY: 80 }],
  });
  await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
  fireEvent.touchEnd(region, {
    changedTouches: [{ identifier: 1, clientX: 30, clientY: 80 }],
  });
  expect(screen.getByText("A-01A")).toBeInTheDocument();
  swipe(region);
  expect(await screen.findByText("A-02A")).toBeInTheDocument();
});
