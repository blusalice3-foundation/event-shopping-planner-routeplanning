/** Ephemeral import outcome; opening a review is not a saved import. */
export type BulkImportResult =
  | { status: "saved" }
  | { status: "no-additions" | "cancelled" | "invalidated" | "failed" }
  | { status: "committed-ui-failed" | "unknown" };
export interface BulkImportRequest {
  id: string;
  isCurrent?(): boolean;
  progress?(phase: "review" | "saving"): void;
}
