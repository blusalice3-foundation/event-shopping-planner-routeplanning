import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  EVENT_NAME,
  LEGACY_ITEM,
  activateArtifactServiceWorker,
  assertDatabaseUnchanged,
  assertRestoredBackup,
  waitUntil,
} from "./rehearse-release-a-db-boundary.mjs";
const snapshot = () => ({
  version: 8,
  stores: {
    eventLists: {
      keyPath: null,
      indexes: [],
      entries: [{ key: "data", value: { [EVENT_NAME]: [LEGACY_ITEM] } }],
    },
    syncQueue: {
      keyPath: null,
      indexes: [],
      entries: [{ key: "migration", value: { sourceDigest: "preserved" } }],
    },
  },
});
test("legacy rejection evidence requires every database record to remain intact", () => {
  const before = snapshot();
  assertDatabaseUnchanged(before, structuredClone(before));
  for (const mutate of [
    (value) => {
      value.version = 7;
    },
    (value) => {
      value.stores.eventLists.entries[0].value[EVENT_NAME][0].quantity = 1;
    },
    (value) => {
      value.stores.syncQueue.entries = [];
    },
    (value) => {
      value.stores.syncQueue.entries.push({ key: "unexpected", value: true });
    },
  ]) {
    const after = structuredClone(before);
    mutate(after);
    assert.throws(() => assertDatabaseUnchanged(before, after));
  }
});
test("isolated recovery verifies purchases and rejects modern or lossy backups", () => {
  const backup = {
    kind: "event-shopping-planner-backup",
    version: 1,
    data: {
      eventLists: { [EVENT_NAME]: [structuredClone(LEGACY_ITEM)] },
      routeSettings: {},
    },
    eventSettings: { blockDetectionSettings: {} },
  };
  assertRestoredBackup(backup, structuredClone(backup));
  for (const mutate of [
    (value) => {
      value.version = 2;
    },
    (value) => {
      value.data.eventLists[EVENT_NAME][0].purchaseStatus = "None";
    },
    (value) => {
      value.data.routeSettings = { missing: true };
    },
    (value) => {
      value.eventSettings.blockDetectionSettings = { changed: true };
    },
  ]) {
    const after = structuredClone(backup);
    mutate(after);
    assert.throws(() => assertRestoredBackup(backup, after));
  }
});

const transitionFixture = ({ candidates = 1, stallUpdate = false } = {}) => {
  const url = "http://127.0.0.1:4173/";
  const actions = [];
  const session = new EventEmitter();
  const version = (versionId) => ({
    versionId,
    scriptURL: new URL("/sw.js", url).href,
    status: "activated",
  });
  session.send = async (method, params) => {
    actions.push(method);
    if (method === "ServiceWorker.enable")
      session.emit("ServiceWorker.workerVersionUpdated", {
        versions: [version("baseline")],
      });
    if (method === "ServiceWorker.updateRegistration") {
      assert.deepEqual(params, { scopeURL: url });
      if (stallUpdate) return new Promise(() => {});
      session.emit("ServiceWorker.workerVersionUpdated", {
        versions: Array.from({ length: candidates }, (_, index) =>
          version("target-" + index),
        ),
      });
    }
  };
  session.detach = async () => actions.push("detach");
  const client = (initialUrl, label) => {
    let currentUrl = initialUrl;
    return {
      url: () => currentUrl,
      goto: async (target) => {
        assert.equal(target, "about:blank");
        actions.push(label);
        currentUrl = target;
      },
    };
  };
  const page = client("about:blank", "new page");
  const clients = [
    page,
    client(url, "release primary"),
    client(new URL("/other", url).href, "release secondary"),
    client("http://other.test/", "unrelated origin"),
  ];
  const context = {
    newCDPSession: async (target) => {
      assert.equal(target, page);
      return session;
    },
    pages: () => clients,
  };
  return { url, actions, session, page, context };
};

test("artifact transition releases all origin clients before a browser-owned update", async () => {
  const fixture = transitionFixture();
  await activateArtifactServiceWorker(
    fixture.context,
    fixture.page,
    fixture.url,
    1_000,
  );
  assert.deepEqual(fixture.actions, [
    "ServiceWorker.enable",
    "release primary",
    "release secondary",
    "ServiceWorker.updateRegistration",
    "detach",
  ]);
  assert.equal(
    fixture.session.listenerCount("ServiceWorker.workerVersionUpdated"),
    0,
  );
});

test("artifact transition times out when the update never settles and detaches observation", async () => {
  const fixture = transitionFixture({ stallUpdate: true });
  await assert.rejects(
    activateArtifactServiceWorker(
      fixture.context,
      fixture.page,
      fixture.url,
      25,
    ),
    /Target Service Worker update timed out/,
  );
  assert.equal(fixture.actions.at(-1), "detach");
  assert.equal(
    fixture.session.listenerCount("ServiceWorker.workerVersionUpdated"),
    0,
  );
});

test("artifact transition requires a new active worker rather than the cached baseline", async () => {
  const fixture = transitionFixture({ candidates: 0 });
  await assert.rejects(
    activateArtifactServiceWorker(
      fixture.context,
      fixture.page,
      fixture.url,
      25,
    ),
    /Natural Service Worker activation after all clients close/,
  );
  assert.equal(fixture.actions.at(-1), "detach");
});

test("artifact transition rejects ambiguous target workers", async () => {
  const fixture = transitionFixture({ candidates: 2 });
  await assert.rejects(
    activateArtifactServiceWorker(
      fixture.context,
      fixture.page,
      fixture.url,
      1_000,
    ),
    /Target Service Worker is ambiguous/,
  );
  assert.equal(fixture.actions.at(-1), "detach");
});

test("boundary polling also times out when the read itself never settles", async () => {
  await assert.rejects(
    waitUntil(() => new Promise(() => {}), "Pending browser readiness", 25),
    /Pending browser readiness timed out/,
  );
});
