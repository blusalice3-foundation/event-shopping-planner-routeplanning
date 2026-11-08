// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAppleTouchWebKit } from "../utils/appleTouchWebKit";
import { PriceQuickSelect } from "./PriceQuickSelect";

vi.mock("../utils/appleTouchWebKit", () => ({ isAppleTouchWebKit: vi.fn() }));

function renderSelect() {
  const onChange = vi.fn();
  render(
    <>
      <label htmlFor="price">購入金額</label>
      <input id="price" />
      <label htmlFor="preset">クイック選択</label>
      <PriceQuickSelect id="preset" defaultValue="" onChange={onChange}>
        <option value="" disabled>
          金額を選択...
        </option>
        <option value="1000">1,000円</option>
      </PriceQuickSelect>
      <button type="button">次へ</button>
    </>,
  );
  return onChange;
}

describe("PriceQuickSelect", () => {
  beforeEach(() => vi.mocked(isAppleTouchWebKit).mockReturnValue(false));

  it("preserves the native select on Windows and Android", () => {
    const onChange = renderSelect();
    fireEvent.change(screen.getByRole("combobox", { name: "クイック選択" }), {
      target: { value: "1000" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "クイック選択を開く" }),
    ).toBeNull();
  });

  it("requires explicit iOS activation, retains labels, and returns focus after selection", () => {
    vi.mocked(isAppleTouchWebKit).mockReturnValue(true);
    const onChange = renderSelect();
    screen.getByLabelText("購入金額").focus();
    expect(screen.queryByRole("combobox")).toBeNull();
    const opener = screen.getByRole("button", { name: "クイック選択を開く" });
    expect(screen.getByLabelText("クイック選択")).toBe(opener);
    fireEvent.click(opener);
    const select = screen.getByRole("combobox", { name: "クイック選択" });
    expect(select).toHaveFocus();
    expect(screen.getByLabelText("クイック選択")).toBe(select);
    fireEvent.change(select, { target: { value: "1000" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes on blur without stealing focus and supports Escape without changing the value", () => {
    vi.mocked(isAppleTouchWebKit).mockReturnValue(true);
    const onChange = renderSelect();
    fireEvent.click(screen.getByRole("button", { name: "クイック選択を開く" }));
    act(() => screen.getByRole("button", { name: "次へ" }).focus());
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "次へ" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "クイック選択を開く" }));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "クイック選択を開く" }),
    ).toHaveFocus();
  });
});
