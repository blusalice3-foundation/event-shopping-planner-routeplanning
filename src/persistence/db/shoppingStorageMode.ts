import { PersistenceConflictError } from "./errors";

/** Baseline versions ignore this private control record and keep legacy data readable. */
export const SHOPPING_STORAGE_MODE_KEY =
  "__esp_internal__:shopping-storage-mode:v1";
export const LEGACY_SHOPPING_STORAGE_MODE = Object.freeze({
  kind: "event-shopping-planner-shopping-storage-mode",
  version: 1,
  mode: "legacy",
});

export function usesLegacyShoppingStorage(value: unknown): boolean {
  if (value === undefined) return false;
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 3 &&
    "kind" in value &&
    value.kind === LEGACY_SHOPPING_STORAGE_MODE.kind &&
    "version" in value &&
    value.version === 1 &&
    "mode" in value &&
    value.mode === "legacy"
  )
    return true;
  throw new PersistenceConflictError(
    "旧バージョン用の保存設定を検証できません。データを保全して復旧してください。",
  );
}
