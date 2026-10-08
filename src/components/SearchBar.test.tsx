// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SearchBar from "./SearchBar";
it("does not advance during Japanese composition and searches the latest local value", () => {
  const next = vi.fn();
  const change = vi.fn();
  const view = render(
    <SearchBar
      searchKeyword=""
      onSearchKeywordChange={change}
      onSearchNext={next}
      matchCount={0}
      currentMatchIndex={-1}
    />,
  );
  const input = view.getByPlaceholderText("検索...");
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "ユーザー登録" } });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(next).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.click(view.getByRole("button", { name: "次を検索" }));
  expect(next).toHaveBeenCalledWith("ユーザー登録");
  fireEvent.change(input, { target: { value: "エラーが発生しました" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(next).toHaveBeenLastCalledWith("エラーが発生しました");
});
