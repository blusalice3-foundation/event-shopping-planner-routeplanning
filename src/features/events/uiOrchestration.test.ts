import { describe, expect, it } from "vitest";
import { buildImportCompletionMessage } from "./uiOrchestration";

describe("buildImportCompletionMessage", () => {
  it("reports restored field values without a retired sheet-field fallback notice", () => {
    expect(
      buildImportCompletionMessage({
        errors: [],
        eventName: "ユーザー登録",
        isUpdate: true,
        itemCount: 2,
      }),
    ).toBe("ユーザー登録を更新しました。\n2件");
  });
});
