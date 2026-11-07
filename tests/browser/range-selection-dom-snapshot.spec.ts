import { expect, test, type Page } from "@playwright/test";
import { readRangeSelectionDomSnapshot } from "./range-selection-dom-snapshot";

test.use({ video: "off", trace: "off", viewport: { width: 800, height: 600 } });

type Fault =
  | "none"
  | "missing"
  | "duplicate"
  | "order"
  | "attribute"
  | "state"
  | "geometry"
  | "top";
const count = 120;
const selected = ["r25", "r26", "r27"];

async function fixture(page: Page, fault: Fault = "none") {
  await page.goto("about:blank");
  await page.setContent(
    '<style>body{margin:0}#rows{position:relative}input{margin:0}</style><main id="rows"></main>',
  );
  await page.evaluate(
    ({ count, selected, fault }) => {
      const root = document.getElementById("rows")!;
      root.style.height = `${count * 100}px`;
      let initial = true;
      const render = () => {
        const first = Math.max(1, Math.floor(scrollY / 100) - 8);
        const last = Math.min(
          count,
          Math.ceil((scrollY + innerHeight) / 100) + 8,
        );
        root.replaceChildren();
        const positions = Array.from(
          { length: last - first + 1 },
          (_, index) => first + index,
        );
        // A pinned distant card is mounted throughout, like a retained focus row.
        if (!positions.includes(count)) positions.push(count);
        for (const position of positions) {
          if (fault === "missing" && position === 37) continue;
          if (fault === "top" && position === 1) continue;
          const accessible = document.createElement("div");
          accessible.style.cssText = `position:absolute;top:${(position - 1) * 100}px;height:100px;width:100%`;
          accessible.setAttribute("aria-posinset", String(position));
          accessible.setAttribute("aria-setsize", String(count));
          const card = document.createElement("div");
          const id =
            fault === "order" && (position === 25 || position === 26)
              ? `r${position === 25 ? 26 : 25}`
              : `r${position}`;
          card.dataset.itemId = id;
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = selected.includes(id);
          if (fault === "state" && position === 25) input.checked = false;
          card.dataset.isSelected = String(input.checked);
          if (fault === "attribute" && position === 25)
            card.dataset.isSelected = String(!input.checked);
          card.append(input);
          accessible.append(card);
          if (fault === "geometry" && initial && position === last) {
            // Simulate a stale mounted-row measurement: coverage must fall back.
            accessible.getBoundingClientRect = () =>
              new DOMRect(0, 0, innerWidth, count * 100);
          }
          root.append(accessible);
          if (fault === "duplicate" && position === 37) {
            const duplicate = accessible.cloneNode(true) as HTMLElement;
            duplicate.querySelector<HTMLElement>(
              "[data-item-id]",
            )!.dataset.itemId = "duplicate";
            root.append(duplicate);
          }
        }
        root
          .querySelector<HTMLInputElement>(`[data-item-id="r${count}"] input`)!
          .focus({ preventScroll: true });
        if (scrollY > 0) initial = false;
      };
      addEventListener("scroll", render);
      render();
    },
    { count, selected, fault },
  );
}

async function snapshot(page: Page, strategy: "adaptive" | "fixed") {
  const result = await page.evaluate(readRangeSelectionDomSnapshot, {
    count,
    strategy,
  });
  expect(result.rowPositions.map(([position]) => position)).toEqual(
    Array.from({ length: count }, (_, index) => index + 1),
  );
  expect(result.observedOrder).toEqual(
    Array.from({ length: count }, (_, index) => `r${index + 1}`),
  );
  expect(result.selectedIds).toEqual(selected);
  return result;
}

test("range DOM snapshot retains exhaustive evidence with fewer stabilized scrolls", async ({
  page,
}, testInfo) => {
  await fixture(page);
  const fixedStarted = performance.now();
  const fixed = await snapshot(page, "fixed");
  const fixedElapsedMs = performance.now() - fixedStarted;
  await fixture(page);
  const adaptiveStarted = performance.now();
  const adaptive = await snapshot(page, "adaptive");
  const adaptiveElapsedMs = performance.now() - adaptiveStarted;
  for (const key of ["observedOrder", "rowPositions", "selectedIds"] as const)
    expect(adaptive[key]).toEqual(fixed[key]);
  expect(adaptive.initialScrollAttempts[0]).toEqual(
    fixed.initialScrollAttempts[0],
  );
  await testInfo.attach("range-dom-snapshot-harness-comparison", {
    body: JSON.stringify(
      {
        diagnosticOnly: true,
        acceptanceMeasurement: false,
        method:
          "synthetic virtual DOM traversal; elapsed time is harness duration, not application latency",
        count,
        equivalent: {
          allDisplayPositions: true,
          exactIdOrder: true,
          selection: true,
        },
        fixed: {
          elapsedMs: fixedElapsedMs,
          traversal: fixed.traversal,
          rowPositions: fixed.rowPositions,
          observedOrder: fixed.observedOrder,
          selectedIds: fixed.selectedIds,
        },
        adaptive: {
          elapsedMs: adaptiveElapsedMs,
          traversal: adaptive.traversal,
          rowPositions: adaptive.rowPositions,
          observedOrder: adaptive.observedOrder,
          selectedIds: adaptive.selectedIds,
        },
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(adaptive.traversal.adaptiveSteps).toBeGreaterThan(0);
  expect(adaptive.traversal.fallbackReason).toBeNull();
  expect(adaptive.traversal.steps).toBeLessThan(fixed.traversal.steps * 0.6);
});

test("range DOM snapshot falls back to exhaustive fixed steps after misleading geometry", async ({
  page,
}) => {
  await fixture(page, "geometry");
  const fixed = await snapshot(page, "fixed");
  await fixture(page, "geometry");
  const adaptive = await snapshot(page, "adaptive");
  expect(adaptive.rowPositions).toEqual(fixed.rowPositions);
  expect(adaptive.selectedIds).toEqual(fixed.selectedIds);
  expect(adaptive.traversal.fallbackReason).toBe("gap-after-adaptive-step");
  expect(adaptive.traversal.fallbackSteps).toBeGreaterThan(0);
});

for (const fault of [
  "missing",
  "duplicate",
  "order",
  "attribute",
  "state",
  "top",
] as const)
  test(`range DOM snapshot rejects ${fault} evidence in both traversal strategies`, async ({
    page,
  }) => {
    for (const strategy of ["fixed", "adaptive"] as const) {
      await fixture(page, fault);
      await expect(snapshot(page, strategy)).rejects.toThrow();
    }
  });
