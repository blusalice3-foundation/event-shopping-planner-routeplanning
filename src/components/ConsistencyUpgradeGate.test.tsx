// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConsistencyUpgradeGate from "./ConsistencyUpgradeGate";
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), download: vi.fn() }));
vi.mock("../app/composition/appRuntime", () => ({
  appRuntime: {
    persistenceCommands: { inspectConsistencyUpgrade: mocks.inspect },
  },
}));
vi.mock("../utils/downloadBlob", () => ({ downloadBlob: mocks.download }));
const archive = (value: number) => ({
  kind: "event-shopping-planner-pre-upgrade",
  version: 1,
  databaseVersion: 7,
  exportedAt: "2026-09-28T00:00:00Z",
  stores: { eventLists: [{ key: "data", value }] },
  localStorage: {},
});
beforeEach(() => vi.resetAllMocks());
describe("upgrade before mounting application persistence", () => {
  it("opens a new or already upgraded database without an unnecessary prompt", async () => {
    mocks.inspect.mockResolvedValue(null);
    render(
      <ConsistencyUpgradeGate>
        <p>購入リスト</p>
      </ConsistencyUpgradeGate>,
    );
    expect(await screen.findByText("購入リスト")).toBeVisible();
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("requires a fresh archive when another tab changed saved data", async () => {
    mocks.inspect
      .mockResolvedValueOnce(archive(1))
      .mockResolvedValueOnce(archive(2))
      .mockResolvedValueOnce(archive(2));
    render(
      <ConsistencyUpgradeGate>
        <p>購入リスト</p>
      </ConsistencyUpgradeGate>,
    );
    const save = await screen.findByRole("button", {
      name: "移行前データを保存",
    });
    const upgrade = screen.getByRole("button", {
      name: "保存形式を更新して開く",
    });
    expect(upgrade).toBeDisabled();
    fireEvent.click(save);
    expect(upgrade).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "移行前データを端末に保存し、ファイルを開けることを確認しました",
      }),
    );
    fireEvent.click(upgrade);
    expect(await screen.findByRole("alert")).toHaveTextContent("別のタブ");
    expect(screen.queryByText("購入リスト")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "保存形式を更新して開く" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "移行前データを保存" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "移行前データを端末に保存し、ファイルを開けることを確認しました",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "保存形式を更新して開く" }),
    );
    expect(await screen.findByText("購入リスト")).toBeVisible();
    expect(mocks.download).toHaveBeenCalledTimes(2);
  });
  it("requires confirmation again after a new download and remains blocked on download failure", async () => {
    mocks.inspect.mockResolvedValue(archive(1));
    render(
      <ConsistencyUpgradeGate>
        <p>購入リスト</p>
      </ConsistencyUpgradeGate>,
    );
    const save = await screen.findByRole("button", {
      name: "移行前データを保存",
    });
    const upgrade = screen.getByRole("button", {
      name: "保存形式を更新して開く",
    });
    fireEvent.click(save);
    const confirmation = screen.getByRole("checkbox", {
      name: "移行前データを端末に保存し、ファイルを開けることを確認しました",
    });
    expect(upgrade).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "端末への保存はこのアプリでは確認できません",
    );
    fireEvent.click(confirmation);
    expect(upgrade).toBeEnabled();
    fireEvent.click(save);
    expect(confirmation).not.toBeChecked();
    expect(upgrade).toBeDisabled();
    fireEvent.click(confirmation);
    mocks.download.mockImplementationOnce(() => {
      throw new Error("Download rejected");
    });
    fireEvent.click(save);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(upgrade).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "ダウンロードを開始できませんでした",
    );
    expect(screen.queryByText("購入リスト")).not.toBeInTheDocument();
  });
  it("does not mount writers if inspection fails", async () => {
    mocks.inspect.mockRejectedValueOnce(new Error("他のタブを閉じてください"));
    render(
      <ConsistencyUpgradeGate>
        <p>購入リスト</p>
      </ConsistencyUpgradeGate>,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("他のタブ"),
    );
    expect(screen.queryByText("購入リスト")).not.toBeInTheDocument();
  });
});
