import { expect, test, type Page } from "@playwright/test";
import {
  createPersistenceIntegrityDescriptors,
  createPersistenceDigest,
} from "../../src/utils/persistenceResilience";
import { readBrowserEventLists } from "./shopping-transfer-persisted-store";
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
