import type { Locator } from "@playwright/test";

export const shoppingInstrumentVersion = "shopping-rendering-v1";
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
  return locator.evaluate(
    async (root, { selector, expected, swipe }) => {
      const button = root.matches(selector)
        ? root
        : root.querySelector(selector);
      if (!button) throw new Error("Missing measured input target");
      const visible = (element: Element | null): element is HTMLElement =>
        element instanceof HTMLElement &&
        !element.closest('[hidden], [aria-hidden="true"]') &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== "hidden";
      const visitItemIds = expected.visitItemIds
        ? new Set(expected.visitItemIds)
        : undefined;
      const matches = () => {
        const row =
          Array.from(
            document.querySelectorAll(
              visitItemIds
                ? '[data-testid="focus-mode-scroll-region"] [data-item-id]'
                : `[data-item-id="${CSS.escape(expected.targetId)}"]:not(.esp-shopping-touch-clone)`,
            ),
          ).find(
            (entry) =>
              visible(entry) &&
              (!visitItemIds || visitItemIds.has(entry.dataset.itemId!)),
          ) ?? null;
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
          const header = document.querySelector(
            '[data-testid="focus-mode-header"]',
          );
          if (
            !visible(header) ||
            !header.textContent?.includes(expected.visitNumber)
          )
            return false;
          if (!row.closest('[data-testid="focus-mode-scroll-region"]'))
            return false;
        }
        return true;
      };
      let resolveUi!: (value: {
        uiMs: number;
        matched: boolean;
        reason?: string;
      }) => void;
      const ui = new Promise<{
        uiMs: number;
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
          uiMs: performance.now() - start,
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
        root.closest(
          '[data-testid="focus-mode-scroll-region"], [data-list-renderer]',
        ) ?? document.body;
      observer.observe(scope, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      if (scope !== document.body)
        observer.observe(document.body, { childList: true });
      start = performance.now();
      const timeout = setTimeout(
        () => finish(false, "Expected target UI did not settle within 15000ms"),
        15000,
      );
      if (swipe) {
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
      } else (button as HTMLButtonElement).click();
      const legacy = new Promise<number>((resolve) => {
        requestAnimationFrame(() =>
          setTimeout(() => resolve(performance.now() - start), 0),
        );
      });
      check(); // React may already have applied the expected UI synchronously.
      const [legacyMs, result] = await Promise.all([legacy, ui]);
      observer.disconnect();
      return { legacyMs, ...result, targetId: expected.targetId, expected };
    },
    { selector, expected, swipe },
  );
}
