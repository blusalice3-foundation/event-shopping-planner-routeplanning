import { createSynchronousFingerprint } from "./persistenceResilience";

/** Opaque sheet provenance, independent of the editable price and remarks. */
export function createSheetIdentityFingerprint(
  price: number | null,
  remarks: string,
): string {
  const fingerprint = createSynchronousFingerprint([price, remarks]);
  return `sheet-v1:${fingerprint.canonicalLength}:${fingerprint.value}`;
}

export function isSheetIdentityFingerprint(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    value.trim() === value &&
    /^sheet-v1:[1-9]\d*:[0-9a-f]{16}$/.test(value)
  );
}
