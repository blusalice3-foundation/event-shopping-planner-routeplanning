import { createHash } from "node:crypto";
import { expect, type Page, type CDPSession } from "@playwright/test";
import {
  beginGesture,
  createTransferFixture,
  readTransferDurable,
  restoreTransferFixture,
  transferEventName,
  transferRow,
  type TransferCondition,
  type TransferMeasurementOptions,
} from "./shopping-transfer-measurement";

export const acceptedTransferScenarios = [
  "multiple",
  "range",
  "same-visit-merge",
  "multiple-merge",
  "mixed",
  "offscreen",
  "collapsed",
  "auto-scroll",
] as const;
export type AcceptedTransferScenario =
  (typeof acceptedTransferScenarios)[number];
export type AcceptedTransferCondition = TransferCondition & {
  scenario: AcceptedTransferScenario;
};
export const acceptedTransferConditions: AcceptedTransferCondition[] =
  acceptedTransferScenarios.flatMap((scenario) =>
    (
      [
        "native",
        ...(scenario === "range" || scenario === "collapsed" ? ["touch"] : []),
      ] as Array<"native" | "touch">
    ).flatMap((input) =>
      (["candidate-to-execute", "execute-to-candidate"] as const).map(
        (direction) => ({
          count: 500,
          input,
          grouped: true,
          load: "light",
          direction,
          scenario,
        }),
      ),
    ),
  );

export function acceptedScenarioFixture(condition: AcceptedTransferCondition) {
  const backup = createTransferFixture(condition);
  const sourcePrefix =
    condition.direction === "candidate-to-execute" ? "c" : "e";
  const targetPrefix = sourcePrefix === "c" ? "e" : "c";
  const source = (n: number) => `${sourcePrefix}${n}`;
  const target = (n: number) => `${targetPrefix}${n}`;
  const items = backup.data.eventLists[transferEventName];
  for (const item of items) {
    const i = Number(item.id.slice(1));
    item.number = `${item.id.startsWith(targetPrefix) ? 1000 + i : 2000 + i}a`;
  }
  const number = (id: string, value: string) => {
    items.find((item) => item.id === id)!.number = value;
  };
  number(source(0), "01a");
  number(source(1), "41a");
  number(source(2), "42a");
  number(source(3), "43a");
  number(target(0), "90a");
  number(target(1), "100a");
  number(target(2), "110a");
  number(target(3), "120a");
  let requestedIds = [source(1), source(2)];
  let effectiveIds = [...requestedIds];
  let anchor = target(0);
  let anchorPosition: "before" | "after" | "any" =
    sourcePrefix === "c" ? "after" : "before";
  const mergePairs: Array<{ source: string; target: string }> = [];
  if (
    ["same-visit-merge", "multiple-merge", "mixed", "offscreen"].includes(
      condition.scenario,
    )
  ) {
    number(source(1), "90a3");
    mergePairs.push({ source: source(1), target: target(0) });
    anchorPosition = "after";
    if (condition.scenario === "same-visit-merge") {
      number(source(2), "90a4");
      number(target(3), "90a2");
      requestedIds = [source(1)];
      effectiveIds = [source(1), source(2)];
      mergePairs.push({ source: source(2), target: target(0) });
    } else if (condition.scenario === "offscreen") {
      number(target(249), "9999a");
      number(source(2), "9999a2");
      mergePairs.push({ source: source(2), target: target(249) });
    } else {
      number(source(2), "100a2");
      mergePairs.push({ source: source(2), target: target(1) });
      if (condition.scenario === "mixed") {
        requestedIds.push(source(3));
        effectiveIds.push(source(3));
        number(source(3), "95a");
      }
    }
  }
  if (condition.scenario === "range") {
    requestedIds = [source(1), source(2), source(3)];
    effectiveIds = [...requestedIds];
  }
  if (condition.scenario === "collapsed") {
    requestedIds = [source(1)];
    effectiveIds = [...requestedIds];
    number(target(1), "90a2");
    number(source(1), "95a");
    anchor = target(2);
    anchorPosition = "before";
  }
  if (condition.scenario === "auto-scroll") {
    requestedIds = [source(1)];
    effectiveIds = [...requestedIds];
  }
  return {
    backup,
    sourcePrefix,
    targetPrefix,
    requestedIds,
    effectiveIds,
    sourceId: source(1),
    anchorId: anchor,
    anchorPosition,
    warmupSourceId: source(0),
    warmupAnchorId: target(0),
    mergePairs,
    fixtureHash: createHash("sha256")
      .update(JSON.stringify(backup))
      .digest("hex"),
  };
}
export async function restoreAcceptedScenario(
  page: Page,
  condition: AcceptedTransferCondition,
  frame: boolean,
) {
  const scenario = acceptedScenarioFixture(condition);
  const fixture = await restoreTransferFixture(
    page,
    condition,
    frame,
    scenario.backup,
  );
  return { ...scenario, fixture };
}
export async function prepareAcceptedScenario(
  page: Page,
  session: CDPSession,
  condition: AcceptedTransferCondition,
  scenario: ReturnType<typeof acceptedScenarioFixture>,
): Promise<TransferMeasurementOptions> {
  if (condition.scenario === "range") {
    await transferRow(page, scenario.requestedIds[0])
      .locator('input[type="checkbox"]')
      .check();
    await transferRow(page, scenario.requestedIds.at(-1)!)
      .locator('input[type="checkbox"]')
      .check();
    await page
      .getByTitle("範囲内のチェックを入れる", { exact: true })
      .first()
      .click();
    for (const id of scenario.requestedIds)
      await expect(
        transferRow(page, id).locator('input[type="checkbox"]'),
      ).toBeChecked();
  } else
    for (const id of scenario.requestedIds)
      await transferRow(page, id).locator('input[type="checkbox"]').check();
  const options: TransferMeasurementOptions = {
    sourceId: scenario.sourceId,
    anchorId: scenario.anchorId,
    expectedTransferredIds: scenario.effectiveIds,
    anchorPosition: scenario.anchorPosition,
    guideKind: "either",
  };
  if (condition.scenario === "collapsed") {
    const selector = `[data-shopping-drag-column="${scenario.targetPrefix === "e" ? "execute" : "candidate"}"] [data-space-group-key="A-90a"]`;
    await page.locator(selector).click();
    await expect(transferRow(page, `${scenario.targetPrefix}0`)).toHaveCount(0);
    options.gestureTargetSelector = selector;
    options.scenarioEvidence = {
      collapsedHeaderSelector: selector,
      hiddenExistingIds: [
        `${scenario.targetPrefix}0`,
        `${scenario.targetPrefix}1`,
      ],
      hiddenBeforeDrop: true,
    };
  }
  if (condition.scenario === "offscreen") {
    const targetId = `${scenario.targetPrefix}249`;
    const box = await transferRow(page, targetId).boundingBox();
    const viewport = page.viewportSize()!;
    const outside = !box || box.y + box.height <= 0 || box.y >= viewport.height;
    expect(
      outside,
      "merge destination must actually be outside the viewport",
    ).toBe(true);
    options.scenarioEvidence = {
      offscreenTargetId: targetId,
      targetBounds: box,
      viewport,
      offscreenBeforeDrop: outside,
    };
  }
  if (condition.scenario === "auto-scroll") {
    options.recaptureAfterGesture = true;
    options.gesture = async () => {
      await beginGesture(
        page,
        session,
        condition.input,
        scenario.sourceId,
        scenario.anchorId,
        { guideKind: "either" },
      );
      const before = await page.evaluate(() => scrollY);
      const point = await page.evaluate(
        (column) => {
          const root = document.querySelector<HTMLElement>(
            `[data-shopping-drag-column="${column}"]`,
          )!;
          for (const row of root.querySelectorAll<HTMLElement>(
            "[data-item-id]:not([data-space-group-key])",
          )) {
            const r = row.getBoundingClientRect();
            const y = Math.min(innerHeight - 8, r.bottom - 3);
            if (y >= innerHeight - 90 && r.top < y) return { x: r.left + 8, y };
          }
          throw new Error(
            "No actual destination card in the product auto-scroll edge",
          );
        },
        scenario.targetPrefix === "e" ? "execute" : "candidate",
      );
      const began = Date.now();
      await page.mouse.move(point.x, point.y, { steps: 4 });
      await page.waitForFunction((before) => scrollY > before, before, {
        timeout: 3000,
      });
      const after = await page.evaluate(() => scrollY);
      const box = await transferRow(page, scenario.anchorId).boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + 5, box!.y + box!.height * 0.8, {
        steps: 4,
      });
      await page.mouse.move(box!.x + 6, box!.y + box!.height * 0.8 + 1);
      expect(after).toBeGreaterThan(before);
      return {
        autoScrollBefore: before,
        autoScrollAfter: after,
        autoScrollMs: Date.now() - began,
        trustedNativeDrag: true,
      };
    };
  }
  return options;
}
export async function verifyAcceptedScenario(
  page: Page,
  before: Awaited<ReturnType<typeof readTransferDurable>>,
  scenario: ReturnType<typeof acceptedScenarioFixture>,
  condition: AcceptedTransferCondition,
) {
  const after = await readTransferDurable(page);
  const beforeById = new Map(before.items.map((item) => [item.id, item]));
  expect(after.items).toHaveLength(500);
  expect(new Set(after.items.map((item) => item.id)).size).toBe(500);
  for (const item of after.items) expect(item).toEqual(beforeById.get(item.id));
  const wanted = new Set(before.executeIds);
  for (const id of scenario.effectiveIds)
    if (condition.direction === "candidate-to-execute") wanted.add(id);
    else wanted.delete(id);
  expect([...after.executeIds].sort()).toEqual([...wanted].sort());
  for (const id of scenario.effectiveIds) {
    const checkbox = transferRow(page, id).locator('input[type="checkbox"]');
    if (await checkbox.count()) await expect(checkbox).not.toBeChecked();
  }
  const space = (number: string) => number.replace(/([a-zA-Z])\d+$/, "$1");
  const targetIds = new Set(
    condition.direction === "candidate-to-execute"
      ? after.executeIds
      : after.items
          .filter((item) => !after.executeIds.includes(item.id))
          .map((item) => item.id),
  );
  const mergeProof = scenario.mergePairs.map((pair) => {
    const a = after.items.find((item) => item.id === pair.source)!;
    const b = after.items.find((item) => item.id === pair.target)!;
    expect(space(a.number)).toBe(space(b.number));
    expect(targetIds.has(pair.source) && targetIds.has(pair.target)).toBe(true);
    return {
      ...pair,
      sourceNumber: a.number,
      targetNumber: b.number,
      targetMembership: true,
    };
  });
  const beforeDestinationIds =
    condition.direction === "candidate-to-execute"
      ? before.executeIds
      : before.items
          .filter((item) => !before.executeIds.includes(item.id))
          .map((item) => item.id);
  const afterDestinationIds =
    condition.direction === "candidate-to-execute"
      ? after.executeIds
      : after.items
          .filter((item) => !after.executeIds.includes(item.id))
          .map((item) => item.id);
  const sourceIds =
    condition.direction === "candidate-to-execute"
      ? before.items
          .filter((item) => !before.executeIds.includes(item.id))
          .map((item) => item.id)
      : before.executeIds;
  const visitKey = (id: string) => {
    const item = beforeById.get(id)!;
    return JSON.stringify([item.eventDate, item.block, space(item.number)]);
  };
  const mergedVisits = new Map(
    scenario.mergePairs.map((pair) => [visitKey(pair.target), pair.target]),
  );
  const destination = scenario.targetPrefix === "e" ? "execute" : "candidate";
  const mountedDestinationIds = await page.evaluate(
    (column) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          `[data-shopping-drag-column="${column}"] [data-item-id]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
        ),
      ].map((row) => row.dataset.itemId!),
    destination,
  );
  const mergeTailProof = [...mergedVisits].map(([key, targetId]) => {
    const existingIds = beforeDestinationIds.filter(
      (id) => visitKey(id) === key,
    );
    const appendedIds = sourceIds.filter(
      (id) => scenario.effectiveIds.includes(id) && visitKey(id) === key,
    );
    const expectedIds = [...existingIds, ...appendedIds];
    const durableIds = afterDestinationIds.filter((id) => visitKey(id) === key);
    expect(
      durableIds,
      `${key}: merge appends after the existing visit tail`,
    ).toEqual(expectedIds);
    const mountedIds = mountedDestinationIds.filter((id) =>
      expectedIds.includes(id),
    );
    expect(
      mountedIds,
      `${key}: mounted member order follows the durable merge tail`,
    ).toEqual(expectedIds.filter((id) => mountedDestinationIds.includes(id)));
    return {
      key,
      targetId,
      existingIds,
      appendedIds,
      expectedIds,
      durableIds,
      mountedIds,
      allMembersMounted: mountedIds.length === expectedIds.length,
    };
  });
  const visibleTransferredIds = await page.evaluate((ids) => {
    return ids
      .filter((id) => {
        const row = document.querySelector<HTMLElement>(
          `[data-item-id="${id}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
        );
        if (!row) return false;
        const rect = row.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.x < innerWidth &&
          rect.right > 0 &&
          rect.y < innerHeight &&
          rect.bottom > 0
        );
      })
      .sort((a, b) => {
        const rect = (id: string) =>
          document
            .querySelector<HTMLElement>(
              `[data-item-id="${id}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
            )!
            .getBoundingClientRect();
        return rect(a).y - rect(b).y || rect(a).x - rect(b).x;
      });
  }, scenario.effectiveIds);
  return {
    actualItemOrder: after.items.map((item) => item.id),
    actualExecuteIds: after.executeIds,
    expectedExecuteMembership: [...wanted],
    fullItemContentPreserved: true,
    mergeProof,
    mergeTailProof,
    visibleTransferredIds,
    offscreenTransferredIds: scenario.effectiveIds.filter(
      (id) => !visibleTransferredIds.includes(id),
    ),
  };
}
