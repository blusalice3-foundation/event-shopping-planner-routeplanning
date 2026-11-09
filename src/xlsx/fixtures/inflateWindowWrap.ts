import fixture from "./inflate-window-wrap-tail.v1.json";

export const INFLATE_REGRESSION_ENTRY = "xl/inflate-window-wrap-regression.xml";
export const inflateRegressionFixture = fixture;

// Synthetic upstream corpus; no user workbook or user content is retained here.
// Keep the compressed bytes fixed: changing zlib/chunk boundaries can hide the bug.
export const expectedInflateRegressionXml = (): Uint8Array => {
  const fragments = [
    "if (state->mode == LEN) {",
    "strm->msg = (char *)",
    "state->offset = (unsigned)",
    "return Z_DATA_ERROR;",
    "unsigned char FAR *from;",
    "state->length = (unsigned)here.val;",
    "hold += (unsigned long)(*next++) << bits;",
    "bits += 8;",
    "case LENLENS:",
    "break;",
    "}",
    "\n",
  ];
  let seed = fixture.generation.seed;
  const parts: string[] = [];
  for (let index = 0; index < fixture.generation.count; index += 1) {
    // Deliberately matches the upstream JS-number PRNG, including rounding.
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    parts.push(fragments[seed % fragments.length]);
    if (index % 12 === 11) parts.push("\n");
  }
  return new TextEncoder().encode(
    '<?xml version="1.0"?><inflate-regression><!--' +
      parts.join(" ") +
      "--></inflate-regression>",
  );
};

export const inflateRegressionCompressedBytes = (): Uint8Array =>
  Uint8Array.from(atob(fixture.compressedBase64), (value) =>
    value.charCodeAt(0),
  );

// Append one deflated, unused XML part without recompressing the fixed corpus.
// Existing local records retain their offsets and all original workbook bytes.
export const addInflateRegressionPart = (
  workbook: Uint8Array,
  corruption?: "crc" | "payload",
): Uint8Array => {
  const original = new DataView(
    workbook.buffer,
    workbook.byteOffset,
    workbook.byteLength,
  );
  let eocd = workbook.byteLength - 22;
  while (
    eocd >= 0 &&
    (original.getUint32(eocd, true) !== 0x06054b50 ||
      eocd + 22 + original.getUint16(eocd + 20, true) !== workbook.byteLength)
  ) {
    eocd -= 1;
  }
  if (eocd < 0) throw new Error("Fixture requires an ordinary ZIP archive.");
  const entryCount = original.getUint16(eocd + 10, true);
  const centralSize = original.getUint32(eocd + 12, true);
  const centralOffset = original.getUint32(eocd + 16, true);
  if (
    entryCount === 0xffff ||
    centralOffset + centralSize !== eocd ||
    original.getUint16(eocd + 4, true) !== 0 ||
    original.getUint16(eocd + 6, true) !== 0
  ) {
    throw new Error("Fixture does not support ZIP64 or split archives.");
  }

  const payload = inflateRegressionCompressedBytes();
  if (corruption === "payload") payload[Math.floor(payload.length / 2)] ^= 0x40;
  const signature =
    (Number.parseInt(fixture.uncompressedCrc32, 16) ^
      (corruption === "crc" ? 0xffffffff : 0)) >>>
    0;
  const name = new TextEncoder().encode(INFLATE_REGRESSION_ENTRY);
  const local = new Uint8Array(30 + name.length + payload.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0x0800, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, signature, true);
  lv.setUint32(18, payload.length, true);
  lv.setUint32(22, fixture.uncompressedBytes, true);
  lv.setUint16(26, name.length, true);
  local.set(name, 30);
  local.set(payload, 30 + name.length);

  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x0800, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, signature, true);
  cv.setUint32(20, payload.length, true);
  cv.setUint32(24, fixture.uncompressedBytes, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(42, centralOffset, true);
  central.set(name, 46);

  const output = new Uint8Array(
    workbook.length + local.length + central.length,
  );
  output.set(workbook.subarray(0, centralOffset));
  output.set(local, centralOffset);
  output.set(
    workbook.subarray(centralOffset, eocd),
    centralOffset + local.length,
  );
  output.set(central, eocd + local.length);
  const newEocd = eocd + local.length + central.length;
  output.set(workbook.subarray(eocd), newEocd);
  const ov = new DataView(output.buffer);
  ov.setUint16(newEocd + 8, entryCount + 1, true);
  ov.setUint16(newEocd + 10, entryCount + 1, true);
  ov.setUint32(newEocd + 12, centralSize + central.length, true);
  ov.setUint32(newEocd + 16, centralOffset + local.length, true);
  return output;
};
