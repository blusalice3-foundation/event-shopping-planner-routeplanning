import type { ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportScreen from "./ImportScreen";
import { sheetCsv } from "../test/sheetImportOptionalUrlFixtures";
const url = "https://docs.google.com/spreadsheets/d/test/edit";
function setup(
  csv: string,
  status: "saved" | "cancelled" = "saved",
  importedItemCount?: number,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => csv })),
  );
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const add = vi.fn<ComponentProps<typeof ImportScreen>["onBulkAdd"]>(
    async (_name, items) => ({
      status,
      importedItemCount: importedItemCount ?? items.length,
    }),
  );
  render(
    <ImportScreen
      onBulkAdd={add}
      activeEventName={null}
      itemToEdit={null}
      onUpdateItem={vi.fn()}
      onDoneEditing={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("即売会名"), {
    target: { value: "イベント" },
  });
  fireEvent.change(screen.getByLabelText("スプレッドシートURLからインポート"), {
    target: { value: url },
  });
  return add;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("import selection and input retention", () => {
  it("imports complete rows, reports exclusions and keeps sourceRows attached to the exact inputs", async () => {
    const add = setup(sheetCsv(4, "mixed"));
    fireEvent.click(screen.getByRole("button", { name: "URLからインポート" }));
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    const [, items, metadata] = add.mock.calls[0];
    expect(items).toHaveLength(3);
    metadata!.sourceRows!.forEach((row, index) =>
      expect(row.item).toBe(items[index]),
    );
    expect(
      screen.getByRole("region", { name: "シート取込結果" }),
    ).toHaveTextContent("取込対象: 3件、必須項目不足による除外: 1行");
    expect(window.confirm).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByLabelText("スプレッドシートURLからインポート"),
      ).toHaveValue(""),
    );
  });
  it.each(["excluded", "cancelled", "failed"] as const)(
    "keeps input on %s and never creates an empty event",
    async (kind) => {
      const add = setup(
        sheetCsv(4, kind === "excluded" ? "excluded" : "mixed"),
        kind === "cancelled" ? "cancelled" : "saved",
      );
      if (kind === "failed")
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new Error("通信に失敗しました");
          }),
        );
      fireEvent.click(
        screen.getByRole("button", { name: "URLからインポート" }),
      );
      await waitFor(() =>
        kind === "cancelled"
          ? expect(add).toHaveBeenCalledOnce()
          : expect(window.alert).toHaveBeenCalled(),
      );
      expect(screen.getByLabelText("即売会名")).toHaveValue("イベント");
      expect(
        screen.getByLabelText("スプレッドシートURLからインポート"),
      ).toHaveValue(url);
      if (kind !== "cancelled") expect(add).not.toHaveBeenCalled();
    },
  );
  it("keeps the established quantity-donor URL completion after excluding incomplete rows", async () => {
    const header = sheetCsv(0);
    const row = (
      number: string,
      quantity: string,
      itemUrl: string,
      block = "A",
    ) => {
      const cells = Array<string>(27).fill("");
      Object.assign(cells, {
        12: "同一サークル",
        13: "1日目",
        14: block,
        15: number,
        16: "新刊",
        24: itemUrl,
        26: quantity,
      });
      return cells.join(",");
    };
    const add = setup(
      [
        header,
        row("1", "1", "https://excluded.test", ""),
        row("2", "21", "https://quantity.test"),
        row("3", "2", ""),
      ].join("\n"),
    );
    fireEvent.click(screen.getByRole("button", { name: "URLからインポート" }));
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(add.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        number: "3",
        quantity: 2,
        url: "https://quantity.test",
      }),
    ]);
    expect(add.mock.calls[0][2]!.sourceRows![0].sourceRowId).toBe("csv:3:4");
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining("数量が1～20の整数ではない1行"),
    );
  });
});

it("clears an earlier diagnostic when the input changes", async () => {
  setup(sheetCsv(4, "excluded"));
  fireEvent.click(screen.getByRole("button", { name: "URLからインポート" }));
  await screen.findByRole("region", { name: "シート取込結果" });
  fireEvent.change(screen.getByLabelText("スプレッドシートURLからインポート"), {
    target: { value: "https://docs.google.com/spreadsheets/d/next/edit" },
  });
  expect(
    screen.queryByRole("region", { name: "シート取込結果" }),
  ).not.toBeInTheDocument();
});

it.each(["url", "file"] as const)(
  "uses the actual committed count for %s import notifications and the result summary",
  async (path) => {
    const [header, excluded, accepted] = sheetCsv(2, "mixed").split("\n");
    const csv = [header, accepted, accepted, excluded].join("\n");
    const add = setup(csv, "saved", 1);
    if (path === "url") {
      fireEvent.click(
        screen.getByRole("button", { name: "URLからインポート" }),
      );
    } else {
      const file = new File([csv], "import.csv", { type: "text/csv" });
      Object.defineProperty(file, "text", { value: async () => csv });
      fireEvent.change(screen.getByLabelText("CSVファイルからインポート"), {
        target: { files: [file] },
      });
    }
    await waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(add.mock.calls[0][1]).toHaveLength(2);
    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith(
        "1件を取り込み、必須項目不足の1行を除外しました。",
      ),
    );
    expect(
      screen.getByRole("region", { name: "シート取込結果" }),
    ).toHaveTextContent("取込対象: 1件、必須項目不足による除外: 1行");
  },
);

it("reports CSV read errors and can reselect the same file without erasing newer input", async () => {
  const add = setup(sheetCsv(1));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([""], "same.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", {
    value: vi
      .fn()
      .mockRejectedValueOnce(new DOMException("denied", "NotReadableError"))
      .mockResolvedValue(sheetCsv(1)),
  });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() =>
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining("CSVファイルを読み取れませんでした"),
    ),
  );
  expect(input.value).toBe("");
  expect(add).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(add).toHaveBeenCalledOnce());
});
it("ignores a replaced CSV read failure before parsing the newer CSV", async () => {
  const add = setup(sheetCsv(1));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  let reject!: (reason: unknown) => void;
  const old = new File([""], "old.csv");
  Object.defineProperty(old, "text", {
    value: () =>
      new Promise((_resolve, rejectRead) => {
        reject = rejectRead;
      }),
  });
  const latest = new File([""], "latest.csv");
  Object.defineProperty(latest, "text", { value: async () => sheetCsv(1) });
  fireEvent.change(input, { target: { files: [old] } });
  fireEvent.change(input, { target: { files: [latest] } });
  await waitFor(() => expect(add).toHaveBeenCalledOnce());
  reject(new DOMException("stale", "NotReadableError"));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(window.alert).not.toHaveBeenCalled();
});
