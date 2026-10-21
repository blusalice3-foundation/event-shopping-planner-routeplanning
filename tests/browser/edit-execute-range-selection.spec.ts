import { shoppingEvidenceIdentity } from "./shopping-performance-evidence";
import { writeFile } from "node:fs/promises";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { summarizePerformanceSamples } from "./performance-summary";

// Match responsive-performance.spec.ts: no trace/video overhead in response timings.
test.use({
  video: "off",
  trace: "off",
  hasTouch: process.env.ESP_RANGE_WARMUP_MOUSE !== "1",
});

const eventName = "編集実行列の範囲選択";
const day = "1日目";
type Layout = "pc" | "smartphone";
type Renderer = "auto" | "full" | "virtual";
type RangeLength = "short" | "long";
type Operation =
  | "firstEndpoint"
  | "secondEndpoint"
  | "selectRange"
  | "clearRange";
type RangeCspViolation = {
  effectiveDirective: string;
  violatedDirective: string;
  blockedURI: string;
  sourceFile: string;
  lineNumber: number;
};

type Condition = {
  count: number;
  layout: Layout;
  renderer: Renderer;
  rangeLength: RangeLength;
};

const conditions: Condition[] = (["auto", "full", "virtual"] as const).flatMap(
  (renderer) =>
    [150, 500].flatMap((count) =>
      (["pc", "smartphone"] as const)
        .filter((layout) => renderer !== "virtual" || layout === "smartphone")
        .flatMap((layout) =>
          (["short", "long"] as const).map((rangeLength) => ({
            count,
            layout,
            renderer,
            rangeLength,
          })),
        ),
    ),
);

function fixture(count: number) {
  const items = Array.from({ length: count }, (_, index) => ({
    id: `r${index + 1}`,
    eventDate: day,
    circle: `ユーザー登録${index + 1}`,
    title: `新刊${index + 1}`,
    block: "A",
    number: String(index + 1),
    price: 500,
    quantity: 1,
    purchaseStatus: "None",
    remarks: "エラーが発生しました",
    priorityLevel: "none",
  }));
  return {
    kind: "event-shopping-planner-backup",
    version: 1,
    exportedAt: "2026-10-20T00:00:00.000Z",
    eventSettings: { blockDetectionSettings: {} },
    data: {
      eventLists: { [eventName]: items },
      eventMetadata: {},
      executeModeItems: {
        [eventName]: { [day]: items.map((item) => item.id) },
      },
      dayModes: { [eventName]: { [day]: "edit" } },
      mapData: {},
      mapRotationSettings: {},
      mapViewportSettings: {},
      routeSettings: {},
      hallDefinitions: {},
      hallRouteSettings: {},
    },
  };
}

const list = (page: Page, count: number) =>
  page.locator(`[data-list-renderer][data-list-row-count="${count}"]`);
const row = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`);
const checkbox = (page: Page, id: string) =>
  row(page, id).locator('input[type="checkbox"]');
const chain = (page: Page, id: string, selected: boolean) =>
  row(page, id)
    .getByTitle(
      selected ? "範囲内のチェックを外す" : "範囲内のチェックを入れる",
      {
        exact: true,
      },
    )
    .first();

async function stablePaint(page: Page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise(requestAnimationFrame);
  });
}

const diagnosticTransitionOverride = () =>
  [
    process.env.ESP_DIAGNOSTIC_CHAIN_NO_TRANSITIONS === "1"
      ? ".esp-flat-range-chain,.esp-flat-range-chain-gap{transition:none!important;}"
      : "",
    process.env.ESP_DIAGNOSTIC_CARD_NO_TRANSITIONS === "1"
      ? "[data-item-id] > .rounded-lg.shadow-md{transition:none!important;}"
      : "",
    process.env.ESP_DIAGNOSTIC_STRIPE_VISIBILITY === "1"
      ? "@layer base{[data-item-id] > .rounded-lg.shadow-md > .bg-blue-500[hidden]{display:block!important;visibility:hidden!important;}}"
      : "",
    process.env.ESP_DIAGNOSTIC_CHAIN_LAYOUT_CONTAINMENT === "1"
      ? ".esp-flat-range-chain,.esp-flat-range-chain-gap{contain:layout!important;}"
      : "",
    process.env.ESP_DIAGNOSTIC_CHAIN_NEAR_OPAQUE === "1"
      ? ".esp-flat-range-chain.opacity-100,.esp-flat-range-chain-gap.opacity-100{opacity:0.99999!important;}"
      : "",
    process.env.ESP_DIAGNOSTIC_CHAIN_FILTER_OPACITY === "1"
      ? ".esp-flat-range-chain,.esp-flat-range-chain-gap{opacity:1!important;filter:opacity(1)!important;} .esp-flat-range-chain.opacity-50,.esp-flat-range-chain-gap.opacity-50{filter:opacity(.5)!important;} @media(hover:hover){.esp-flat-range-chain.opacity-50:hover,.esp-flat-range-chain-gap.opacity-50:hover{filter:opacity(1)!important;}}"
      : "",
  ]
    .filter(Boolean)
    .join("\n");

async function restore(
  page: Page,
  condition: Condition,
  withCandidates = false,
  candidateOnly = false,
) {
  await page.addInitScript(({ renderer }) => {
    const reports: RangeCspViolation[] = [];
    (
      window as unknown as { __espRangeCspViolations: RangeCspViolation[] }
    ).__espRangeCspViolations = reports;
    document.addEventListener("securitypolicyviolation", (event) => {
      if (
        event.effectiveDirective === "img-src" ||
        event.effectiveDirective.startsWith("style-src")
      )
        reports.push({
          effectiveDirective: event.effectiveDirective,
          violatedDirective: event.violatedDirective,
          blockedURI: event.blockedURI,
          sourceFile: event.sourceFile,
          lineNumber: event.lineNumber,
        });
    });
    localStorage.setItem(
      "__esp_internal__:list-renderer-preference:v1",
      JSON.stringify({
        version: 1,
        value: renderer === "full" ? "full" : "auto",
      }),
    );
    // TanStack is an existing supported fallback. Disable only its competing
    // Observer in this test; leave ResizeObserver and focus available.
    if (renderer === "virtual")
      Object.defineProperty(window, "IntersectionObserver", {
        configurable: true,
        value: undefined,
      });
  }, condition);
  if (diagnosticTransitionOverride()) {
    expect(
      process.env.ESP_PROFILE_RANGE,
      "CSS override is diagnostic only",
    ).toBe("1");
    await page.route(/\/assets\/[^?]+\.css(?:\?.*)?$/, async (route) => {
      const response = await route.fetch();
      const css = await response.text();
      await route.fulfill({
        response,
        body: `${css}\n${diagnosticTransitionOverride()}\n`,
      });
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const backup = fixture(condition.count);
  if (candidateOnly) backup.data.executeModeItems[eventName][day] = [];
  if (withCandidates) {
    backup.data.eventLists[eventName].push(
      ...Array.from({ length: 3 }, (_, index) => ({
        ...backup.data.eventLists[eventName][index],
        id: `c${index + 1}`,
        circle: `候補${index + 1}`,
        block: "B",
      })),
    );
  }
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "edit-execute-range-selection.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await expect(dialog).toBeHidden({ timeout: 60000 });
  await expect(row(page, "r1")).toBeVisible();
  await page.getByTitle("表示項目の設定", { exact: true }).click();
  await page.getByLabel("画面の表示倍率").selectOption("100");
  if (condition.layout === "smartphone") {
    await page
      .getByTitle("スマートフォンモードに切替", { exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page
    .locator("div.fixed.inset-0.z-40")
    .first()
    .click({ position: { x: 2, y: 100 } });
  const groups = page.getByRole("button", { name: "スペース別", exact: true });
  if ((await groups.getAttribute("class"))?.includes("bg-blue-600"))
    await groups.click();
  await expect(groups).not.toHaveClass(/bg-blue-600/);
  await expect(page.getByTitle("編集モード", { exact: true })).toHaveClass(
    /bg-blue-100/,
  );
  await expect(list(page, condition.count)).toHaveCount(1);
  await assertRenderer(page, condition);
  await stablePaint(page);
}

async function assertRenderer(page: Page, condition: Condition) {
  expect(
    await page.evaluate(() => window.visualViewport?.scale),
    "actual visual viewport zoom",
  ).toBe(1);
  const root = list(page, condition.count);
  const expectedEngine = condition.renderer === "full" ? "full" : "virtual";
  await expect(root).toHaveAttribute("data-list-renderer", expectedEngine);
  await expect(root).toHaveAttribute("data-list-row-keys-stable", "true");
  if (condition.renderer === "auto") {
    await expect(root).toHaveAttribute(
      "data-list-renderer-strategy",
      "retained-viewport",
    );
    await expect(root).toHaveAttribute(
      "data-list-renderer-reason",
      "virtual-eligible",
    );
  } else {
    expect(await root.getAttribute("data-list-renderer-strategy")).toBeNull();
    await expect(root).toHaveAttribute(
      "data-list-renderer-reason",
      condition.renderer === "full" ? "preference-full" : "virtual-eligible",
    );
  }
}

async function environment(page: Page, condition: Condition) {
  const renderer = await list(page, condition.count).evaluate((root) =>
    Object.fromEntries(
      [...root.attributes]
        .filter((attribute) => attribute.name.startsWith("data-list-"))
        .map((attribute) => [attribute.name, attribute.value]),
    ),
  );
  const runtime = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio,
    visualViewportScale: window.visualViewport?.scale ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    appZoom: [...document.querySelectorAll<HTMLElement>("[class]")]
      .filter((element) => element.classList.contains("origin-top-left"))
      .map((element) => ({
        className: element.className,
        cssZoom: getComputedStyle(element).zoom,
      })),
    intersectionObserver: typeof IntersectionObserver === "function",
    resizeObserver: typeof ResizeObserver === "function",
    focus: typeof HTMLElement.prototype.focus === "function",
    rendererPreference: localStorage.getItem(
      "__esp_internal__:list-renderer-preference:v1",
    ),
  }));
  return {
    ...condition,
    requestedRenderer: condition.renderer,
    configuration: {
      viewMode: "edit",
      columnType: "execute",
      spaceGroups: false,
      showHallGroups: true,
      hallDefinitions: [],
      priorityLevel: "none",
      viewportZoomPercent: 100,
      fixtureId: `edit-execute-range-r1-r${condition.count}-20261020`,
    },
    renderer,
    runtime,
  };
}

async function prepareItem(page: Page, condition: Condition, id: string) {
  const index = Number(id.slice(1)) - 1;
  await expect
    .poll(
      async () => {
        await page.evaluate(
          ({ id, index, count }) => {
            const mounted = document.querySelector<HTMLElement>(
              `[data-item-id="${id}"]`,
            );
            const placeholder = document.querySelector<HTMLElement>(
              `[data-row-key='item:"${id}"']`,
            );
            if (mounted || placeholder) {
              (mounted ?? placeholder)!.scrollIntoView({ block: "center" });
              return;
            }
            const root = document.querySelector<HTMLElement>(
              `[data-list-renderer][data-list-row-count="${count}"]`,
            )!;
            const canvas = root.querySelector<HTMLElement>(
              ".esp-virtual-list-canvas",
            )!;
            const bounds = canvas.getBoundingClientRect();
            scrollTo(
              0,
              bounds.top +
                scrollY +
                (bounds.height * index) / count -
                innerHeight / 2,
            );
          },
          { id, index, count: condition.count },
        );
        await stablePaint(page);
        return row(page, id).isVisible();
      },
      { timeout: 20000 },
    )
    .toBe(true);
  await row(page, id).scrollIntoViewIfNeeded();
  await stablePaint(page);
}

async function activate(
  locator: Locator,
  layout: Layout,
  position?: { x: number; y: number },
) {
  if (layout === "smartphone") await locator.tap({ position });
  else await locator.click({ position });
}

// Scan actual mounted checkboxes while scrolling the entire list. Neither
// Retained nor TanStack is required to keep offscreen cards mounted.
async function selectionSnapshot(page: Page, condition: Condition) {
  const result = await page.evaluate(async ({ count }) => {
    const seen = new Map<string, boolean>();
    const positions = new Map<number, string>();
    const idPositions = new Map<string, number>();
    const paint = async () => {
      await new Promise(requestAnimationFrame);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise(requestAnimationFrame);
    };
    const collect = () => {
      document
        .querySelectorAll<HTMLElement>("[data-item-id]")
        .forEach((entry) => {
          const input = entry.querySelector<HTMLInputElement>(
            'input[type="checkbox"]',
          );
          if (!input) return;
          const id = entry.dataset.itemId!;
          const accessibleRow = entry.closest<HTMLElement>("[aria-posinset]");
          const position = Number(accessibleRow?.getAttribute("aria-posinset"));
          if (
            !Number.isInteger(position) ||
            position < 1 ||
            position > count ||
            accessibleRow?.getAttribute("aria-setsize") !== String(count)
          )
            throw new Error(
              `Invalid displayed position: ${id}, position=${position}`,
            );
          if (positions.has(position) && positions.get(position) !== id)
            throw new Error(`Two IDs at displayed position ${position}`);
          if (idPositions.has(id) && idPositions.get(id) !== position)
            throw new Error(`Displayed position changed during scan: ${id}`);
          if (entry.dataset.isSelected !== String(input.checked))
            throw new Error(`Selection attribute mismatch: ${id}`);
          positions.set(position, id);
          idPositions.set(id, position);
          seen.set(id, input.checked);
        });
    };
    // A real endpoint click may still have a pending Retained focus scroll.
    // Keep focus/pins intact and prove the traversal actually starts at row1.
    const initialScrollAttempts: Array<{
      scrollY: number;
      firstMounted: boolean;
      focusedItemId: string | null;
    }> = [];
    let startedAtTop = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      scrollTo({ top: 0, left: 0, behavior: "instant" });
      await paint();
      const firstMounted = Boolean(
        document.querySelector('[data-item-id="r1"] input[type="checkbox"]'),
      );
      initialScrollAttempts.push({
        scrollY,
        firstMounted,
        focusedItemId:
          document.activeElement?.closest<HTMLElement>("[data-item-id]")
            ?.dataset.itemId ?? null,
      });
      if (scrollY <= 1 && firstMounted) {
        startedAtTop = true;
        collect();
        break;
      }
    }
    if (!startedAtTop)
      throw new Error(
        `DOM scan could not reach the first row: ${JSON.stringify(initialScrollAttempts)}`,
      );
    let previous = -1;
    // Read the current height as virtual row measurements become more precise.
    for (let steps = 0; seen.size < count && steps < count * 4; steps++) {
      const bottom = document.documentElement.scrollHeight - innerHeight;
      const next = Math.min(
        bottom,
        scrollY + Math.max(100, innerHeight * 0.65),
      );
      scrollTo(0, next);
      await paint();
      collect();
      if (
        scrollY === previous ||
        (scrollY >= bottom - 1 && seen.size === count)
      )
        break;
      previous = scrollY;
    }
    // Sort only by actual accessible display position, never by an item's ID.
    const rowPositions = [...positions].sort(([left], [right]) => left - right);
    const observedOrder = rowPositions.map(([, id]) => id);
    return {
      initialScrollAttempts,
      observedOrder,
      rowPositions,
      selectedIds: observedOrder.filter((id) => seen.get(id)),
    };
  }, condition);
  expect(
    result.rowPositions.map(([position]) => position),
    "every display position was checked through the DOM",
  ).toEqual(Array.from({ length: condition.count }, (_, index) => index + 1));
  expect(
    result.observedOrder,
    "actual display order matches the fixed fixture",
  ).toEqual(fixture(condition.count).data.executeModeItems[eventName][day]);
  return result;
}
async function assertMountedStripeVisibility(page: Page) {
  const stripes = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "[data-item-id] > .rounded-lg.shadow-md > .bg-blue-500",
      ),
    ].map((stripe) => {
      const row = stripe.closest<HTMLElement>("[data-item-id]");
      const style = getComputedStyle(stripe);
      return {
        itemId: row?.dataset.itemId,
        selected: row?.dataset.isSelected === "true",
        visibility: style.visibility,
        display: style.display,
        hidden: stripe.hidden,
      };
    }),
  );
  expect(
    stripes.length,
    "actual mounted selection stripe count",
  ).toBeGreaterThan(0);
  for (const stripe of stripes) {
    expect(stripe.visibility, `stripe visibility for ${stripe.itemId}`).toBe(
      stripe.selected ? "visible" : "hidden",
    );
    expect(stripe.display, `stripe layout box for ${stripe.itemId}`).not.toBe(
      "none",
    );
    expect(stripe.hidden, `stripe hidden attribute for ${stripe.itemId}`).toBe(
      false,
    );
  }
  return {
    mountedCount: stripes.length,
    selectedCount: stripes.filter((stripe) => stripe.selected).length,
    unselectedCount: stripes.filter((stripe) => !stripe.selected).length,
    observations: stripes,
  };
}
async function chainGeometry(locator: Locator) {
  return locator.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    let left = Math.max(0, bounds.left);
    let top = Math.max(0, bounds.top);
    let right = Math.min(innerWidth, bounds.right);
    let bottom = Math.min(innerHeight, bounds.bottom);
    const clippers: Array<Record<string, unknown>> = [];
    for (
      let parent = button.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      const rect = parent.getBoundingClientRect();
      if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) {
        left = Math.max(left, rect.left);
        right = Math.min(right, rect.right);
      }
      if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) {
        top = Math.max(top, rect.top);
        bottom = Math.min(bottom, rect.bottom);
      }
      if (
        /(hidden|clip|scroll|auto)/.test(
          `${style.overflowX} ${style.overflowY}`,
        )
      )
        clippers.push({
          tag: parent.tagName,
          className: parent.className,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        });
    }
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const centerVisible = x >= left && x < right && y >= top && y < bottom;
    const hit = document.elementFromPoint(x, y);
    const interactiveOverlaps = [
      ...document.querySelectorAll<HTMLElement>(
        'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [tabindex]',
      ),
    ]
      .filter((other) => {
        if (
          other === button ||
          button.contains(other) ||
          other.contains(button)
        )
          return false;
        // Adjacent chain segments intentionally continue the same range action.
        if (
          other.title === "範囲内のチェックを入れる" ||
          other.title === "範囲内のチェックを外す"
        )
          return false;
        const style = getComputedStyle(other);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.pointerEvents !== "none"
        );
      })
      .flatMap((other) => {
        const otherBounds = other.getBoundingClientRect();
        const overlap = {
          left: Math.max(left, otherBounds.left),
          right: Math.min(right, otherBounds.right),
          top: Math.max(top, otherBounds.top),
          bottom: Math.min(bottom, otherBounds.bottom),
        };
        if (
          overlap.right - overlap.left <= 1 ||
          overlap.bottom - overlap.top <= 1
        )
          return [];
        const topElement = document.elementFromPoint(
          (overlap.left + overlap.right) / 2,
          (overlap.top + overlap.bottom) / 2,
        );
        return [
          {
            tag: other.tagName,
            title: other.title,
            ariaLabel: other.getAttribute("aria-label"),
            itemId:
              other.closest<HTMLElement>("[data-item-id]")?.dataset.itemId ??
              null,
            overlap,
            chainOnTop: Boolean(topElement && button.contains(topElement)),
            otherControlOnTop: Boolean(
              topElement && other.contains(topElement),
            ),
          },
        ];
      });
    return {
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        right: bounds.right,
        bottom: bounds.bottom,
      },
      visible: {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
      },
      viewport: { width: innerWidth, height: innerHeight },
      centerVisible,
      centerHit: Boolean(hit && button.contains(hit)),
      hit: hit
        ? { tag: hit.tagName, title: hit.closest("button")?.title }
        : null,
      clippers,
      interactiveOverlaps,
    };
  });
}

async function assertChainGeometry(locator: Locator) {
  await expect(locator).toBeVisible();
  const geometry = await chainGeometry(locator);
  expect(
    geometry.bounds.x,
    "chain is inside the horizontal viewport",
  ).toBeGreaterThanOrEqual(0);
  expect(geometry.bounds.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(
    geometry.visible.width,
    "chain is not horizontally clipped",
  ).toBeGreaterThanOrEqual(39);
  expect(
    geometry.visible.height,
    "chain has an available click/tap target",
  ).toBeGreaterThanOrEqual(16);
  expect(geometry.centerVisible, "actual chain center is visible").toBe(true);
  expect(
    geometry.centerHit,
    "chain target is not covered by another element",
  ).toBe(true);
  return geometry;
}

async function actionableChain(
  page: Page,
  preferredId: string,
  selected: boolean,
) {
  // A covered endpoint must fail here; another segment cannot stand in for it.
  const locator = chain(page, preferredId, selected);
  const geometry = await assertChainGeometry(locator);
  return {
    locator,
    position: {
      x: geometry.bounds.width / 2,
      y: geometry.bounds.height / 2,
    },
    evidence: {
      preferredId,
      chosenId: preferredId,
      preferredBlockedGeometry: null,
      geometry,
    },
  };
}

async function assertVisibleChainCenters(page: Page) {
  const observations = await page
    .locator(
      'button[title="範囲内のチェックを入れる"], button[title="範囲内のチェックを外す"]',
    )
    .evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        const bounds = button.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        const style = getComputedStyle(button);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          bounds.width <= 0 ||
          bounds.height <= 0 ||
          x < 0 ||
          x >= innerWidth ||
          y < 0 ||
          y >= innerHeight
        )
          return [];
        for (
          let parent = button.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const rect = parent.getBoundingClientRect();
          const parentStyle = getComputedStyle(parent);
          if (
            (/(hidden|clip|scroll|auto)/.test(parentStyle.overflowX) &&
              (x < rect.left || x >= rect.right)) ||
            (/(hidden|clip|scroll|auto)/.test(parentStyle.overflowY) &&
              (y < rect.top || y >= rect.bottom))
          )
            return [];
        }
        const hit = document.elementFromPoint(x, y);
        let coveringChrome: {
          tag: string;
          className: string;
          position: string;
        } | null = null;
        if (hit && !button.contains(hit)) {
          for (
            let ancestor: Element | null = hit;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            // Fixed headers and sticky toolbars mark the viewport's usable
            // content edge. A relative/absolute candidate drop area does not.
            if (ancestor.closest("[data-item-id]") || ancestor.contains(button))
              continue;
            const position = getComputedStyle(ancestor).position;
            if (position === "fixed" || position === "sticky") {
              coveringChrome = {
                tag: ancestor.tagName,
                className: ancestor.getAttribute("class") ?? "",
                position,
              };
              break;
            }
          }
        }
        return [
          {
            itemId:
              button.closest<HTMLElement>("[data-item-id]")?.dataset.itemId ??
              null,
            segment: button.classList.contains("esp-flat-range-chain-gap")
              ? "gap"
              : "main",
            center: { x, y },
            excludedReason: coveringChrome
              ? `covered by ${coveringChrome.position} application chrome`
              : null,
            coveringChrome,
            centerHit: Boolean(hit && button.contains(hit)),
            hit: hit ? { tag: hit.tagName, className: hit.className } : null,
          },
        ];
      }),
    );
  const visibleCenters = observations.filter(
    (observation) => !observation.excludedReason,
  );
  const excludedCenters = observations.filter(
    (observation) => observation.excludedReason,
  );
  expect(
    visibleCenters.length,
    "visible mounted chain centers",
  ).toBeGreaterThan(0);
  for (const observation of visibleCenters)
    expect(
      observation.centerHit,
      `${observation.itemId} ${observation.segment} center: ${JSON.stringify(observation)}`,
    ).toBe(true);
  return { visibleCenters, excludedCenters };
}

async function rangeCspViolations(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __espRangeCspViolations?: RangeCspViolation[] })
        .__espRangeCspViolations ?? [],
  );
}

async function cssChainAssetReadiness(page: Page, main: Locator) {
  const cssChain = await main.evaluate((element) =>
    element.classList.contains("esp-flat-range-chain"),
  );
  if (!cssChain) {
    expect(
      process.env.ESP_EXPECT_CSS_CHAIN === "1",
      "optimized build must use the CSS flat chain",
    ).toBe(false);
    return { rendering: "inline-svg", assets: [] };
  }
  await expect(main).toHaveClass(/esp-flat-range-chain/);
  await expect(main.locator("svg")).toHaveCount(0);
  const gap = page.locator(".esp-flat-range-chain-gap").first();
  await expect(gap).toHaveCount(1);
  const references = await main.evaluate((element) => {
    const gap = document.querySelector<HTMLElement>(
      ".esp-flat-range-chain-gap",
    )!;
    const descriptors = [
      {
        name: "main-links",
        node: element,
        pseudo: "::before",
        expectedHeight: 20,
      },
      {
        name: "main-hook",
        node: element,
        pseudo: "::after",
        expectedHeight: 58,
      },
      { name: "gap-links", node: gap, pseudo: null, expectedHeight: 20 },
    ];
    return descriptors.map(({ name, node, pseudo, expectedHeight }) => {
      const style = getComputedStyle(node, pseudo);
      // The Vite SVG data URI can itself contain url(#gradient) expressions.
      // Extract the single outer CSS URL, preserving its nested parentheses.
      const outerUrl = /^url\(([\s\S]*)\)$/.exec(style.backgroundImage.trim());
      const serialized = outerUrl?.[1]?.trim();
      const source =
        serialized &&
        ((serialized.startsWith('"') && serialized.endsWith('"')) ||
          (serialized.startsWith("'") && serialized.endsWith("'")))
          ? serialized.slice(1, -1)
          : serialized;
      const sources = source ? [source] : [];
      return {
        name,
        pseudo,
        expectedHeight,
        candidateHook: element.classList.contains(
          "esp-flat-range-chain-candidate",
        ),
        sources,
        backgroundImage: style.backgroundImage,
        backgroundSize: style.backgroundSize,
        backgroundPosition: style.backgroundPosition,
        backgroundRepeat: style.backgroundRepeat,
        clipPath: style.clipPath,
        content: style.content,
        cssWidth: style.width,
        cssHeight: style.height,
      };
    });
  });
  for (const reference of references) {
    expect(reference.sources, `${reference.name} CSS image URL`).toHaveLength(
      1,
    );
    expect(reference.backgroundSize).toBe(`40px ${reference.expectedHeight}px`);
    expect(reference.backgroundPosition).toBe("0px 0px");
    expect(reference.backgroundRepeat).toBe(
      reference.name === "main-hook" ? "no-repeat" : "repeat-y",
    );
    if (reference.pseudo) {
      expect(
        reference.content,
        `${reference.name} generated pseudo element`,
      ).not.toBe("none");
      expect(reference.content).not.toBe("normal");
    }
    expect(
      parseFloat(reference.cssWidth),
      `${reference.name} painted width`,
    ).toBe(40);
    expect(
      parseFloat(reference.cssHeight),
      `${reference.name} painted height`,
    ).toBeGreaterThan(0);
  }
  const assets = await page.evaluate(
    async (references) =>
      Promise.all(
        references.map(async (reference) => {
          const image = new Image();
          image.src = reference.sources[0];
          await image.decode();
          let hookSideAlphas: { left: number; right: number } | null = null;
          if (reference.name === "main-hook") {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            hookSideAlphas = {
              left: context.getImageData(2, 50, 1, 1).data[3],
              right: context.getImageData(38, 50, 1, 1).data[3],
            };
          }
          return {
            ...reference,
            hookSideAlphas,
            complete: image.complete,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          };
        }),
      ),
    references,
  );
  for (const asset of assets) {
    expect(asset.complete, `${asset.name} image decoded`).toBe(true);
    expect(asset.naturalWidth).toBe(40);
    expect(asset.naturalHeight).toBe(asset.expectedHeight);
    if (asset.name === "main-hook") {
      expect(asset.hookSideAlphas).not.toBeNull();
      expect(
        asset.hookSideAlphas![asset.candidateHook ? "right" : "left"],
        "hook connects to its actual column",
      ).toBeGreaterThan(0);
      expect(
        asset.hookSideAlphas![asset.candidateHook ? "left" : "right"],
      ).toBe(0);
    }
  }
  return { rendering: "css-svg-tiles", assets };
}

async function clearSelection(page: Page) {
  const clear = page.getByTitle("選択を解除", { exact: true });
  if (await clear.isVisible()) await clear.click();
  await expect(
    page.getByTitle("範囲内のチェックを外す", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByTitle("範囲内のチェックを入れる", { exact: true }),
  ).toHaveCount(0);
  await stablePaint(page);
}

const conditionName = (condition: Condition) =>
  `${condition.count} items, ${condition.layout}, ${condition.renderer}, ${condition.rangeLength}`;
const endpoint = (condition: Condition) =>
  condition.rangeLength === "short" ? "r3" : `r${condition.count}`;
const targetIds = (condition: Condition) =>
  fixture(condition.count).data.executeModeItems[eventName][day].slice(
    0,
    condition.rangeLength === "short" ? 3 : condition.count,
  );

type RangeCpuProfile = {
  nodes: Array<{
    id: number;
    children?: number[];
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
  }>;
  samples?: number[];
  timeDeltas?: number[];
  startTime: number;
  endTime: number;
};

function summarizeCpuProfile(
  profile: RangeCpuProfile,
  window?: { startTime: number; endTime: number },
) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const selfMs = new Map<number, number>();
  const inclusiveMs = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let totalSampledMs = 0;
  let timestamp = profile.startTime;
  for (let index = 0; index < samples.length; index++) {
    const delta = deltas[index] ?? 0;
    const previousTimestamp = timestamp;
    timestamp += delta;
    const ms = window
      ? Math.max(
          0,
          Math.min(timestamp, window.endTime) -
            Math.max(previousTimestamp, window.startTime),
        ) / 1000
      : delta / 1000;
    if (ms === 0) continue;
    totalSampledMs += ms;
    const id = samples[index];
    selfMs.set(id, (selfMs.get(id) ?? 0) + ms);
    let ancestor: number | undefined = id;
    while (ancestor !== undefined) {
      inclusiveMs.set(ancestor, (inclusiveMs.get(ancestor) ?? 0) + ms);
      ancestor = parents.get(ancestor);
    }
  }
  const top = (values: Map<number, number>) =>
    [...values]
      .sort(([, left], [, right]) => right - left)
      .slice(0, 30)
      .map(([id, ms]) => ({ id, ms, ...nodes.get(id)?.callFrame }));
  return {
    durationMs:
      ((window?.endTime ?? profile.endTime) -
        (window?.startTime ?? profile.startTime)) /
      1000,
    totalSampledMs,
    sampleCount: samples.length,
    topSelf: top(selfMs),
    topInclusive: top(inclusiveMs),
  };
}

type RangeTraceEvent = {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: Record<string, unknown>;
};

function summarizeRangeTrace(events: RangeTraceEvent[], operation: string) {
  const start = events.find(
    (event) => event.name === `esp-range-${operation}-start`,
  );
  const end = events.find(
    (event) =>
      event.name === `esp-range-${operation}-end` &&
      (!start || event.ts >= start.ts),
  );
  if (!start || !end)
    throw new Error(`Missing measured trace markers for ${operation}`);
  const groups = new Map<
    string,
    {
      name: string;
      thread: string;
      count: number;
      totalMs: number;
      maxMs: number;
    }
  >();
  for (const event of events) {
    if (event.ph !== "X" || !event.dur) continue;
    const duration =
      Math.max(
        0,
        Math.min(event.ts + event.dur, end.ts) - Math.max(event.ts, start.ts),
      ) / 1000;
    if (!duration) continue;
    const thread =
      event.pid === start.pid && event.tid === start.tid ? "main" : "other";
    const key = `${thread}:${event.name}`;
    const previous = groups.get(key) ?? {
      name: event.name,
      thread,
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };
    previous.count += 1;
    previous.totalMs += duration;
    previous.maxMs = Math.max(previous.maxMs, duration);
    groups.set(key, previous);
  }
  return {
    window: { startTime: start.ts, endTime: end.ts },
    durationMs: (end.ts - start.ts) / 1000,
    note: "Durations overlap for nested timeline events; do not sum different categories.",
    timeline: [...groups.values()].sort((a, b) => b.totalMs - a.totalMs),
  };
}

async function artifact(testInfo: TestInfo, name: string, data: unknown) {
  const body = JSON.stringify(data, null, 2);
  await writeFile(testInfo.outputPath(`${name}.json`), body, "utf8");
  await testInfo.attach(name, { body, contentType: "application/json" });
}

for (const condition of conditions) {
  test(`edit execute chain forward/reverse: ${conditionName(condition)} @range-selection-regression`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240000);
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await restore(page, condition);
    const actualEnvironment = await environment(page, condition);
    const directions: unknown[] = [];
    for (const reverse of [false, true]) {
      await clearSelection(page);
      // A checked item outside the short range must survive both range operations.
      if (condition.rangeLength === "short") {
        await prepareItem(page, condition, "r4");
        await activate(checkbox(page, "r4"), condition.layout);
        const groups = page.getByRole("button", {
          name: "スペース別",
          exact: true,
        });
        // Existing parent controls explicitly clear endpoints but preserve checks.
        await groups.click();
        await groups.click();
        await prepareItem(page, condition, "r4");
        await expect(checkbox(page, "r4")).toBeChecked();
      }
      const first = reverse ? endpoint(condition) : "r1";
      const second = reverse ? "r1" : endpoint(condition);
      await prepareItem(page, condition, first);
      await activate(checkbox(page, first), condition.layout);
      await expect(checkbox(page, first)).toBeChecked();
      const outsideIds = condition.rangeLength === "short" ? ["r4"] : [];
      const firstSnapshot = await selectionSnapshot(page, condition);
      const firstStripeVisibility = await assertMountedStripeVisibility(page);
      expect(firstSnapshot.selectedIds).toEqual(
        fixture(condition.count).data.executeModeItems[eventName][day].filter(
          (id) => id === first || outsideIds.includes(id),
        ),
      );
      await prepareItem(page, condition, second);
      await activate(checkbox(page, second), condition.layout);
      await expect(checkbox(page, second)).toBeChecked();
      const secondSnapshot = await selectionSnapshot(page, condition);
      const secondStripeVisibility = await assertMountedStripeVisibility(page);
      expect(secondSnapshot.selectedIds).toEqual(
        fixture(condition.count).data.executeModeItems[eventName][day].filter(
          (id) => id === first || id === second || outsideIds.includes(id),
        ),
      );
      await prepareItem(page, condition, second);
      const selectAction = await actionableChain(page, second, false);
      const geometry = selectAction.evidence.geometry;
      const assetReadiness = await cssChainAssetReadiness(
        page,
        selectAction.locator,
      );
      const visibleBeforeSelection = await assertVisibleChainCenters(page);
      const screenshotName = reverse
        ? "chain-ready-reverse"
        : "chain-ready-forward";
      if (screenshotName) {
        const screenshot = testInfo.outputPath(`${screenshotName}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(screenshotName, {
          path: screenshot,
          contentType: "image/png",
        });
      }
      await activate(
        selectAction.locator,
        condition.layout,
        selectAction.position,
      );
      const expected = [
        ...targetIds(condition),
        ...(condition.rangeLength === "short" ? ["r4"] : []),
      ];
      const selectedSnapshot = await selectionSnapshot(page, condition);
      const selectedStripeVisibility =
        await assertMountedStripeVisibility(page);
      const selected = selectedSnapshot.selectedIds;
      expect(selected).toEqual(expected);
      await prepareItem(page, condition, second);
      await expect(checkbox(page, second)).toBeChecked();
      const clearAction = await actionableChain(page, second, true);
      const selectedGeometry = clearAction.evidence.geometry;
      const visibleBeforeClear = await assertVisibleChainCenters(page);
      await activate(
        clearAction.locator,
        condition.layout,
        clearAction.position,
      );
      const clearSnapshot = await selectionSnapshot(page, condition);
      const clearStripeVisibility = await assertMountedStripeVisibility(page);
      expect(clearSnapshot.selectedIds).toEqual(outsideIds);
      await expect(
        page.getByTitle("範囲内のチェックを入れる", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByTitle("範囲内のチェックを外す", { exact: true }),
      ).toHaveCount(0);
      await assertRenderer(page, condition);
      directions.push({
        reverse,
        first,
        second,
        selected,
        remaining: condition.rangeLength === "short" ? ["r4"] : [],
        geometry,
        selectedGeometry,
        visibleChainCenters: {
          beforeSelection: visibleBeforeSelection,
          beforeClear: visibleBeforeClear,
        },
        assetReadiness,
        stripeVisibility: {
          first: firstStripeVisibility,
          second: secondStripeVisibility,
          selected: selectedStripeVisibility,
          cleared: clearStripeVisibility,
        },
        chainActions: {
          select: selectAction.evidence,
          clear: clearAction.evidence,
        },
        snapshots: {
          firstSnapshot,
          secondSnapshot,
          selectedSnapshot,
          clearSnapshot,
        },
        screenshot: screenshotName ? `${screenshotName}.png` : null,
      });
    }
    await artifact(testInfo, "edit-execute-range-selection-regression", {
      environment: actualEnvironment,
      fixtureIds: fixture(condition.count).data.executeModeItems[eventName][
        day
      ],
      targetIds: targetIds(condition),
      cspViolations: await rangeCspViolations(page),
      directions,
      errors,
    });
    expect(errors).toEqual([]);
    expect(await rangeCspViolations(page)).toEqual([]);
  });

  test(`edit execute chain response: ${conditionName(condition)} @range-selection-performance @shopping-performance`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(1200000);
    page.setDefaultTimeout(15000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await restore(page, condition);
    const actualEnvironment = await environment(page, condition);
    const initialStripeOverrideReadiness =
      process.env.ESP_DIAGNOSTIC_STRIPE_VISIBILITY === "1"
        ? await page.evaluate(() => {
            const stripes = [
              ...document.querySelectorAll<HTMLElement>(
                "[data-item-id] > .rounded-lg.shadow-md > .bg-blue-500[hidden]",
              ),
            ];
            return {
              stripeCount: stripes.length,
              allComputedDisplayBlockAndVisibilityHidden: stripes.every(
                (stripe) => {
                  const style = getComputedStyle(stripe);
                  return (
                    style.display === "block" && style.visibility === "hidden"
                  );
                },
              ),
              first: stripes[0]
                ? {
                    display: getComputedStyle(stripes[0]).display,
                    visibility: getComputedStyle(stripes[0]).visibility,
                    className: stripes[0].className,
                  }
                : null,
            };
          })
        : null;
    if (initialStripeOverrideReadiness) {
      expect(initialStripeOverrideReadiness.stripeCount).toBeGreaterThan(0);
      expect(
        initialStripeOverrideReadiness.allComputedDisplayBlockAndVisibilityHidden,
      ).toBe(true);
      expect(initialStripeOverrideReadiness.first?.display).toBe("block");
      expect(initialStripeOverrideReadiness.first?.visibility).toBe("hidden");
    }
    const timings: Record<Operation, number[]> = {
      firstEndpoint: [],
      secondEndpoint: [],
      selectRange: [],
      clearRange: [],
    };
    const samples: unknown[] = [];
    const diagnosticOnly = process.env.ESP_PROFILE_RANGE === "1";
    const continuousDiagnostic =
      process.env.ESP_RANGE_CONTINUOUS_DIAGNOSTIC === "1";
    expect(
      !continuousDiagnostic || diagnosticOnly,
      "continuous profiling is diagnostic only",
    ).toBe(true);
    const cpu = diagnosticOnly
      ? await page.context().newCDPSession(page)
      : null;
    if (cpu) {
      await cpu.send("Profiler.enable");
      await cpu.send("Profiler.setSamplingInterval", { interval: 1000 });
    }
    const invalidationDiagnostic =
      process.env.ESP_RANGE_INVALIDATION_DIAGNOSTIC === "1";
    expect(
      !invalidationDiagnostic || (diagnosticOnly && !continuousDiagnostic),
      "invalidation profiling requires per-operation diagnostic mode",
    ).toBe(true);
    const tracingCategories = [
      "devtools.timeline",
      "blink.user_timing",
      "disabled-by-default-devtools.timeline",
      ...(invalidationDiagnostic
        ? [
            "disabled-by-default-devtools.timeline.invalidationTracking",
            "disabled-by-default-devtools.timeline.stack",
          ]
        : []),
    ].join(",");
    const diagnosticOperations: unknown[] = [];
    const layoutGeometry = () =>
      page.evaluate(() => {
        const elements = new Set<Element>();
        const addAncestors = (element: Element | null) => {
          for (; element; element = element.parentElement)
            elements.add(element);
        };
        for (const element of document.querySelectorAll(
          '[data-list-engine],[data-item-id="r1"],[data-item-id="r500"]',
        ))
          addAncestors(element);
        for (const element of document.querySelectorAll(
          "[data-item-id] > .rounded-lg.shadow-md,header,main,nav,aside,[role=toolbar],[role=banner],body,#root,.fixed,.sticky",
        ))
          elements.add(element);
        for (const button of document.querySelectorAll("button"))
          if (/選択|解除|件|品目/.test(button.textContent ?? ""))
            addAncestors(button);
        const path = (element: Element) => {
          const parts: string[] = [];
          for (
            let node: Element | null = element;
            node;
            node = node.parentElement
          ) {
            const parent: Element | null = node.parentElement;
            parts.unshift(
              `${node.tagName.toLowerCase()}:${parent ? [...parent.children].indexOf(node) : 0}`,
            );
          }
          return parts.join("/");
        };
        return {
          viewport: {
            innerWidth,
            innerHeight,
            clientWidth: document.documentElement.clientWidth,
            clientHeight: document.documentElement.clientHeight,
            scrollX,
            scrollY,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
          },
          elements: [...elements].map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              path: path(element),
              tag: element.tagName,
              id: element.id,
              className: element.getAttribute("class"),
              itemId:
                element.closest<HTMLElement>("[data-item-id]")?.dataset.itemId,
              text: element.matches("button")
                ? element.textContent?.slice(0, 160)
                : null,
              rect: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              scrollWidth: element.scrollWidth,
              scrollHeight: element.scrollHeight,
              clientWidth: element.clientWidth,
              clientHeight: element.clientHeight,
              position: style.position,
              overflow: style.overflow,
              display: style.display,
            };
          }),
        };
      });
    const continuousEvents: RangeTraceEvent[] = [];
    const continuousMeasurements: Array<{
      operation: Operation;
      markerName: string;
      responseMs: number;
    }> = [];
    const collectContinuousTrace = (event: { value: unknown[] }) => {
      continuousEvents.push(...(event.value as RangeTraceEvent[]));
    };
    let operationSequence = 0;
    let shoppingDiagnostic: unknown = null;
    const continuousRenderCounters =
      process.env.ESP_RANGE_RENDER_DIAGNOSTICS === "1";
    let warmupAssetReadiness: Awaited<
      ReturnType<typeof cssChainAssetReadiness>
    > | null = null;
    let warmupChainContainmentReadiness: {
      buttonCount: number;
      allComputedContainLayout: boolean;
      first: { contain: string; className: string } | null;
    } | null = null;
    const chainOpacityReadiness = () =>
      page.evaluate(() => {
        const buttons = [
          ...document.querySelectorAll<HTMLElement>(
            ".esp-flat-range-chain,.esp-flat-range-chain-gap",
          ),
        ];
        const sampleButtons = [
          ...document.querySelectorAll<HTMLElement>(
            ".esp-flat-range-chain-start,.esp-flat-range-chain-end",
          ),
          document.querySelector<HTMLElement>(".esp-flat-range-chain-gap"),
        ].filter((button): button is HTMLElement => button !== null);
        const snapshotStyle = (button: HTMLElement, pseudo: string | null) => {
          const style = getComputedStyle(button, pseudo);
          return Object.fromEntries(
            [...style].map((property) => [
              property,
              style.getPropertyValue(property),
            ]),
          );
        };
        return {
          buttonCount: buttons.length,
          opacityValues: [
            ...new Set(
              buttons.map((button) => getComputedStyle(button).opacity),
            ),
          ],
          filterValues: [
            ...new Set(
              buttons.map((button) => getComputedStyle(button).filter),
            ),
          ],
          allUnselectedFilterHalf: buttons.every(
            (button) =>
              getComputedStyle(button).opacity === "1" &&
              getComputedStyle(button).filter === "opacity(0.5)",
          ),
          allSelectedFilterOpaque: buttons.every(
            (button) =>
              getComputedStyle(button).opacity === "1" &&
              getComputedStyle(button).filter === "opacity(1)",
          ),
          allUnselectedHalf: buttons.every(
            (button) => getComputedStyle(button).opacity === "0.5",
          ),
          allSelectedNearOpaque: buttons.every(
            (button) => getComputedStyle(button).opacity === "0.99999",
          ),
          styleSamples: sampleButtons.map((button) => ({
            className: button.className,
            itemId:
              button.closest<HTMLElement>("[data-item-id]")?.dataset.itemId,
            rect: (() => {
              const rect = button.getBoundingClientRect();
              return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              };
            })(),
            element: snapshotStyle(button, null),
            before: snapshotStyle(button, "::before"),
            after: snapshotStyle(button, "::after"),
          })),
        };
      });
    let warmupNearOpaqueReadiness: {
      before: Awaited<ReturnType<typeof chainOpacityReadiness>>;
      after: Awaited<ReturnType<typeof chainOpacityReadiness>> | null;
    } | null = null;
    let warmupFilterOpacityReadiness: {
      before: Awaited<ReturnType<typeof chainOpacityReadiness>>;
      after: Awaited<ReturnType<typeof chainOpacityReadiness>> | null;
    } | null = null;
    const warmupVisual =
      process.env.ESP_DIAGNOSTIC_CHAIN_FILTER_OPACITY === "1" ||
      process.env.ESP_RANGE_WARMUP_VISUAL === "1";
    expect(
      !warmupVisual || diagnosticOnly,
      "warmup visual is diagnostic only",
    ).toBe(true);
    const warmupVisualEvidence: unknown[] = [];
    expect(
      process.env.ESP_RANGE_WARMUP_VISUAL !== "1" || !continuousDiagnostic,
      "interactive visual QA is warmup only",
    ).toBe(true);
    expect(
      process.env.ESP_RANGE_WARMUP_MOUSE !== "1" ||
        (process.env.ESP_RANGE_WARMUP_VISUAL === "1" &&
          diagnosticOnly &&
          !continuousDiagnostic),
      "mouse-only context is warmup visual QA only",
    ).toBe(true);
    if (process.env.ESP_RANGE_WARMUP_MOUSE === "1")
      expect(
        await page.evaluate(() => matchMedia("(hover:hover)").matches),
      ).toBe(true);
    const captureWarmupChain = async (state: string, locator: Locator) => {
      const styles = await locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          opacity: style.opacity,
          filter: style.filter,
          outline: style.outline,
          outlineOffset: style.outlineOffset,
          focusVisible: element.matches(":focus-visible"),
          hover: element.matches(":hover"),
          hoverMedia: matchMedia("(hover:hover)").matches,
        };
      });
      warmupVisualEvidence.push({
        state,
        styles,
        geometry: await chainGeometry(locator),
      });
      const geometry = await chainGeometry(locator);
      const x = Math.max(0, geometry.bounds.x - 4);
      const screenshot = testInfo.outputPath(`chain-warmup-${state}.png`);
      await page.screenshot({
        path: screenshot,
        clip: {
          x,
          y: 0,
          width: Math.min(48, geometry.viewport.width - x),
          height: geometry.viewport.height,
        },
      });
      await testInfo.attach(`chain-warmup-${state}`, {
        path: screenshot,
        contentType: "image/png",
      });
    };
    const captureWarmupInteractions = async (
      state: string,
      locator: Locator,
    ) => {
      if (await page.evaluate(() => matchMedia("(hover:hover)").matches)) {
        await locator.hover();
        await stablePaint(page);
        const hovered = await locator.evaluate((element) => {
          const style = getComputedStyle(element);
          return { opacity: style.opacity, filter: style.filter };
        });
        expect(hovered.opacity).toBe("1");
        if (process.env.ESP_DIAGNOSTIC_CHAIN_FILTER_OPACITY === "1")
          expect(hovered.filter).toBe("opacity(1)");
        await captureWarmupChain(`${state}-hover`, locator);
      }
      await page.mouse.move(0, 0);
      await page.keyboard.press("Tab");
      await locator.focus();
      await expect(locator).toBeFocused();
      expect(
        await locator.evaluate((element) => element.matches(":focus-visible")),
      ).toBe(true);
      await captureWarmupChain(`${state}-focus`, locator);
      await locator.evaluate((element) => (element as HTMLElement).blur());
      await stablePaint(page);
    };
    const domCounts = () =>
      page.evaluate(() => ({
        elements: document.querySelectorAll("*").length,
        cards: document.querySelectorAll("[data-item-id]").length,
        svg: document.querySelectorAll("svg").length,
        path: document.querySelectorAll("path").length,
        button: document.querySelectorAll("button").length,
        input: document.querySelectorAll("input").length,
        defs: document.querySelectorAll("defs").length,
        pattern: document.querySelectorAll("pattern").length,
        linearGradient: document.querySelectorAll("linearGradient").length,
      }));
    const clickResponse = async (
      locator: Locator,
      operation: Operation,
      record: boolean,
    ) => {
      // Preparation is outside the timer, exactly as in the existing harness.
      await locator.scrollIntoViewIfNeeded();
      await stablePaint(page);
      const countsBefore =
        diagnosticOnly && !continuousDiagnostic ? await domCounts() : null;
      const geometryBefore =
        invalidationDiagnostic && operation === "selectRange"
          ? await layoutGeometry()
          : null;
      const markerName = continuousDiagnostic
        ? `${operation}-${operationSequence++}`
        : operation;
      const traceEvents: RangeTraceEvent[] = [];
      const collectTrace = (event: { value: unknown[] }) => {
        traceEvents.push(...(event.value as RangeTraceEvent[]));
      };
      if (cpu && !continuousDiagnostic) {
        cpu.on("Tracing.dataCollected", collectTrace);
        await cpu.send("Tracing.start", {
          categories: tracingCategories,
          options: "record-as-much-as-possible",
        });
        await cpu.send("Profiler.start");
      }
      const value = await locator.evaluate(
        async (
          element,
          {
            operation,
            targetCount,
            diagnosticOnly,
            continuousDiagnostic,
            markerName,
          },
        ) => {
          if (diagnosticOnly) performance.mark(`esp-range-${markerName}-start`);
          const started = performance.now();
          (element as HTMLElement).click();
          await new Promise(requestAnimationFrame);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const durationMs = performance.now() - started;
          if (diagnosticOnly) performance.mark(`esp-range-${markerName}-end`);
          // Validate the post-paint state at this exact measurement boundary.
          // Later full-list scans may not conceal a delayed required UI update.
          const mountedTargets = [
            ...document.querySelectorAll<HTMLElement>("[data-item-id]"),
          ].filter(
            (entry) => Number(entry.dataset.itemId?.slice(1)) <= targetCount,
          );
          const selected = mountedTargets.every(
            (entry) =>
              entry.dataset.isSelected === "true" &&
              entry.querySelector<HTMLInputElement>('input[type="checkbox"]')
                ?.checked,
          );
          const clear = mountedTargets.every(
            (entry) =>
              entry.dataset.isSelected === "false" &&
              !entry.querySelector<HTMLInputElement>('input[type="checkbox"]')
                ?.checked,
          );
          const rendered =
            operation === "firstEndpoint"
              ? (element as HTMLInputElement).checked &&
                element.closest<HTMLElement>("[data-item-id]")?.dataset
                  .isSelected === "true"
              : operation === "secondEndpoint"
                ? (element as HTMLInputElement).checked &&
                  document.querySelector(
                    '[title="範囲内のチェックを入れる"]',
                  ) !== null
                : operation === "selectRange"
                  ? selected &&
                    document.querySelector(
                      '[title="範囲内のチェックを外す"]',
                    ) !== null
                  : clear &&
                    document.querySelector(
                      '[title="範囲内のチェックを外す"], [title="範囲内のチェックを入れる"]',
                    ) === null;
          const animations =
            diagnosticOnly && !continuousDiagnostic
              ? (() => {
                  const groups = new Map<
                    string,
                    {
                      property: string;
                      scope: string;
                      targetClass: string;
                      playState: string;
                      count: number;
                    }
                  >();
                  for (const animation of document.getAnimations()) {
                    const target = (animation.effect as KeyframeEffect | null)
                      ?.target;
                    if (!(target instanceof Element)) continue;
                    const property =
                      "transitionProperty" in animation
                        ? String(animation.transitionProperty)
                        : "animationName" in animation
                          ? String(animation.animationName)
                          : animation.constructor.name;
                    const scope = target.matches(".esp-flat-range-chain")
                      ? "chain-main"
                      : target.matches(".esp-flat-range-chain-gap")
                        ? "chain-gap"
                        : target.closest("[data-item-id]")
                          ? "card"
                          : "other";
                    const targetClass = target.getAttribute("class") ?? "";
                    const key = `${property}:${scope}:${targetClass}:${animation.playState}`;
                    const group = groups.get(key) ?? {
                      property,
                      scope,
                      targetClass,
                      playState: animation.playState,
                      count: 0,
                    };
                    group.count += 1;
                    groups.set(key, group);
                  }
                  return [...groups.values()];
                })()
              : null;
          return { durationMs, rendered, animations };
        },
        {
          operation,
          targetCount: targetIds(condition).length,
          diagnosticOnly,
          continuousDiagnostic,
          markerName,
        },
      );
      if (cpu && !continuousDiagnostic) {
        const stopped = await cpu.send("Profiler.stop");
        const profile = stopped.profile as RangeCpuProfile;
        const traceComplete = new Promise<void>((resolve) =>
          cpu.once("Tracing.tracingComplete", () => resolve()),
        );
        await cpu.send("Tracing.end");
        await traceComplete;
        cpu.off("Tracing.dataCollected", collectTrace);
        const traceName = `${operation}.trace.json`;
        await writeFile(
          testInfo.outputPath(traceName),
          JSON.stringify({ traceEvents }),
          "utf8",
        );
        await testInfo.attach(`${operation}-timeline`, {
          path: testInfo.outputPath(traceName),
          contentType: "application/json",
        });
        const trace = summarizeRangeTrace(traceEvents, operation);
        const invalidations = invalidationDiagnostic
          ? traceEvents.filter((event) =>
              /InvalidationTracking/.test(event.name),
            )
          : [];
        const invalidationNodes: unknown[] = [];
        if (invalidationDiagnostic && operation === "selectRange") {
          const nodeIds = new Set<number>();
          const collectIds = (value: unknown, key = "") => {
            if (
              typeof value === "number" &&
              /^(?:backendNodeId|nodeId|relatedNodeId|parentNodeId|invalidatedNodeId|rootNode|nodeIds|backendNodeIds)$/.test(
                key,
              )
            )
              nodeIds.add(value);
            else if (Array.isArray(value))
              for (const child of value) collectIds(child, key);
            else if (value && typeof value === "object")
              for (const [childKey, child] of Object.entries(value))
                collectIds(child, childKey);
          };
          for (const event of invalidations) collectIds(event.args);
          for (const event of traceEvents.filter(
            (event) => event.name === "Layout",
          ))
            collectIds(event.args);
          const ids = [...nodeIds];
          for (let offset = 0; offset < ids.length; offset += 16)
            invalidationNodes.push(
              ...(await Promise.all(
                ids.slice(offset, offset + 16).map(async (id) => {
                  try {
                    const { node } = await cpu.send("DOM.describeNode", {
                      backendNodeId: id,
                      depth: 0,
                    });
                    const { object } = await cpu.send("DOM.resolveNode", {
                      backendNodeId: id,
                    });
                    const related = object.objectId
                      ? await cpu.send("Runtime.callFunctionOn", {
                          objectId: object.objectId,
                          functionDeclaration: `function(){return {itemId:this.closest?.('[data-item-id]')?.getAttribute('data-item-id')??null,parents:(()=>{const result=[];for(let node=this;node&&result.length<5;node=node.parentElement)result.push({tag:node.tagName,id:node.id,className:node.getAttribute?.('class')});return result;})()}}`,
                          returnByValue: true,
                        })
                      : null;
                    if (object.objectId)
                      await cpu.send("Runtime.releaseObject", {
                        objectId: object.objectId,
                      });
                    return {
                      traceNodeId: id,
                      node,
                      related: related?.result.value ?? null,
                    };
                  } catch (error) {
                    return { traceNodeId: id, error: String(error) };
                  }
                }),
              )),
            );
        }
        const geometryAfter = geometryBefore ? await layoutGeometry() : null;
        const profileName = `${operation}.cpuprofile`;
        await writeFile(
          testInfo.outputPath(profileName),
          JSON.stringify(profile),
          "utf8",
        );
        await testInfo.attach(`${operation}-cpu-profile`, {
          path: testInfo.outputPath(profileName),
          contentType: "application/json",
        });
        diagnosticOperations.push({
          operation,
          responseMs: value.durationMs,
          invalidations,
          invalidationNodes,
          geometryBefore,
          geometryAfter,
          animationsAfterPaint: value.animations,
          countsBefore,
          countsAfter: await domCounts(),
          profile: profileName,
          cpu: summarizeCpuProfile(profile),
          measuredCpu:
            trace.window.startTime >= profile.startTime &&
            trace.window.endTime <= profile.endTime
              ? summarizeCpuProfile(profile, trace.window)
              : null,
          trace: { file: traceName, ...trace },
        });
      }
      if (continuousDiagnostic)
        continuousMeasurements.push({
          operation,
          markerName,
          responseMs: value.durationMs,
        });
      expect(
        value.rendered,
        `${operation} required UI was painted at measurement end`,
      ).toBe(true);
      if (record) timings[operation].push(value.durationMs);
      return value.durationMs;
    };
    if (continuousDiagnostic && cpu) {
      if (continuousRenderCounters)
        await page.evaluate(() => {
          const api = (
            window as unknown as {
              __espShoppingPerformance: {
                enable(value?: boolean): void;
                reset(): void;
              };
            }
          ).__espShoppingPerformance;
          api.enable();
          api.reset();
        });
      cpu.on("Tracing.dataCollected", collectContinuousTrace);
      await cpu.send("Tracing.start", {
        categories:
          "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline",
        options: "record-as-much-as-possible",
      });
      await cpu.send("Profiler.start");
    }
    // An unrecorded complete cycle warms both endpoint and chain paths.
    // Each prior clearSnapshot proves the next cycle starts with every ID unchecked;
    // no state-changing operation occurs between that validation and reset.
    for (
      let repeat = -1;
      repeat < (diagnosticOnly && !continuousDiagnostic ? 0 : 20);
      repeat++
    ) {
      await clearSelection(page);
      if (repeat === -1)
        expect((await selectionSnapshot(page, condition)).selectedIds).toEqual(
          [],
        );
      const record = repeat >= 0;
      const durations: Partial<Record<Operation, number>> = {};
      await prepareItem(page, condition, "r1");
      durations.firstEndpoint = await clickResponse(
        checkbox(page, "r1"),
        "firstEndpoint",
        record,
      );
      await expect(checkbox(page, "r1")).toBeChecked();
      const firstSnapshot = await selectionSnapshot(page, condition);
      expect(firstSnapshot.selectedIds).toEqual(["r1"]);
      await prepareItem(page, condition, endpoint(condition));
      durations.secondEndpoint = await clickResponse(
        checkbox(page, endpoint(condition)),
        "secondEndpoint",
        record,
      );
      await expect(checkbox(page, endpoint(condition))).toBeChecked();
      const secondSnapshot = await selectionSnapshot(page, condition);
      expect(secondSnapshot.selectedIds).toEqual(["r1", endpoint(condition)]);
      await prepareItem(page, condition, endpoint(condition));
      await expect(chain(page, endpoint(condition), false)).toBeVisible();
      const selectAction = await actionableChain(
        page,
        endpoint(condition),
        false,
      );
      const beforeSelection = selectAction.evidence.geometry;
      if (repeat === -1) {
        warmupAssetReadiness = await cssChainAssetReadiness(
          page,
          selectAction.locator,
        );
        if (process.env.ESP_DIAGNOSTIC_CHAIN_LAYOUT_CONTAINMENT === "1") {
          warmupChainContainmentReadiness = await page.evaluate(() => {
            const buttons = [
              ...document.querySelectorAll<HTMLElement>(
                ".esp-flat-range-chain,.esp-flat-range-chain-gap",
              ),
            ];
            return {
              buttonCount: buttons.length,
              allComputedContainLayout: buttons.every(
                (button) => getComputedStyle(button).contain === "layout",
              ),
              first: buttons[0]
                ? {
                    contain: getComputedStyle(buttons[0]).contain,
                    className: buttons[0].className,
                  }
                : null,
            };
          });
          expect(warmupChainContainmentReadiness.buttonCount).toBeGreaterThan(
            0,
          );
          expect(warmupChainContainmentReadiness.allComputedContainLayout).toBe(
            true,
          );
          expect(warmupChainContainmentReadiness.first?.contain).toBe("layout");
        }
        if (process.env.ESP_DIAGNOSTIC_CHAIN_NEAR_OPAQUE === "1") {
          warmupNearOpaqueReadiness = {
            before: await chainOpacityReadiness(),
            after: null,
          };
          expect(warmupNearOpaqueReadiness.before.buttonCount).toBeGreaterThan(
            0,
          );
          expect(warmupNearOpaqueReadiness.before.allUnselectedHalf).toBe(true);
        }
        if (process.env.ESP_DIAGNOSTIC_CHAIN_FILTER_OPACITY === "1") {
          warmupFilterOpacityReadiness = {
            before: await chainOpacityReadiness(),
            after: null,
          };
          expect(
            warmupFilterOpacityReadiness.before.buttonCount,
          ).toBeGreaterThan(0);
          expect(
            warmupFilterOpacityReadiness.before.allUnselectedFilterHalf,
          ).toBe(true);
        }
        if (warmupVisual)
          await captureWarmupChain("unselected", selectAction.locator);
        if (process.env.ESP_RANGE_WARMUP_VISUAL === "1")
          await captureWarmupInteractions("unselected", selectAction.locator);
      }
      durations.selectRange = await clickResponse(
        selectAction.locator,
        "selectRange",
        record,
      );
      if (repeat === -1 && warmupNearOpaqueReadiness) {
        warmupNearOpaqueReadiness.after = await chainOpacityReadiness();
        expect(warmupNearOpaqueReadiness.after.buttonCount).toBe(
          warmupNearOpaqueReadiness.before.buttonCount,
        );
        expect(warmupNearOpaqueReadiness.after.allSelectedNearOpaque).toBe(
          true,
        );
      }
      if (repeat === -1 && warmupFilterOpacityReadiness) {
        warmupFilterOpacityReadiness.after = await chainOpacityReadiness();
        expect(warmupFilterOpacityReadiness.after.buttonCount).toBe(
          warmupFilterOpacityReadiness.before.buttonCount,
        );
        expect(warmupFilterOpacityReadiness.after.allSelectedFilterOpaque).toBe(
          true,
        );
        expect(
          warmupFilterOpacityReadiness.after.styleSamples.map(
            (sample) => sample.rect,
          ),
        ).toEqual(
          warmupFilterOpacityReadiness.before.styleSamples.map(
            (sample) => sample.rect,
          ),
        );
      }
      if (repeat === -1 && warmupVisual)
        await captureWarmupChain(
          "selected",
          chain(page, endpoint(condition), true),
        );
      if (repeat === -1 && process.env.ESP_RANGE_WARMUP_VISUAL === "1")
        await captureWarmupInteractions(
          "selected",
          chain(page, endpoint(condition), true),
        );
      await expect(chain(page, endpoint(condition), true)).toBeVisible();
      const selectedSnapshot = await selectionSnapshot(page, condition);
      const selected = selectedSnapshot.selectedIds;
      expect(selected).toEqual(targetIds(condition));
      await prepareItem(page, condition, endpoint(condition));
      const clearAction = await actionableChain(
        page,
        endpoint(condition),
        true,
      );
      const beforeClear = clearAction.evidence.geometry;
      durations.clearRange = await clickResponse(
        clearAction.locator,
        "clearRange",
        record,
      );
      await expect(
        page.getByTitle("範囲内のチェックを入れる", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByTitle("範囲内のチェックを外す", { exact: true }),
      ).toHaveCount(0);
      const clearSnapshot = await selectionSnapshot(page, condition);
      expect(clearSnapshot.selectedIds).toEqual([]);
      await assertRenderer(page, condition);
      if (record)
        samples.push({
          repeat,
          durations,
          selectedIds: selected,
          remainingIds: [],
          snapshots: {
            firstSnapshot,
            secondSnapshot,
            selectedSnapshot,
            clearSnapshot,
          },
          beforeSelection,
          beforeClear,
          chainActions: {
            select: selectAction.evidence,
            clear: clearAction.evidence,
          },
        });
    }
    if (diagnosticOnly) {
      if (continuousDiagnostic && cpu) {
        const stopped = await cpu.send("Profiler.stop");
        const profile = stopped.profile as RangeCpuProfile;
        const traceComplete = new Promise<void>((resolve) =>
          cpu.once("Tracing.tracingComplete", () => resolve()),
        );
        await cpu.send("Tracing.end");
        await traceComplete;
        cpu.off("Tracing.dataCollected", collectContinuousTrace);
        await writeFile(
          testInfo.outputPath("continuous.cpuprofile"),
          JSON.stringify(profile),
          "utf8",
        );
        await writeFile(
          testInfo.outputPath("continuous.trace.json"),
          JSON.stringify({ traceEvents: continuousEvents }),
          "utf8",
        );
        await testInfo.attach("continuous-cpu-profile", {
          path: testInfo.outputPath("continuous.cpuprofile"),
          contentType: "application/json",
        });
        await testInfo.attach("continuous-timeline", {
          path: testInfo.outputPath("continuous.trace.json"),
          contentType: "application/json",
        });
        for (let index = 0; index < continuousMeasurements.length; index++) {
          const measurement = continuousMeasurements[index];
          const trace = summarizeRangeTrace(
            continuousEvents,
            measurement.markerName,
          );
          diagnosticOperations.push({
            ...measurement,
            repeat: Math.floor(index / 4) - 1,
            profile: "continuous.cpuprofile",
            measuredCpu: summarizeCpuProfile(profile, trace.window),
            trace: { file: "continuous.trace.json", ...trace },
          });
        }
        shoppingDiagnostic = continuousRenderCounters
          ? await page.evaluate(() =>
              (
                window as unknown as {
                  __espShoppingPerformance: { read(): unknown };
                }
              ).__espShoppingPerformance.read(),
            )
          : null;
      }
      await artifact(testInfo, "edit-execute-range-selection-diagnostic", {
        diagnosticOnly: true,
        diagnosticMode: continuousDiagnostic
          ? "continuous-warmup-plus-twenty"
          : "per-operation-warmup",
        shoppingDiagnostic,
        initialStripeOverrideReadiness,
        invalidationDiagnostic,
        tracingCategories,
        warmupChainContainmentReadiness,
        chainLayoutContainmentOverride:
          process.env.ESP_DIAGNOSTIC_CHAIN_LAYOUT_CONTAINMENT === "1",
        warmupNearOpaqueReadiness,
        chainNearOpaqueOverride:
          process.env.ESP_DIAGNOSTIC_CHAIN_NEAR_OPAQUE === "1",
        warmupFilterOpacityReadiness,
        warmupVisual,
        warmupVisualEvidence,
        warmupMouseContext: process.env.ESP_RANGE_WARMUP_MOUSE === "1",
        chainFilterOpacityOverride:
          process.env.ESP_DIAGNOSTIC_CHAIN_FILTER_OPACITY === "1",
        continuousRenderCounters,
        diagnosticCssOverride: diagnosticTransitionOverride() || null,
        transitionOverrideFlags: {
          chain: process.env.ESP_DIAGNOSTIC_CHAIN_NO_TRANSITIONS === "1",
          card: process.env.ESP_DIAGNOSTIC_CARD_NO_TRANSITIONS === "1",
        },
        stripeVisibilityOverride:
          process.env.ESP_DIAGNOSTIC_STRIPE_VISIBILITY === "1",
        acceptanceMeasurement: false,
        environment: actualEnvironment,
        browserVersion: page.context().browser()?.version(),
        fixtureIds: fixture(condition.count).data.executeModeItems[eventName][
          day
        ],
        endpoints: ["r1", endpoint(condition)],
        targetIds: targetIds(condition),
        repetitions: continuousDiagnostic ? 21 : 1,
        recordedDiagnosticRepetitions: continuousDiagnostic ? 20 : 0,
        operations: diagnosticOperations,
        warmupAssetReadiness,
        cspViolations: await rangeCspViolations(page),
        errors,
      });
      await cpu?.detach();
      expect(await rangeCspViolations(page)).toEqual([]);
      expect(errors).toEqual([]);
      return;
    }
    const summary = Object.fromEntries(
      Object.entries(timings).map(([operation, values]) => [
        operation,
        summarizePerformanceSamples(values),
      ]),
    );
    await artifact(testInfo, "edit-execute-range-selection-timings", {
      ...shoppingEvidenceIdentity("range"),
      environment: actualEnvironment,
      browserVersion: page.context().browser()?.version(),
      fixtureIds: fixture(condition.count).data.executeModeItems[eventName][
        day
      ],
      endpoints: ["r1", endpoint(condition)],
      targetIds: targetIds(condition),
      targetCount: targetIds(condition).length,
      method: {
        start: "performance.now immediately before DOM click",
        end: "requestAnimationFrame then setTimeout(0), matching responsive-performance.spec.ts",
        summary: "two middle samples for even median; nearest-rank p95",
        repetitions: 20,
        warmupCycles: 1,
        direction: "forward",
        excluded: [
          "reset",
          "scroll",
          "pre-operation stable paint",
          "all-ID DOM validation",
        ],
        persistence:
          "保存なし: selection and endpoints are transient UI state; no persistence operation added",
        baseline: "比較不可: target chain does not exist before the fix",
        thresholds: { minimumCount: 20, medianMs: 55, p95Ms: 100 },
      },
      warmupAssetReadiness,
      cspViolations: await rangeCspViolations(page),
      timings,
      summary,
      samples,
      errors,
    });
    expect(errors).toEqual([]);
    expect(await rangeCspViolations(page)).toEqual([]);
    for (const [operation, result] of Object.entries(summary)) {
      expect(result.count, `${operation} sample count`).toBeGreaterThanOrEqual(
        20,
      );
      expect(result.medianMs, `${operation} median`).toBeLessThanOrEqual(55);
      expect(result.p95Ms, `${operation} p95`).toBeLessThanOrEqual(100);
    }
  });
}

for (const layout of ["pc", "smartphone"] as const) {
  test(`parent edit controls clear endpoints and allow a new chain: ${layout} @range-selection-regression`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const condition: Condition = {
      count: 150,
      layout,
      renderer: "auto",
      rangeLength: "short",
    };
    await restore(page, condition, true);
    const groups = page.getByRole("button", {
      name: "スペース別",
      exact: true,
    });
    const anyChain = page.locator(
      '[title="範囲内のチェックを入れる"], [title="範囲内のチェックを外す"]',
    );
    const createChain = async () => {
      await clearSelection(page);
      for (const id of ["r1", "r3"]) {
        await prepareItem(page, condition, id);
        await activate(checkbox(page, id), layout);
      }
      await expect(anyChain.first()).toBeVisible();
    };
    const preservedChecks = async () => {
      for (const id of ["r1", "r3"]) {
        await prepareItem(page, condition, id);
        await expect(checkbox(page, id)).toBeChecked();
      }
    };
    await createChain();
    await groups.click();
    await expect(anyChain).toHaveCount(0);
    await groups.click();
    await expect(anyChain).toHaveCount(0);
    await preservedChecks();
    await createChain();
    await groups.click();
    await clearSelection(page);
    for (const id of ["r1", "r3"]) {
      await prepareItem(page, condition, id);
      await activate(checkbox(page, id), layout);
    }
    await expect(anyChain.first()).toBeVisible();
    await page
      .getByRole("button", { name: "全て折りたたむ", exact: true })
      .click();
    await expect(anyChain).toHaveCount(0);
    await page.getByRole("button", { name: "全て展開", exact: true }).click();
    await expect(anyChain).toHaveCount(0);
    await preservedChecks();
    await groups.click();
    await createChain();
    const blockFilter = page.getByRole("button", { name: "B", exact: true });
    await blockFilter.click();
    await expect(anyChain).toHaveCount(0);
    await blockFilter.click();
    await expect(anyChain).toHaveCount(0);
    await preservedChecks();
    await createChain();
    await prepareItem(page, condition, "r3");
    const geometry = await assertChainGeometry(chain(page, "r3", false));
    await activate(chain(page, "r3", false), layout);
    for (const id of ["r1", "r2", "r3"]) {
      await prepareItem(page, condition, id);
      await expect(checkbox(page, id)).toBeChecked();
    }
    await prepareItem(page, condition, "r3");
    await activate(chain(page, "r3", true), layout);
    await expect(anyChain).toHaveCount(0);
    await artifact(testInfo, "edit-execute-parent-endpoint-clearing", {
      environment: await environment(page, condition),
      controls: [
        "space groups on/off",
        "collapse/expand all",
        "candidate block filter on/off",
      ],
      preservedChecks: ["r1", "r3"],
      newRange: ["r1", "r2", "r3"],
      geometry,
    });
  });
}

for (const width of [320, 390]) {
  test(`Virtual edit card controls fit their columns: ${width}px @range-selection-regression`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const condition: Condition = {
      count: 150,
      layout: "smartphone",
      renderer: "virtual",
      rangeLength: "short",
    };
    await restore(page, condition, true);
    await page.setViewportSize({ width, height: 844 });
    const observations = [];
    for (const id of ["r1", "c1"]) {
      await prepareItem(page, condition, id);
      const card = row(page, id);
      const controls = [
        { name: "checkbox", locator: checkbox(page, id) },
        {
          name: "memo",
          locator: card.getByLabel("利用者メモ", { exact: true }),
        },
        {
          name: "quantity",
          locator: card.getByLabel("購入予定数量", { exact: true }),
        },
        {
          name: "price",
          locator: card.getByLabel("購入金額", { exact: true }),
        },
        {
          name: "status",
          locator: card.getByRole("button", { name: /^Current status:/ }),
        },
      ];
      for (const { name, locator } of controls) {
        await expect(locator).toBeVisible();
        const geometry = await locator.evaluate((control) => {
          const card = control.closest<HTMLElement>(".rounded-lg.shadow-md");
          if (!card) throw new Error("Control has no shopping card frame");
          const rect = (element: Element) => {
            const bounds = element.getBoundingClientRect();
            return {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              width: bounds.width,
              height: bounds.height,
            };
          };
          const bounds = rect(control);
          const center = {
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2,
          };
          const hit = document.elementFromPoint(center.x, center.y);
          return {
            control: bounds,
            card: rect(card),
            cardClientWidth: card.clientWidth,
            cardScrollWidth: card.scrollWidth,
            viewport: { width: innerWidth, height: innerHeight },
            center,
            centerHit: Boolean(hit && control.contains(hit)),
            hit: hit ? { tag: hit.tagName, className: hit.className } : null,
          };
        });
        observations.push({ id, name, ...geometry });
      }
    }
    await assertRenderer(page, condition);
    const screenshot = testInfo.outputPath(
      `narrow-edit-card-controls-${width}.png`,
    );
    await page.screenshot({ path: screenshot });
    await testInfo.attach("narrow-edit-card-controls", {
      path: screenshot,
      contentType: "image/png",
    });
    await artifact(testInfo, "virtual-edit-card-control-geometry", {
      environment: await environment(page, condition),
      width,
      observations,
    });
    for (const observation of observations) {
      const description = `${width}px ${observation.id} ${observation.name}: ${JSON.stringify(observation)}`;
      expect(observation.control.width, description).toBeGreaterThan(0);
      expect(observation.control.height, description).toBeGreaterThan(0);
      expect(observation.control.left, description).toBeGreaterThanOrEqual(
        observation.card.left - 0.5,
      );
      expect(observation.control.right, description).toBeLessThanOrEqual(
        observation.card.right + 0.5,
      );
      expect(observation.control.top, description).toBeGreaterThanOrEqual(
        observation.card.top - 0.5,
      );
      expect(observation.control.bottom, description).toBeLessThanOrEqual(
        observation.card.bottom + 0.5,
      );
      expect(observation.control.left, description).toBeGreaterThanOrEqual(0);
      expect(observation.control.right, description).toBeLessThanOrEqual(width);
      expect(observation.control.top, description).toBeGreaterThanOrEqual(0);
      expect(observation.control.bottom, description).toBeLessThanOrEqual(
        observation.viewport.height,
      );
      expect(observation.centerHit, description).toBe(true);
    }
  });
}

for (const { count, rangeLength } of [
  { count: 150, rangeLength: "short" },
  { count: 500, rangeLength: "long" },
] as const) {
  test(`Virtual reverse chain preserves populated candidate checkbox hits: ${count} items, ${rangeLength} @range-selection-regression`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const condition: Condition = {
      count,
      layout: "smartphone",
      renderer: "virtual",
      rangeLength,
    };
    await restore(page, condition, true);
    const last = endpoint(condition);
    const endpointStages = [];
    const endpointState = () =>
      page.evaluate(() => ({
        scrollY,
        focusedItemId:
          document.activeElement?.closest<HTMLElement>("[data-item-id]")
            ?.dataset.itemId ?? null,
        renderers: [
          ...document.querySelectorAll<HTMLElement>("[data-list-renderer]"),
        ].map((root) => ({
          column: root.dataset.shoppingDragColumn,
          renderer: root.dataset.listRenderer,
          rowCount: root.dataset.listRowCount,
        })),
        mountedItems: [
          ...document.querySelectorAll<HTMLElement>("[data-item-id]"),
        ].map((entry) => ({
          id: entry.dataset.itemId,
          column: entry.closest<HTMLElement>("[data-shopping-drag-column]")
            ?.dataset.shoppingDragColumn,
          selected: entry.dataset.isSelected,
          checked: entry.querySelector<HTMLInputElement>(
            'input[type="checkbox"]',
          )?.checked,
          chainCount: entry.querySelectorAll(
            'button[title="範囲内のチェックを入れる"], button[title="範囲内のチェックを外す"]',
          ).length,
        })),
      }));
    await assertRenderer(page, condition);
    for (const id of [last, "r1"]) {
      await prepareItem(page, condition, id);
      const beforeActivation = await endpointState();
      try {
        await activate(checkbox(page, id), condition.layout);
        await expect(checkbox(page, id)).toBeChecked();
        await expect(row(page, id)).toHaveAttribute("data-is-selected", "true");
        await stablePaint(page);
        await expect(checkbox(page, id)).toBeChecked();
      } finally {
        const stage = {
          activatedId: id,
          beforeActivation,
          afterActivation: await endpointState(),
        };
        endpointStages.push(stage);
        await artifact(testInfo, `virtual-populated-endpoint-${id}`, stage);
      }
    }
    // Preserve both chosen endpoints across virtual unmount/remount before
    // returning to the same r1 segment whose center must receive the tap.
    for (const id of [last, "r1"]) {
      await prepareItem(page, condition, id);
      await expect(checkbox(page, id)).toBeChecked();
      await expect(row(page, id)).toHaveAttribute("data-is-selected", "true");
    }
    await artifact(testInfo, "virtual-populated-endpoint-readiness", {
      endpointStages,
      beforeChain: await endpointState(),
    });
    const action = await actionableChain(page, "r1", false);
    const visibleChainCenters = await assertVisibleChainCenters(page);
    await prepareItem(page, condition, "c1");
    const chainBesideCandidate = await chainGeometry(chain(page, "r1", false));
    const candidate = checkbox(page, "c1");
    const candidateGeometry = await candidate.evaluate((input) => {
      const bounds = input.getBoundingClientRect();
      const center = {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      };
      const hit = document.elementFromPoint(center.x, center.y);
      return {
        bounds: {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        },
        center,
        centerHit: Boolean(hit && input.contains(hit)),
        hit: hit ? { tag: hit.tagName, className: hit.className } : null,
      };
    });
    expect(candidateGeometry.centerHit).toBe(true);
    expect(
      chainBesideCandidate.bounds.right,
      "execute chain and candidate checkbox have separate horizontal targets",
    ).toBeLessThanOrEqual(candidateGeometry.bounds.left);
    await activate(candidate, condition.layout);
    await expect(candidate).toBeChecked();
    for (const id of ["r1", last]) {
      await prepareItem(page, condition, id);
      await expect(checkbox(page, id)).toBeChecked();
    }
    await assertRenderer(page, condition);
    await artifact(testInfo, "virtual-chain-populated-candidate-hit", {
      environment: await environment(page, condition),
      endpointStages,
      chain: action.evidence,
      visibleChainCenters,
      chainBesideCandidate,
      candidateGeometry,
    });
  });
}

test("Virtual empty candidate keeps its drop hit without intercepting the chain during drag/cancel @range-selection-regression", async ({
  page,
}, testInfo) => {
  const condition: Condition = {
    count: 150,
    layout: "smartphone",
    renderer: "virtual",
    rangeLength: "short",
  };
  await restore(page, condition);
  for (const id of ["r3", "r1"]) {
    await prepareItem(page, condition, id);
    await activate(checkbox(page, id), condition.layout);
  }
  const candidate = page.locator(
    '[data-shopping-drag-column="candidate"][data-list-renderer]',
  );
  await expect(candidate).toHaveCount(1);
  await expect(candidate).toHaveCSS("pointer-events", "auto");
  const beforeDrag = await actionableChain(page, "r1", false);
  const candidateBoundsBeforeDrag = await candidate.evaluate((root) => {
    const bounds = root.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right };
  });
  expect(
    beforeDrag.evidence.geometry.bounds.right,
    "idle empty candidate does not occupy the execute chain gutter",
  ).toBeLessThanOrEqual(candidateBoundsBeforeDrag.left);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  try {
    // Dispatch only the source event. Hit testing below proves the destination
    // can receive browser input; dispatching dragover on it would bypass that.
    await row(page, "r1").dispatchEvent("dragstart", {
      dataTransfer: transfer,
    });
    await expect(candidate).toHaveCSS("pointer-events", "auto");
    const duringDrag = await candidate.evaluate((root) => {
      const bounds = root.getBoundingClientRect();
      const center = {
        x: (Math.max(0, bounds.left) + Math.min(innerWidth, bounds.right)) / 2,
        y: (Math.max(0, bounds.top) + Math.min(innerHeight, bounds.bottom)) / 2,
      };
      const hit = document.elementFromPoint(center.x, center.y);
      return {
        center,
        centerHit: Boolean(hit && root.contains(hit)),
        hit: hit ? { tag: hit.tagName, className: hit.className } : null,
      };
    });
    expect(duringDrag.centerHit).toBe(true);
    await row(page, "r1").dispatchEvent("dragend", {
      dataTransfer: transfer,
    });
    await expect(candidate).toHaveCSS("pointer-events", "auto");
    const afterCancel = await actionableChain(page, "r1", false);
    const candidateBoundsAfterCancel = await candidate.evaluate((root) => {
      const bounds = root.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right };
    });
    expect(
      afterCancel.evidence.geometry.bounds.right,
      "cancelled drag keeps the empty candidate outside the chain gutter",
    ).toBeLessThanOrEqual(candidateBoundsAfterCancel.left);
    await activate(afterCancel.locator, condition.layout, afterCancel.position);
    for (const id of ["r1", "r2", "r3"]) {
      await prepareItem(page, condition, id);
      await expect(checkbox(page, id)).toBeChecked();
    }
    await prepareItem(page, condition, "r1");
    const clearAction = await actionableChain(page, "r1", true);
    await activate(clearAction.locator, condition.layout, clearAction.position);
    for (const id of ["r1", "r2", "r3"]) {
      await prepareItem(page, condition, id);
      await expect(checkbox(page, id)).not.toBeChecked();
    }
    await artifact(testInfo, "virtual-chain-empty-candidate-drag-hit", {
      environment: await environment(page, condition),
      beforeDrag: beforeDrag.evidence,
      candidateBoundsBeforeDrag,
      duringDrag,
      afterCancel: afterCancel.evidence,
      candidateBoundsAfterCancel,
      clear: clearAction.evidence,
    });
  } finally {
    await row(page, "r1").dispatchEvent("dragend", {
      dataTransfer: transfer,
    });
    await transfer.dispose();
  }
});

for (const layout of ["pc", "smartphone"] as const) {
  for (const rangeLength of ["short", "long"] as const) {
    test(`parent candidate CSS chain keeps orientation and range checks: ${layout}, ${rangeLength} @range-selection-regression`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(180000);
      const condition: Condition = {
        count: rangeLength === "short" ? 4 : 150,
        layout,
        renderer: "full",
        rangeLength,
      };
      await restore(page, condition, false, true);
      const outsideIds = rangeLength === "short" ? ["r4"] : [];
      if (outsideIds.length) {
        await prepareItem(page, condition, "r4");
        await activate(checkbox(page, "r4"), layout);
        const groups = page.getByRole("button", {
          name: "スペース別",
          exact: true,
        });
        await groups.click();
        await groups.click();
      }
      const last = endpoint(condition);
      for (const id of ["r1", last]) {
        await prepareItem(page, condition, id);
        await activate(checkbox(page, id), layout);
      }
      const endpoints = await selectionSnapshot(page, condition);
      const endpointStripeVisibility =
        await assertMountedStripeVisibility(page);
      expect(endpoints.selectedIds).toEqual(
        fixture(condition.count).data.executeModeItems[eventName][day].filter(
          (id) => id === "r1" || id === last || outsideIds.includes(id),
        ),
      );
      await prepareItem(page, condition, last);
      const selectAction = await actionableChain(page, last, false);
      await expect(selectAction.locator).toHaveClass(
        /esp-flat-range-chain-candidate/,
      );
      const assetReadiness = await cssChainAssetReadiness(
        page,
        selectAction.locator,
      );
      const filterBefore = await selectAction.locator.evaluate((button) => {
        const style = getComputedStyle(button);
        return { opacity: style.opacity, filter: style.filter };
      });
      if (rangeLength === "long")
        expect(filterBefore).toEqual({ opacity: "1", filter: "opacity(0.5)" });
      const screenshot = testInfo.outputPath("candidate-chain-ready.png");
      await page.screenshot({ path: screenshot });
      await testInfo.attach("candidate-chain-ready", {
        path: screenshot,
        contentType: "image/png",
      });
      await activate(selectAction.locator, layout, selectAction.position);
      const selected = await selectionSnapshot(page, condition);
      const selectedStripeVisibility =
        await assertMountedStripeVisibility(page);
      expect(selected.selectedIds).toEqual(
        fixture(condition.count).data.executeModeItems[eventName][day].filter(
          (id) => targetIds(condition).includes(id) || outsideIds.includes(id),
        ),
      );
      await prepareItem(page, condition, last);
      const clearAction = await actionableChain(page, last, true);
      const filterAfter = await clearAction.locator.evaluate((button) => {
        const style = getComputedStyle(button);
        return { opacity: style.opacity, filter: style.filter };
      });
      if (rangeLength === "long")
        expect(filterAfter).toEqual({ opacity: "1", filter: "opacity(1)" });
      await activate(clearAction.locator, layout, clearAction.position);
      const cleared = await selectionSnapshot(page, condition);
      const clearedStripeVisibility = await assertMountedStripeVisibility(page);
      expect(cleared.selectedIds).toEqual(outsideIds);
      await expect(
        page.locator(
          '[title="範囲内のチェックを入れる"], [title="範囲内のチェックを外す"]',
        ),
      ).toHaveCount(0);
      await assertRenderer(page, condition);
      const actualEnvironment = await environment(page, condition);
      await artifact(testInfo, "edit-candidate-css-range-selection", {
        environment: {
          ...actualEnvironment,
          configuration: {
            ...actualEnvironment.configuration,
            columnType: "candidate",
            showHallGroups: false,
          },
        },
        snapshots: { endpoints, selected, cleared },
        stripeVisibility: {
          endpoints: endpointStripeVisibility,
          selected: selectedStripeVisibility,
          cleared: clearedStripeVisibility,
        },
        assetReadiness,
        filterBefore,
        filterAfter,
        chainActions: {
          select: selectAction.evidence,
          clear: clearAction.evidence,
        },
        screenshot: "candidate-chain-ready.png",
        cspViolations: await rangeCspViolations(page),
      });
      expect(await rangeCspViolations(page)).toEqual([]);
    });
  }
}
