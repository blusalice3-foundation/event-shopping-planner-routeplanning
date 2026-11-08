// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import UnsavedChangesRecoveryNotice from "./UnsavedChangesRecoveryNotice";
import {
  createUnsavedChangesWriter,
  readUnsavedChanges,
} from "../utils/unsavedChangesJournal";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("can minimize and reopen the notice without deleting any recovery inputs", () => {
  createUnsavedChangesWriter("application").write([
    { id: "x", changes: [], canResume: false },
  ]);
  render(<UnsavedChangesRecoveryNotice ready onResume={vi.fn()} />);
  const initialToggle = screen.getByRole("button", {
    name: /救済記録.*を表示/,
  });
  expect(initialToggle).toHaveAttribute("aria-expanded", "false");
  expect(initialToggle.className).not.toMatch(/fixed|sticky|absolute/);
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  fireEvent.click(initialToggle);
  expect(screen.getByRole("region")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "記録を保持して最小化" }));
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  expect(readUnsavedChanges()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /救済記録.*を表示/ }));
  expect(screen.getByRole("region")).toBeInTheDocument();
  expect(readUnsavedChanges()).toHaveLength(1);
});
it("warns when a queued operation did not reach planning and its original input is unavailable", () => {
  createUnsavedChangesWriter("application").write([
    { id: "x", changes: [], canResume: false, inputUnavailable: true },
  ]);
  render(<UnsavedChangesRecoveryNotice ready onResume={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /救済記録.*を表示/ }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "その入力内容はこの救済記録に含まれていません",
  );
  expect(
    screen.getByRole("button", { name: "内容を再確認して再開" }),
  ).toBeDisabled();
});
