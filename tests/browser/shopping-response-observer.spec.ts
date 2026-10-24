import { expect, test, type Page } from "@playwright/test";
import {
  createPersistenceIntegrityDescriptors,
  createPersistenceDigest,
} from "../../src/utils/persistenceResilience";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";
import { measureShoppingResponse } from "./shopping-performance-evidence";
import { prepareTransferSourceOrigin } from "./shopping-transfer-measurement";
import { captureAcceptedSelectionPostcondition } from "./shopping-transfer-scenarios";

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

for (const delayedRow of ["old-card", "placeholder"] as const) {
  test(`shopping UI observer waits for every visible visit row: ${delayedRow}`, async ({
    page,
  }) => {
    await page.setContent(`
      <div data-testid="focus-mode-header">Visit A</div>
      <button id="next">next</button>
      <div data-testid="focus-mode-scroll-region" style="height:120px;overflow:auto">
        <div data-viewport-list>
          <div style="height:40px"><div id="first" data-item-id="old-1">old first</div></div>
          <div id="second" style="height:40px">${delayedRow === "old-card" ? '<div data-item-id="old-2">old second</div>' : '<div data-viewport-active="false" data-viewport-row-key="focus:new-2"><div class="esp-viewport-placeholder" data-row-key="focus:new-2">new second placeholder</div></div>'}</div>
        </div>
      </div>`);
    await page.locator("#next").evaluate((button) => {
      button.addEventListener("click", () => {
        document.querySelector(
          '[data-testid="focus-mode-header"]',
        )!.textContent = "Visit B";
        document.querySelector<HTMLElement>("#first")!.dataset.itemId = "new-1";
        setTimeout(() => {
          document.querySelector("#second")!.innerHTML =
            '<div data-item-id="new-2">new second</div>';
        }, 250);
      });
    });
    const sample = await measureShoppingResponse(
      page.locator("#next"),
      "button",
      {
        targetId: "new-1",
        visitNumber: "Visit B",
        visitItemIds: ["new-1", "new-2"],
      },
    );
    expect(sample.matched).toBe(true);
    expect(sample.uiMs).toBeGreaterThanOrEqual(250);
    expect(sample.uiMs - sample.legacyMs).toBeGreaterThan(100);
    await expect(page.locator('[data-item-id="new-2"]')).toBeVisible();
  });
}

for (const retained of [true, false]) {
  test(`shopping UI observer waits for an absent visible row (${retained ? "retained slots" : "virtual frontier"})`, async ({
    page,
  }) => {
    await page.setContent(`
      <div data-testid="focus-mode-header">Visit A</div><button id="next">next</button>
      <div data-testid="focus-mode-scroll-region" style="height:120px;overflow:auto">
        <div id="visit" ${retained ? "data-viewport-list" : ""}><div data-item-id="new-1" style="height:40px">first row only</div></div>
      </div>`);
    await page.locator("#next").evaluate((button) => {
      button.addEventListener("click", () => {
        document.querySelector(
          '[data-testid="focus-mode-header"]',
        )!.textContent = "Visit B";
        setTimeout(() => {
          document
            .querySelector("#visit")!
            .insertAdjacentHTML(
              "beforeend",
              '<div data-item-id="new-2" style="height:40px">second row</div>',
            );
        }, 250);
      });
    });
    const sample = await measureShoppingResponse(
      page.locator("#next"),
      "button",
      {
        targetId: "new-1",
        visitNumber: "Visit B",
        visitItemIds: ["new-1", "new-2"],
      },
    );
    expect(sample.matched).toBe(true);
    expect(sample.uiMs).toBeGreaterThanOrEqual(250);
    expect(sample.uiMs - sample.legacyMs).toBeGreaterThan(100);
  });
}

for (const invalidOrder of ["duplicate", "missing-middle"] as const) {
  test(`shopping UI observer rejects ${invalidOrder} visible membership until repaired`, async ({
    page,
  }) => {
    const initialIds =
      invalidOrder === "duplicate"
        ? ["new-1", "new-1", "new-3"]
        : ["new-1", "new-3"];
    await page.setContent(`
      <div data-testid="focus-mode-header">Visit A</div><button id="next">next</button>
      <div data-testid="focus-mode-scroll-region" style="height:160px;overflow:auto">
        <div id="visit">${initialIds.map((id) => `<div data-item-id="${id}" style="height:40px">${id}</div>`).join("")}</div>
      </div>`);
    await page.locator("#next").evaluate((button) => {
      button.addEventListener("click", () => {
        document.querySelector(
          '[data-testid="focus-mode-header"]',
        )!.textContent = "Visit B";
        setTimeout(() => {
          document.querySelector("#visit")!.innerHTML = [
            "new-1",
            "new-2",
            "new-3",
          ]
            .map(
              (id) =>
                `<div data-item-id="${id}" style="height:40px">${id}</div>`,
            )
            .join("");
        }, 250);
      });
    });
    const sample = await measureShoppingResponse(
      page.locator("#next"),
      "button",
      {
        targetId: "new-1",
        visitNumber: "Visit B",
        visitItemIds: ["new-1", "new-2", "new-3"],
      },
    );
    expect(sample.matched).toBe(true);
    expect(sample.uiMs).toBeGreaterThanOrEqual(250);
    expect(sample.uiMs - sample.legacyMs).toBeGreaterThan(100);
  });
}

test("shopping UI observer accepts virtual visits whose omitted rows are below the viewport", async ({
  page,
}) => {
  await page.setContent(`
    <div data-testid="focus-mode-header">Visit A</div><button id="next">next</button>
    <div data-testid="focus-mode-scroll-region" style="height:80px;overflow:auto">
      <div data-list-renderer="virtual"><div data-item-id="new-1" style="height:100px">only visible card</div></div>
    </div>`);
  await page.locator("#next").evaluate((button) => {
    button.addEventListener("click", () => {
      document.querySelector('[data-testid="focus-mode-header"]')!.textContent =
        "Visit B";
    });
  });
  const sample = await measureShoppingResponse(
    page.locator("#next"),
    "button",
    {
      targetId: "new-1",
      visitNumber: "Visit B",
      visitItemIds: ["new-1", "new-2", "new-3"],
    },
  );
  expect(sample.matched).toBe(true);
  expect(sample.uiMs).toBeLessThan(250);
  await expect(page.locator("[data-item-id]")).toHaveCount(1);
});
test("shopping UI observer excludes old visible rows even for a single-item visit", async ({
  page,
}) => {
  await page.setContent(`
    <div data-testid="focus-mode-header">Visit A</div><button id="next">next</button>
    <div data-testid="focus-mode-scroll-region" style="height:120px;overflow:auto">
      <div data-item-id="new-1">new first</div><div id="stale" data-item-id="old-2">old second</div>
    </div>`);
  await page.locator("#next").evaluate((button) => {
    button.addEventListener("click", () => {
      document.querySelector('[data-testid="focus-mode-header"]')!.textContent =
        "Visit B";
      setTimeout(() => document.querySelector("#stale")!.remove(), 250);
    });
  });
  const sample = await measureShoppingResponse(
    page.locator("#next"),
    "button",
    {
      targetId: "new-1",
      visitNumber: "Visit B",
    },
  );
  expect(sample.matched).toBe(true);
  expect(sample.uiMs).toBeGreaterThanOrEqual(250);
  expect(sample.uiMs - sample.legacyMs).toBeGreaterThan(100);
});

test("shopping UI observer ignores hidden prewarm and offscreen deferred slots", async ({
  page,
}) => {
  await page.setContent(`
    <div data-testid="focus-mode-header">Visit A</div><button id="next">next</button>
    <div data-testid="focus-mode-scroll-region" style="height:80px;overflow:auto">
      <div hidden aria-hidden="true" data-viewport-list><div data-item-id="old-hidden">hidden old</div></div>
      <div data-viewport-list>
        <div style="height:100px"><div data-item-id="new-1">new first</div></div>
        <div data-viewport-active="false" data-viewport-row-key="focus:new-2" style="height:40px"><div class="esp-viewport-placeholder">offscreen placeholder</div></div>
      </div>
    </div>`);
  await page.locator("#next").evaluate((button) => {
    button.addEventListener("click", () => {
      document.querySelector('[data-testid="focus-mode-header"]')!.textContent =
        "Visit B";
    });
  });
  const sample = await measureShoppingResponse(
    page.locator("#next"),
    "button",
    {
      targetId: "new-1",
      visitNumber: "Visit B",
      visitItemIds: ["new-1", "new-2"],
    },
  );
  expect(sample.matched).toBe(true);
  expect(sample.uiMs).toBeLessThan(250);
  await expect(page.locator(".esp-viewport-placeholder")).toHaveCount(1);
});

test("shopping UI observer rechecks visible membership after its response frame", async ({
  page,
}) => {
  await page.setContent(`
    <div data-testid="focus-mode-header">Visit A</div><button id="next">next</button>
    <div data-testid="focus-mode-scroll-region" style="height:120px;overflow:auto">
      <div data-item-id="new-1">new first</div><div id="second" data-item-id="new-2">new second</div>
    </div>`);
  await page.locator("#next").evaluate((button) => {
    button.addEventListener("click", () => {
      document.querySelector('[data-testid="focus-mode-header"]')!.textContent =
        "Visit B";
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("#second")!.dataset.itemId =
          "old-2";
      });
      setTimeout(() => {
        document.querySelector<HTMLElement>("#second")!.dataset.itemId =
          "new-2";
      }, 250);
    });
  });
  const sample = await measureShoppingResponse(
    page.locator("#next"),
    "button",
    {
      targetId: "new-1",
      visitNumber: "Visit B",
      visitItemIds: ["new-1", "new-2"],
    },
  );
  expect(sample.matched).toBe(true);
  expect(sample.uiMs).toBeGreaterThanOrEqual(250);
  expect(sample.uiMs - sample.legacyMs).toBeGreaterThan(100);
});
test("completed response clocks survive a separately reported selection postcondition failure", async ({
  page,
}) => {
  await page.setContent(`<div data-list-renderer="full">
    <div data-item-id="target"><button aria-label="Current status: 未購入">status</button></div>
    <div data-item-id="moved"><input type="checkbox" checked></div>
  </div>`);
  await page
    .locator("button")
    .evaluate((button) =>
      button.addEventListener("click", () =>
        button.setAttribute("aria-label", "Current status: 購入済"),
      ),
    );
  const measured = await measureShoppingResponse(
    page.locator('[data-item-id="target"]'),
    "button",
    { targetId: "target", status: "購入済" },
  );
  const postconditionErrors = await captureAcceptedSelectionPostcondition(
    page,
    ["moved", "unmounted"],
    7,
    "selection-fixture-7",
    50,
  );
  expect(measured.matched).toBe(true);
  expect(Number.isFinite(measured.legacyMs)).toBe(true);
  expect(Number.isFinite(measured.uiMs)).toBe(true);
  expect(postconditionErrors).toEqual([
    {
      measurementId: "selection-fixture-7",
      sampleIndex: 7,
      code: "selection-not-consumed",
      itemIds: ["moved"],
      message: expect.stringContaining(
        "Moved mounted item checkboxes must be unchecked",
      ),
    },
  ]);
});

test("accepted selection postcondition waits for late UI cleanup while ignoring unmounted identities", async ({
  page,
}) => {
  await page.setContent(
    '<div data-item-id="moved"><input type="checkbox" checked></div>',
  );
  await page.evaluate(() => {
    setTimeout(() => {
      document.querySelector<HTMLInputElement>("input")!.checked = false;
    }, 100);
  });
  expect(
    await captureAcceptedSelectionPostcondition(
      page,
      ["moved", "unmounted"],
      3,
      "selection-fixture-3",
    ),
  ).toEqual([]);
});

test("accepted selection capture keeps page read errors fatal", async () => {
  const readFailure = new Error("selection page read failed");
  const page = {
    evaluate: async () => {
      throw readFailure;
    },
  } as unknown as Page;
  await expect(
    captureAcceptedSelectionPostcondition(
      page,
      ["moved"],
      1,
      "selection-fixture-1",
      20,
    ),
  ).rejects.toBe(readFailure);
});
test("persisted readback binds event roots to the committed metadata and checkpoint", async () => {
  const items = [{ id: "one", circle: "ユーザー登録", quantity: 1 }];
  const key = '__esp_internal__:day-record:v1:["event",[]]';
  const row = {
    kind: "event-shopping-planner-day-record",
    version: 1,
    eventName: "event",
    path: [] as string[],
    value: items,
    children: [],
    digest: await createPersistenceDigest({
      store: "eventLists",
      key,
      value: items,
      children: [],
    }),
  };
  const payload = {
    kind: "event-shopping-planner-day-records",
    version: 1,
    storeName: "eventLists",
    count: 1,
    authenticatedRoots: true,
    checksum: row.digest.value,
  };
  const metadataFor = async (payload: unknown) => {
    const { digest, fingerprint } =
      await createPersistenceIntegrityDescriptors(payload);
    const root = {
      revision: "test:1",
      baseRevision: null,
      digest,
      writerId: "readback-test",
      committedAt: "2026-10-21T00:00:00.000Z",
    };
    return {
      metadata: {
        kind: "event-shopping-planner-persistence-metadata",
        version: 1,
        storeName: "eventLists",
        key: "data",
        revision: root.revision,
        baseRevision: root.baseRevision,
        payloadDigest: digest,
        payloadFingerprint: fingerprint,
        writerId: root.writerId,
        committedAt: root.committedAt,
      },
      checkpoint: {
        kind: "event-shopping-planner-persistence-checkpoint",
        version: 1,
        storeName: "eventLists",
        key: "data",
        committedRoot: root,
        absorbedCandidates: [],
        updatedAt: root.committedAt,
      },
    };
  };
  const read = {
    payload,
    entries: [[key, row] as [string, typeof row]],
    ...(await metadataFor(payload)),
  };
  const fakePage = (read: unknown) =>
    ({ evaluate: async () => read }) as unknown as Page;
  expect(await readBrowserEventLists(fakePage(read))).toEqual({ event: items });
  const legacy = { event: items };
  expect(
    await readBrowserEventLists(
      fakePage({
        payload: legacy,
        entries: [],
        ...(await metadataFor(legacy)),
      }),
    ),
  ).toEqual(legacy);

  const forged = structuredClone(read);
  forged.entries[0][1].value[0].quantity = 2;
  forged.entries[0][1].digest = await createPersistenceDigest({
    store: "eventLists",
    key,
    value: forged.entries[0][1].value,
    children: [],
  });
  forged.payload.checksum = forged.entries[0][1].digest.value;
  await expect(readBrowserEventLists(fakePage(forged))).rejects.toThrow(
    "same committed root",
  );

  const staleCheckpoint = structuredClone(read);
  staleCheckpoint.checkpoint.committedRoot.revision = "other:2";
  await expect(
    readBrowserEventLists(fakePage(staleCheckpoint)),
  ).rejects.toThrow("same committed root");
  const corruptRow = structuredClone(read);
  corruptRow.entries[0][1].value[0].quantity = 3;
  await expect(readBrowserEventLists(fakePage(corruptRow))).rejects.toThrow(
    "unauthenticated eventLists event root",
  );
});

for (const input of ["native", "touch"] as const) {
  test(`transfer ${input} origin preserves the valid card edge and records its actual owner`, async ({
    page,
    context,
  }) => {
    await page.setContent(transferOriginMarkup());
    const proof = await prepareTransferSourceOrigin(page, "source");
    expect(proof.sourcePoint).toEqual({ x: 104, y: 155 });
    expect(proof.sourceOrigin).toBe("card-edge");
    expect(proof.sourceHitTest.initialRejection).toBeNull();
    expect(proof.sourceHitTest.attempts).toHaveLength(1);
    await expectTrustedOrigin(page, context, input, proof.sourcePoint);
  });

  test(`transfer ${input} origin rejects the grouped range sibling and its covered handle`, async ({
    page,
    context,
  }) => {
    await page.setContent(transferOriginMarkup("range"));
    const proof = await prepareTransferSourceOrigin(page, "source");
    expect(proof.sourceOrigin).toBe("card-body");
    expect(proof.sourceHitTest.initialRejection).toMatchObject({
      point: { x: 104, y: 155 },
      hitTagName: "DIV",
      hitTitle: "範囲内のチェックを外す",
      hitItemId: null,
      hitRect: { width: 40, height: 180 },
      sourceContainsHit: false,
      interactive: false,
      matched: false,
    });
    expect(proof.sourceHitTest.attempts[1]).toMatchObject({
      origin: "drag-handle",
      sourceContainsHit: false,
      matched: false,
    });
    expect(proof.sourceHitTest.selectedHit).toMatchObject({
      hitItemId: "source",
      sourceContainsHit: true,
      interactive: false,
      matched: true,
    });
    await expectTrustedOrigin(page, context, input, proof.sourcePoint);
  });

  test(`transfer ${input} origin rejects an interactive control before using the real handle`, async ({
    page,
    context,
  }) => {
    await page.setContent(transferOriginMarkup("control"));
    const proof = await prepareTransferSourceOrigin(page, "source");
    expect(proof.sourceOrigin).toBe("drag-handle");
    expect(proof.sourceHitTest.initialRejection).toMatchObject({
      hitTagName: "BUTTON",
      sourceContainsHit: true,
      interactive: true,
      matched: false,
    });
    expect(proof.sourceHitTest.selectedHit).toMatchObject({
      hitItemId: "source",
      sourceContainsHit: true,
      interactive: false,
      matched: true,
    });
    await expectTrustedOrigin(page, context, input, proof.sourcePoint);
  });
}

test("transfer origin fails closed with candidate evidence when every source point is covered", async ({
  page,
}) => {
  await page.setContent(transferOriginMarkup("blocked"));
  await expect(prepareTransferSourceOrigin(page, "source")).rejects.toThrow(
    /No eligible real source origin:.*"initialRejection":.*"selectedHit":null/,
  );
});

function transferOriginMarkup(mode?: "range" | "control" | "blocked") {
  return `<div data-item-id="source" draggable="true" style="position:absolute;left:100px;top:120px;width:300px;height:180px">
    <div data-drag-handle style="position:absolute;left:16px;top:68px;width:16px;height:16px"><svg width="16" height="16"><rect width="16" height="16" /></svg></div>
    ${mode === "control" ? '<button style="position:absolute;left:0;top:28px;width:20px;height:20px" data-no-long-press>control</button>' : ""}
  </div>${mode === "range" || mode === "blocked" ? `<div title="範囲内のチェックを外す" style="position:absolute;left:100px;top:120px;width:${mode === "range" ? 40 : 300}px;height:180px;z-index:40"></div>` : ""}`;
}

async function expectTrustedOrigin(
  page: Page,
  context: import("@playwright/test").BrowserContext,
  input: "native" | "touch",
  point: { x: number; y: number },
) {
  await page.locator('[data-item-id="source"]').evaluate((source) => {
    source.addEventListener("mousedown", record, { once: true });
    source.addEventListener("touchstart", record, { once: true });
    function record(event: Event) {
      if (source.hasAttribute("data-input-proof")) return;
      source.setAttribute(
        "data-input-proof",
        JSON.stringify({
          trusted: event.isTrusted,
          type: event.type,
          sourceContainsTarget: source.contains(event.target as Node),
          itemId: (event.target as Element).closest<HTMLElement>(
            "[data-item-id]",
          )?.dataset.itemId,
        }),
      );
    }
  });
  if (input === "native") {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.up();
  } else {
    const session = await context.newCDPSession(page);
    try {
      await session.send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 1,
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ ...point, id: 1 }],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } finally {
      await session.detach();
    }
  }
  const observed = await page
    .locator('[data-item-id="source"]')
    .getAttribute("data-input-proof");
  expect(JSON.parse(observed!)).toEqual({
    trusted: true,
    type: input === "native" ? "mousedown" : "touchstart",
    sourceContainsTarget: true,
    itemId: "source",
  });
}
