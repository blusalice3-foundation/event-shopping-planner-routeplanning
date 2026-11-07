import assert from "node:assert/strict";
import test from "node:test";
import { performanceCollectionMetadata } from "./performance-quick-check-metadata.mjs";

const formal = { diagnosticOnly: false, acceptanceMeasurement: true };
const quick = {
  diagnosticOnly: true,
  acceptanceMeasurement: false,
  collectionScope: "development-quick-check",
};

test("quick-check metadata preserves formal defaults unless explicitly enabled", () => {
  assert.deepEqual(performanceCollectionMetadata(), formal);
  for (const value of [undefined, "0", "", "true", " 1", 1])
    assert.deepEqual(
      performanceCollectionMetadata({ ESP_DIAGNOSTIC_QUICK_CHECK: value }),
      formal,
    );
  assert.deepEqual(
    performanceCollectionMetadata({ ESP_DIAGNOSTIC_OTHER: "1" }),
    formal,
  );
});

test("enabled quick-check metadata is diagnostic for every environment case variant", () => {
  for (const env of [
    { ESP_DIAGNOSTIC_QUICK_CHECK: "1" },
    { esp_diagnostic_quick_check: "1" },
    { ESP_DIAGNOSTIC_QUICK_CHECK: "0", esp_diagnostic_quick_check: "1" },
  ]) {
    const original = { ...env };
    assert.deepEqual(performanceCollectionMetadata(env), quick);
    assert.deepEqual(env, original);
  }
});

test("collection metadata remains immutable across quick and formal calls", () => {
  const diagnostic = performanceCollectionMetadata({
    ESP_DIAGNOSTIC_QUICK_CHECK: "1",
  });
  assert.ok(Object.isFrozen(diagnostic));
  assert.ok(Object.isFrozen(performanceCollectionMetadata()));
  assert.throws(() => {
    diagnostic.acceptanceMeasurement = true;
  }, TypeError);
  assert.deepEqual(performanceCollectionMetadata(), formal);
  assert.deepEqual(
    performanceCollectionMetadata({ ESP_DIAGNOSTIC_QUICK_CHECK: "1" }),
    quick,
  );
});
