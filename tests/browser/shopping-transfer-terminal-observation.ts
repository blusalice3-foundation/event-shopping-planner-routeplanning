import { execFileSync } from "node:child_process";

export type TerminalObservedCommit = {
  at: number;
  stores: string[];
  operationId?: string;
  writes: unknown[];
};

export const terminalBaselineProduct = {
  referenceProductCommit: "200cd7564772a17e2264907ae22e9a93ad30f5dc",
  sourceTree: "4155d4dc250e69b16be9a0455bd99a208b9f8d93",
  publicTree: "90071a462092c45bc3ae11df5e696a053fc8a1ed",
} as const;

export type TerminalBaselineObservation = {
  phase: string;
  sourceCommit: string;
  referenceProductCommit: string;
  sourceTree: string;
  publicTree: string;
  sourceState: string;
};

export function isTerminalBaselineObservation(
  observation: TerminalBaselineObservation | undefined,
): boolean {
  return (
    observation?.phase === "before" &&
    /^[a-f0-9]{40}$/.test(observation.sourceCommit) &&
    observation.sourceState === "clean" &&
    observation.referenceProductCommit ===
      terminalBaselineProduct.referenceProductCommit &&
    observation.sourceTree === terminalBaselineProduct.sourceTree &&
    observation.publicTree === terminalBaselineProduct.publicTree
  );
}

/** Resolve source identity before preparation; after measurements do not invoke Git. */
export function resolveBaselineProductObservation({
  phase = process.env.ESP_EVIDENCE_PHASE,
  cwd = process.cwd(),
  git = (args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim(),
}: {
  phase?: string;
  cwd?: string;
  git?: (args: string[]) => string;
} = {}): TerminalBaselineObservation | undefined {
  if (phase !== "before") return undefined;
  const observation = {
    ...terminalBaselineProduct,
    phase,
    sourceCommit: git(["rev-parse", "HEAD"]),
    sourceTree: git(["rev-parse", "HEAD:src"]),
    publicTree: git(["rev-parse", "HEAD:public"]),
    sourceState:
      git([
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        "src",
        "public",
      ]) === ""
        ? "clean"
        : "dirty",
  };
  return isTerminalBaselineObservation(observation) ? observation : undefined;
}

export type TerminalWritePostconditionError = {
  measurementId: string;
  sampleIndex: number;
  code: "unexpected-noop-write";
  itemIds: string[];
  message: string;
  expectedWriteCount: 0;
  actualWriteCount: number;
};

/** A comparison-only observation preserves an actual write; it never passes acceptance. */
export function terminalWritePostconditions({
  observation,
  scenario,
  sampleIndex,
  measurementId,
  targetId,
  commits,
}: {
  observation?: TerminalBaselineObservation;
  scenario: string;
  sampleIndex: number;
  measurementId: string;
  targetId: string;
  commits: readonly TerminalObservedCommit[];
}): TerminalWritePostconditionError[] {
  if (
    !isTerminalBaselineObservation(observation) ||
    scenario !== "noop" ||
    commits.length === 0
  )
    return [];
  return [
    {
      measurementId,
      sampleIndex,
      code: "unexpected-noop-write",
      itemIds: [targetId],
      message: `Noop expected zero persistence transactions; observed ${commits.length}`,
      expectedWriteCount: 0,
      actualWriteCount: commits.length,
    },
  ];
}

export type TerminalPersistenceSample = {
  sampleIndex: number;
  measurementId: string;
  physicalWriteCount: number;
  operationId: string | null;
  commits: TerminalObservedCommit[];
};

export function terminalPersistenceObservation(
  samples: readonly TerminalPersistenceSample[],
) {
  return {
    writeCount: samples.reduce(
      (count, sample) => count + sample.commits.length,
      0,
    ),
    operationId: null,
    commits: samples.flatMap((sample) => sample.commits),
    samples,
  };
}
