import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBytes } from "../xlsx/download/downloadBytes";
import { downloadBlob } from "./downloadBlob";

const objectUrl = "blob:https://example.test/download";

const setupDownload = () => {
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click: vi.fn(),
    remove: vi.fn(),
  };
  const appendChild = vi.fn();
  vi.stubGlobal("document", {
    createElement: vi.fn(() => anchor),
    body: { appendChild },
  });
  const createObjectURL = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue(objectUrl);
  const revokeObjectURL = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => {});
  return { anchor, appendChild, createObjectURL, revokeObjectURL };
};

describe("file download lifetime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps JSON Blob bytes available after clicking and eventually releases the URL", async () => {
    const { anchor, appendChild, createObjectURL, revokeObjectURL } =
      setupDownload();
    const source = '{"event":"ユーザー登録","message":"エラーが発生しました"}';
    const blob = new Blob([source], { type: "application/json;charset=utf-8" });

    downloadBlob(blob, "イベント.json");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.href).toBe(objectUrl);
    expect(anchor.download).toBe("イベント.json");
    expect(anchor.rel).toBe("noopener");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(await blob.text()).toBe(source);
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
  });

  it("releases the URL immediately when the browser rejects starting the download", () => {
    const { anchor, revokeObjectURL } = setupDownload();
    const failure = new Error("download failed");
    anchor.click.mockImplementation(() => {
      throw failure;
    });

    expect(() => downloadBlob(new Blob(["backup"]), "backup.json")).toThrow(
      failure,
    );
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("downloads only the requested XLSX byte view with the shared deferred cleanup", async () => {
    const { anchor, createObjectURL, revokeObjectURL } = setupDownload();
    const backing = new Uint8Array([99, 80, 75, 3, 4, 88]);

    downloadBytes(backing.subarray(1, 5), "イベント.xlsx");

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([80, 75, 3, 4]),
    );
    expect(anchor.download).toBe("イベント.xlsx");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    backing.fill(0);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([80, 75, 3, 4]),
    );
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(objectUrl);
  });
  it("isolates staggered successful downloads from a later failed download", () => {
    const { anchor, createObjectURL, revokeObjectURL } = setupDownload();
    const firstUrl = "blob:https://example.test/first";
    const secondUrl = "blob:https://example.test/second";
    const failedUrl = "blob:https://example.test/failed";
    createObjectURL
      .mockReturnValueOnce(firstUrl)
      .mockReturnValueOnce(secondUrl)
      .mockReturnValueOnce(failedUrl);

    downloadBlob(new Blob(["first backup"]), "first.json");
    vi.advanceTimersByTime(20_000);
    downloadBlob(new Blob(["second backup"]), "second.json");
    vi.advanceTimersByTime(10_000);
    anchor.click.mockImplementationOnce(() => {
      throw new Error("download failed");
    });
    expect(() =>
      downloadBlob(new Blob(["failed backup"]), "failed.json"),
    ).toThrow("download failed");

    expect(revokeObjectURL.mock.calls).toEqual([[failedUrl]]);
    expect(vi.getTimerCount()).toBe(2);
    expect(anchor.click).toHaveBeenCalledTimes(3);
    expect(anchor.remove).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(29_999);
    expect(revokeObjectURL.mock.calls).toEqual([[failedUrl]]);
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL.mock.calls).toEqual([[failedUrl], [firstUrl]]);
    vi.advanceTimersByTime(19_999);
    expect(revokeObjectURL.mock.calls).toEqual([[failedUrl], [firstUrl]]);
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL.mock.calls).toEqual([
      [failedUrl],
      [firstUrl],
      [secondUrl],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.runIf(typeof SharedArrayBuffer === "function")(
    "captures only a SharedArrayBuffer subview without changing its downloaded bytes",
    async () => {
      const { createObjectURL } = setupDownload();
      const backing = new Uint8Array(new SharedArrayBuffer(6));
      backing.set([99, 80, 75, 3, 4, 88]);

      downloadBytes(backing.subarray(1, 5), "shared.xlsx");

      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
        new Uint8Array([80, 75, 3, 4]),
      );
      backing.fill(0);
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
        new Uint8Array([80, 75, 3, 4]),
      );
    },
  );
});
