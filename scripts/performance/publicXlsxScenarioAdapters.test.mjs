import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { IDBFactory, IDBDatabase, IDBObjectStore } from "fake-indexeddb";
import { fileURLToPath } from "node:url";
import {
  buildCanonicalItems,
  buildCanonicalEventWorkbookBytes,
  canonicalEventItemsSemanticSha256,
  canonicalPersistencePayloadBytes,
  sha256Bytes,
} from "./canonicalPublicFixtures.mjs";
import {
  PUBLIC_XLSX_SCENARIO_IDS,
  publicXlsxScenarioAdapters,
  resolveSourceBoundWorkerAsset,
  stageCanonicalExportEventLists,
  readCommittedEventListsReceipt,
} from "./publicXlsxScenarioAdapters.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const createCdpSessionDouble = () => {
  let tracingComplete = null;
  return {
    async send(method) {
      if (method === "Performance.getMetrics") {
        return { metrics: [{ name: "JSHeapUsedSize", value: 1_000 }] };
      }
      if (method === "Tracing.end") {
        queueMicrotask(() => tracingComplete?.({ stream: "trace-stream" }));
        return {};
      }
      if (method === "IO.read") {
        return {
          data: JSON.stringify({
            traceEvents: [
              {
                ph: "M",
                name: "thread_name",
                args: { name: "CrRendererMain" },
                pid: 1,
                tid: 1,
              },
            ],
          }),
          eof: true,
        };
      }
      return {};
    },
    once(type, listener) {
      if (type === "Tracing.tracingComplete") tracingComplete = listener;
    },
    async detach() {},
  };
};

test("dispatches every XLSX scenario through a repo-owned public adapter", () => {
  assert.deepEqual(PUBLIC_XLSX_SCENARIO_IDS, [
    "foundation-benign-main-thread-xlsx",
    "xlsx-worker-import-valid",
    "xlsx-worker-export-roundtrip",
    "xlsx-worker-reject-corrupt",
    "xlsx-worker-reject-input-over-limit",
    "xlsx-worker-reject-zip-bomb",
    "xlsx-worker-cancel",
    "xlsx-worker-timeout",
  ]);
  for (const id of PUBLIC_XLSX_SCENARIO_IDS) {
    assert.equal(typeof publicXlsxScenarioAdapters[id], "function");
  }
});

test("binds one exact public Worker asset to its artifact manifest", () => {
  const entry = {
    path: "static/assets/xlsx.worker-source-bound.js",
    size: 123,
    sha256: "a".repeat(64),
  };
  assert.deepEqual(
    resolveSourceBoundWorkerAsset({
      artifactBinding: { outputFiles: [entry] },
      targetUrl: "https://performance.example.test/release/",
    }),
    {
      entry,
      url: "https://performance.example.test/assets/xlsx.worker-source-bound.js",
    },
  );
  assert.throws(
    () =>
      resolveSourceBoundWorkerAsset({
        artifactBinding: { outputFiles: [] },
        targetUrl: "https://performance.example.test/",
      }),
    /Expected one source-bound XLSX Worker asset/,
  );
  assert.throws(
    () =>
      resolveSourceBoundWorkerAsset({
        artifactBinding: { outputFiles: [entry, { ...entry }] },
        targetUrl: "https://performance.example.test/",
      }),
    /received 2/,
  );
});

test("generates one deterministic source-bound workbook recipe", async () => {
  const first = await buildCanonicalEventWorkbookBytes({
    rowCount: 10,
    seed: 1967,
  });
  const second = await buildCanonicalEventWorkbookBytes({
    rowCount: 10,
    seed: 1967,
  });
  assert.equal(first.bytes.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(first.payloadSha256, sha256Bytes(first.bytes));
  assert.equal(first.payloadSha256, second.payloadSha256);
  assert.equal(first.semanticSha256, second.semanticSha256);
});

test("binds round-trip semantics to every exported item field", () => {
  const items = buildCanonicalItems({ rowCount: 2, seed: 1967 });
  const expected = canonicalEventItemsSemanticSha256("semantic-event", items);
  const changed = structuredClone(items);
  changed[1].circle = "drifted non-ID field";
  assert.notEqual(
    canonicalEventItemsSemanticSha256("semantic-event", changed),
    expected,
  );
  changed[1].circle = items[1].circle;
  changed[1].purchaseStatus = "Purchased";
  assert.notEqual(
    canonicalEventItemsSemanticSha256("semantic-event", changed),
    expected,
  );
});

test("fault fixture hashes bind the exact tracked Worker bytes", async () => {
  for (const [scenarioId, workerName] of [
    ["xlsx-worker-cancel", "cancel.worker.js"],
    ["xlsx-worker-timeout", "timeout.worker.js"],
  ]) {
    const fixture = JSON.parse(
      await readFile(
        path.join(
          root,
          "scripts",
          "fixtures",
          "performance",
          `${scenarioId}.json`,
        ),
        "utf8",
      ),
    );
    const workerBytes = await readFile(
      path.join(root, "scripts", "performance", "fault-workers", workerName),
    );
    assert.equal(
      fixture.faultInjection.replacementSha256,
      sha256Bytes(workerBytes),
    );
    assert.equal(
      fixture.faultInjection.method,
      "playwright-exact-worker-response-substitution-v1",
    );
  }
});

test("executes the default benign XLSX adapter through the public file surface", async () => {
  const calls = [];
  const locator = (label) => ({
    async setInputFiles(file) {
      calls.push(["input", label, file.name, file.buffer.length]);
    },
    async waitFor() {
      calls.push(["wait", label]);
    },
  });
  const page = {
    async goto(url, options) {
      calls.push(["goto", url, options.waitUntil]);
    },
    getByLabel(label) {
      return locator(label);
    },
    getByRole(role, options) {
      return locator(`${role}:${options.name}`);
    },
    on() {},
    off() {},
    async evaluate(callback) {
      return callback();
    },
  };
  const browserContext = {
    async newCDPSession() {
      return createCdpSessionDouble();
    },
  };
  const result = await publicXlsxScenarioAdapters[
    "foundation-benign-main-thread-xlsx"
  ]({
    browserContext,
    fixtureBytes: Buffer.from("tracked-foundation-fixture", "utf8"),
    fixtureDocument: null,
    page,
    requiredAssertions: ["scenario-completed"],
    requiredTelemetry: ["durationMs"],
    scenarioId: "foundation-benign-main-thread-xlsx",
    targetUrl: "https://performance.example.test/release/",
  });
  assert.equal(result.assertions["scenario-completed"], true);
  assert.equal(
    result.executionBinding.adapterContract,
    "public-artifact-surface-v1",
  );
  assert.equal(result.executionBinding.setup, null);
  assert.ok(result.metrics.durationMs >= 0);
  assert.deepEqual(calls.slice(0, 2), [
    ["goto", "https://performance.example.test/release/", "networkidle"],
    ["wait", "バックアップファイルを選択"],
  ]);
  assert.equal(
    calls.some(([kind]) => kind === "input"),
    true,
  );
});

test("round-trips the production UI export download through the public Worker", async () => {
  const fixture = JSON.parse(
    await readFile(
      path.join(
        root,
        "scripts",
        "fixtures",
        "performance",
        "xlsx-worker-export-roundtrip.json",
      ),
      "utf8",
    ),
  );
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "foundation-public-export-"),
  );
  const downloadPath = path.join(temporaryRoot, "public-export.xlsx");
  await writeFile(
    downloadPath,
    Buffer.from("PK\u0003\u0004public-export", "binary"),
  );
  const workerUrl =
    "https://performance.example.test/assets/xlsx.worker-source-bound.js";
  const listeners = new Map();
  const waiters = new Map();
  const calls = [];
  const emit = (type, value) => {
    for (const listener of listeners.get(type) ?? []) listener(value);
    const waiter = waiters.get(type);
    if (waiter) {
      waiters.delete(type);
      waiter(value);
    }
  };
  const locator = (name, click = async () => calls.push(["click", name])) => ({
    async check() {
      calls.push(["check", name]);
    },
    async click() {
      await click();
    },
    filter() {
      return this;
    },
    getByRole(role, options) {
      return locator(`${name}:${role}:${options.name}`);
    },
    async setInputFiles(file) {
      calls.push(["input", name, file.name, file.buffer.length]);
    },
    async waitFor() {
      calls.push(["wait", name]);
    },
  });
  const page = {
    async evaluate(callback, argument) {
      if (argument?.contract === "event-export-idb-stage-v1") {
        calls.push([
          "idb-stage",
          argument.eventName,
          argument.itemCount,
          argument.payloadSha256,
        ]);
        return {
          contract: argument.contract,
          databaseName: "EventShoppingPlannerDB",
          databaseVersion: 10,
          storeName: "eventLists",
          controlStoreName: "syncQueue",
          key: "data",
          payloadSha256: argument.payloadSha256,
          semanticSha256: argument.expectedSemanticSha256,
          itemCount: argument.itemCount,
          transactionStores: ["eventLists", "eventConsistency", "syncQueue"],
        };
      }
      return callback(argument);
    },
    async goto(url, options) {
      calls.push(["goto", url, options.waitUntil]);
    },
    getByLabel(label) {
      return locator(`label:${label}`);
    },
    getByRole(role, options) {
      const accessibleName = options?.name ?? "";
      const name = `${role}:${accessibleName}`;
      if (role === "button" && accessibleName === "エクスポート") {
        return locator(name, async () => {
          calls.push(["public-export-confirmed"]);
          emit("worker", { url: () => workerUrl });
          await new Promise((resolve) => setTimeout(resolve, 35));
          emit("download", {
            async path() {
              return downloadPath;
            },
            suggestedFilename() {
              return "canonical-worker-roundtrip.xlsx";
            },
          });
        });
      }
      return locator(name);
    },
    async reload(options) {
      calls.push(["reload", options.waitUntil]);
    },
    off(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter(
          (candidate) => candidate !== listener,
        ),
      );
    },
    on(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    waitForEvent(type) {
      return new Promise((resolve) => waiters.set(type, resolve));
    },
  };
  const browserContext = {
    async newCDPSession() {
      return createCdpSessionDouble();
    },
  };
  const originalWorker = globalThis.Worker;
  globalThis.Worker = class PublicWorkerContractDouble {
    #listeners = new Map();

    constructor(url) {
      emit("worker", { url: () => url });
    }

    addEventListener(type, listener) {
      this.#listeners.set(type, listener);
    }

    postMessage(request) {
      const listener = this.#listeners.get("message");
      setTimeout(() => {
        listener({
          data: {
            type: "XLSX_PROGRESS",
            requestId: request.requestId,
            progress: { phase: "parse", completed: 1, total: 1 },
          },
        });
        listener({
          data: {
            type: "XLSX_IMPORT_RESULT",
            requestId: request.requestId,
            result: {
              value: {
                eventName: "canonical-worker-roundtrip",
                items: buildCanonicalItems({ rowCount: 50_000, seed: 1967 }),
              },
            },
          },
        });
      }, 35);
    }

    terminate() {}
  };
  try {
    const result = await publicXlsxScenarioAdapters[
      "xlsx-worker-export-roundtrip"
    ]({
      artifactBinding: {
        outputFiles: [
          {
            path: "static/assets/xlsx.worker-source-bound.js",
            size: 123,
            sha256: "a".repeat(64),
          },
        ],
      },
      browserContext,
      fixtureBytes: Buffer.from(JSON.stringify(fixture), "utf8"),
      fixtureDocument: fixture,
      page,
      requiredAssertions: fixture.requiredAssertions,
      requiredTelemetry: fixture.requiredTelemetry,
      scenarioId: fixture.scenarioId,
      targetUrl: "https://performance.example.test/release/",
    });
    assert.deepEqual(result.assertions, {
      "worker-execution-observed": true,
      "ui-heartbeat-observed": true,
      "progress-observed": true,
      "single-terminal-result": true,
      "round-trip-semantic-parity": true,
      "single-atomic-download": true,
    });
    assert.equal(
      calls.some(([kind]) => kind === "public-export-confirmed"),
      true,
    );
    assert.equal(
      calls.some(
        ([kind, eventName, itemCount]) =>
          kind === "idb-stage" &&
          eventName === "canonical-worker-roundtrip" &&
          itemCount === 50_000,
      ),
      true,
    );
    assert.equal(
      result.executionBinding.fixturePayload.generator,
      "event-export-idb-stage-v1",
    );
    assert.deepEqual(result.executionBinding.setup, {
      method: "indexeddb-schema-exact-single-transaction-stage-v2",
      timing: "excluded-from-measurement-v1",
      readback: "separate-readonly-transaction-v1",
      databaseName: "EventShoppingPlannerDB",
      databaseVersion: 10,
      storeName: "eventLists",
      controlStoreName: "syncQueue",
      key: "data",
      transactionStores: ["eventLists", "eventConsistency", "syncQueue"],
      payloadSha256: result.executionBinding.fixturePayload.payloadSha256,
      semanticSha256: result.executionBinding.fixturePayload.semanticSha256,
      itemCount: 50_000,
      revision: `performance-stage:${result.executionBinding.fixturePayload.payloadSha256}`,
    });
    assert.equal(
      result.executionBinding.fixturePayload.payloadSha256,
      /^[0-9a-f]{64}$/.test(
        result.executionBinding.fixturePayload.payloadSha256,
      )
        ? result.executionBinding.fixturePayload.payloadSha256
        : null,
    );
  } finally {
    globalThis.Worker = originalWorker;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("keeps the XLSX adapter free of synthetic download and legacy target hooks", async () => {
  const source = await readFile(
    path.join(root, "scripts", "performance", "publicXlsxScenarioAdapters.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /foundation-performance-scenario/);
  assert.doesNotMatch(source, /__ESP_CANONICAL_PERFORMANCE_HARNESS__/);
  assert.doesNotMatch(source, /createObjectURL|new globalThis\.Blob/);
  assert.match(source, /getByRole\("button", \{\s*name: "Excel形式で出力"/);
  assert.match(source, /waitForEvent\("download"\)/);
  assert.match(source, /await readFile\(downloadPath\)/);
});

test("stages initialized empty DB 9/10/11 roots while preserving their parent revisions", async (t) => {
  const originalIndexedDb = globalThis.indexedDB;
  const metadataKey = "__esp_internal__:meta:v1:eventLists:data";
  const checkpointKey = "__esp_internal__:checkpoint:v1:eventLists:data";
  const initializedMetadata = {
    kind: "event-shopping-planner-persistence-metadata",
    version: 1,
    storeName: "eventLists",
    key: "data",
    revision: "initialized-empty-root",
    baseRevision: null,
    payloadDigest: {
      algorithm: "SHA-256",
      canonicalization: "esp-json-v1",
      value: sha256Bytes(Buffer.from("{}")),
    },
    payloadFingerprint: {
      algorithm: "FNV-1A-64",
      canonicalization: "esp-json-v1",
      canonicalLength: 2,
      value: "08f44b07b5901a25",
    },
    writerId: "application-startup",
    committedAt: "2026-10-06T00:00:00.000Z",
  };
  const initializedCheckpoint = {
    kind: "event-shopping-planner-persistence-checkpoint",
    version: 1,
    storeName: "eventLists",
    key: "data",
    committedRoot: {
      revision: initializedMetadata.revision,
      baseRevision: null,
      digest: initializedMetadata.payloadDigest,
      writerId: initializedMetadata.writerId,
      committedAt: initializedMetadata.committedAt,
    },
    absorbedCandidates: [],
    updatedAt: "2026-10-06T00:00:00.001Z",
  };
  const items = buildCanonicalItems({ rowCount: 2, seed: 1967 });
  const eventName = "canonical-worker-roundtrip";
  const stageOptions = {
    eventName,
    eventLists: { [eventName]: items },
    expectedSemanticSha256: canonicalEventItemsSemanticSha256(eventName, items),
    page: { evaluate: (callback, argument) => callback(argument) },
  };
  const read = (database, storeName, key) =>
    new Promise((resolve, reject) => {
      const request = database
        .transaction(storeName, "readonly")
        .objectStore(storeName)
        .get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  try {
    for (const mutation of [
      "none",
      "partitioned-empty",
      "partitioned-empty-v11",
      "partitioned-stray",
      "partitioned-digest",
      "data",
      "digest",
      "checkpoint",
      "partial",
      "consistency-data",
      "consistency-digest",
      "timestamp",
    ]) {
      await t.test(mutation, async () => {
        const databaseVersion =
          mutation === "partitioned-empty-v11"
            ? 11
            : mutation.startsWith("partitioned")
              ? 10
              : 9;
        globalThis.indexedDB = new IDBFactory();
        const database = await new Promise((resolve, reject) => {
          const request = globalThis.indexedDB.open(
            "EventShoppingPlannerDB",
            databaseVersion,
          );
          request.onupgradeneeded = () => {
            for (const storeName of [
              "dayModes",
              "eventConsistency",
              "eventLists",
              "eventMetadata",
              "executeModeItems",
              "hallDefinitions",
              "hallRouteSettings",
              "mapData",
              "mapRotationSettings",
              "mapViewportSettings",
              "routeSettings",
              "syncQueue",
            ])
              request.result.createObjectStore(storeName);
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const metadata = structuredClone(initializedMetadata);
          const checkpoint = structuredClone(initializedCheckpoint);
          const payload = mutation === "data" ? { "existing-event": [] } : {};
          const consistencyMetadata = {
            ...structuredClone(initializedMetadata),
            storeName: "eventConsistency",
            revision: "initialized-empty-consistency",
          };
          const consistencyCheckpoint = {
            ...structuredClone(initializedCheckpoint),
            storeName: "eventConsistency",
            committedRoot: {
              ...structuredClone(initializedCheckpoint.committedRoot),
              revision: consistencyMetadata.revision,
            },
          };
          const emptyHead = {
            kind: "event-shopping-planner-day-records",
            version: 1,
            storeName: "eventConsistency",
            count: 0,
            checksum: "0".repeat(64),
            authenticatedRoots: true,
          };
          if (mutation.startsWith("partitioned")) {
            const canonical = JSON.stringify(
              emptyHead,
              Object.keys(emptyHead).sort(),
            );
            let hash = 0xcbf29ce484222325n;
            for (let index = 0; index < canonical.length; index++)
              hash = BigInt.asUintN(
                64,
                (hash ^ BigInt(canonical.charCodeAt(index))) * 0x100000001b3n,
              );
            consistencyMetadata.baseRevision =
              "initialized-empty-before-partition";
            consistencyMetadata.payloadDigest.value = sha256Bytes(
              Buffer.from(canonical),
            );
            consistencyMetadata.payloadFingerprint.canonicalLength =
              canonical.length;
            consistencyMetadata.payloadFingerprint.value = hash
              .toString(16)
              .padStart(16, "0");
            consistencyCheckpoint.committedRoot.baseRevision =
              consistencyMetadata.baseRevision;
            consistencyCheckpoint.committedRoot.digest = structuredClone(
              consistencyMetadata.payloadDigest,
            );
          }
          if (mutation === "partitioned-digest")
            consistencyMetadata.payloadDigest.value = "0".repeat(64);
          if (mutation === "consistency-digest") {
            consistencyMetadata.payloadDigest.value = "0".repeat(64);
          }
          if (mutation === "timestamp") checkpoint.updatedAt = "invalid";
          if (mutation === "digest")
            metadata.payloadDigest.value = "0".repeat(64);
          if (mutation === "checkpoint")
            checkpoint.committedRoot.revision = "stale-root";
          await new Promise((resolve, reject) => {
            const transaction = database.transaction(
              ["eventLists", "eventConsistency", "syncQueue"],
              "readwrite",
            );
            transaction.objectStore("eventLists").put(payload, "data");
            transaction.objectStore("syncQueue").put(metadata, metadataKey);
            if (mutation !== "partial")
              transaction
                .objectStore("syncQueue")
                .put(checkpoint, checkpointKey);
            transaction
              .objectStore("eventConsistency")
              .put(
                mutation.startsWith("partitioned")
                  ? emptyHead
                  : mutation === "consistency-data"
                    ? { "existing-event": {} }
                    : {},
                "data",
              );
            transaction
              .objectStore("syncQueue")
              .put(
                consistencyMetadata,
                "__esp_internal__:meta:v1:eventConsistency:data",
              );
            transaction
              .objectStore("syncQueue")
              .put(
                consistencyCheckpoint,
                "__esp_internal__:checkpoint:v1:eventConsistency:data",
              );
            if (mutation === "partitioned-stray")
              transaction
                .objectStore("eventConsistency")
                .put({}, "__esp_internal__:day-record:v1:stray");
            transaction.oncomplete = resolve;
            transaction.onabort = () => reject(transaction.error);
          });
          const snapshot = () =>
            Promise.all([
              read(database, "eventLists", "data"),
              read(database, "syncQueue", metadataKey),
              read(database, "syncQueue", checkpointKey),
              read(database, "eventConsistency", "data"),
              read(
                database,
                "syncQueue",
                "__esp_internal__:meta:v1:eventConsistency:data",
              ),
              read(
                database,
                "syncQueue",
                "__esp_internal__:checkpoint:v1:eventConsistency:data",
              ),
            ]);
          if (
            ["none", "partitioned-empty", "partitioned-empty-v11"].includes(
              mutation,
            )
          ) {
            const staged = await stageCanonicalExportEventLists(stageOptions);
            assert.equal(staged.receipt.databaseVersion, databaseVersion);
            const [
              payload,
              metadata,
              checkpoint,
              consistency,
              storedConsistencyMetadata,
            ] = await snapshot();
            assert.equal(consistency[eventName].schemaVersion, 1);
            assert.equal(
              storedConsistencyMetadata.baseRevision,
              consistencyMetadata.revision,
            );
            assert.deepEqual(payload, stageOptions.eventLists);
            assert.equal(metadata.baseRevision, initializedMetadata.revision);
            assert.equal(
              checkpoint.committedRoot.baseRevision,
              initializedMetadata.revision,
            );
          } else {
            const before = await snapshot();
            await assert.rejects(
              stageCanonicalExportEventLists(stageOptions),
              /requires an empty fresh-context root/,
            );
            assert.deepEqual(await snapshot(), before);
          }
        } finally {
          database.close();
        }
      });
    }
  } finally {
    if (originalIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDb;
  }
});

// Persistence canonicalization omits own undefined fields, while the IDB fixture
// retains them. Normalize a private hash input only, never the stored test values.
const receiptPayloadBytes = (value) =>
  canonicalPersistencePayloadBytes(JSON.parse(JSON.stringify(value)));
const receiptStores = [
  "dayModes",
  "eventConsistency",
  "eventLists",
  "eventMetadata",
  "executeModeItems",
  "hallDefinitions",
  "hallRouteSettings",
  "mapData",
  "mapRotationSettings",
  "mapViewportSettings",
  "routeSettings",
  "syncQueue",
];
const receiptMetadataKey = (store) =>
  "__esp_internal__:meta:v1:" + store + ":data";
const receiptCheckpointKey = (store) =>
  "__esp_internal__:checkpoint:v1:" + store + ":data";
const receiptRecordKey = (eventName) =>
  "__esp_internal__:day-record:v1:" + JSON.stringify([eventName, []]);
const receiptHead = (rows) => ({
  kind: "event-shopping-planner-day-records",
  version: 1,
  storeName: "eventLists",
  count: rows.length,
  checksum: (
    rows.reduce((sum, [, row]) => sum + BigInt("0x" + row.digest.value), 0n) %
    (1n << 256n)
  )
    .toString(16)
    .padStart(64, "0"),
  authenticatedRoots: true,
});
const receiptRecord = (eventName, items) => {
  const key = receiptRecordKey(eventName);
  return [
    key,
    {
      kind: "event-shopping-planner-day-record",
      version: 1,
      eventName,
      path: [],
      value: items,
      children: [],
      digest: {
        algorithm: "SHA-256",
        canonicalization: "esp-json-v1",
        value: sha256Bytes(
          receiptPayloadBytes({
            store: "eventLists",
            key,
            value: items,
            children: [],
          }),
        ),
      },
    },
  ];
};
const receiptControls = (payload, storeName) => {
  const bytes = receiptPayloadBytes(payload);
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes)
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  const metadata = {
    kind: "event-shopping-planner-persistence-metadata",
    version: 1,
    storeName,
    key: "data",
    revision: "committed-" + storeName,
    baseRevision:
      payload?.kind === "event-shopping-planner-day-records"
        ? "before-head-preparation"
        : null,
    payloadDigest: {
      algorithm: "SHA-256",
      canonicalization: "esp-json-v1",
      value: sha256Bytes(bytes),
    },
    payloadFingerprint: {
      algorithm: "FNV-1A-64",
      canonicalization: "esp-json-v1",
      canonicalLength: bytes.toString("utf8").length,
      value: hash.toString(16).padStart(16, "0"),
    },
    writerId: "verified-application-startup",
    committedAt: "2026-10-22T00:00:00.000Z",
  };
  return {
    metadata,
    checkpoint: {
      kind: "event-shopping-planner-persistence-checkpoint",
      version: 1,
      storeName,
      key: "data",
      committedRoot: {
        revision: metadata.revision,
        baseRevision: metadata.baseRevision,
        digest: structuredClone(metadata.payloadDigest),
        writerId: metadata.writerId,
        committedAt: metadata.committedAt,
      },
      absorbedCandidates: [],
      updatedAt: metadata.committedAt,
    },
  };
};
const receiptRequest = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const receiptFinished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
  });
const receiptSnapshot = async (database) => {
  const tx = database.transaction(receiptStores, "readonly");
  const finished = receiptFinished(tx);
  const contents = await Promise.all(
    receiptStores.map(async (name) => {
      const store = tx.objectStore(name);
      return [
        name,
        await Promise.all([
          receiptRequest(store.getAllKeys()),
          receiptRequest(store.getAll()),
        ]),
      ];
    }),
  );
  await finished;
  return contents;
};
const withReceiptDatabase = async (callback) => {
  const originalIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const database = await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open("EventShoppingPlannerDB", 11);
    request.onupgradeneeded = () => {
      for (const store of receiptStores)
        request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await callback(database);
  } finally {
    database.close();
    if (originalIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDb;
  }
};
const seedReceipt = async (
  database,
  payload,
  rows,
  controls = receiptControls(payload, "eventLists"),
) => {
  const tx = database.transaction(receiptStores, "readwrite");
  const finished = receiptFinished(tx);
  const queue = tx.objectStore("syncQueue");
  for (const storeName of receiptStores.filter(
    (name) => name !== "syncQueue",
  )) {
    const data = storeName === "eventLists" ? payload : {};
    const root =
      storeName === "eventLists" ? controls : receiptControls(data, storeName);
    tx.objectStore(storeName).put(data, "data");
    queue.put(root.metadata, receiptMetadataKey(storeName));
    queue.put(root.checkpoint, receiptCheckpointKey(storeName));
  }
  for (const [key, row] of rows) tx.objectStore("eventLists").put(row, key);
  queue.put(
    { event: 7, optional: { keep: true } },
    "__esp_internal__:unchanged-control",
  );
  await finished;
};
const observeReceiptCalls = async (callback) => {
  const puts = [];
  const transactions = [];
  const put = IDBObjectStore.prototype.put;
  const transaction = IDBDatabase.prototype.transaction;
  IDBObjectStore.prototype.put = function (...args) {
    puts.push({ store: this.name, key: args[1] });
    return Reflect.apply(put, this, args);
  };
  IDBDatabase.prototype.transaction = function (...args) {
    transactions.push({ stores: [...args[0]], mode: args[1] });
    return Reflect.apply(transaction, this, args);
  };
  try {
    return await callback({ puts, transactions });
  } finally {
    IDBObjectStore.prototype.put = put;
    IDBDatabase.prototype.transaction = transaction;
  }
};

test("authenticates legacy and event-head receipts without changing any persisted field", async (t) => {
  for (const mutation of [
    "legacy",
    "head",
    "head-other-event",
    "head-prototype-event",
    "legacy-digest",
    "legacy-array",
    "head-array",
    "head-record-array",
    "head-authentication",
    "head-count",
    "head-checksum",
    "head-record-digest",
    "head-record-key",
    "head-record-path",
    "head-record-children",
    "head-record-unknown-drift",
    "head-extra-record",
    "head-missing-record",
    "head-payload-digest",
    "head-fingerprint",
    "head-checkpoint",
    "head-cardinality",
    "head-semantic",
  ]) {
    await t.test(mutation, async () =>
      withReceiptDatabase(async (database) => {
        const eventName =
          mutation === "head-prototype-event" ? "__proto__" : "receipt-event";
        const items = buildCanonicalItems({ rowCount: 2, seed: 1967 });
        items[0].url = undefined;
        items[0].assignedTo = undefined;
        items[0].customOptional = { nested: ["retained", { keep: true }] };
        let rows = [receiptRecord(eventName, items)];
        if (mutation === "head-other-event")
          rows.push(
            receiptRecord("other-event", [{ ...items[1], id: "other" }]),
          );
        if (mutation === "head-record-key") rows[0][0] += "-wrong-key";
        if (mutation === "head-record-path") rows[0][1].path = ["unexpected"];
        if (mutation === "head-record-children")
          rows[0][1].children = [{ path: ["child"] }];
        if (mutation === "head-record-digest")
          rows[0][1].digest.value = "0".repeat(64);
        if (mutation === "head-record-unknown-drift")
          rows[0][1].value[0].customOptional.nested[1].keep = false;
        if (mutation === "head-record-array")
          rows[0][1] = Object.assign([], rows[0][1]);
        const isLegacy = mutation.startsWith("legacy");
        let payload = isLegacy
          ? Object.fromEntries([[eventName, items]])
          : receiptHead(rows);
        if (mutation === "legacy-array" || mutation === "head-array")
          payload = Object.assign([], payload);
        if (mutation === "head-authentication")
          payload.authenticatedRoots = false;
        if (mutation === "head-count") payload.count++;
        if (mutation === "head-checksum") payload.checksum = "1".repeat(64);
        if (isLegacy) rows = [];
        if (mutation === "head-extra-record")
          rows.push(receiptRecord("unlisted-event", []));
        if (mutation === "head-missing-record") rows = [];
        const controls = receiptControls(payload, "eventLists");
        if (mutation === "legacy-digest" || mutation === "head-payload-digest")
          controls.metadata.payloadDigest.value = "0".repeat(64);
        if (mutation === "head-fingerprint")
          controls.metadata.payloadFingerprint.value = "0".repeat(16);
        if (mutation === "head-checkpoint")
          controls.checkpoint.committedRoot.revision = "uncommitted-revision";
        await seedReceipt(database, payload, rows, controls);
        const before = await receiptSnapshot(database);
        await observeReceiptCalls(async ({ puts, transactions }) => {
          const read = () =>
            readCommittedEventListsReceipt({
              eventName,
              expectedItemCount: mutation === "head-cardinality" ? 3 : 2,
              expectedSemanticSha256:
                mutation === "head-semantic"
                  ? "0".repeat(64)
                  : canonicalEventItemsSemanticSha256(eventName, items),
              page: { evaluate: (callback, input) => callback(input) },
            });
          if (
            [
              "legacy",
              "head",
              "head-other-event",
              "head-prototype-event",
            ].includes(mutation)
          ) {
            const receipt = await read();
            assert.equal(receipt.itemCount, 2);
            assert.equal(
              receipt.payloadSha256,
              sha256Bytes(receiptPayloadBytes(payload)),
            );
            assert.equal(
              receipt.semanticSha256,
              canonicalEventItemsSemanticSha256(eventName, items),
            );
          } else {
            await assert.rejects(read(), /Committed event/);
          }
          assert.deepEqual(puts, []);
          assert.deepEqual(transactions, [
            { stores: ["eventLists", "syncQueue"], mode: "readonly" },
          ]);
        });
        assert.deepEqual(await receiptSnapshot(database), before);
      }),
    );
  }
});

test("stages only truly empty authenticated item heads and preserves every unrelated root", async (t) => {
  for (const mutation of [
    "empty-head",
    "empty-head-and-consistency",
    "nonempty-head",
    "forged-head",
    "wrong-store",
    "wrong-count",
    "wrong-checksum",
    "extra-record",
    "extra-unrecognized-record",
    "missing-data-with-extra-record",
    "metadata-digest",
    "metadata-fingerprint",
    "checkpoint",
  ]) {
    await t.test(mutation, async () =>
      withReceiptDatabase(async (database) => {
        const rows =
          mutation === "nonempty-head"
            ? [receiptRecord("existing-event", [])]
            : [];
        const payload = receiptHead(rows);
        if (mutation === "forged-head") payload.authenticatedRoots = false;
        if (mutation === "wrong-store") payload.storeName = "eventMetadata";
        if (mutation === "wrong-count") payload.count = 1;
        if (mutation === "wrong-checksum") payload.checksum = "1".repeat(64);
        const controls = receiptControls(payload, "eventLists");
        if (mutation === "metadata-digest")
          controls.metadata.payloadDigest.value = "0".repeat(64);
        if (mutation === "metadata-fingerprint")
          controls.metadata.payloadFingerprint.value = "0".repeat(16);
        if (mutation === "checkpoint")
          controls.checkpoint.committedRoot.revision = "stale-root";
        if (mutation === "extra-record")
          rows.push(receiptRecord("unlisted-event", []));
        if (
          mutation === "extra-unrecognized-record" ||
          mutation === "missing-data-with-extra-record"
        )
          rows.push(["unrecognized-record", { keep: true }]);
        await seedReceipt(database, payload, rows, controls);
        if (
          mutation === "empty-head-and-consistency" ||
          mutation === "missing-data-with-extra-record"
        ) {
          const tx = database.transaction(
            ["eventLists", "eventConsistency", "syncQueue"],
            "readwrite",
          );
          const finished = receiptFinished(tx);
          if (mutation === "missing-data-with-extra-record")
            tx.objectStore("eventLists").delete("data");
          else {
            const head = { ...receiptHead([]), storeName: "eventConsistency" };
            const root = receiptControls(head, "eventConsistency");
            tx.objectStore("eventConsistency").put(head, "data");
            tx.objectStore("syncQueue").put(
              root.metadata,
              receiptMetadataKey("eventConsistency"),
            );
            tx.objectStore("syncQueue").put(
              root.checkpoint,
              receiptCheckpointKey("eventConsistency"),
            );
          }
          await finished;
        }
        const before = await receiptSnapshot(database);
        const eventName = "staged-head-event";
        const items = buildCanonicalItems({ rowCount: 2, seed: 1967 });
        items[0].customOptional = { keep: ["all", "fields"] };
        const eventLists = { [eventName]: items };
        const accepted = mutation.startsWith("empty-head");
        await observeReceiptCalls(async ({ puts }) => {
          const stage = () =>
            stageCanonicalExportEventLists({
              eventName,
              eventLists,
              expectedSemanticSha256: canonicalEventItemsSemanticSha256(
                eventName,
                items,
              ),
              page: { evaluate: (callback, input) => callback(input) },
            });
          if (accepted) {
            await stage();
            assert.equal(puts.length, 6);
            assert.deepEqual(
              puts.map(({ store }) => store),
              [
                "eventLists",
                "syncQueue",
                "syncQueue",
                "eventConsistency",
                "syncQueue",
                "syncQueue",
              ],
            );
          } else {
            await assert.rejects(
              stage(),
              /requires an empty fresh-context root/,
            );
            assert.deepEqual(puts, []);
          }
        });
        const after = await receiptSnapshot(database);
        if (!accepted) {
          assert.deepEqual(after, before);
          return;
        }
        const afterMap = new Map(after);
        const [, eventValues] = afterMap.get("eventLists");
        assert.deepEqual(eventValues, [eventLists]);
        const [queueKeys, queueValues] = afterMap.get("syncQueue");
        const queue = new Map(
          queueKeys.map((key, index) => [key, queueValues[index]]),
        );
        assert.equal(
          queue.get(receiptMetadataKey("eventLists")).baseRevision,
          controls.metadata.revision,
        );
        assert.equal(
          queue.get(receiptCheckpointKey("eventLists")).committedRoot
            .baseRevision,
          controls.metadata.revision,
        );
        const untouched = (snapshot) =>
          snapshot
            .map(([store, [keys, values]]) =>
              store === "syncQueue"
                ? [
                    store,
                    keys
                      .map((key, index) => [key, values[index]])
                      .filter(
                        ([key]) =>
                          !["eventLists", "eventConsistency"].some(
                            (name) =>
                              key === receiptMetadataKey(name) ||
                              key === receiptCheckpointKey(name),
                          ),
                      ),
                  ]
                : [store, keys, values],
            )
            .filter(
              ([store]) => !["eventLists", "eventConsistency"].includes(store),
            );
        assert.deepEqual(untouched(after), untouched(before));
      }),
    );
  }
});
