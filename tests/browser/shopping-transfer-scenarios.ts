import { createHash } from "node:crypto";
import { expect, type Page, type CDPSession } from "@playwright/test";
import {
  beginGesture,
  createTransferFixture,
  readTransferDurable,
  restoreTransferFixture,
  transferEventName,
  transferRow,
  waitForTransferIdle,
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

type OracleItem = {
  id: string;
  block: string;
  number: string;
  eventDate: string;
};
export function defaultCandidateOrder(items: readonly OracleItem[]) {
  const collator = new Intl.Collator("ja", {
    numeric: true,
    sensitivity: "base",
  });
  return [...items]
    .sort(
      (a, b) =>
        collator.compare(a.block, b.block) ||
        collator.compare(a.number, b.number),
    )
    .map((item) => item.id);
}

// Independent specification: raw candidate slots and displayed numeric order differ.
export function reverseCandidateOrderExpectation(
  before: { items: readonly OracleItem[]; executeIds: readonly string[] },
  effectiveIds: readonly string[],
  target: { anchorId: string; collapsedFirstMemberId?: string },
) {
  const byId = new Map(before.items.map((item) => [item.id, item]));
  const executing = new Set(before.executeIds);
  const moving = new Set(effectiveIds);
  if (
    moving.size !== effectiveIds.length ||
    effectiveIds.some((id) => !executing.has(id) || !byId.has(id))
  )
    throw new Error(
      "Reverse oracle requires unique existing execution members",
    );
  const day = byId.get(effectiveIds[0])?.eventDate;
  if (!day || effectiveIds.some((id) => byId.get(id)!.eventDate !== day))
    throw new Error("Reverse oracle requires one frozen source day");
  const rawCandidates = before.items.filter(
    (item) => item.eventDate === day && !executing.has(item.id),
  );
  const displayedBeforeIds = defaultCandidateOrder(rawCandidates);
  const anchorId = target.collapsedFirstMemberId ?? target.anchorId;
  const anchorIndex = displayedBeforeIds.indexOf(anchorId);
  if (anchorIndex === -1)
    throw new Error("Reverse oracle anchor is not a candidate");
  // Ordinary rows retain the lower-half next-displayed-row boundary. A collapsed
  // header retains its first-member anchor, even when its lower half is hovered.
  const boundaryId = target.collapsedFirstMemberId
    ? anchorId
    : (displayedBeforeIds[anchorIndex + 1] ?? null);
  const insertionIndex =
    boundaryId === null
      ? rawCandidates.length
      : rawCandidates.findIndex((item) => item.id === boundaryId);
  const sourceIds = before.items
    .filter((item) => moving.has(item.id))
    .map((item) => item.id);
  const expectedRawCandidateIds = rawCandidates.map((item) => item.id);
  expectedRawCandidateIds.splice(insertionIndex, 0, ...sourceIds);
  const expectedExecuteIds = before.executeIds.filter((id) => !moving.has(id));
  const remainingExecutionItems = before.items.filter(
    (item) =>
      item.eventDate === day && executing.has(item.id) && !moving.has(item.id),
  );
  let candidateIndex = 0;
  let executionIndex = 0;
  const expectedItemOrder = before.items.map((item) =>
    item.eventDate !== day
      ? item.id
      : executing.has(item.id) && !moving.has(item.id)
        ? remainingExecutionItems[executionIndex++].id
        : expectedRawCandidateIds[candidateIndex++],
  );
  return {
    contract: "candidate-raw-boundary-and-default-display" as const,
    anchorId,
    boundaryKind: target.collapsedFirstMemberId
      ? ("collapsed-first-member" as const)
      : ("next-displayed-row" as const),
    boundaryId,
    displayedBeforeIds,
    sourceIds,
    expectedItemOrder,
    expectedExecuteIds,
    expectedRawCandidateIds,
    expectedDisplayIds: defaultCandidateOrder(
      expectedRawCandidateIds.map((id) => byId.get(id)!),
    ),
  };
}
type SelectionPreparationProof = {
  requestedIds: string[];
  requestedDisplayOrder: string[];
  checkboxChecks: Array<{
    targetId: string;
    checked: boolean;
    scrollY: number;
    rect: { x: number; y: number; width: number; height: number };
  }>;
  headerText: string;
  requestedCount: number;
  effectiveCount: number;
  mountedCheckedIds: string[];
  exactSelectionVerified: true;
  scrollRestoration: {
    before: number;
    after: number;
    sourceVisible: boolean;
    anchorVisible: boolean;
  } | null;
};
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
    preparationProof: undefined as SelectionPreparationProof | undefined,
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
export async function acceptedRangeFrameGeometry(
  page: Page,
  ids: readonly string[],
  anchorId: string,
) {
  return page.evaluate(
    ({ ids, anchorId }) => {
      const box = (r: DOMRect) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        left: r.left,
      });
      const header = document.querySelector<HTMLElement>(
        '[data-testid="app-shell-header"]',
      );
      const headerRect = header?.getBoundingClientRect();
      const headerBottom = headerRect?.bottom ?? null;
      const row = (id: string) => {
        const element = document.querySelector<HTMLElement>(
          `[data-item-id="${id}"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)`,
        );
        if (!element)
          return {
            id,
            mounted: false,
            rect: null,
            fullyVisible: false,
            controls: [],
            dropHit: null,
          };
        const r = element.getBoundingClientRect();
        const point = {
          x: r.x + 4,
          y: r.y + Math.min(r.height - 4, r.height * 0.8),
        };
        const hit = document.elementFromPoint(point.x, point.y);
        const owner = hit?.closest<HTMLElement>("[data-item-id]");
        const controls = [
          ...element.querySelectorAll<HTMLElement>(
            'input[type="checkbox"], select, button',
          ),
        ]
          .map((control) => {
            const cr = control.getBoundingClientRect();
            const style = getComputedStyle(control);
            return {
              tag: control.tagName,
              type: control.getAttribute("type"),
              title: control.title,
              label: control.getAttribute("aria-label"),
              rect: box(cr),
              visible:
                cr.width > 0 &&
                cr.height > 0 &&
                style.visibility !== "hidden" &&
                style.display !== "none",
              fullyVisible:
                cr.width > 0 &&
                cr.height > 0 &&
                cr.left >= 0 &&
                cr.right <= innerWidth &&
                cr.top >= (headerBottom ?? Infinity) &&
                cr.bottom <= innerHeight,
            };
          })
          .filter((control) => control.visible);
        return {
          id,
          mounted: true,
          rect: box(r),
          fullyVisible:
            headerBottom !== null &&
            r.left >= 0 &&
            r.right <= innerWidth &&
            r.top >= headerBottom &&
            r.bottom <= innerHeight,
          controls,
          dropHit: {
            point,
            tagName: hit?.tagName ?? null,
            ownerId: owner?.dataset.itemId ?? null,
            sourceContainsHit: !!hit && element.contains(hit),
            ownerMatched: owner === element,
          },
        };
      };
      return {
        epoch: performance.timeOrigin + performance.now(),
        scrollY,
        viewport: { width: innerWidth, height: innerHeight },
        header: headerRect ? box(headerRect) : null,
        source: ids.map(row),
        anchor: row(anchorId),
      };
    },
    { ids: [...ids], anchorId },
  );
}

export async function prepareAcceptedRangeFrame(
  page: Page,
  sourceIds: readonly string[],
  anchorId: string,
) {
  const before = await acceptedRangeFrameGeometry(page, sourceIds, anchorId);
  // Fixture preparation only; all response/frame clocks remain in measureTransfer.
  await page.evaluate(() => window.scrollBy(0, 180));
  await waitForTransferIdle(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );
  });
  const after = await acceptedRangeFrameGeometry(page, sourceIds, anchorId);
  return {
    method: "real-window-scrollBy-preclock" as const,
    requestedDeltaY: 180,
    expectedSourceIds: [...sourceIds],
    anchorId,
    before,
    after,
  };
}

export function verifyAcceptedRangeFramePreparation(
  preparation: Awaited<ReturnType<typeof prepareAcceptedRangeFrame>>,
) {
  const { before, after, expectedSourceIds, anchorId } = preparation;
  expect(expectedSourceIds).toHaveLength(3);
  expect(after.source.map((row) => row.id)).toEqual(expectedSourceIds);
  expect(
    Math.abs(after.scrollY - before.scrollY - preparation.requestedDeltaY),
    "Range frame preparation must move the actual window by +180px",
  ).toBeLessThanOrEqual(1);
  expect(
    after.header,
    "Actual sticky header must be observable",
  ).not.toBeNull();
  expect(
    after.source.every(
      (row) =>
        row.fullyVisible &&
        row.controls.length > 0 &&
        row.controls.every((control) => control.fullyVisible),
    ),
    "All three original cards and visible controls must fit below the header",
  ).toBe(true);
  expect(after.anchor.id).toBe(anchorId);
  expect(after.anchor.fullyVisible, "Actual drop anchor must fully fit").toBe(
    true,
  );
  expect(after.anchor.dropHit?.sourceContainsHit).toBe(true);
  expect(after.anchor.dropHit?.ownerMatched).toBe(true);
}

export async function prepareAcceptedScenario(
  page: Page,
  session: CDPSession,
  condition: AcceptedTransferCondition,
  scenario: ReturnType<typeof acceptedScenarioFixture>,
): Promise<TransferMeasurementOptions> {
  const checkboxChecks: SelectionPreparationProof["checkboxChecks"] = [];
  const checkActualCheckbox = async (id: string) => {
    const checkbox = transferRow(page, id).locator('input[type="checkbox"]');
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    checkboxChecks.push(
      await checkbox.evaluate((input, targetId) => {
        const rect = input.getBoundingClientRect();
        return {
          targetId,
          checked: (input as HTMLInputElement).checked,
          scrollY,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      }, id),
    );
  };
  let scrollRestoration: SelectionPreparationProof["scrollRestoration"] = null;
  const fillRange =
    condition.scenario === "range" ||
    (condition.scenario === "mixed" && scenario.sourcePrefix === "c");
  if (fillRange) {
    await checkActualCheckbox(scenario.requestedIds[0]);
    // Mixed candidate numbers display c1,c3,c2. Select its actual outer endpoints,
    // then use the product's range action instead of clicking through its overlay.
    await checkActualCheckbox(
      condition.scenario === "mixed"
        ? scenario.requestedIds[1]
        : scenario.requestedIds.at(-1)!,
    );
    await page
      .getByTitle("範囲内のチェックを入れる", { exact: true })
      .first()
      .click();
    for (const id of scenario.requestedIds) {
      const checkbox = transferRow(page, id).locator('input[type="checkbox"]');
      await expect(checkbox).toBeChecked();
      if (!checkboxChecks.some((entry) => entry.targetId === id))
        checkboxChecks.push(
          await checkbox.evaluate((input, targetId) => {
            const rect = input.getBoundingClientRect();
            return {
              targetId,
              checked: (input as HTMLInputElement).checked,
              scrollY,
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
            };
          }, id),
        );
    }
  } else if (
    condition.scenario === "offscreen" &&
    scenario.sourcePrefix === "c"
  ) {
    const before = await page.evaluate(() => scrollY);
    await checkActualCheckbox(scenario.requestedIds[0]);
    await page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight),
    );
    await checkActualCheckbox(scenario.requestedIds[1]);
    await page.evaluate((top) => scrollTo(0, top), before);
    await expect(transferRow(page, scenario.sourceId)).toBeInViewport();
    await expect(transferRow(page, scenario.anchorId)).toBeInViewport();
    const after = await page.evaluate(() => scrollY);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
    await expect(
      transferRow(page, scenario.sourceId).locator('input[type="checkbox"]'),
    ).toBeChecked();
    scrollRestoration = {
      before,
      after,
      sourceVisible: true,
      anchorVisible: true,
    };
  } else for (const id of scenario.requestedIds) await checkActualCheckbox(id);
  const column = scenario.sourcePrefix === "c" ? "candidate" : "execute";
  const header = page.getByRole("button", {
    name:
      column === "candidate"
        ? /選択したアイテムを実行列に移動/
        : /選択したアイテムを実行列から戻す/,
  });
  const countLabel =
    scenario.requestedIds.length === scenario.effectiveIds.length
      ? `${scenario.requestedIds.length}件`
      : `選択${scenario.requestedIds.length}件（移動${scenario.effectiveIds.length}件）`;
  await expect(header).toContainText(countLabel);
  const headerText = (await header.innerText()).replace(/\s/g, "");
  expect(headerText.endsWith(`(${countLabel})`)).toBe(true);
  const mountedCheckedIds = await page.evaluate(
    (column) =>
      [
        ...document.querySelectorAll<HTMLInputElement>(
          `[data-shopping-drag-column="${column}"] [data-item-id]:not([data-space-group-key]):not(.esp-shopping-touch-clone) input[type="checkbox"]:checked`,
        ),
      ].map(
        (input) =>
          input.closest<HTMLElement>("[data-item-id]")!.dataset.itemId!,
      ),
    column,
  );
  expect(
    mountedCheckedIds.every((id) => scenario.requestedIds.includes(id)),
  ).toBe(true);
  expect(checkboxChecks.map((entry) => entry.targetId).sort()).toEqual(
    [...scenario.requestedIds].sort(),
  );
  const requestedItems = scenario.backup.data.eventLists[
    transferEventName
  ].filter((item) => scenario.requestedIds.includes(item.id));
  const requestedDisplayOrder =
    column === "candidate"
      ? defaultCandidateOrder(requestedItems)
      : scenario.requestedIds;
  expect(mountedCheckedIds).toEqual(
    requestedDisplayOrder.filter((id) => mountedCheckedIds.includes(id)),
  );
  scenario.preparationProof = {
    requestedIds: [...scenario.requestedIds],
    requestedDisplayOrder,
    checkboxChecks,
    headerText,
    requestedCount: scenario.requestedIds.length,
    effectiveCount: scenario.effectiveIds.length,
    mountedCheckedIds,
    exactSelectionVerified: true,
    scrollRestoration,
  };
  const options: TransferMeasurementOptions = {
    sourceId: scenario.sourceId,
    anchorId: scenario.anchorId,
    expectedTransferredIds: scenario.effectiveIds,
    nextInputTarget: "topmost-visible-unmoved-destination",
    anchorPosition: scenario.anchorPosition,
    guideKind: "either",
    scenarioEvidence: { selectionPreparation: scenario.preparationProof },
  };
  if (condition.scenario === "collapsed") {
    const selector = `[data-shopping-drag-column="${scenario.targetPrefix === "e" ? "execute" : "candidate"}"] [data-space-group-key="A-90a"]`;
    await page.locator(selector).click();
    await expect(transferRow(page, `${scenario.targetPrefix}0`)).toHaveCount(0);
    options.gestureTargetSelector = selector;
    options.scenarioEvidence = {
      ...options.scenarioEvidence,
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
    // A virtualized offscreen row may not exist. Do not wait for it or reveal it.
    const observation = await page.evaluate((targetId) => {
      const row = document.querySelector<HTMLElement>(
        '[data-item-id="' +
          targetId +
          '"]:not([data-space-group-key]):not(.esp-shopping-touch-clone)',
      );
      const r = row?.getBoundingClientRect();
      return {
        mounted: !!row,
        bounds: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
      };
    }, targetId);
    const box = observation.bounds;
    const viewport = page.viewportSize()!;
    const outside = !box || box.y + box.height <= 0 || box.y >= viewport.height;
    expect(
      outside,
      "merge destination must actually be outside the viewport",
    ).toBe(true);
    options.scenarioEvidence = {
      ...options.scenarioEvidence,
      offscreenTargetId: targetId,
      targetBounds: box,
      targetMounted: observation.mounted,
      viewport,
      offscreenBeforeDrop: outside,
    };
  }
  if (condition.scenario === "auto-scroll") {
    options.recaptureAfterGesture = true;
    options.gesture = async () => {
      const initialGesture = await beginGesture(
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
        ...initialGesture,
        finalTargetPoint: { x: box!.x + 6, y: box!.y + box!.height * 0.8 + 1 },
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
  const reverseOrder =
    condition.direction === "execute-to-candidate"
      ? reverseCandidateOrderExpectation(
          {
            items: before.items as OracleItem[],
            executeIds: before.executeIds,
          },
          scenario.effectiveIds,
          {
            anchorId: scenario.anchorId,
            ...(condition.scenario === "collapsed"
              ? { collapsedFirstMemberId: `${scenario.targetPrefix}0` }
              : {}),
          },
        )
      : null;
  let candidateOrderProof = null;
  if (reverseOrder) {
    expect(after.items.map((item) => item.id)).toEqual(
      reverseOrder.expectedItemOrder,
    );
    expect(after.executeIds).toEqual(reverseOrder.expectedExecuteIds);
    expect(afterDestinationIds).toEqual(reverseOrder.expectedRawCandidateIds);
    expect(mountedDestinationIds).toEqual(
      reverseOrder.expectedDisplayIds.filter((id) =>
        mountedDestinationIds.includes(id),
      ),
    );
    candidateOrderProof = {
      ...reverseOrder,
      actualItemOrder: after.items.map((item) => item.id),
      actualExecuteIds: after.executeIds,
      actualRawCandidateIds: afterDestinationIds,
      actualMountedDisplayIds: mountedDestinationIds,
      rawOrderVerified: true,
      defaultDisplayOrderVerified: true,
    };
  } else {
    // Forward transfer modifies execution order, never the full item-array order.
    expect(after.items.map((item) => item.id)).toEqual(
      before.items.map((item) => item.id),
    );
  }
  const mergeTailProof = (reverseOrder ? [] : [...mergedVisits]).map(
    ([key, targetId]) => {
      const existingIds = beforeDestinationIds.filter(
        (id) => visitKey(id) === key,
      );
      const appendedIds = sourceIds.filter(
        (id) => scenario.effectiveIds.includes(id) && visitKey(id) === key,
      );
      const expectedIds = [...existingIds, ...appendedIds];
      const durableIds = afterDestinationIds.filter(
        (id) => visitKey(id) === key,
      );
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
    },
  );
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
    offscreenIdentityProof:
      condition.scenario === "offscreen"
        ? {
            ...mergeProof.find(
              (pair) => pair.target === `${scenario.targetPrefix}249`,
            )!,
            beforeItemPreserved: true,
          }
        : null,
    mergeTailProof,
    candidateOrderProof,
    selectionPreparation: scenario.preparationProof,
    visibleTransferredIds,
    offscreenTransferredIds: scenario.effectiveIds.filter(
      (id) => !visibleTransferredIds.includes(id),
    ),
  };
}
