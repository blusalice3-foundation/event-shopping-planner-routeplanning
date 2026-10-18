// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import UrlUpdateDialog from "./UrlUpdateDialog";

afterEach(cleanup);

describe("UrlUpdateDialog reviewed sheet selection", () => {
  it("shows the saved sheet name and submits exactly the edited blank value", () => {
    const onConfirm = vi.fn();
    render(
      <UrlUpdateDialog
        currentUrl="https://docs.google.com/spreadsheets/d/source#gid=2"
        currentSheetName="保存済みシート"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("シート名（オプション）");
    expect(input).toHaveValue("保存済みシート");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    expect(onConfirm).toHaveBeenCalledWith(
      "https://docs.google.com/spreadsheets/d/source#gid=2",
      "",
    );
    expect(screen.getByText(/空欄の場合はURLのgid/)).toBeVisible();
  });

  it("uses the visible saved name when untouched and supports cancellation", () => {
    const onConfirm = vi.fn(),
      onCancel = vi.fn();
    render(
      <UrlUpdateDialog
        currentUrl=" https://example.com/source "
        currentSheetName="品目表"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    expect(onConfirm).toHaveBeenCalledWith(
      "https://example.com/source",
      "品目表",
    );
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
