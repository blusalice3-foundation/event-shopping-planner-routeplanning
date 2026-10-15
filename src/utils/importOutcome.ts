/** Worker and DOM errors can originate in another realm; compare their names. */
export function bulkImportFailureStatus(
  error: unknown,
): "failed" | "cancelled" | "committed-ui-failed" | "unknown" {
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "";
  if (name === "CommittedStateApplyError") return "committed-ui-failed";
  if (name === "MutationCancelled") return "cancelled";
  return [
    "QuotaExceededError",
    "AbortError",
    "ConstraintError",
    "DataError",
    "MutationConflict",
    "MutationTargetMissing",
  ].includes(name)
    ? "failed"
    : "unknown";
}
