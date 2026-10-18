// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LimitedPurchaseDialog from "./LimitedPurchaseDialog";

const renderDialog = (
  props: Partial<ComponentProps<typeof LimitedPurchaseDialog>> = {},
) => {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();

  render(
    <LimitedPurchaseDialog
      isOpen
      itemId="item-1"
      itemTitle="target item"
      initialPlanned={5}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />,
  );

  return { onSubmit, onCancel };
};

const getDialogInputs = () => {
  const dialog = screen.getByRole("dialog");
  const inputs = within(dialog).getAllByRole("textbox") as HTMLInputElement[];
  return {
    actualInput: inputs[0],
    plannedInput: inputs[1],
    dialog,
  };
};

const clickPrimaryButton = async (user: ReturnType<typeof userEvent.setup>) => {
  const dialog = screen.getByRole("dialog");
  const buttons = within(dialog).getAllByRole("button");
  await user.click(buttons[buttons.length - 1]);
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LimitedPurchaseDialog", () => {
  it("prioritizes actual quantity errors when both fields are empty", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({ initialPlanned: 5 });
    const { actualInput, plannedInput, dialog } = getDialogInputs();

    await user.clear(actualInput);
    await user.clear(plannedInput);
    await clickPrimaryButton(user);

    expect(
      within(dialog).getByText("実購入数を入力してください"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("treats non-decimal actual input as an integer error instead of blank", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();
    const { actualInput, plannedInput, dialog } = getDialogInputs();

    await user.type(actualInput, "abc");
    await user.clear(plannedInput);
    await clickPrimaryButton(user);

    expect(
      within(dialog).getByText("実購入数は整数で入力してください"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("defers with only planned quantity validation", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({ showDeferButton: true });
    const { actualInput, plannedInput, dialog } = getDialogInputs();

    await user.type(actualInput, "abc");
    await user.clear(plannedInput);
    await user.type(plannedInput, "06");
    await user.click(within(dialog).getAllByRole("button")[0]);

    expect(onSubmit).toHaveBeenCalledWith({
      kind: "defer",
      planned: 6,
      plannedEdited: true,
      baselinePlanned: 5,
      observedPlanned: 5,
    });
  });

  it("converts to purchased after app confirmation when actual equals planned", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    const { onSubmit } = renderDialog();
    const { actualInput } = getDialogInputs();

    await user.type(actualInput, "5");
    await clickPrimaryButton(user);

    const confirmDialog = screen.getByRole("dialog", {
      name: "購入済として保存しますか？",
    });
    expect(confirmDialog).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
    await user.click(
      within(confirmDialog).getByRole("button", { name: "購入済にする" }),
    );

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "purchased",
        planned: 5,
        actual: expect.any(Number),
        plannedEdited: false,
        baselinePlanned: 5,
        observedPlanned: 5,
      }),
    );
  });

  it("blocks saving and deferring when planned quantity is 1", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({
      initialPlanned: 1,
      showDeferButton: true,
    });
    const { actualInput, dialog } = getDialogInputs();

    await user.type(actualInput, "2");
    await clickPrimaryButton(user);

    expect(
      within(dialog).getByText(
        "限数として保存するには、購入予定数を2以上に変更してください。",
      ),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: "この商品を後で入力" }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows custom excess confirmation and can return to the input dialog", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();
    const { actualInput } = getDialogInputs();

    await user.type(actualInput, "6");
    await clickPrimaryButton(user);

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);

    const excessDialog = dialogs[1];
    const excessButtons = within(excessDialog).getAllByRole("button");
    expect(excessButtons).toHaveLength(2);

    await user.click(excessButtons[0]);

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("converts to purchased from the custom excess confirmation", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();
    const { actualInput } = getDialogInputs();

    await user.type(actualInput, "8");
    await clickPrimaryButton(user);

    const excessDialog = screen.getAllByRole("dialog")[1];
    await user.click(within(excessDialog).getAllByRole("button")[1]);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "purchased",
        planned: 5,
        actual: expect.any(Number),
        plannedEdited: false,
        baselinePlanned: 5,
        observedPlanned: 5,
      }),
    );
  });

  it("resets inputs when the target item changes even if quantities are similar", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <LimitedPurchaseDialog
        isOpen
        itemId="item-a"
        initialActual={1}
        initialPlanned={5}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    let inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs[0]).toHaveValue("1");
    expect(inputs[1]).toHaveValue("5");

    await user.clear(inputs[0]);
    await user.type(inputs[0], "9");

    rerender(
      <LimitedPurchaseDialog
        isOpen
        itemId="item-b"
        initialActual={2}
        initialPlanned={6}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs[0]).toHaveValue("2");
    expect(inputs[1]).toHaveValue("6");
  });
});

it.each([5, 6])(
  "preserves actual %i and invalidates an old equal/excess confirmation after an external planned change",
  async (actual) => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const props = {
      isOpen: true,
      itemId: "1",
      initialPlanned: 5,
      onSubmit: submit,
      onCancel: vi.fn(),
    };
    const rendered = render(<LimitedPurchaseDialog {...props} />);
    await user.type(screen.getAllByRole("textbox")[0], String(actual));
    await clickPrimaryButton(user);
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    rendered.rerender(<LimitedPurchaseDialog {...props} initialPlanned={9} />);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getAllByRole("textbox")[0]).toHaveValue(String(actual));
    expect(screen.getAllByRole("textbox")[0]).toHaveFocus();
    expect(screen.getAllByRole("textbox")[1]).toHaveValue("9");
    expect(submit).not.toHaveBeenCalled();
    await clickPrimaryButton(user);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "limited",
        actual,
        planned: 9,
        plannedEdited: false,
        baselinePlanned: 5,
      }),
    );
  },
);

it("keeps Tab inside the main input and handles one Escape only once", async () => {
  const user = userEvent.setup();
  const { onCancel } = renderDialog({ showDeferButton: true });
  const { actualInput, plannedInput, dialog } = getDialogInputs();
  const saveButton = within(dialog).getByRole("button", { name: "保存" });
  expect(actualInput).toHaveFocus();
  await user.tab({ shift: true });
  expect(saveButton).toHaveFocus();
  await user.tab();
  expect(actualInput).toHaveFocus();
  await user.tab();
  expect(plannedInput).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it.each(["5", "6"])(
  "returns from confirmation %s to Save without a delayed focus request",
  async (actual) => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();
    const { actualInput, dialog } = getDialogInputs();
    await user.type(actualInput, actual);
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    const confirm = screen.getAllByRole("dialog")[1];
    expect(confirm).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "保存" })).toHaveFocus();
    expect(onCancel).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  },
);

it("preserves edited planned intent and focuses actual after confirmation expires", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  const props = {
    isOpen: true,
    itemId: "1",
    initialPlanned: 5,
    onSubmit,
    onCancel: vi.fn(),
  };
  const { rerender } = render(<LimitedPurchaseDialog {...props} />);
  const { actualInput, plannedInput, dialog } = getDialogInputs();
  await user.type(actualInput, "6");
  await user.clear(plannedInput);
  await user.type(plannedInput, "6");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  const expiredConfirm = screen.getByRole("button", { name: "購入済にする" });
  rerender(<LimitedPurchaseDialog {...props} initialPlanned={9} />);
  expect(actualInput).toHaveFocus();
  expect(actualInput).toHaveValue("6");
  expect(plannedInput).toHaveValue("6");
  fireEvent.click(expiredConfirm);
  expect(onSubmit).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  await user.click(screen.getByRole("button", { name: "購入済にする" }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "purchased",
      planned: 6,
      plannedEdited: true,
      baselinePlanned: 5,
      observedPlanned: 9,
    }),
  );
});

it("stops all touch phases in the main dialog and its sibling confirmation", async () => {
  const user = userEvent.setup();
  const onTouch = vi.fn();
  render(
    <div
      onTouchStart={onTouch}
      onTouchMove={onTouch}
      onTouchEnd={onTouch}
      onTouchCancel={onTouch}
    >
      <LimitedPurchaseDialog
        isOpen
        initialPlanned={5}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    </div>,
  );
  const { actualInput, dialog } = getDialogInputs();
  const touch = { identifier: 1, clientX: 120, clientY: 50 };
  for (const target of [actualInput, dialog]) {
    expect(fireEvent.touchStart(target, { touches: [touch] })).toBe(true);
    expect(
      fireEvent.touchMove(target, { touches: [{ ...touch, clientX: 20 }] }),
    ).toBe(true);
    expect(fireEvent.touchEnd(target, { changedTouches: [touch] })).toBe(true);
    expect(fireEvent.touchCancel(target, { changedTouches: [touch] })).toBe(
      true,
    );
  }
  await user.type(actualInput, "5");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  const confirm = screen.getAllByRole("dialog")[1];
  fireEvent.touchStart(confirm, { touches: [touch] });
  fireEvent.touchMove(confirm, { touches: [{ ...touch, clientX: 20 }] });
  fireEvent.touchEnd(confirm, { changedTouches: [touch] });
  fireEvent.touchCancel(confirm, { changedTouches: [touch] });
  expect(onTouch).not.toHaveBeenCalled();
});

it("closes only confirmation when Escape is dispatched to the main root during confirmation", () => {
  const { onCancel } = renderDialog();
  const { actualInput, dialog } = getDialogInputs();
  fireEvent.change(actualInput, { target: { value: "5" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(onCancel).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("button", { name: "保存" })).toHaveFocus();
});

it.each(["next", "reconfirm", "reopen"])(
  "does not let cancelled-confirmation focus steal from %s",
  (transition) => {
    vi.useFakeTimers();
    const props = {
      isOpen: true,
      itemId: "first",
      initialPlanned: 5,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = render(<LimitedPurchaseDialog {...props} />);
    const { actualInput, dialog } = getDialogInputs();
    fireEvent.change(actualInput, { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "入力に戻る" }));
    if (transition === "next") {
      rerender(<LimitedPurchaseDialog {...props} itemId="second" />);
    } else if (transition === "reconfirm") {
      fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    } else {
      rerender(<LimitedPurchaseDialog {...props} isOpen={false} />);
      rerender(<LimitedPurchaseDialog {...props} />);
    }
    const focus = document.activeElement;
    vi.advanceTimersByTime(0);
    expect(document.activeElement).toBe(focus);
    if (transition === "reconfirm") {
      expect(
        screen.getByRole("button", { name: "購入済にする" }),
      ).toHaveFocus();
    } else {
      expect(screen.getByRole("textbox", { name: "実購入数" })).toHaveFocus();
    }
  },
);
