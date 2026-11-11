import { describe, expect, it, vi } from "vitest";
import {
  createApplicationMutationCoordinator,
  type MutationResult,
} from "../../../app/commands/applicationMutationCoordinator";
import type { PersistenceSnapshot } from "../../../app/ports/PersistenceCommandPort";
import { createEventConsistency } from "../../../types/consistency";
import { planEventRestore } from "./eventMutations";

function map(value = "地図のセル本文") {
  return {
    sheetName: "1日目",
    maxRow: 182,
    maxCol: 222,
    cells: [{ row: 1, col: 1, value }],
    mergedCells: [{ startRow: 1, endRow: 1, startCol: 1, endCol: 2 }],
    blocks: [{ id: "block", name: "A" }],
  };
}

function snapshot(
  name: string,
  maps?: Record<string, unknown>,
): PersistenceSnapshot {
  return {
    eventLists: { [name]: [{ id: "item", remarks: "ユーザー登録" }] },
    eventConsistency: { [name]: createEventConsistency() },
    eventMetadata: { [name]: { memo: "エラーが発生しました" } },
    executeModeItems: { [name]: { "1日目": ["item"] } },
    dayModes: { [name]: { "1日目": "edit" } },
    mapData: maps === undefined ? {} : { [name]: maps },
    mapRotationSettings: { [name]: { "1日目": { mapTabAngle: 90 } } },
    routeSettings: {},
    hallDefinitions: {},
    hallRouteSettings: {},
    mapViewportSettings: { [name]: { "1日目": { zoom: 2 } } },
  };
}

function mapSummary(plan: ReturnType<typeof planEventRestore>): string {
  const summary = plan.confirmation?.details.find((detail) =>
    detail.startsWith("地図データ（要約）"),
  );
  expect(summary).toBeDefined();
  return summary!;
}

function review(result: MutationResult) {
  expect(result.status).toBe("confirmation-required");
  if (result.status !== "confirmation-required")
    throw new Error("Expected a restore confirmation");
  return result;
}

function restoreHarness(
  initial: PersistenceSnapshot,
  backup: PersistenceSnapshot,
) {
  let current = structuredClone(initial);
  let durable = structuredClone(initial);
  const commit = vi.fn(async (next: PersistenceSnapshot) => {
    durable = structuredClone(next);
  });
  const apply = vi.fn((next: PersistenceSnapshot) => {
    current = next;
  });
  const coordinator = createApplicationMutationCoordinator({
    readCurrent: () => current,
    drain: async () => undefined,
    readDurable: async () => ({
      snapshot: structuredClone(durable),
      expectedRoots: {},
      consistencyMissing: false,
    }),
    commit,
    apply,
  });
  const intent = {
    id: "restore-event",
    events: ["event"],
    plan: (latest: PersistenceSnapshot) =>
      planEventRestore(latest, backup, "backup", "event"),
  };
  return {
    coordinator,
    intent,
    commit,
    apply,
    current: () => current,
    durable: () => durable,
    adoptSavedMap(value: string) {
      const updated = structuredClone(durable);
      updated.mapData.event["1日目マップ"] = map(value);
      durable = updated;
      current = structuredClone(updated);
    },
  };
}

describe("event restore map confirmation", () => {
  it("keeps a full-size map out of display details while retaining all restored data and comparison values", () => {
    const cellBody = "表示してはいけないセル本文" + "x".repeat(200_000);
    const largeMap = {
      ...map(),
      cells: Array.from({ length: 40_404 }, (_, index) => ({
        row: Math.floor(index / 222) + 1,
        col: (index % 222) + 1,
        value: index === 40_403 ? cellBody : null,
      })),
    };
    const current = snapshot("event");
    const backup = snapshot("backup", { "1日目マップ": largeMap });
    const backupBefore = structuredClone(backup);

    const plan = planEventRestore(current, backup, "backup", "event");
    const summary = mapSummary(plan);
    const display = plan.confirmation!.details.join("\n");

    expect(summary).toContain("1日目マップ");
    expect(summary).toContain("182行 × 222列");
    expect(summary).toMatch(/40,?404/);
    expect(summary).toContain("結合");
    expect(summary).toContain("ブロック");
    expect(display).not.toContain("表示してはいけないセル本文");
    expect(display.length).toBeLessThan(5_000);
    expect(plan.snapshot.mapData.event).toEqual(backup.mapData.backup);
    expect(plan.confirmation!.comparison).toMatchObject({
      before: { mapData: null },
      after: { mapData: backup.mapData.backup },
    });
    expect(backup).toEqual(backupBefore);
    expect(current.mapData).toEqual({});
  });

  it.each([
    {
      name: "adds a map",
      before: undefined,
      after: { 追加地図: map("追加内容") },
    },
    {
      name: "replaces a map",
      before: { 旧地図: map("旧内容") },
      after: { 新地図: map("新内容") },
    },
    {
      name: "removes maps absent from the backup",
      before: { 削除地図: map() },
      after: undefined,
    },
  ])("$name without omitting any saved map data", ({ before, after }) => {
    const current = snapshot("event", before);
    const backup = snapshot("backup", after);
    const plan = planEventRestore(current, backup, "backup", "event");
    const summary = mapSummary(plan);

    expect(summary).toContain("現在:");
    expect(summary).toContain("復元後:");
    for (const name of Object.keys(before ?? {}))
      expect(summary).toContain(name);
    for (const name of Object.keys(after ?? {}))
      expect(summary).toContain(name);
    if (after) expect(plan.snapshot.mapData.event).toEqual(after);
    else expect(plan.snapshot.mapData).not.toHaveProperty("event");
    expect(plan.snapshot.mapRotationSettings.event).toEqual(
      backup.mapRotationSettings.backup,
    );
    expect(plan.snapshot.mapViewportSettings.event).toEqual(
      backup.mapViewportSettings.backup,
    );
  });

  it("preserves ordinary non-map confirmation details and excludes unchanged map data", () => {
    const current = snapshot("event", { 同一地図: map() });
    const backup = snapshot("backup", { 同一地図: map() });
    backup.eventMetadata.backup = { memo: "変更後の日本語メモ" };

    const plan = planEventRestore(current, backup, "backup", "event");

    expect(plan.confirmation!.details).toContain(
      'eventMetadata\n現在: {\n  "memo": "エラーが発生しました"\n}\n復元後: {\n  "memo": "変更後の日本語メモ"\n}',
    );
    expect(
      plan.confirmation!.details.some((detail) =>
        detail.startsWith("地図データ（要約）"),
      ),
    ).toBe(false);
    expect(plan.snapshot.mapData.event).toEqual(backup.mapData.backup);
  });

  it("bounds display size even when a backup has many maps with very long names", () => {
    const maps = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `地図${index}-${"長い地図名".repeat(1_000)}`,
        map(),
      ]),
    );
    const backup = snapshot("backup", maps);
    const plan = planEventRestore(snapshot("event"), backup, "backup", "event");
    const summary = mapSummary(plan);

    expect(summary.length).toBeLessThan(12_000);
    expect(summary).not.toContain(Object.keys(maps)[0]);
    expect(summary).toContain("100");
    expect(plan.snapshot.mapData.event).toEqual(maps);
    expect(plan.confirmation!.comparison).toMatchObject({
      after: { mapData: maps },
    });
  });

  it("requests a new approval when pending save completion changes a cell while map dimensions and summary stay identical", async () => {
    const backup = snapshot("backup", { "1日目マップ": map("復元内容") });
    const h = restoreHarness(
      snapshot("event", { "1日目マップ": map("元内容") }),
      backup,
    );
    const first = review(await h.coordinator.request(h.intent));

    h.adoptSavedMap("確認待ちに保存された内容");
    const second = review(await h.coordinator.confirm(first.token));

    expect(second.confirmation.details).toEqual(first.confirmation.details);
    expect(second.token.signature).not.toBe(first.token.signature);
    expect(h.commit).not.toHaveBeenCalled();
    expect((await h.coordinator.confirm(first.token)).status).toBe("expired");
    expect((await h.coordinator.confirm(second.token)).status).toBe(
      "committed",
    );
    expect(h.current().mapData.event).toEqual(backup.mapData.backup);
    expect(h.commit).toHaveBeenCalledOnce();
  });

  it("cancels the summary review without saving or applying the restored data", async () => {
    const initial = snapshot("event", { "1日目マップ": map("保持内容") });
    const backup = snapshot("backup", { "1日目マップ": map("復元内容") });
    const h = restoreHarness(initial, backup);
    const pending = review(await h.coordinator.request(h.intent));

    expect(h.coordinator.cancel(pending.token)).toBe(true);
    expect((await h.coordinator.confirm(pending.token)).status).toBe("expired");
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.current()).toEqual(initial);
    expect(h.durable()).toEqual(initial);
  });

  it("keeps the current data on save failure and retries the reviewed full restore without another approval", async () => {
    const initial = snapshot("event", { "1日目マップ": map("保持内容") });
    const backup = snapshot("backup", { "1日目マップ": map("復元内容") });
    const h = restoreHarness(initial, backup);
    const pending = review(await h.coordinator.request(h.intent));
    const failure = new Error("保存失敗");
    h.commit.mockRejectedValueOnce(failure);

    await expect(h.coordinator.confirm(pending.token)).rejects.toBe(failure);
    expect(h.current()).toEqual(initial);
    expect(h.durable()).toEqual(initial);
    expect(h.apply).not.toHaveBeenCalled();

    expect((await h.coordinator.confirm(pending.token)).status).toBe(
      "committed",
    );
    expect(h.current().mapData.event).toEqual(backup.mapData.backup);
    expect(h.durable().mapData.event).toEqual(backup.mapData.backup);
    expect(h.commit).toHaveBeenCalledTimes(2);
    expect(h.apply).toHaveBeenCalledOnce();
  });
});
