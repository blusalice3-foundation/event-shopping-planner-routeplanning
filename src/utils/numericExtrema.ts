/** Equivalent empty and NaN behavior without an input-sized argument list. */
export function maximum(values: readonly number[]): number {
  let result = -Infinity;
  for (const value of values) result = Math.max(result, value);
  return result;
}
export function minimum(values: readonly number[]): number {
  let result = Infinity;
  for (const value of values) result = Math.min(result, value);
  return result;
}
