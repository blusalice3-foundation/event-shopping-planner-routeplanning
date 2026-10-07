import type { VirtualListEligibility } from "./virtualEligibility";

/**
 * Normal-flow placeholders have their own height and keep navigation anchors.
 * Activated content stays mounted, including during drag, dialogs and resize.
 * This is a separate capability from the absolute-positioned virtual renderer.
 */
export const evaluateRetainedViewportEligibility = (input: {
  readonly runtimeAvailable: boolean;
  readonly zoomPercent: number | null;
  readonly recoveryActive: boolean | null;
  readonly rowCount: number;
  readonly minimumRowCount: number;
  readonly stableRowKeys: boolean;
  readonly estimatedRowHeightPx: number;
}): VirtualListEligibility => {
  const fail = (
    reason: Extract<VirtualListEligibility, { eligible: false }>["reason"],
  ): VirtualListEligibility => ({ eligible: false, reason, rowHeightPx: null });
  if (!input.runtimeAvailable) return fail("runtime-unavailable");
  if (input.zoomPercent === null) return fail("zoom-unknown");
  if (input.zoomPercent !== 100) return fail("zoom-unsupported");
  if (input.recoveryActive === null) return fail("recovery-state-unknown");
  if (input.recoveryActive) return fail("recovery-active");
  if (!Number.isInteger(input.rowCount) || input.rowCount < 0)
    return fail("row-count-unknown");
  if (input.rowCount < input.minimumRowCount) return fail("list-too-short");
  if (!input.stableRowKeys) return fail("row-keys-unstable");
  return {
    eligible: true,
    reason: null,
    rowHeightPx: input.estimatedRowHeightPx,
  };
};
