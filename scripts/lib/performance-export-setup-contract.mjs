const LEGACY_METHOD = "indexeddb-schema-exact-single-transaction-stage-v1";
const CONSISTENCY_METHOD = "indexeddb-schema-exact-single-transaction-stage-v2";

export function isValidExportSetupStorageBinding(setup) {
  if (!setup || !Number.isSafeInteger(setup.databaseVersion)) return false;
  if (setup.method === LEGACY_METHOD) {
    return (
      setup.databaseVersion >= 5 &&
      setup.databaseVersion <= 7 &&
      JSON.stringify(setup.transactionStores) ===
        JSON.stringify(["eventLists", "syncQueue"])
    );
  }
  if (setup.method === CONSISTENCY_METHOD) {
    return (
      setup.databaseVersion === 8 &&
      JSON.stringify(setup.transactionStores) ===
        JSON.stringify(["eventLists", "eventConsistency", "syncQueue"])
    );
  }
  return false;
}
