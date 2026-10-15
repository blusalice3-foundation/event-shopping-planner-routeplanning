/** Logical names may be any string, including Object.prototype property names. */
export function ownValue<T>(
  record: Readonly<Record<string, T>> | null | undefined,
  key: string,
): T | undefined {
  return record && Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}
export function setOwnValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): T {
  Object.defineProperty(record, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return value;
}
/** Same static contract as record indexing; only own entries are returned. */
export function recordEntry<R extends Readonly<Record<string, unknown>>>(
  record: R | null | undefined,
  key: string,
): R[string] {
  return ownValue(record, key) as R[string];
}
