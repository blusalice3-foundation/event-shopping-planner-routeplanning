import { downloadBlob } from "../../utils/downloadBlob";

export const downloadBytes = (
  bytes: Uint8Array,
  fileName: string,
  mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
): void => {
  const payload =
    bytes.buffer instanceof ArrayBuffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : new Uint8Array(bytes);
  downloadBlob(new Blob([payload], { type: mimeType }), fileName);
};
