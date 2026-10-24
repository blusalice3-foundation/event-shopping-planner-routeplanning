// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StorageRollbackMaintenance from "./StorageRollbackMaintenance";
import { db } from "../../persistence/facade/indexedDbPersistence";
import { downloadBlob } from "../../utils/downloadBlob";
import { createEventConsistency } from "../../types/consistency";

vi.mock("../../persistence/facade/indexedDbPersistence", () => ({
  db: {
    readApplicationSnapshot: vi.fn(),
    prepareShoppingMoveRollback: vi.fn(),
  },
}));
vi.mock("../../utils/downloadBlob", () => ({ downloadBlob: vi.fn() }));
const expectedRoots = {};
const snapshot = {
  eventLists: { event: [] },
  eventConsistency: { event: createEventConsistency() },
  eventMetadata: {},
  executeModeItems: {},
  dayModes: {},
  mapData: {},
  mapRotationSettings: {},
  mapViewportSettings: {},
  routeSettings: {},
  hallDefinitions: {},
  hallRouteSettings: {},
};
beforeEach(() => {
  vi.mocked(db.readApplicationSnapshot).mockResolvedValue({
    snapshot,
    expectedRoots,
    consistencyMissing: false,
    eventGenerations: {},
  });
  vi.mocked(db.prepareShoppingMoveRollback).mockResolvedValue();
});
afterEach(() => vi.resetAllMocks());

it("requires the downloaded backup and its confirmation, then prepares exactly that observation", async () => {
  render(<StorageRollbackMaintenance />);
  const prepare = screen.getByRole("button", {
    name: "2. 旧バージョン用に準備",
  });
  expect(prepare).toBeDisabled();
  expect(db.readApplicationSnapshot).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "1. 最新のバックアップを保存" }),
  );
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
  expect(db.readApplicationSnapshot).toHaveBeenCalledWith({
    prepareScopedCommands: false,
  });
  expect(downloadBlob).toHaveBeenCalledWith(
    expect.any(Blob),
    expect.stringMatching(/^event-shopping-planner-backup-.*\.json$/),
  );
  expect(prepare).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(prepare);
  await screen.findByText(
    "旧バージョンで読み込める保存形式の準備が完了しました。",
  );
  expect(db.prepareShoppingMoveRollback).toHaveBeenCalledExactlyOnceWith(
    expectedRoots,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("requires a new backup after an intervening save fails the atomic comparison", async () => {
  vi.mocked(db.prepareShoppingMoveRollback).mockRejectedValue(
    new Error("計算後に保存データが変更されました。"),
  );
  render(<StorageRollbackMaintenance />);
  fireEvent.click(
    screen.getByRole("button", { name: "1. 最新のバックアップを保存" }),
  );
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "2. 旧バージョン用に準備" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "計算後に保存データが変更されました。",
  );
  expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "2. 旧バージョン用に準備" }),
  ).toBeDisabled();
  expect(db.prepareShoppingMoveRollback).toHaveBeenCalledOnce();
});

it("does not offer a preparation when the verified load or backup fails", async () => {
  vi.mocked(db.readApplicationSnapshot).mockRejectedValue(
    new Error("保存設定を検証できません。"),
  );
  render(<StorageRollbackMaintenance />);
  fireEvent.click(
    screen.getByRole("button", { name: "1. 最新のバックアップを保存" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "保存設定を検証できません。",
  );
  expect(downloadBlob).not.toHaveBeenCalled();
  expect(db.prepareShoppingMoveRollback).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "2. 旧バージョン用に準備" }),
  ).toBeDisabled();
});
