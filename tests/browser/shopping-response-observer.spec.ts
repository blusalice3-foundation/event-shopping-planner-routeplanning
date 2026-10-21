import { expect, test } from "@playwright/test";
import { measureShoppingResponse } from "./shopping-performance-evidence";

test.use({ trace: "off", video: "off" });
for (const delay of [0, 150]) {
  test(`shopping UI observer captures ${delay ? "delayed" : "synchronous"} target updates independently`, async ({
    page,
  }) => {
    await page.setContent(
      `<div data-list-renderer="full"><div data-item-id="target"><button aria-label="Current status: 未購入">status</button></div></div>`,
    );
    await page.locator("button").evaluate((button, delay) => {
      button.addEventListener("click", () => {
        const apply = () =>
          button.setAttribute("aria-label", "Current status: 購入済");
        if (delay) setTimeout(apply, delay);
        else apply();
      });
    }, delay);
    const sample = await measureShoppingResponse(
      page.locator('[data-item-id="target"]'),
      "button",
      { targetId: "target", status: "購入済" },
    );
    expect(sample.matched).toBe(true);
    if (delay) {
      expect(sample.uiMs).toBeGreaterThanOrEqual(150);
      expect(sample.uiMs - sample.legacyMs).toBeGreaterThan(50);
    }
    expect(sample.legacyMs).toBeGreaterThanOrEqual(0);
  });
}

test("shopping UI observer uses the active visit instead of retained hidden rows", async ({
  page,
}) => {
  await page.setContent(
    `<div data-testid="focus-mode-header">A 42</div><div data-testid="focus-mode-scroll-region"><div hidden aria-hidden="true"><div data-item-id="target"><button aria-label="Current status: 購入済"></button></div></div><div data-item-id="target"><button aria-label="Current status: 未購入">status</button></div></div>`,
  );
  const target = page.locator('[data-item-id="target"]').last();
  await target
    .locator("button")
    .evaluate((button) =>
      button.addEventListener("click", () =>
        button.setAttribute("aria-label", "Current status: 購入済"),
      ),
    );
  const sample = await measureShoppingResponse(target, "button", {
    targetId: "target",
    status: "購入済",
    visitNumber: "42",
  });
  expect(sample.matched).toBe(true);
});
