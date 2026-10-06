import { describe, expect, it, vi } from "vitest";
import {
  createSyntheticRoot,
  prepareMetadataForPayload,
  validatePersistenceSnapshot,
} from "./persistenceCore";
import {
  buildMapDataPuts,
  validateMapSnapshot,
} from "../repositories/mapRepository";
import { normalizeMapDataForPersistence } from "../../utils/mapDataPersistence";
import { canonicalStringifyPersistencePayload } from "../../utils/persistenceResilience";

describe("prepareMetadataForPayload", () => {
  it("共有canonical表現から従来と同一のSHA-256とFNV-1A-64を生成する", async () => {
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");
    const metadata = await prepareMetadataForPayload(
      "eventLists",
      "data",
      {
        z: [1, "日本語", { beta: false, alpha: null }],
        a: "イベント",
      },
      "base-revision",
      "fixed-revision",
    );

    expect(metadata.payloadDigest).toEqual({
      algorithm: "SHA-256",
      canonicalization: "esp-json-v1",
      value: "21137d49102dff1f091e8874e8d74a2356dbc16d3247858f0f83c747e90c9a40",
    });
    expect(metadata.payloadFingerprint).toEqual({
      algorithm: "FNV-1A-64",
      canonicalization: "esp-json-v1",
      canonicalLength: 54,
      value: "e91757f3a223ec6c",
    });
    expect(encodeSpy).toHaveBeenCalledTimes(1);
    encodeSpy.mockRestore();
  });
});

describe("shared integrity validation", () => {
  const payload = {
    a: "イベント",
    z: [1, "日本語", { alpha: null, beta: false }],
  };

  it("checks both descriptors with one encoding for stored and synthetic roots", async () => {
    const metadata = await prepareMetadataForPayload(
      "eventLists",
      "data",
      payload,
      null,
    );
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      const result = await validatePersistenceSnapshot("eventLists", "data", {
        payload,
        metadata,
        checkpoint: undefined,
      });
      expect(result).toMatchObject({
        validated: { data: payload, root: metadata },
      });
      expect(
        encode.mock.calls.filter(
          ([value]) => value === canonicalStringifyPersistencePayload(payload),
        ),
      ).toHaveLength(1);
      encode.mockClear();
      const synthetic = await createSyntheticRoot(
        "eventLists",
        "data",
        payload,
      );
      expect(synthetic.payloadDigest).toEqual(metadata.payloadDigest);
      expect(synthetic.payloadFingerprint).toEqual(metadata.payloadFingerprint);
      expect(
        encode.mock.calls.filter(
          ([value]) => value === canonicalStringifyPersistencePayload(payload),
        ),
      ).toHaveLength(1);
    } finally {
      encode.mockRestore();
    }
  });

  it.each(["payloadDigest", "payloadFingerprint"] as const)(
    "still rejects a mismatched %s",
    async (field) => {
      const metadata = await prepareMetadataForPayload(
        "eventLists",
        "data",
        payload,
        null,
      );
      metadata[field].value = "0".repeat(field === "payloadDigest" ? 64 : 16);
      const result = await validatePersistenceSnapshot("eventLists", "data", {
        payload,
        metadata,
        checkpoint: undefined,
      });
      expect(result).toHaveProperty("conflict");
    },
  );

  it("shares map encoding while retaining both checks", async () => {
    const data = normalizeMapDataForPersistence({
      event: {
        day: {
          maxRow: 1,
          maxCol: 1,
          cells: [
            {
              row: 1,
              col: 1,
              value: "日本語",
              backgroundColor: null,
              borders: { top: null, right: null, bottom: null, left: null },
            },
          ],
          mergedCells: [],
          blocks: [],
        },
      },
    });
    const metadata = await prepareMetadataForPayload(
      "mapData",
      "data",
      data,
      null,
    );
    const entries = Object.fromEntries(
      buildMapDataPuts(data).map(({ key, value }) => [key, value]),
    );
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      const result = await validateMapSnapshot({
        entries,
        metadata,
        checkpoint: undefined,
      });
      expect(result).toMatchObject({ validated: { data } });
      expect(
        encode.mock.calls.filter(
          ([value]) => value === canonicalStringifyPersistencePayload(data),
        ),
      ).toHaveLength(1);
    } finally {
      encode.mockRestore();
    }
    for (const field of ["payloadDigest", "payloadFingerprint"] as const) {
      const corrupt = structuredClone(metadata);
      corrupt[field].value = "0".repeat(field === "payloadDigest" ? 64 : 16);
      expect(
        await validateMapSnapshot({
          entries,
          metadata: corrupt,
          checkpoint: undefined,
        }),
      ).toHaveProperty("conflict");
    }
  });
});
