export const downloadBlob = (blob: Blob, fileName: string): void => {
  const anchor = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  let started = false;
  try {
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    started = true;
  } finally {
    anchor.remove();
    if (started) {
      // Safari may resolve the Blob after click() returns. Keep it alive while
      // the browser starts the download, then release it for long-lived PWAs.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } else {
      URL.revokeObjectURL(objectUrl);
    }
  }
};
