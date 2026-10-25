import {
  isTerminalBaselineObservation,
  type TerminalBaselineObservation,
  type TerminalObservedCommit,
} from "./shopping-transfer-terminal-observation.ts";

type FrameObservationRect = {
  itemId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role: "source-gap" | "source-origin" | "destination-card";
};
export type FrameObservationFailureCode =
  | "identity-clipped"
  | "no-content-verified-frame";
export type FrameObservationCapture = {
  index: number;
  framePath: string;
  frameSha256: string;
  sessionId: number;
  acknowledged: boolean;
  metadata: { timestamp?: number; [key: string]: unknown };
};
export type FrameObservationEvidence = {
  postInput: true;
  trusted: boolean;
  matched: boolean;
  startEpoch: number;
  domMs: number | null;
  markerDelayMs: number;
  commits: TerminalObservedCommit[];
  sourceRects: FrameObservationRect[];
  targetRects: FrameObservationRect[];
  captures: FrameObservationCapture[];
  guard?: {
    itemId: string;
    actualHeight: number;
    minimumHeightExclusive: 20;
  };
  candidateCount?: number;
  inputMarkerCount?: number;
  inputMarker?: { pid: number; ts: number };
  domMarker?: { pid: number; ts: number };
  tracePath?: string;
  traceSha256?: string;
  baselinePath?: string;
  baselineSha256?: string;
  referencePath?: string;
  referenceSha256?: string;
  verificationPath?: string;
  verificationSha256?: string;
  failedObservationPath?: string;
  failedObservationSha256?: string;
  failureScreenshotPath?: string;
  failureScreenshotSha256?: string;
  failureDomPath?: string;
  failureDomSha256?: string;
  durableProof?: unknown;
  scenarioEvidence?: Record<string, unknown>;
  expectedTransferredIds?: readonly string[];
};

/** A failed post-input observation is not a measured frame or a product verdict. */
export class FrameObservationError extends Error {
  readonly code: FrameObservationFailureCode;
  readonly measurementId: string;
  readonly evidence: FrameObservationEvidence;
  constructor(
    code: FrameObservationFailureCode,
    measurementId: string,
    message: string,
    evidence: FrameObservationEvidence,
  ) {
    super(message);
    if (
      !["identity-clipped", "no-content-verified-frame"].includes(code) ||
      !measurementId ||
      evidence.postInput !== true ||
      evidence.trusted !== true ||
      evidence.matched !== true
    )
      throw new Error("Unknown or pre-input frame observation failure");
    this.name = "FrameObservationError";
    this.code = code;
    this.measurementId = measurementId;
    this.evidence = evidence;
  }
}
export type BaselineFrameObservation = {
  sampleIndex: number;
  measurementId: string;
  fixtureHash: string;
  effectiveIds: string[];
} & (
  | { outcome: "completed"; durationMs: number; failure?: never }
  | {
      outcome: "endpoint-unobservable";
      durationMs?: never;
      failure: {
        code: FrameObservationFailureCode;
        message: string;
        evidence: FrameObservationEvidence;
      };
    }
);

export function canRecordBaselineFrameObservation(
  error: unknown,
  phase: string | undefined,
  measurementKind: "response" | "frame",
  condition: { count: number; scenario?: string },
  observation: TerminalBaselineObservation | undefined,
): error is FrameObservationError {
  if (
    phase !== "before" ||
    measurementKind !== "frame" ||
    condition.count !== 500 ||
    condition.scenario !== "range" ||
    !isTerminalBaselineObservation(observation) ||
    !(error instanceof FrameObservationError)
  )
    return false;
  const evidence = error.evidence;
  const file = (
    name:
      | "trace"
      | "baseline"
      | "failedObservation"
      | "reference"
      | "verification",
  ) =>
    typeof evidence[`${name}Path`] === "string" &&
    /^[a-f0-9]{64}$/.test(evidence[`${name}Sha256`] ?? "");
  return (
    evidence.postInput === true &&
    evidence.trusted === true &&
    evidence.matched === true &&
    evidence.inputMarkerCount === 1 &&
    Number.isFinite(evidence.inputMarker?.pid) &&
    Number.isFinite(evidence.inputMarker?.ts) &&
    Number.isFinite(evidence.domMarker?.ts) &&
    evidence.inputMarker!.pid === evidence.domMarker?.pid &&
    evidence.domMarker!.ts >= evidence.inputMarker!.ts &&
    (error.code === "identity-clipped"
      ? evidence.guard?.minimumHeightExclusive === 20 &&
        Number.isFinite(evidence.guard.actualHeight) &&
        evidence.guard.actualHeight <= 20 &&
        evidence.targetRects.some(
          (rect) =>
            rect.itemId === evidence.guard!.itemId &&
            rect.height === evidence.guard!.actualHeight,
        )
      : file("reference") &&
        file("verification") &&
        Number.isInteger(evidence.candidateCount) &&
        evidence.candidateCount! >= 0) &&
    file("trace") &&
    file("baseline") &&
    file("failedObservation") &&
    evidence.captures.length > 0 &&
    evidence.captures.every(
      (capture) =>
        capture.acknowledged === true &&
        typeof capture.framePath === "string" &&
        /^[a-f0-9]{64}$/.test(capture.frameSha256),
    ) &&
    evidence.captures.some((capture) =>
      Number.isFinite(capture.metadata.timestamp),
    )
  );
}

/** One record per original fixture index; failed clocks never get a numeric value. */
export function appendBaselineFrameObservation(
  observations: BaselineFrameObservation[],
  observation: BaselineFrameObservation,
) {
  if (
    observation.sampleIndex !== observations.length + 1 ||
    observation.sampleIndex > 20 ||
    observations.some(
      (entry) => entry.measurementId === observation.measurementId,
    ) ||
    !observation.measurementId ||
    !["completed", "endpoint-unobservable"].includes(observation.outcome) ||
    !Array.isArray(observation.effectiveIds) ||
    observation.effectiveIds.length !== 3 ||
    new Set(observation.effectiveIds).size !==
      observation.effectiveIds.length ||
    !/^[a-f0-9]{64}$/.test(observation.fixtureHash) ||
    (observation.outcome === "completed"
      ? !Number.isFinite(observation.durationMs) ||
        observation.durationMs < 0 ||
        !!observation.failure
      : "durationMs" in observation || !observation.failure)
  )
    throw new Error("Invalid or repeated original baseline frame attempt");
  observations.push(observation);
}
