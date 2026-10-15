/** Session keys are ephemeral; never infer ownership from a string prefix. */
export const buildFocusSessionKey = (
  eventName: string,
  eventDate: string,
): string => JSON.stringify([eventName, eventDate]);

export function parseFocusSessionKey(
  key: string,
): readonly [string, string] | null {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) &&
      value.length === 2 &&
      value.every((part) => typeof part === "string")
      ? (value as [string, string])
      : null;
  } catch {
    return null;
  }
}
