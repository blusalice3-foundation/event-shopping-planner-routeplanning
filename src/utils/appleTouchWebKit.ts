/** iPadOS can identify itself as a Mac; limit the workaround to touch WebKit. */
export function isAppleTouchWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /AppleWebKit/i.test(navigator.userAgent) &&
    (/iPad|iPhone|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
  );
}
