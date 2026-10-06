import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const EVENT_NAME = "RELEASE_A_ROLLBACK_SAVE";
export const LEGACY_ITEM = Object.freeze({
  id: "rollback-backup-item",
  circle: "復旧検証",
  eventDate: "1日目",
  block: "A",
  number: "01",
  title: "Rollback Purchased Item",
  price: 750,
  purchaseStatus: "Purchased",
  quantity: 2,
  remarks: "ユーザー登録",
});
const LEGACY_SOURCES = {
  eventShoppingLists: JSON.stringify({ [EVENT_NAME]: [LEGACY_ITEM] }),
  eventMetadata: "{}",
  executeModeItems: "{}",
  dayModes: "{}",
  mapData: "{}",
  mapRotationSettings: "{}",
  routeSettings: "{}",
  hallDefinitions: "{}",
  hallRouteSettings: "{}",
  mapViewportSettings: "{}",
  syncQueue: '{"pending":[{"id":"rollback-archive","kind":"archive-only"}]}',
};
const digest = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");

export function assertDatabaseUnchanged(expected, actual) {
  assert.equal(actual.version, expected.version, "Database version changed.");
  assert.deepEqual(actual.stores, expected.stores, "Database records changed.");
}
export function assertRestoredBackup(expected, actual) {
  assert.equal(actual.kind, "event-shopping-planner-backup");
  assert.equal(
    actual.version,
    1,
    "Legacy recovery must use a version 1 backup.",
  );
  assert.deepEqual(actual.data, expected.data, "Restored backup data differs.");
  assert.deepEqual(actual.eventSettings, expected.eventSettings);
  const item = actual.data.eventLists[EVENT_NAME]?.[0];
  assert.ok(item, "The purchased item is missing.");
  for (const [key, value] of Object.entries(LEGACY_ITEM)) {
    assert.equal(item[key], value, "Restored item field differs: " + key);
  }
}
const snapshotDatabase = (page) =>
  page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open("EventShoppingPlannerDB");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const names = [...database.objectStoreNames].sort();
      const transaction = database.transaction(names, "readonly");
      const stores = Object.fromEntries(
        await Promise.all(
          names.map(
            (name) =>
              new Promise((resolve, reject) => {
                const store = transaction.objectStore(name);
                const entries = [];
                const request = store.openCursor();
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                  const cursor = request.result;
                  if (cursor) {
                    entries.push({ key: cursor.key, value: cursor.value });
                    cursor.continue();
                  } else {
                    resolve([
                      name,
                      {
                        keyPath: store.keyPath,
                        indexes: [...store.indexNames],
                        entries,
                      },
                    ]);
                  }
                };
              }),
          ),
        ),
      );
      return { version: database.version, stores };
    } finally {
      database.close();
    }
  });
const readLegacySources = (page) =>
  page.evaluate(
    (keys) =>
      Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    Object.keys(LEGACY_SOURCES),
  );
async function waitUntil(read, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(label + " was not observed.");
}
// Release every origin client; never skipWaiting or reset the database.
async function loadArtifact(context, page, url, artifactId, mainAsset) {
  await page.goto(url);
  const matches = () =>
    page.evaluate(
      ({ artifactId, mainAsset, requireMarker }) => {
        const marker = globalThis.document.querySelector(
          'meta[name="event-shopping-planner-build-id"]',
        );
        return (
          (!requireMarker || marker?.content === artifactId) &&
          [...globalThis.document.scripts].some(
            (script) =>
              script.src && new URL(script.src).pathname === mainAsset,
          )
        );
      },
      {
        artifactId,
        mainAsset,
        requireMarker: Boolean(process.env.ESP_EXPECTED_TARGET_BUILD_ID),
      },
    );
  if (!(await matches())) await page.reload();
  if (!(await matches())) {
    const session = await context.newCDPSession(page);
    const versions = new Map();
    const onVersions = ({ versions: updated }) => {
      for (const version of updated) versions.set(version.versionId, version);
    };
    session.on("ServiceWorker.workerVersionUpdated", onVersions);
    try {
      await session.send("ServiceWorker.enable");
      await waitUntil(
        () =>
          [...versions.values()].some(
            (version) => version.status === "activated",
          ),
        "Baseline active Service Worker",
      );
      const baselineIds = new Set(
        [...versions.values()]
          .filter((version) => version.status === "activated")
          .map((version) => version.versionId),
      );
      await page.evaluate(async () =>
        (await navigator.serviceWorker.ready).update(),
      );
      await page.reload();
      if (!(await matches())) {
        const candidates = () =>
          [...versions.values()].filter(
            (version) =>
              !baselineIds.has(version.versionId) &&
              ["installed", "activated"].includes(version.status),
          );
        await waitUntil(
          () => candidates().length > 0,
          "Target Service Worker installation",
        );
        assert.equal(
          candidates().length,
          1,
          "Target Service Worker is ambiguous.",
        );
        const target = candidates()[0];
        await Promise.all(
          context.pages().map((client) => client.goto("about:blank")),
        );
        await waitUntil(
          () => versions.get(target.versionId)?.status === "activated",
          "Natural Service Worker activation after all clients close",
        );
        await page.goto(url);
      }
    } finally {
      session.off("ServiceWorker.workerVersionUpdated", onVersions);
      await session.detach();
    }
  }
  await waitUntil(matches, "Expected artifact build marker");
  await page
    .locator('script[type="module"][src="' + mainAsset + '"]')
    .waitFor({ state: "attached" });
  await page.evaluate(async () => navigator.serviceWorker.ready);
  if (
    !(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
  ) {
    await page.reload();
  }
  await waitUntil(
    () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    "Service Worker controller",
  );
}

async function downloadJson(page, button) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const download = await downloadPromise;
  assert.equal(await download.failure(), null, "Backup download failed.");
  return JSON.parse(await readFile(await download.path(), "utf8"));
}
async function restoreBackup(page, backup) {
  await page
    .locator('input[aria-label="バックアップファイルを選択"]')
    .setInputFiles({
      name: "pre-upgrade-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup), "utf8"),
    });
  const dialog = page.getByRole("dialog", {
    name: "バックアップからイベントを復元",
  });
  await dialog.waitFor();
  await dialog.getByRole("radio", { name: /同名で置換/ }).check();
  await dialog.getByRole("button", { name: "置換して復元" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: EVENT_NAME, exact: true }).waitFor();
}
async function main() {
  const stage = process.env.ESP_DB_BOUNDARY_STAGE;
  assert.ok(
    ["seed", "upgrade", "blocked", "isolated", "forward"].includes(stage),
  );
  const url = process.env.ESP_PREVIEW_URL;
  const profile = process.env.ESP_BROWSER_PROFILE_DIR;
  const evidenceDirectory = process.env.ESP_DB_BOUNDARY_DIRECTORY;
  const artifactId = process.env.ESP_TARGET_ARTIFACT_ID;
  assert.ok(
    url && profile && evidenceDirectory && artifactId,
    "Boundary drill configuration is incomplete.",
  );
  const backupPath = path.join(evidenceDirectory, "legacy-backup.json");
  const snapshotPath = path.join(evidenceDirectory, "upgraded-database.json");
  const candidates = [
    process.env.CHROME_PATH,
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  let executablePath;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      executablePath = candidate;
      break;
    } catch {
      /* Try the next installed Chromium browser. */
    }
  }
  assert.ok(executablePath, "A Chromium browser is required.");
  const index = await fetch(url);
  assert.ok(index.ok);
  assert.equal(
    digest(await index.text()),
    process.env.ESP_EXPECTED_INDEX_SHA256,
  );
  const worker = await fetch(new URL("/sw.js", url));
  assert.ok(worker.ok);
  assert.equal(digest(await worker.text()), process.env.ESP_EXPECTED_SW_SHA256);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: true,
    serviceWorkers: "allow",
    acceptDownloads: true,
  });
  try {
    if (stage === "seed") {
      await context.addInitScript(
        ({ origin, sources }) => {
          if (
            globalThis.location.origin !== origin ||
            localStorage.getItem("__esp_internal__:boundary-seeded")
          )
            return;
          for (const [key, value] of Object.entries(sources))
            localStorage.setItem(key, value);
          localStorage.setItem("__esp_internal__:boundary-seeded", "true");
        },
        { origin: new URL(url).origin, sources: LEGACY_SOURCES },
      );
    }
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await loadArtifact(
      context,
      page,
      url,
      artifactId,
      process.env.ESP_EXPECTED_MAIN_ASSET,
    );
    if (stage === "seed") {
      await page
        .getByRole("button", { name: "JSONバックアップ保存", exact: true })
        .waitFor();
      const backup = await downloadJson(page, "JSONバックアップ保存");
      assertRestoredBackup(backup, backup);
      assert.ok((await snapshotDatabase(page)).version <= 7);
      assert.deepEqual(await readLegacySources(page), LEGACY_SOURCES);
      await writeFile(
        backupPath,
        JSON.stringify(backup, null, 2) + "\n",
        "utf8",
      );
    } else if (stage === "upgrade") {
      const update = page.getByRole("button", {
        name: "保存形式を更新して開く",
        exact: true,
      });
      await update.waitFor();
      assert.ok(
        await update.isDisabled(),
        "Upgrade was enabled before archival.",
      );
      const archive = await downloadJson(page, "移行前データを保存");
      assert.equal(archive.kind, "event-shopping-planner-pre-upgrade");
      assert.ok(archive.databaseVersion <= 7);
      assert.equal(archive.localStorage.syncQueue, LEGACY_SOURCES.syncQueue);
      await update.click();
      await page
        .getByRole("button", { name: "JSONバックアップ保存", exact: true })
        .waitFor();
      const current = await downloadJson(page, "JSONバックアップ保存");
      const backup = JSON.parse(await readFile(backupPath, "utf8"));
      assert.equal(current.version, 2);
      assert.deepEqual(current.data.eventLists, backup.data.eventLists);
      assert.deepEqual(await readLegacySources(page), LEGACY_SOURCES);
      const snapshot = await snapshotDatabase(page);
      assert.equal(snapshot.version, 8);
      assert.ok(
        snapshot.stores.eventConsistency,
        "The consistency store is missing.",
      );
      const controls = snapshot.stores.syncQueue.entries;
      assert.ok(
        controls.some(
          ({ key }) => key === "__esp_internal__:migration:consistency:v1",
        ),
      );
      assert.ok(
        controls.some(
          ({ key }) =>
            key === "__esp_internal__:migration-archive:consistency:v1",
        ),
      );
      await writeFile(
        snapshotPath,
        JSON.stringify(snapshot, null, 2) + "\n",
        "utf8",
      );
      await writeFile(
        path.join(evidenceDirectory, "pre-upgrade-archive.json"),
        JSON.stringify(archive, null, 2) + "\n",
        "utf8",
      );
    } else if (stage === "blocked") {
      const expected = JSON.parse(await readFile(snapshotPath, "utf8"));
      for (const offline of [false, true]) {
        await context.setOffline(offline);
        await page.reload();
        await page
          .getByRole("heading", {
            name: /^保存データを安全に読み込めません(?:でした)?$/,
          })
          .waitFor();
        assert.equal(
          await page
            .locator('input[aria-label="バックアップファイルを選択"]')
            .count(),
          0,
        );
        assertDatabaseUnchanged(expected, await snapshotDatabase(page));
        assert.deepEqual(await readLegacySources(page), LEGACY_SOURCES);
      }
    } else if (stage === "isolated") {
      const backup = JSON.parse(await readFile(backupPath, "utf8"));
      await restoreBackup(page, backup);
      await page.goto(url);
      const restored = await downloadJson(page, "JSONバックアップ保存");
      assertRestoredBackup(backup, restored);
      await page.reload();
      assertRestoredBackup(
        backup,
        await downloadJson(page, "JSONバックアップ保存"),
      );
      const snapshot = await snapshotDatabase(page);
      assert.ok(
        snapshot.version <= 7,
        "Isolated recovery used a modern database.",
      );
      const item = snapshot.stores.eventLists.entries.find(
        ({ key }) => key === "data",
      )?.value[EVENT_NAME]?.[0];
      assert.deepEqual(item, restored.data.eventLists[EVENT_NAME][0]);
    } else {
      assert.equal(
        await page
          .getByRole("heading", { name: "保存データの更新", exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "JSONバックアップ保存", exact: true })
        .waitFor();
      assertDatabaseUnchanged(
        JSON.parse(await readFile(snapshotPath, "utf8")),
        await snapshotDatabase(page),
      );
      assert.deepEqual(await readLegacySources(page), LEGACY_SOURCES);
      const current = await downloadJson(page, "JSONバックアップ保存");
      const backup = JSON.parse(await readFile(backupPath, "utf8"));
      assert.deepEqual(current.data.eventLists, backup.data.eventLists);
    }
    process.stdout.write(
      "DB boundary rehearsal " + stage + " PASS (" + artifactId + ").\n",
    );
  } finally {
    await context.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
