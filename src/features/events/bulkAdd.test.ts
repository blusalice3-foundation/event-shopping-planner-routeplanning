import { createSheetIdentityFingerprint } from "../../utils/sheetIdentity";
import { describe, expect, it, vi } from "vitest";
import { buildBulkAddItems } from "./bulkAdd";

describe("buildBulkAddItems source-owned fields", () => {
  it("スプレッドシート新規品目は価格・備考と内部識別情報を保持する", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );

    const [item] = buildBulkAddItems(
      [
        {
          circle: "サークルA",
          eventDate: "1日目",
          block: "東A",
          number: "01a",
          title: "新刊",
          price: 1200,
          quantity: 2,
          remarks: "シート備考",
          sheetIdentityFingerprint: createSheetIdentityFingerprint(
            1200,
            "シート備考",
          ),
        },
      ],
      {
        url: "https://docs.google.com/spreadsheets/d/example/edit",
        sheetName: "品目表",
      },
    );

    expect(item).toMatchObject({
      price: 1200,
      remarks: "シート備考",
      sheetIdentityFingerprint: createSheetIdentityFingerprint(
        1200,
        "シート備考",
      ),
      source: "spreadsheet",
      protectionLevel: "none",
    });
  });

  it("Googleシート品目を固定追加した場合は照合用識別情報を引き継がない", () => {
    const [item] = buildBulkAddItems(
      [
        {
          circle: "ユーザー登録",
          eventDate: "1日目",
          block: "A",
          number: "01a",
          title: "固定追加",
          price: 500,
          quantity: 1,
          remarks: "エラーが発生しました",
          source: "spreadsheet",
          sheetIdentityFingerprint: createSheetIdentityFingerprint(
            500,
            "エラーが発生しました",
          ),
        },
      ],
      { source: "app" },
    );
    expect(item.source).toBe("app");
    expect(item.protectionLevel).toBe("full");
    expect(item).not.toHaveProperty("sheetIdentityFingerprint");
    expect(item.price).toBe(500);
    expect(item.remarks).toBe("エラーが発生しました");
  });
  it("手入力品目には同期元フィールドを作らない", () => {
    const [item] = buildBulkAddItems(
      [
        {
          circle: "手入力",
          eventDate: "1日目",
          block: "A",
          number: "1",
          title: "",
          price: 500,
          quantity: 1,
          remarks: "利用者メモ",
        },
      ],
      { source: "app" },
    );

    expect(item).not.toHaveProperty("catalogPrice");
    expect(item).not.toHaveProperty("sheetRemarks");
    expect(item).not.toHaveProperty("sheetIdentityFingerprint");
    expect(item.source).toBe("app");
  });
});
