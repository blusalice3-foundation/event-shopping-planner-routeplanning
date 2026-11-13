import { describe, expect, it } from "vitest";
import {
  createSheetIdentityFingerprint,
  isSheetIdentityFingerprint,
} from "./sheetIdentity";

describe("opaque sheet identity", () => {
  it("keeps Unicode and multiline source distinctions without storing the source text", () => {
    const remarks = "ユーザー登録\nエラーが発生しました";
    const value = createSheetIdentityFingerprint(500, remarks);
    expect(isSheetIdentityFingerprint(value)).toBe(true);
    expect(value).not.toContain(remarks);
    expect(createSheetIdentityFingerprint(500, remarks)).toBe(value);
    expect(createSheetIdentityFingerprint(500, remarks + "\n")).not.toBe(value);
    expect(createSheetIdentityFingerprint(700, remarks)).not.toBe(value);
    expect(createSheetIdentityFingerprint(null, "")).not.toBe(
      createSheetIdentityFingerprint(0, ""),
    );
  });
  it.each([
    undefined,
    null,
    false,
    123,
    "verified",
    "sheet-v1:0:0123456789abcdef",
    "sheet-v1:8:bad",
    "sheet-v1:8:0123456789abcdef\n",
  ])("rejects invalid identity evidence: %s", (value) => {
    expect(isSheetIdentityFingerprint(value)).toBe(false);
  });
});
