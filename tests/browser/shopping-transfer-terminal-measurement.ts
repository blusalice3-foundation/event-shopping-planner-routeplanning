import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  expect,
  type CDPSession,
  type Page,
  type TestInfo,
  type Worker,
} from "@playwright/test";
import {
  createTransferFixture,
  installCommitProbe,
  restoreTransferFixture,
  transferEventName,
  transferRow,
  waitForTransferIdle,
  type TransferCondition,
  type TransferSample,
} from "./shopping-transfer-measurement";

export type TerminalCondition = {
  count: 500;
  grouped: false;
  load: "light";
  input: "native" | "touch";
  scenario: "noop" | "reject" | "cancel" | "same-column";
  direction: "execute-to-execute" | "candidate-to-execute";
};
export const terminalConditions: TerminalCondition[] = (
  ["native", "touch"] as const
).flatMap((input) =>
  (["noop", "reject", "cancel", "same-column"] as const).map((scenario) => ({
    count: 500 as const,
    grouped: false as const,
    load: "light" as const,
    input,
    scenario,
    direction:
      scenario === "reject"
        ? ("candidate-to-execute" as const)
        : ("execute-to-execute" as const),
  })),
);
const day = "1日目";
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
type Rect = { x: number; y: number; width: number; height: number };
type Trace = {
  name: string;
  pid: number;
  ts: number;
  args?: { data?: { clip?: number[] } };
};
type Commit = {
  at: number;
  stores: string[];
  operationId?: string;
  writes: unknown[];
};
export async function restoreTerminalFixture(
  page: Page,
  condition: TerminalCondition,
  frame: boolean,
) {
  const base: TransferCondition = {
    ...condition,
    direction: "execute-to-candidate",
  };
  const backup = createTransferFixture(base);
  if (condition.scenario === "reject") {
    for (const item of backup.data.eventLists[transferEventName])
      if (item.id.startsWith("e")) item.block = "B";
    Object.assign(backup.data.hallDefinitions, {
      [transferEventName]: {
        [`__mapless__:${day}`]: [
          { id: "hall-a", name: "Aホール", vertices: [], blockNames: ["A"] },
          { id: "hall-b", name: "Bホール", vertices: [], blockNames: ["B"] },
        ],
      },
    });
  }
  return restoreTransferFixture(page, base, frame, backup);
}
async function selectRange(page: Page, selected: string[]) {
  const clear = page.getByRole("button", { name: "選択を解除", exact: true });
  if (await clear.count()) await clear.click();
  await transferRow(page, selected[0]).getByRole("checkbox").check();
  await transferRow(page, selected[2]).getByRole("checkbox").check();
  await page
    .getByTitle("範囲内のチェックを入れる", { exact: true })
    .first()
    .click();
  for (const id of selected)
    await expect(transferRow(page, id).getByRole("checkbox")).toBeChecked();
  await expect(
    page.getByTitle("範囲内のチェックを外す", { exact: true }).first(),
  ).toBeVisible();
}
const pointerClick = (session: CDPSession, point: { x: number; y: number }) =>
  Promise.all([
    session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
      timestamp: Date.now() / 1000,
    }),
    session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
      timestamp: Date.now() / 1000,
    }),
  ]);
async function gesture(
  page: Page,
  session: CDPSession,
  condition: TerminalCondition,
  id: string,
  anchor: string,
) {
  const source = await transferRow(page, id).boundingBox(),
    target = await transferRow(page, anchor).boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  const from = { x: source!.x + 4, y: source!.y + 35 };
  const to = { x: target!.x + 4, y: target!.y + target!.height * 0.8 };
  if (condition.input === "native") {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 8, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.move(to.x + 1, to.y + 1);
  } else {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...from, id: 1 }],
    });
    await expect(page.locator(".esp-shopping-touch-clone")).toBeVisible();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...to, id: 1 }],
    });
  }
  if (condition.scenario === "reject")
    await expect(
      page.locator('[data-shopping-drag-status="rejected"]'),
    ).toBeVisible();
}
async function arm(
  page: Page,
  condition: TerminalCondition,
  selected: string[],
  beforeOrder: string[],
  nextId: string,
  measurementId: string,
) {
  return page.evaluate(
    ({ condition, selected, beforeOrder, nextId, measurementId }) => {
      const state = {
        startEpoch: 0,
        startMs: 0,
        markerDelayMs: 0,
        responseMs: null as number | null,
        domMs: null as number | null,
        trusted: false,
        response: undefined as Record<string, unknown> | undefined,
        clicks: [] as Array<Record<string, unknown>>,
        failure: undefined as string | undefined,
      };
      const root = document.querySelector(
        '[data-shopping-drag-column="' +
          (condition.scenario === "reject" ? "candidate" : "execute") +
          '"]',
      )!;
      const checked = () =>
        selected.every(
          (id) =>
            (
              root.querySelector(
                '[data-item-id="' + id + '"] input[type="checkbox"]',
              ) as HTMLInputElement | null
            )?.checked,
        );
      const endpoints = () =>
        [...root.querySelectorAll('[title="範囲内のチェックを外す"]')].length;
      const cleanup = () =>
        !document.querySelector(
          "[data-shopping-drag-guide], [data-shopping-drag-status], .esp-shopping-touch-clone",
        );
      const order = () =>
        [
          ...root.querySelectorAll<HTMLElement>(
            "[data-item-id]:not([data-space-group-key])",
          ),
        ].map((row) => row.dataset.itemId!);
      const expectedOrder =
        condition.scenario === "same-column"
          ? (() => {
              const without = beforeOrder.filter(
                (id) => !selected.includes(id),
              );
              const target = without.indexOf("e4");
              without.splice(target + 1, 0, ...selected);
              return without;
            })()
          : beforeOrder;
      const correct = () =>
        cleanup() &&
        checked() &&
        (condition.scenario === "noop" || condition.scenario === "same-column"
          ? endpoints() === 0
          : endpoints() > 0) &&
        expectedOrder.slice(0, 7).every((id, index) => order()[index] === id);
      const observer = new MutationObserver(check);
      let pending = false;
      const timeout = setTimeout(() => {
        state.failure = "Terminal UI did not settle within 15000ms";
        observer.disconnect();
      }, 15000);
      function check() {
        if (
          !state.startEpoch ||
          state.responseMs !== null ||
          pending ||
          !correct()
        )
          return;
        state.domMs = performance.now() - state.startMs;
        performance.mark(measurementId + ":dom");
        pending = true;
        requestAnimationFrame(() =>
          setTimeout(() => {
            pending = false;
            if (!correct()) {
              check();
              return;
            }
            const first = root.querySelector<HTMLElement>(
              '[data-item-id="' + selected[0] + '"]',
            )!;
            const box = first.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + 20, box.y + 30);
            state.responseMs = performance.now() - state.startMs;
            state.response = {
              selectionBeforeIds: selected,
              selectionAfterIds: selected.filter(
                (id) =>
                  (
                    root.querySelector(
                      '[data-item-id="' + id + '"] input[type="checkbox"]',
                    ) as HTMLInputElement
                  )?.checked,
              ),
              endpointsCleared: endpoints() === 0,
              endpointsRetained: endpoints() > 0,
              guideCleared: true,
              cloneCleared: true,
              sourceInteractive: first.contains(hit),
              orderVerified: condition.scenario !== "same-column" || correct(),
            };
            observer.disconnect();
            clearTimeout(timeout);
          }, 0),
        );
      }
      const begin = (event: Event) => {
        if (state.startEpoch) return;
        state.startMs = event.timeStamp;
        state.startEpoch = performance.timeOrigin + event.timeStamp;
        state.trusted = event.isTrusted;
        state.markerDelayMs = performance.now() - state.startMs;
        performance.mark(measurementId + ":input");
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class", "style"],
        });
        check();
      };
      const click = (event: MouseEvent) => {
        const target = event.target as HTMLInputElement;
        if (!target.matches('input[type="checkbox"]') || !state.startEpoch)
          return;
        const eventEpoch = performance.timeOrigin + event.timeStamp;
        const targetId =
          target.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
        const expected =
          condition.scenario === "same-column"
            ? state.clicks.length === 0
            : true;
        requestAnimationFrame(() =>
          setTimeout(
            () =>
              state.clicks.push({
                eventEpoch,
                targetId,
                trusted: event.isTrusted,
                matched: targetId === nextId && target.checked === expected,
                durationMs: performance.now() - event.timeStamp,
              }),
            0,
          ),
        );
      };
      for (const name of ["drop", "dragend", "touchend", "touchcancel"])
        document.addEventListener(name, begin, { capture: true });
      document.addEventListener("click", click, true);
      const stop = () => {
        observer.disconnect();
        clearTimeout(timeout);
        for (const name of ["drop", "dragend", "touchend", "touchcancel"])
          document.removeEventListener(name, begin, true);
        document.removeEventListener("click", click, true);
      };
      Object.assign(window, {
        __shoppingTerminal: state,
        __shoppingTerminalStop: stop,
      });
    },
    { condition, selected, beforeOrder, nextId, measurementId },
  );
}
async function readState(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __shoppingTerminal: {
            startEpoch: number;
            markerDelayMs: number;
            responseMs: number | null;
            domMs: number | null;
            trusted: boolean;
            response: Record<string, unknown>;
            failure?: string;
            clicks: Array<{
              durationMs: number;
              eventEpoch: number;
              trusted: boolean;
              matched: boolean;
              targetId: string;
            }>;
          };
        }
      ).__shoppingTerminal,
  );
}
async function inkComparison(
  page: Page,
  frame: string,
  reference: string,
  baseline: string,
  rects: Rect[],
  controls: Rect[],
) {
  return page.evaluate(
    async ({ frame, reference, baseline, rects, controls }) => {
      const decode = async (data: string) =>
        createImageBitmap(
          new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], {
            type: "image/png",
          }),
        );
      const [actual, expected, before] = await Promise.all([
        decode(frame),
        decode(reference),
        decode(baseline),
      ]);
      const crop = (image: ImageBitmap, rect: Rect) => {
        const canvas = new OffscreenCanvas(128, 64),
          context = canvas.getContext("2d")!;
        context.drawImage(
          image,
          (rect.x * image.width) / innerWidth,
          (rect.y * image.height) / innerHeight,
          (rect.width * image.width) / innerWidth,
          (rect.height * image.height) / innerHeight,
          0,
          0,
          128,
          64,
        );
        return context.getImageData(0, 0, 128, 64).data;
      };
      const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        let error = 0,
          weight = 0;
        for (let i = 0; i < a.length; i += 4) {
          const ink = (p: Uint8ClampedArray) =>
            Math.max(
              0,
              170 - (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]),
            ) / 170;
          const x = ink(a),
            y = ink(b);
          error += Math.abs(x - y);
          weight += Math.max(x, y);
        }
        return weight ? error / weight : 0;
      };
      try {
        const controlErrors = controls.map((rect) =>
          difference(crop(actual, rect), crop(expected, rect)),
        );
        const scores = rects.map((rect) => ({
          frameError: difference(crop(actual, rect), crop(expected, rect)),
          baselineError: difference(crop(before, rect), crop(expected, rect)),
          controlErrors,
        }));
        return {
          method: "dark-ink-shape-v1",
          matched: scores.every(
            (score) =>
              score.baselineError > 0.001 &&
              score.frameError <= 0.025 &&
              score.frameError < score.baselineError * 0.55 &&
              score.controlErrors.every((error) => error <= 0.025),
          ),
          scores,
        };
      } finally {
        actual.close();
        expected.close();
        before.close();
      }
    },
    { frame, reference, baseline, rects, controls },
  );
}
export async function measureTerminal(
  page: Page,
  session: CDPSession,
  worker: Worker,
  condition: TerminalCondition,
  index: number,
  frame: boolean,
  testInfo: TestInfo,
): Promise<Record<string, TransferSample>> {
  const source = condition.scenario === "reject" ? "candidate" : "execute",
    prefix = source === "candidate" ? "c" : "e";
  const selected = [1, 2, 3].map((n) => prefix + n),
    id = selected[0],
    nextId = prefix + "0",
    anchor = condition.scenario === "same-column" ? "e4" : "e0";
  const measurementId = `terminal-${condition.scenario}-${index}`;
  await selectRange(page, selected);
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForTransferIdle(page);
  const beforeOrder = await page
    .locator(
      '[data-shopping-drag-column="' +
        source +
        '"] [data-item-id]:not([data-space-group-key])',
    )
    .evaluateAll((rows) =>
      rows.map((row) => (row as HTMLElement).dataset.itemId!),
    );
  const beforeFrame = frame
    ? await page.screenshot({ animations: "allow" })
    : undefined;
  const sourceBox = await transferRow(page, id).boundingBox();
  expect(sourceBox).not.toBeNull();
  const endpointBoxes =
    frame && condition.scenario === "noop"
      ? await page
          .getByTitle("範囲内のチェックを外す", { exact: true })
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const r = button.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            }),
          )
      : [];
  const nextBox = await transferRow(page, nextId)
    .getByRole("checkbox")
    .boundingBox();
  expect(nextBox).not.toBeNull();
  const nextPoint = {
    x: nextBox!.x + nextBox!.width / 2,
    y: nextBox!.y + nextBox!.height / 2,
  };
  const beforeCount = await worker.evaluate(
    () =>
      (globalThis as unknown as { __transferCommits: Commit[] })
        .__transferCommits.length,
  );
  const trace: Trace[] = [],
    frames: Array<{
      data: string;
      metadata: { timestamp?: number };
      sessionId: number;
      acknowledged: boolean;
    }> = [];
  const collect = (value: { value: Trace[] }) => trace.push(...value.value);
  const acknowledgements: Promise<unknown>[] = [];
  const capture = (event: {
    data: string;
    metadata: { timestamp?: number };
    sessionId: number;
  }) => {
    const record = { ...event, acknowledged: false };
    frames.push(record);
    acknowledgements.push(
      session
        .send("Page.screencastFrameAck", { sessionId: event.sessionId })
        .then(() => {
          record.acknowledged = true;
        }),
    );
  };
  let stopped = false;
  if (frame) {
    session.on("Tracing.dataCollected", collect);
    await session.send("Tracing.start", {
      categories:
        "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame",
      transferMode: "ReportEvents",
    });
    session.on("Page.screencastFrame", capture);
    await session.send("Page.startScreencast", {
      format: "png",
      maxWidth: 1440,
      maxHeight: 1000,
      everyNthFrame: 1,
    });
  }
  try {
    await gesture(page, session, condition, id, anchor);
    await arm(page, condition, selected, beforeOrder, nextId, measurementId);
    if (condition.input === "native") {
      if (condition.scenario === "cancel") await page.keyboard.press("Escape");
      await page.mouse.up();
    } else
      await session.send("Input.dispatchTouchEvent", {
        type: condition.scenario === "cancel" ? "touchCancel" : "touchEnd",
        touchPoints: [],
        timestamp: Date.now() / 1000,
      });
    if (!frame && condition.scenario === "same-column")
      await pointerClick(session, nextPoint);
    await page.waitForFunction(
      () => {
        const s = (
          window as unknown as {
            __shoppingTerminal: { responseMs: number | null; failure?: string };
          }
        ).__shoppingTerminal;
        return s.responseMs !== null || !!s.failure;
      },
      {},
      { timeout: 16000 },
    );
    let state = await readState(page);
    expect(state.failure).toBeUndefined();
    expect(state.trusted).toBe(true);
    expect(state.response.sourceInteractive).toBe(true);
    await waitForTransferIdle(page);
    const commits = await worker.evaluate(
      (before) =>
        (
          globalThis as unknown as { __transferCommits: Commit[] }
        ).__transferCommits.slice(before),
      beforeCount,
    );
    const saving = condition.scenario === "same-column";
    expect(commits).toHaveLength(saving ? 1 : 0);
    const common = {
      measurementId,
      targetId: id,
      matched: true,
      startEpoch: state.startEpoch,
      markerDelayMs: state.markerDelayMs,
      domMs: state.domMs,
      commits,
      physicalWriteCount: commits.length,
      operationId: saving ? (commits[0].operationId ?? null) : null,
      operationIdUnavailableReason:
        saving && !commits[0].operationId
          ? "Persistence request did not expose an operation ID"
          : undefined,
      trusted: state.trusted,
    };
    if (!frame) {
      let pending: (typeof state.clicks)[number] | undefined;
      if (saving) {
        await page.waitForFunction(
          () =>
            (window as unknown as { __shoppingTerminal: { clicks: unknown[] } })
              .__shoppingTerminal.clicks.length > 0,
        );
        state = await readState(page);
        pending = state.clicks[0];
        expect(pending.trusted).toBe(true);
        expect(pending.matched).toBe(true);
        expect(pending.eventEpoch).toBeGreaterThan(state.startEpoch);
        expect(pending.eventEpoch).toBeLessThan(commits[0].at);
      }
      const next = await transferRow(page, nextId)
        .getByRole("checkbox")
        .boundingBox();
      expect(next).not.toBeNull();
      const clickIndex = (await readState(page)).clicks.length;
      await pointerClick(session, {
        x: next!.x + next!.width / 2,
        y: next!.y + next!.height / 2,
      });
      await page.waitForFunction(
        (n) =>
          (window as unknown as { __shoppingTerminal: { clicks: unknown[] } })
            .__shoppingTerminal.clicks.length > n,
        clickIndex,
      );
      state = await readState(page);
      const applied = state.clicks.at(-1)!;
      expect(applied.trusted).toBe(true);
      expect(applied.matched).toBe(true);
      expect(applied.eventEpoch).toBeGreaterThan(
        saving ? commits[0].at : state.startEpoch,
      );
      return {
        response: {
          ...common,
          ...state.response,
          durationMs: state.responseMs!,
        },
        nextApplied: { ...common, ...applied, targetId: nextId },
        ...(saving
          ? {
              nextPending: { ...common, ...pending!, targetId: nextId },
              save: { ...common, durationMs: commits[0].at - state.startEpoch },
            }
          : {}),
      };
    }
    // This auxiliary final reference never replaces the earliest captured frame.
    await page.evaluate(async (itemId) => {
      const row = document.querySelector<HTMLElement>(
        `[data-item-id="${itemId}"]:not([data-space-group-key])`,
      )!;
      let previous = "",
        stable = 0;
      const began = performance.now();
      await new Promise<void>((resolve, reject) => {
        function check() {
          let opacity = 1;
          for (
            let node: HTMLElement | null = row;
            node;
            node = node.parentElement
          )
            opacity *= Number(getComputedStyle(node).opacity);
          const rect = row.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.x + 20,
            rect.y + Math.min(40, rect.height / 2),
          );
          const geometry = JSON.stringify([
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            scrollY,
          ]);
          stable =
            opacity >= 0.999 && row.contains(hit) && geometry === previous
              ? stable + 1
              : 0;
          previous = geometry;
          if (stable >= 3) {
            resolve();
            return;
          }
          if (performance.now() - began > 10000) {
            reject(
              new Error(
                "Terminal source never became opaque, hit-testable and stable",
              ),
            );
            return;
          }
          requestAnimationFrame(check);
        }
        requestAnimationFrame(check);
      });
    }, id);
    const targetBox = await transferRow(page, id).boundingBox();
    expect(targetBox).not.toBeNull();
    const reference = await page.screenshot({ animations: "allow" });
    await session.send("Page.stopScreencast");
    session.off("Page.screencastFrame", capture);
    await Promise.all(acknowledgements);
    const complete = new Promise<void>((resolve) =>
      session.once("Tracing.tracingComplete", resolve),
    );
    await session.send("Tracing.end");
    await complete;
    stopped = true;
    const input = trace.find(
        (event) => event.name === measurementId + ":input",
      ),
      dom = trace.find((event) => event.name === measurementId + ":dom");
    expect(input).toBeDefined();
    expect(dom).toBeDefined();
    const rect = (r: Rect): Rect => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: Math.min(r.height, 180),
    });
    const union = (a: Rect, b: Rect): Rect => {
      const x = Math.min(a.x, b.x),
        y = Math.min(a.y, b.y);
      return {
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
      };
    };
    const regions: Rect[] =
      condition.scenario === "noop"
        ? [
            union(rect(sourceBox!), endpointBoxes[0]),
            union(rect(sourceBox!), endpointBoxes.at(-1)!),
          ]
        : [rect(sourceBox!), rect(targetBox!)];
    const controlBoxes = await Promise.all(
      [selected[0], nextId].map(async (item) => {
        const box = await transferRow(page, item)
          .getByRole("checkbox")
          .boundingBox();
        expect(box).not.toBeNull();
        return box!;
      }),
    );
    const covers = (event: Trace, box: Rect) => {
      const clip = event.args?.data?.clip;
      if (!clip || clip.length < 8) return false;
      const x = clip.filter((_, i) => i % 2 === 0),
        y = clip.filter((_, i) => i % 2 === 1);
      return (
        Math.min(...x) <= box.x &&
        Math.max(...x) >= box.x + box.width &&
        Math.min(...y) <= box.y &&
        Math.max(...y) >= box.y + box.height
      );
    };
    let proof:
      | {
          captured: (typeof frames)[number];
          timestamp: number;
          sourcePaint: Trace;
          paint: Trace;
          draw: Trace;
          comparison: Awaited<ReturnType<typeof inkComparison>>;
        }
      | undefined;
    const comparisons: unknown[] = [];
    for (const captured of frames) {
      if (
        !captured.acknowledged ||
        !Number.isFinite(captured.metadata.timestamp)
      )
        continue;
      const timestamp =
        input!.ts +
        (captured.metadata.timestamp! * 1000 -
          state.startEpoch -
          state.markerDelayMs) *
          1000;
      const paints = trace.filter(
        (e) =>
          e.name === "Paint" &&
          e.pid === dom!.pid &&
          e.ts >= dom!.ts &&
          e.ts <= timestamp,
      );
      const sourcePaint = paints.find((e) => covers(e, regions[0])),
        paint = paints.find((e) => covers(e, regions[1]));
      if (!sourcePaint || !paint) continue;
      const draw = trace.find(
        (e) =>
          e.name === "DrawFrame" &&
          e.pid === dom!.pid &&
          e.ts >= Math.max(sourcePaint.ts, paint.ts) &&
          e.ts <= timestamp,
      );
      if (!draw) continue;
      const comparison = await inkComparison(
        page,
        captured.data,
        reference.toString("base64"),
        beforeFrame!.toString("base64"),
        regions,
        controlBoxes,
      );
      comparisons.push({ timestamp, comparison });
      if (comparison.matched) {
        proof = { captured, timestamp, sourcePaint, paint, draw, comparison };
        break;
      }
    }
    await testInfo.attach(measurementId + "-frame-verification", {
      body: JSON.stringify(comparisons),
      contentType: "application/json",
    });
    expect(proof, "No content-verified terminal frame").toBeDefined();
    const bytes = Buffer.from(proof!.captured.data, "base64");
    const metadata = Buffer.from(
      JSON.stringify({
        method: "Page.startScreencast",
        format: "png",
        maxWidth: 1440,
        maxHeight: 1000,
        everyNthFrame: 1,
        acknowledged: true,
        sessionId: proof!.captured.sessionId,
        metadata: proof!.captured.metadata,
        frameSha256: hash(bytes),
      }),
    );
    const files = {
      trace: Buffer.from(JSON.stringify({ traceEvents: trace })),
      frame: bytes,
      reference,
      baseline: beforeFrame!,
      frameMetadata: metadata,
    };
    const paths: Record<string, string> = {};
    for (const [name, data] of Object.entries(files)) {
      const json = name === "trace" || name === "frameMetadata";
      const filename = testInfo.outputPath(
        `${measurementId}-${name}.${json ? "json" : "png"}`,
      );
      await writeFile(filename, data);
      await testInfo.attach(`${measurementId}-${name}`, {
        path: filename,
        contentType: json ? "application/json" : "image/png",
      });
      paths[name + "Path"] = filename;
      paths[name + "Sha256"] = hash(data);
    }
    const durationMs =
      proof!.captured.metadata.timestamp! * 1000 - state.startEpoch;
    return {
      frame: {
        ...common,
        ...state.response,
        ...paths,
        durationMs,
        frameTimestampMs: durationMs,
        frameVerified: true,
        sourcePresent: true,
        sourceAbsent: false,
        sourceOriginVacated: saving,
        selectionVerified: true,
        visualTarget: saving ? "source-origin" : "endpoints",
        orderVerified: true,
        controlsVerified: true,
        captureMethod: "Page.startScreencast(png)",
        captureTimestampKind: "frame-swap-upper-bound",
        paintCorrelated: true,
        drawFrameCorrelated: true,
        correlation: {
          input: { pid: input!.pid, ts: input!.ts },
          dom: { pid: dom!.pid, ts: dom!.ts },
          sourcePaint: {
            pid: proof!.sourcePaint.pid,
            ts: proof!.sourcePaint.ts,
          },
          paint: { pid: proof!.paint.pid, ts: proof!.paint.ts },
          drawFrame: { pid: proof!.draw.pid, ts: proof!.draw.ts },
          frame: {
            epochMs: proof!.captured.metadata.timestamp! * 1000,
            traceTs: proof!.timestamp,
            sessionId: proof!.captured.sessionId,
          },
          sourceRect: regions[0],
          targetRect: regions[1],
          comparison: proof!.comparison,
        },
      },
    };
  } finally {
    await page.evaluate(() =>
      (
        window as unknown as { __shoppingTerminalStop?: () => void }
      ).__shoppingTerminalStop?.(),
    );
    if (frame) {
      if (!stopped) {
        await session.send("Page.stopScreencast").catch(() => {});
        const done = new Promise<void>((resolve) =>
          session.once("Tracing.tracingComplete", resolve),
        );
        await session
          .send("Tracing.end")
          .then(() => done)
          .catch(() => {});
      }
      session.off("Tracing.dataCollected", collect);
      session.off("Page.screencastFrame", capture);
    }
  }
}
export { installCommitProbe };
