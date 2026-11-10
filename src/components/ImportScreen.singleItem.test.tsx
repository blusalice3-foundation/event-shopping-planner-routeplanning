// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem } from "../types/item";
import type { BulkImportResult } from "../types/import";
import ImportScreen from "./ImportScreen";

type Props = ComponentProps<typeof ImportScreen>;
const item: ShoppingItem = {
  id: "existing",
  circle: "",
  title: "既存タイトル",
  eventDate: "1日目",
  block: "A",
  number: "1",
  price: null,
  quantity: 1,
  purchaseStatus: "None",
  remarks: "保持する備考",
};
const setup = (overrides: Partial<Props> = {}) => {
  const onBulkAdd = vi.fn<Props["onBulkAdd"]>(async () => ({
    status: "saved",
  }));
  const props: Props = {
    activeEventName: "イベント",
    itemToEdit: null,
    onBulkAdd,
    onUpdateItem: vi.fn(),
    onDoneEditing: vi.fn(),
    ...overrides,
  };
  const view = render(<ImportScreen {...props} />);
  return { ...view, props, onBulkAdd };
};
const circle = () =>
  screen.getByRole("textbox", { name: "サークル名（必須）" });
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "リストに追加" }));

afterEach(() => vi.restoreAllMocks());

describe("ImportScreen single item circle requirement", () => {
  it.each(["", "   ", "　　"])(
    "rejects a title-only item with circle %j, associates the error and retains all inputs",
    (value) => {
      const h = setup({
        newItemDefaults: { eventDate: "2日目", block: "東A", number: "12a" },
      });
      const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
      fireEvent.change(circle(), { target: { value } });
      change("タイトル", "保持するタイトル");
      change("備考", "保持するメモ");
      change("URL", "https://example.test");
      submit();
      expect(h.onBulkAdd).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
      expect(circle()).toBeRequired();
      expect(circle()).toHaveAttribute("aria-invalid", "true");
      expect(circle()).toHaveAttribute("aria-describedby", "singleCircleError");
      expect(circle()).toHaveFocus();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "サークル名を入力してください。",
      );
      expect(circle()).toHaveValue(value);
      expect(screen.getByLabelText("タイトル")).toHaveValue("保持するタイトル");
      expect(screen.getByLabelText("備考")).toHaveValue("保持するメモ");
      expect(screen.getByLabelText("URL")).toHaveValue("https://example.test");
      expect(screen.getByLabelText("参加日")).toHaveValue("2日目");
      expect(screen.getByLabelText("ブロック")).toHaveValue("東A");
      expect(screen.getByLabelText("ナンバー")).toHaveValue("12a");
      change("タイトル", "次のタイトル");
      expect(screen.getByRole("alert")).toBeVisible();
      fireEvent.change(circle(), { target: { value: "　日本語サークル　" } });
      expect(circle()).toHaveValue("　日本語サークル　");
      expect(circle()).not.toHaveAttribute("aria-invalid");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("accepts a Japanese circle without a title and resets only after a saved result", async () => {
    const h = setup({
      newItemDefaults: { eventDate: "2日目", block: "東A", number: "12a" },
    });
    submit();
    fireEvent.change(circle(), { target: { value: "　日本語サークル　" } });
    change("備考", " メモ ");
    change("URL", "https://example.test/item");
    submit();
    await waitFor(() => expect(h.onBulkAdd).toHaveBeenCalledOnce());
    expect(h.onBulkAdd.mock.calls[0]).toEqual([
      "イベント",
      [
        {
          circle: "日本語サークル",
          title: "",
          eventDate: "2日目",
          block: "東A",
          number: "12a",
          price: 0,
          quantity: 1,
          remarks: "メモ",
          url: "https://example.test/item",
        },
      ],
      expect.objectContaining({
        source: "app",
        request: expect.objectContaining({ isCurrent: expect.any(Function) }),
      }),
    ]);
    await waitFor(() => expect(circle()).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the existing title-only edit condition and does not add a single-item requirement to a new import", async () => {
    const h = setup({ itemToEdit: item });
    const input = screen.getByRole("textbox", {
      name: "サークル名",
    });
    expect(input).not.toBeRequired();
    expect(screen.queryByText("サークル名（必須）")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "アイテムを更新" }));
    expect(h.props.onUpdateItem).toHaveBeenCalledWith(item);
    expect(h.onBulkAdd).not.toHaveBeenCalled();
    h.rerender(
      <ImportScreen {...h.props} activeEventName={null} itemToEdit={null} />,
    );
    expect(
      screen.queryByRole("textbox", {
        name: "サークル名（必須）",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("M列 サークル名")).not.toBeRequired();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["event", "edit", "new", "map"] as const)(
    "clears the local error when the %s target or input mode changes",
    (target) => {
      const h = setup();
      submit();
      expect(screen.getByRole("alert")).toBeVisible();
      const next: Props = {
        ...h.props,
        ...(target === "event" ? { activeEventName: "別イベント" } : {}),
        ...(target === "edit" ? { itemToEdit: item } : {}),
        ...(target === "new" ? { activeEventName: null } : {}),
        ...(target === "map"
          ? { newItemDefaults: { eventDate: "3日目", block: "B", number: "3" } }
          : {}),
      };
      h.rerender(<ImportScreen {...next} />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(h.onBulkAdd).not.toHaveBeenCalled();
      if (target === "map") {
        expect(screen.getByLabelText("参加日")).toHaveValue("3日目");
        expect(screen.getByLabelText("ブロック")).toHaveValue("B");
        expect(screen.getByLabelText("ナンバー")).toHaveValue("3");
      }
    },
  );

  it.each(["cancelled", "failed"] as const)(
    "retains input after %s, prevents a duplicate pending submission and allows retry",
    async (status) => {
      let finish!: (value: BulkImportResult) => void;
      const add = vi
        .fn<Props["onBulkAdd"]>()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValue({ status: "saved" });
      setup({ onBulkAdd: add });
      fireEvent.change(circle(), { target: { value: "日本語サークル" } });
      change("備考", "保持するメモ");
      submit();
      submit();
      expect(add).toHaveBeenCalledOnce();
      await act(async () => finish({ status }));
      expect(circle()).toHaveValue("日本語サークル");
      expect(screen.getByLabelText("備考")).toHaveValue("保持するメモ");
      submit();
      await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(circle()).toHaveValue(""));
    },
  );

  it("keeps newer input when an older pending submission succeeds", async () => {
    let finish!: (value: BulkImportResult) => void;
    const add = vi.fn<Props["onBulkAdd"]>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup({ onBulkAdd: add });
    fireEvent.change(circle(), { target: { value: "保存対象" } });
    submit();
    const request = add.mock.calls[0][2]!.request!;
    expect(request.isCurrent!()).toBe(true);
    fireEvent.change(circle(), { target: { value: "次の入力" } });
    change("タイトル", "次のタイトル");
    expect(request.isCurrent!()).toBe(false);
    await act(async () => finish({ status: "saved" }));
    expect(circle()).toHaveValue("次の入力");
    expect(screen.getByLabelText("タイトル")).toHaveValue("次のタイトル");
    expect(add).toHaveBeenCalledOnce();
  });
});
