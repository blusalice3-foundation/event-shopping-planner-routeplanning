export type FocusPhase = "normal" | "postponed" | "late";

export interface FocusModeAddItemResult {
  newItemId: string;
  placement?: "positioned" | "merged-into-existing-visit";
  mergedIntoVisitItemIds?: string[];
}

/** Legacy string IDs remain accepted while callers migrate to placement metadata. */
export type FocusModeAddItemReturn = string | FocusModeAddItemResult | void;

export type FocusMapCenteringMode = "prevToCurrent" | "currentOnly";

export interface FocusMapViewportSnapshot {
  offsetX: number;
  offsetY: number;
  zoomLevel: number;
  rotationAngle: number;
}

export interface FocusMapViewportRestoreRequest {
  snapshot: FocusMapViewportSnapshot;
  revision: number;
}

export interface FocusModeSessionState {
  phase: FocusPhase;
  phaseIndex: number;
  savedPhaseIndices: Record<FocusPhase, number>;
  postponedItemIds: string[];
  lateItemIds: string[];
  isCompleted: boolean;
  lastPurchaseChangeAt?: {
    phase: FocusPhase;
    phaseIndex: number;
    visitKey: string;
  } | null;
}
