import { expect, test, type Page } from "@playwright/test";
import { armTransferResponseProbe } from "./shopping-transfer-measurement";

const moved = ["c1", "c2", "c3"];
const expected = ["e0", ...moved, "e1"];
const card = (id: string, controls = true) =>
  `<div data-item-id="${id}">${controls ? '<input type="checkbox">' : ""}</div>`;

async function prepare(page: Page) {
  await page.setContent(
    `<section data-shopping-drag-column="candidate"></section><section data-shopping-drag-column="execute">${card("e0")}${card("e1")}</section>`,
  );
}
async function arm(page: Page, requiredDestinationIds = moved) {
  await armTransferResponseProbe(
    page,
    "c1",
    "e0",
    "execute",
    "native",
    "endpoint-regression",
    {
      expectedTransferredIds: moved,
      requiredDestinationIds,
      expectedDestinationDisplayIds: expected,
      anchorPosition: "after",
    },
  );
}
async function replaceDestination(page: Page, html: string) {
  await page
    .locator('[data-shopping-drag-column="execute"]')
    .evaluate((root, html) => {
      root.innerHTML = html;
    }, html);
}
async function begin(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event("drop")));
}
async function responseState(page: Page) {
  return page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return {
      domMs: window.__shoppingTransferProbe?.domMs,
      responseMs: window.__shoppingTransferProbe?.responseMs,
      mounted: window.__shoppingTransferProbe?.mountedTransferredIds,
    };
  });
}
async function expectIncomplete(page: Page) {
  expect(await responseState(page)).toMatchObject({
    domMs: null,
    responseMs: null,
  });
}
async function expectComplete(page: Page, mounted = moved) {
  await page.waitForFunction(
    () => window.__shoppingTransferProbe?.responseMs !== null,
  );
  expect(await responseState(page)).toMatchObject({ mounted });
  await page.evaluate(() => window.__shoppingTransferProbe?.stop?.());
}

test("multi-card response waits for every pre-input required destination card", async ({
  page,
}) => {
  await prepare(page);
  await arm(page);
  await replaceDestination(page, card("e0") + card("c1") + card("e1"));
  await begin(page);
  await expectIncomplete(page);
  await replaceDestination(page, expected.map((id) => card(id)).join(""));
  await expectComplete(page);
});

test("multi-card response rejects a secondary-card permutation", async ({
  page,
}) => {
  await prepare(page);
  await arm(page);
  await replaceDestination(
    page,
    ["e0", "c1", "c3", "c2", "e1"].map((id) => card(id)).join(""),
  );
  await begin(page);
  await expectIncomplete(page);
  await replaceDestination(page, expected.map((id) => card(id)).join(""));
  await expectComplete(page);
});

test("an explicit pre-input offscreen exemption does not wait for the absent card", async ({
  page,
}) => {
  await prepare(page);
  await arm(page, ["c1", "c2"]);
  await replaceDestination(
    page,
    ["e0", "c1", "c2", "e1"].map((id) => card(id)).join(""),
  );
  await begin(page);
  await expectComplete(page, ["c1", "c2"]);
});

test("a required destination card must have its input controls", async ({
  page,
}) => {
  await prepare(page);
  await arm(page);
  await replaceDestination(
    page,
    expected.map((id) => card(id, id !== "c2")).join(""),
  );
  await begin(page);
  await expectIncomplete(page);
  await replaceDestination(page, expected.map((id) => card(id)).join(""));
  await expectComplete(page);
});

test("an exempt card still needs controls if it mounts", async ({ page }) => {
  await prepare(page);
  await arm(page, ["c1", "c2"]);
  await replaceDestination(
    page,
    expected.map((id) => card(id, id !== "c3")).join(""),
  );
  await begin(page);
  await expectIncomplete(page);
  await replaceDestination(page, expected.map((id) => card(id)).join(""));
  await expectComplete(page);
});

test("the measured predicate needs neither layout reads nor a full DOM scan", async ({
  page,
}) => {
  await prepare(page);
  await arm(page);
  await replaceDestination(page, expected.map((id) => card(id)).join(""));
  await page.evaluate(() => {
    Element.prototype.getBoundingClientRect = () => {
      throw new Error("unexpected measured layout read");
    };
    Element.prototype.querySelectorAll = () => {
      throw new Error("unexpected measured full DOM scan");
    };
  });
  await begin(page);
  await expectComplete(page);
});
