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
const withTimeout = async (operation, milliseconds, label) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(label + " timed out.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
export async function waitUntil(read, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      await withTimeout(
        Promise.resolve().then(read),
        Math.max(1, deadline - Date.now()),
        label,
      )
    )
      return;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))),
    );
  }
  throw new Error(label + " was not observed.");
}
// Release every origin client before updating; never skipWaiting or reset the database.
export async function activateArtifactServiceWorker(
  context,
  page,
  url,
  timeoutMs = 60_000,
) {
  const session = await context.newCDPSession(page);
  const workerUrl = new URL("/sw.js", url).href;
  const origin = new URL(url).origin;
  const versions = new Map();
  const onVersions = ({ versions: updated }) => {
    for (const version of updated) versions.set(version.versionId, version);
  };
  const activeVersions = () =>
    [...versions.values()].filter(
      (version) =>
        version.scriptURL === workerUrl && version.status === "activated",
    );
  session.on("ServiceWorker.workerVersionUpdated", onVersions);
  try {
    await withTimeout(
      session.send("ServiceWorker.enable"),
      timeoutMs,
      "Service Worker observation",
    );
    await waitUntil(
      () => activeVersions().length > 0,
      "Baseline active Service Worker",
      timeoutMs,
    );
    const baselineIds = new Set(versions.keys());
    await Promise.all(
      context.pages().map(async (client) => {
        if (new URL(client.url()).origin === origin)
          await client.goto("about:blank");
      }),
    );
    await withTimeout(
      session.send("ServiceWorker.updateRegistration", {
        scopeURL: new URL("/", url).href,
      }),
      timeoutMs,
      "Target Service Worker update",
    );
    await waitUntil(
      () => {
        const activated = activeVersions().filter(
          (version) => !baselineIds.has(version.versionId),
        );
        assert.ok(activated.length <= 1, "Target Service Worker is ambiguous.");
        return activated.length === 1;
      },
      "Natural Service Worker activation after all clients close",
      timeoutMs,
    );
  } finally {
    session.off("ServiceWorker.workerVersionUpdated", onVersions);
    await session.detach();
  }
}
async function loadArtifact(context, page, url, artifactId, mainAsset, stage) {
  if (["upgrade", "blocked", "forward"].includes(stage))
    await activateArtifactServiceWorker(context, page, url);
  await page.goto(url);
  await waitUntil(
    () =>
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
      ),
    "Expected artifact build marker",
  );
  await page
    .locator('script[type="module"][src="' + mainAsset + '"]')
    .waitFor({ state: "attached" });
  await waitUntil(
    () =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.active?.state === "activated";
      }),
    "Active Service Worker registration",
  );
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
  process.stdout.write("DB boundary rehearsal " + stage + " START.\n");
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
      stage,
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
