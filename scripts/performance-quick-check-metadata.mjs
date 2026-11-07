const formalCollection = Object.freeze({
  diagnosticOnly: false,
  acceptanceMeasurement: true,
});
const developmentQuickCollection = Object.freeze({
  diagnosticOnly: true,
  acceptanceMeasurement: false,
  collectionScope: "development-quick-check",
});
export function performanceCollectionMetadata(env = {}) {
  // Treat any enabled case variant conservatively as diagnostic on every OS.
  return Object.entries(env).some(
    ([name, value]) =>
      name.toUpperCase() === "ESP_DIAGNOSTIC_QUICK_CHECK" && value === "1",
  )
    ? developmentQuickCollection
    : formalCollection;
}
