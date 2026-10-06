import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_NAME,
  LEGACY_ITEM,
  assertDatabaseUnchanged,
  assertRestoredBackup,
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
