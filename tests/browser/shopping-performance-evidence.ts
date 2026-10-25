import type { Locator, Page } from "@playwright/test";
import {
  performanceAcceptanceCriteriaForGroup as criteriaForGroup,
  performanceSamplingProfile,
  resolvePerformanceProfile,
} from "../../scripts/shopping-performance-evidence-contract.mjs";

export const performanceMeasurementProfile = resolvePerformanceProfile(
  undefined,
  process.env,
);
export const performanceMeasurementSampleCount = performanceSamplingProfile(
  performanceMeasurementProfile,
).sampleCount;
export const performanceAcceptanceCriteriaForGroup = (group: string) =>
  criteriaForGroup(group, performanceMeasurementProfile);
export const shoppingPerformanceThresholds =
  performanceAcceptanceCriteriaForGroup("shopping").acceptanceThresholds;
export const shoppingInstrumentVersion = "shopping-rendering-v3";
export function shoppingEvidenceIdentity(
  group: "shopping" | "range" | "drag" | "transfer",
  measurementKind: "response" | "frame" = "response",
) {
  return {
    schemaVersion: 1,
    instrumentVersion: shoppingInstrumentVersion,
    phase: process.env.ESP_EVIDENCE_PHASE ?? "standalone",
    runId: process.env.ESP_EVIDENCE_RUN_ID ?? "standalone",
    group,
    measurementKind,
    diagnosticOnly: false,
    acceptanceMeasurement: true,
    ...performanceAcceptanceCriteriaForGroup(group),
  };
}

export type ShoppingUiExpectation = {
  targetId: string;
  status?: "購入済" | "売切";
  dialog?: "visible" | "hidden";
  visitNumber?: string;
  visitItemIds?: string[];
};

/** Both endpoints use the same page clock; the UI observer never delays the legacy endpoint. */
export async function measureShoppingResponse(
  locator: Locator,
  selector: string,
  expected: ShoppingUiExpectation,
  swipe?: "next" | "back",
) {
  if (
    arguments.length > 4 ||
    (swipe !== undefined && swipe !== "next" && swipe !== "back")
  )
    throw new Error(
      "Measured response requires its own input; observe-only options are setup-only",
    );
  const result = await observeShoppingResponse(
    locator,
    selector,
    expected,
    swipe,
    true,
  );
  if (result.legacyMs === null || result.uiMs === null)
    throw new Error("Missing measured response clocks");
  return { ...result, legacyMs: result.legacyMs, uiMs: result.uiMs };
}

/** The same expected UI and post-frame acknowledgement, without reading either clock. */
export async function prepareShoppingResponse(
  locator: Locator,
  selector: string,
  expected: ShoppingUiExpectation,
  swipe?: "next" | "back",
) {
  const {
    matched,
    reason,
    targetId,
    expected: acknowledged,
  } = await observeShoppingResponse(locator, selector, expected, swipe, false);
  return { matched, reason, targetId, expected: acknowledged };
}

/** Acknowledge an already dispatched setup input without another click or clock. */
export async function acknowledgeShoppingResponse(
  locator: Locator,
  selector: string,
  expected: ShoppingUiExpectation,
) {
  const {
    matched,
    reason,
    targetId,
    expected: acknowledged,
  } = await observeShoppingResponse(
    locator,
    selector,
    expected,
    undefined,
    false,
    false,
  );
  return { matched, reason, targetId, expected: acknowledged };
}

async function observeShoppingResponse(
  locator: Locator,
  selector: string,
  expected: ShoppingUiExpectation,
  swipe: "next" | "back" | undefined,
  measured: boolean,
  dispatchInput = true,
) {
  return locator.evaluate(
    async (root, { selector, expected, swipe, measured, dispatchInput }) => {
      const button = root.matches(selector)
        ? root
        : root.querySelector(selector);
      if (!button) throw new Error("Missing measured input target");
      const visible = (element: Element | null): element is HTMLElement =>
        element instanceof HTMLElement &&
        !element.closest('[hidden], [aria-hidden="true"]') &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden";
      const visitOrder = expected.visitNumber
        ? (expected.visitItemIds ?? [expected.targetId])
        : undefined;
      const visitItemIds = visitOrder ? new Set(visitOrder) : undefined;
      const visitPositions = visitOrder
        ? new Map(visitOrder.map((id, index) => [id, index]))
        : undefined;
      const focusRegion = visitItemIds
        ? document.querySelector<HTMLElement>(
            '[data-testid="focus-mode-scroll-region"]',
          )
        : null;
      const focusHeader = visitItemIds
        ? document.querySelector('[data-testid="focus-mode-header"]')
        : null;
      // Focus visits retain offscreen/hidden rows. Check only slots intersecting
      // the scroll viewport, including slots whose real card is still deferred.
      // FocusVisitRows keeps one logical slot per visit item, including deferred
      // cards. Its child count proves that a temporarily absent slot cannot make
      // the remaining first card sufficient. No offscreen real card is required.
      // Stop geometry reads below the viewport; other virtual renderers without
      // that retained-slot contract need only cover the visible frontier.
      const visibleVisitRow = (): HTMLElement | null => {
        if (!visible(focusRegion)) return null;
        const regionRect = focusRegion.getBoundingClientRect();
        const top = Math.max(0, regionRect.top);
        const bottom = Math.min(innerHeight, regionRect.bottom);
        const left = Math.max(0, regionRect.left);
        const right = Math.min(innerWidth, regionRect.right);
        if (bottom <= top || right <= left) return null;
        const lists = Array.from(
          focusRegion.querySelectorAll<HTMLElement>("[data-viewport-list]"),
        ).filter(visible);
        const candidates = lists.length
          ? lists.map((list) => ({
              retained: true,
              rows: list.children,
            }))
          : [
              {
                retained: false,
                rows: Array.from(
                  focusRegion.querySelectorAll(
                    "[data-item-id]:not(.esp-shopping-touch-clone), [data-viewport-focus-sentinel], .esp-viewport-placeholder",
                  ),
                ),
              },
            ];
        let first: HTMLElement | null = null;
        let previousPosition: number | undefined;
        let lastBottom = top;
        let continuationBelowViewport = false;
        for (const { retained, rows } of candidates) {
          if (retained && rows.length !== visitOrder!.length) return null;
          for (let slotIndex = 0; slotIndex < rows.length; slotIndex++) {
            const slot = rows[slotIndex];
            if (!visible(slot)) continue;
            const rect = slot.getBoundingClientRect();
            if (rect.top >= bottom) {
              continuationBelowViewport = true;
              if (retained) break;
            }
            if (
              rect.bottom <= top ||
              rect.top >= bottom ||
              rect.right <= left ||
              rect.left >= right
            )
              continue;
            const row = slot.matches("[data-item-id]")
              ? slot
              : slot.querySelector<HTMLElement>(
                  "[data-item-id]:not(.esp-shopping-touch-clone)",
                );
            if (
              !visible(row) ||
              !visitItemIds!.has(row.dataset.itemId!) ||
              (retained && row.dataset.itemId !== visitOrder![slotIndex]) ||
              slot.matches(
                '[data-viewport-active="false"], [data-viewport-focus-sentinel], .esp-viewport-placeholder',
              ) ||
              slot.querySelector(
                '[data-viewport-active="false"], [data-viewport-focus-sentinel], .esp-viewport-placeholder',
              )
            )
              return null;
            const position = visitPositions!.get(row.dataset.itemId!)!;
            if (
              previousPosition !== undefined &&
              position !== previousPosition + 1
            )
              return null;
            previousPosition = position;
            lastBottom = Math.max(lastBottom, rect.bottom);
            first ??= row;
          }
        }
        // A virtual renderer may omit offscreen DOM, but cannot leave room for
        // an expected next row and claim that only the first row has settled.
        if (
          first &&
          previousPosition! < visitOrder!.length - 1 &&
          lastBottom < bottom &&
          !continuationBelowViewport
        )
          return null;
        return first;
      };
      const matches = () => {
        const row = visitItemIds
          ? visibleVisitRow()
          : (Array.from(
              document.querySelectorAll(
                `[data-item-id="${CSS.escape(expected.targetId)}"]:not(.esp-shopping-touch-clone)`,
              ),
            ).find(visible) ?? null);
        if (!visible(row)) return false;
        if (expected.status) {
          const status = row.querySelector(
            'button[aria-label^="Current status:"]',
          );
          if (
            !visible(status) ||
            !status.getAttribute("aria-label")?.includes(expected.status)
          )
            return false;
        }
        if (expected.dialog) {
          const dialog = Array.from(
            document.querySelectorAll('[role="dialog"]'),
          ).find(
            (entry) =>
              entry.getAttribute("aria-label") === "事後通販･頒布可否確認" ||
              entry.textContent?.includes("事後通販･頒布可否確認"),
          );
          if (
            expected.dialog === "visible"
              ? !visible(dialog ?? null)
              : visible(dialog ?? null)
          )
            return false;
        }
        if (expected.visitNumber) {
          if (
            !visible(focusHeader) ||
            !focusHeader.textContent?.includes(expected.visitNumber)
          )
            return false;
          if (!row.closest('[data-testid="focus-mode-scroll-region"]'))
            return false;
        }
        return true;
      };
      let resolveUi!: (value: {
        uiMs: number | null;
        matched: boolean;
        reason?: string;
      }) => void;
      const ui = new Promise<{
        uiMs: number | null;
        matched: boolean;
        reason?: string;
      }>((resolve) => {
        resolveUi = resolve;
      });
      let pending = false;
      let finished = false;
      let start = 0;
      const observer = new MutationObserver(() => check());
      const finish = (matched: boolean, reason?: string) => {
        if (finished) return;
        finished = true;
        observer.disconnect();
        clearTimeout(timeout);
        resolveUi({
          uiMs: measured ? performance.now() - start : null,
          matched,
          ...(reason ? { reason } : {}),
        });
      };
      const check = () => {
        if (finished || pending || !matches()) return;
        pending = true;
        requestAnimationFrame(() =>
          setTimeout(() => {
            pending = false;
            if (matches()) finish(true);
            else check();
          }, 0),
        );
      };
      // Restrict observation to the current list/focus root and the modal host.
      const scope =
        focusRegion ??
        root.closest(
          '[data-testid="focus-mode-scroll-region"], [data-list-renderer]',
        ) ??
        document.body;
      observer.observe(scope, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      if (focusHeader && !scope.contains(focusHeader))
        observer.observe(focusHeader, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      if (scope !== document.body)
        observer.observe(document.body, { childList: true });
      start = measured ? performance.now() : 0;
      const timeout = setTimeout(
        () => finish(false, "Expected target UI did not settle within 15000ms"),
        15000,
      );
      if (dispatchInput && swipe) {
        const emit = (type: string, x: number) => {
          const point = { clientX: x, clientY: 200 };
          const event = new Event(type, { bubbles: true });
          Object.defineProperties(event, {
            touches: { value: type === "touchend" ? [] : [point] },
            changedTouches: { value: [point] },
          });
          root.dispatchEvent(event);
        };
        emit("touchstart", 200);
        emit("touchmove", swipe === "next" ? 80 : 320);
        emit("touchend", swipe === "next" ? 80 : 320);
      } else if (dispatchInput) (button as HTMLButtonElement).click();
      const legacy = measured
        ? new Promise<number>((resolve) => {
            requestAnimationFrame(() =>
              setTimeout(() => resolve(performance.now() - start), 0),
            );
          })
        : Promise.resolve(null);
      check(); // React may already have applied the expected UI synchronously.
      const [legacyMs, result] = await Promise.all([legacy, ui]);
      observer.disconnect();
      return { legacyMs, ...result, targetId: expected.targetId, expected };
    },
    { selector, expected, swipe, measured, dispatchInput },
  );
}
/** Capture actual case settings after measurement, outside every response clock. */
export async function shoppingBrowserEnvironment(page: Page, retry: number) {
  const actual = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio,
  }));
  const browserVersion = page.context().browser()?.version();
  if (!browserVersion)
    throw new Error("Measured browser version is unavailable");
  return {
    ...actual,
    browserVersion,
    browserChannel:
      process.env.PERFORMANCE_BROWSER_CHANNEL ?? "bundled-chromium",
    headed: process.env.PERFORMANCE_HEADED === "1",
    workers: 1,
    retries: retry,
  };
}
