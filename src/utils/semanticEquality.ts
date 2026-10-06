/** Compare the canonical JSON values used by mutation plans without allocating strings. */
export function semanticEqual(left: unknown, right: unknown): boolean {
  return compareJsonValues(left, right, false);
}
/** Compare plain JSON payloads with the property order used by JSON.stringify. */
export function jsonEqual(left: unknown, right: unknown): boolean {
  return compareJsonValues(left, right, true);
}
function compareJsonValues(
  left: unknown,
  right: unknown,
  ordered: boolean,
): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    )
      return false;
    for (let index = 0; index < left.length; index++) {
      if (
        !compareJsonValues(
          jsonArrayValue(left[index]),
          jsonArrayValue(right[index]),
          ordered,
        )
      )
        return false;
    }
    return true;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const keys = Object.keys(left).filter((key) =>
      isJsonProperty((left as Record<string, unknown>)[key]),
    );
    const other = Object.keys(right).filter((key) =>
      isJsonProperty((right as Record<string, unknown>)[key]),
    );
    return (
      keys.length === other.length &&
      keys.every(
        (key, index) =>
          (!ordered || other[index] === key) &&
          Object.prototype.hasOwnProperty.call(right, key) &&
          compareJsonValues(
            (left as Record<string, unknown>)[key],
            (right as Record<string, unknown>)[key],
            ordered,
          ),
      )
    );
  }
  return jsonScalar(left) === jsonScalar(right);
}
const isJsonProperty = (value: unknown): boolean =>
  value !== undefined &&
  typeof value !== "function" &&
  typeof value !== "symbol";
const jsonScalar = (value: unknown): unknown =>
  typeof value === "number" && !Number.isFinite(value) ? null : value;
const jsonArrayValue = (value: unknown): unknown =>
  isJsonProperty(value) ? jsonScalar(value) : null;

/** Retain immutable branches after IndexedDB returns a newly cloned snapshot. */
export function reuseEqualReferences<T>(previous: T, next: T): T {
  if (previous === next) return previous;
  if (
    previous === null ||
    next === null ||
    typeof previous !== "object" ||
    typeof next !== "object"
  )
    return next;
  const arrays = Array.isArray(previous) && Array.isArray(next);
  if (Array.isArray(previous) !== Array.isArray(next)) return next;
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  const keys = Object.keys(after);
  const previousKeys = Object.keys(before);
  const result = (
    arrays ? new Array((next as unknown[]).length) : {}
  ) as Record<string, unknown>;
  let equal =
    previousKeys.length === keys.length &&
    (!arrays || (previous as unknown[]).length === (next as unknown[]).length);
  for (const [index, key] of keys.entries()) {
    const value = reuseEqualReferences(before[key], after[key]);
    Object.defineProperty(result, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    if (previousKeys[index] !== key || value !== before[key]) equal = false;
  }
  return (equal ? previous : result) as T;
}
