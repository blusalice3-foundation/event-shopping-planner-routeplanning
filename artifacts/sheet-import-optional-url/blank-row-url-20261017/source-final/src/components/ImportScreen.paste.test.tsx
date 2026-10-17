// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import ImportScreen from "./ImportScreen";

const renderImportScreen = (
  onBulkAdd: ComponentProps<typeof ImportScreen>["onBulkAdd"] = vi.fn(
    async () => ({ status: "saved" as const }),
  ),
) =>
  render(
    <ImportScreen
      onBulkAdd={onBulkAdd}
      activeEventName={null}
      itemToEdit={null}
      onUpdateItem={vi.fn()}
      onDoneEditing={vi.fn()}
    />,
  );

const getTextarea = (label: string) =>
  screen.getByLabelText(label) as HTMLTextAreaElement;

const pasteIntoCircle = (text: string) => {
  fireEvent.paste(getTextarea("M列 サークル名"), {
    clipboardData: {
      getData: () => text,
    },
  });
};

describe("ImportScreenの7列貼り付け", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("7列目を備考へ反映し、手入力済みのURLは変更しない", () => {
    renderImportScreen();
    const urlTextarea = getTextarea("URL（7列貼り付け対象外）");
    fireEvent.change(urlTextarea, {
      target: { value: "https://manual.example" },
    });

    pasteIntoCircle("サークルA\t1日目\t東A\t01a\t新刊\t1000\t取り置き希望");

    expect(getTextarea("M列 サークル名")).toHaveValue("サークルA");
    expect(getTextarea("N列 参加日")).toHaveValue("1日目");
    expect(getTextarea("O列 ブロック")).toHaveValue("東A");
    expect(getTextarea("P列 番号")).toHaveValue("01a");
    expect(getTextarea("Q列 タイトル")).toHaveValue("新刊");
    expect(getTextarea("R列 価格")).toHaveValue("1000");
    expect(getTextarea("W列 備考")).toHaveValue("取り置き希望");
    expect(urlTextarea).toHaveValue("https://manual.example");
  });

  it.each([
    {
      name: "既存URLの対応を維持する",
      urls: "https://a.example\nhttps://blank.example\nhttps://b.example",
      expectedUrls: ["https://a.example", "https://b.example"],
      excludedCount: 1,
    },
    {
      name: "空行のURLを同じサークルへ補完しない",
      urls: "\nhttps://blank.example\n",
      expectedUrls: [undefined, undefined],
      excludedCount: 1,
    },
    {
      name: "URLも空の行を診断件数に含めない",
      urls: "",
      expectedUrls: [undefined, undefined],
      excludedCount: 0,
    },
  ])(
    "空行を含む7列の再貼付けで$name",
    async ({ urls, expectedUrls, excludedCount }) => {
      const onBulkAdd = vi.fn<ComponentProps<typeof ImportScreen>["onBulkAdd"]>(
        async () => ({ status: "cancelled" }),
      );
      renderImportScreen(onBulkAdd);
      fireEvent.change(screen.getByLabelText("即売会名"), {
        target: { value: "イベント" },
      });
      pasteIntoCircle("旧サークル\t2日目\t西B\t99a\t旧刊\t500\t旧備考");
      const urlTextarea = getTextarea("URL（7列貼り付け対象外）");
      fireEvent.change(urlTextarea, { target: { value: urls } });

      pasteIntoCircle(
        [
          "同一サークル\t1日目\t東A\t01a\t品目A\t1000\t備考A",
          "",
          "同一サークル\t1日目\t東A\t02a\t品目B\t500\t備考B",
        ].join("\r\n"),
      );

      expect(getTextarea("M列 サークル名")).toHaveValue(
        "同一サークル\n\n同一サークル",
      );
      expect(getTextarea("Q列 タイトル")).toHaveValue("品目A\n\n品目B");
      expect(urlTextarea).toHaveValue(urls);
      fireEvent.click(screen.getByRole("button", { name: "リストを作成" }));

      await waitFor(() => expect(onBulkAdd).toHaveBeenCalledTimes(1));
      const items = onBulkAdd.mock.calls[0][1];
      expect(items.map((item) => item.title)).toEqual(["品目A", "品目B"]);
      expect(items.map((item) => item.url)).toEqual(expectedUrls);
      if (expectedUrls.every((value) => value === undefined)) {
        items.forEach((item) => expect(item).not.toHaveProperty("url"));
      }
      const summary = screen.getByRole("region", { name: "シート取込結果" });
      expect(summary).toHaveTextContent(
        `取込対象: 2件、必須項目不足による除外: ${excludedCount}行`,
      );
      if (excludedCount > 0) expect(summary).toHaveTextContent("2行目");
      else expect(summary).not.toHaveTextContent("行目");
    },
  );

  it("空行後の必須項目不足を貼付け元と同じ3行目として診断する", async () => {
    const onBulkAdd = vi.fn<ComponentProps<typeof ImportScreen>["onBulkAdd"]>(
      async () => ({ status: "cancelled" }),
    );
    renderImportScreen(onBulkAdd);
    fireEvent.change(screen.getByLabelText("即売会名"), {
      target: { value: "イベント" },
    });
    pasteIntoCircle(
      [
        "サークルA\t1日目\t東A\t01a\t品目A\t1000\t備考A",
        "",
        "サークルB\t1日目\t\t02a\t品目B\t500\t備考B",
      ].join("\n"),
    );

    fireEvent.click(screen.getByRole("button", { name: "リストを作成" }));

    await waitFor(() => expect(onBulkAdd).toHaveBeenCalledTimes(1));
    expect(onBulkAdd.mock.calls[0][1]).toEqual([
      expect.objectContaining({ title: "品目A" }),
    ]);
    const summary = screen.getByRole("region", { name: "シート取込結果" });
    expect(summary).toHaveTextContent(
      "取込対象: 1件、必須項目不足による除外: 1行",
    );
    expect(summary).toHaveTextContent("3行目");
    expect(summary).not.toHaveTextContent("2行目");
  });

  it("列数が不正なら警告し、既存の全textareaを変更しない", () => {
    renderImportScreen();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const initialValues = [
      ["M列 サークル名", "既存サークル"],
      ["N列 参加日", "既存日"],
      ["O列 ブロック", "既存ブロック"],
      ["P列 番号", "既存番号"],
      ["Q列 タイトル", "既存タイトル"],
      ["R列 価格", "既存価格"],
      ["W列 備考", "既存備考"],
      ["URL（7列貼り付け対象外）", "https://existing.example"],
    ] as const;
    initialValues.forEach(([label, value]) => {
      fireEvent.change(getTextarea(label), { target: { value } });
    });

    pasteIntoCircle(
      [
        "正常\t1日目\t東A\t01a\t新刊\t1000\t備考",
        "不足\t2日目\t西B\t02b\t既刊\t500",
      ].join("\n"),
    );

    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("2行目（6列・不足）"),
    );
    initialValues.forEach(([label, value]) => {
      expect(getTextarea(label)).toHaveValue(value);
    });
  });

  it("同名確認へ進む場合は入力内容を消さない", () => {
    const onBulkAdd = vi.fn(async () => ({ status: "cancelled" as const }));
    renderImportScreen(onBulkAdd);
    fireEvent.change(screen.getByLabelText("即売会名"), {
      target: { value: "既存イベント" },
    });
    pasteIntoCircle("サークルA\t1日目\t東A\t01a\t新刊\t1000\t取り置き希望");

    fireEvent.click(screen.getByRole("button", { name: "リストを作成" }));

    expect(onBulkAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("即売会名")).toHaveValue("既存イベント");
    expect(getTextarea("M列 サークル名")).toHaveValue("サークルA");
    expect(getTextarea("W列 備考")).toHaveValue("取り置き希望");
  });

  it("保存待ち中の新しい7列貼付けを古い要求の成功で消さず、再送できる", async () => {
    let complete!: (result: { status: "saved" }) => void;
    const onBulkAdd = vi
      .fn<ComponentProps<typeof ImportScreen>["onBulkAdd"]>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue({ status: "saved" });
    renderImportScreen(onBulkAdd);
    fireEvent.change(screen.getByLabelText("即売会名"), {
      target: { value: "イベント" },
    });
    pasteIntoCircle("サークルA\t1日目\t東A\t01a\t新刊\t1000\t最初の入力");
    fireEvent.click(screen.getByRole("button", { name: "リストを作成" }));
    const request = onBulkAdd.mock.calls[0][2]!.request!;
    expect(request.isCurrent?.()).toBe(true);
    fireEvent.change(getTextarea("URL（7列貼り付け対象外）"), {
      target: {
        value: "https://b.example\nhttps://blank.example\nhttps://c.example",
      },
    });
    pasteIntoCircle(
      "サークルB\t2日目\t西B\t02b\t既刊\t500\t次の入力\n\n" +
        "サークルC\t3日目\t南C\t03a\t新刊\t800\t追加の入力",
    );
    expect(request.isCurrent?.()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "リストを作成" }));
    expect(onBulkAdd).toHaveBeenCalledTimes(1);
    await act(async () => complete({ status: "saved" }));
    expect(getTextarea("M列 サークル名")).toHaveValue("サークルB\n\nサークルC");
    expect(getTextarea("W列 備考")).toHaveValue("次の入力\n\n追加の入力");
    expect(getTextarea("URL（7列貼り付け対象外）")).toHaveValue(
      "https://b.example\nhttps://blank.example\nhttps://c.example",
    );
    fireEvent.click(screen.getByRole("button", { name: "リストを作成" }));
    await waitFor(() => expect(getTextarea("M列 サークル名")).toHaveValue(""));
    expect(onBulkAdd.mock.calls[1][1]).toEqual([
      expect.objectContaining({
        circle: "サークルB",
        eventDate: "2日目",
        title: "既刊",
        remarks: "次の入力",
        url: "https://b.example",
      }),
      expect.objectContaining({
        circle: "サークルC",
        eventDate: "3日目",
        title: "新刊",
        remarks: "追加の入力",
        url: "https://c.example",
      }),
    ]);
  });
  it("新規URL取込でも不正数量の行を丸めず除外する", async () => {
    const makeCsvRow = (number: string, quantity: string) => {
      const cells = Array.from({ length: 27 }, () => "");
      cells[12] = "サークルA";
      cells[13] = "1日目";
      cells[14] = "東A";
      cells[15] = number;
      cells[16] = "新刊";
      cells[17] = "1000";
      cells[22] = "備考";
      cells[26] = quantity;
      return cells.join(",");
    };
    const csv = [
      Array.from({ length: 27 }, (_, index) =>
        index === 12 ? "サークル名" : `列${index}`,
      ).join(","),
      makeCsvRow("01a", "20"),
      makeCsvRow("02a", "21"),
    ].join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(csv),
      }),
    );
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onBulkAdd = vi.fn<ComponentProps<typeof ImportScreen>["onBulkAdd"]>(
      async () => ({ status: "saved" }) as const,
    );
    renderImportScreen(onBulkAdd);
    fireEvent.change(screen.getByLabelText("即売会名"), {
      target: { value: "新イベント" },
    });
    fireEvent.change(
      screen.getByLabelText("スプレッドシートURLからインポート"),
      {
        target: {
          value: "https://docs.google.com/spreadsheets/d/example-document/edit",
        },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "URLからインポート" }));

    await waitFor(() => expect(onBulkAdd).toHaveBeenCalledTimes(1));
    const importedItems = onBulkAdd.mock.calls[0][1];
    expect(importedItems).toHaveLength(1);
    expect(importedItems[0]).toMatchObject({ number: "01a", quantity: 20 });
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("21"));
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining("1行は取り込みませんでした"),
    );
  });
});
