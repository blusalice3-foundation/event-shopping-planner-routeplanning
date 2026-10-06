import { normalizeExecutionVisitDay } from "../../../utils/visitProjection";
import { DayMergeRequiredError, resolveDayKey } from "./context";
/** UI lookup aliases only. Persisted spelling is recovered from the source record. */
export function projectDayBuckets<T>(
  record: Record<string, T> | undefined,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record ?? {}).map(([key, value]) => [
      resolveDayKey(record, key).status === "resolved"
        ? normalizeExecutionVisitDay(key)
        : key,
      value,
    ]),
  );
}
export function preserveDayBucketKeys<T>(
  source: Record<string, T> | undefined,
  changed: Record<string, T>,
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(changed)) {
    const match = resolveDayKey(source, key);
    if (match.status === "ambiguous")
      throw new DayMergeRequiredError(key, match.keys);
    const target = match.status === "resolved" ? match.key : key;
    if (Object.prototype.hasOwnProperty.call(result, target))
      throw new DayMergeRequiredError(key, Object.keys(changed));
    Object.defineProperty(result, target, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}
