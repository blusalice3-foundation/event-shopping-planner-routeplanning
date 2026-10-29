type Sample = {
  operation: string;
  phase: "input" | "paint" | "save";
  durationMs: number;
  sequence: number;
};
export type ShoppingMoveLifecyclePhase =
  | "move-command-entry"
  | "plan-ready"
  | "queue-accepted"
  | "ui-apply-start"
  | "ui-apply-success"
  | "ui-apply-failure";
export interface ShoppingMoveLifecycleRecord {
  readonly phase: ShoppingMoveLifecyclePhase;
  readonly atMs: number;
  readonly epochMs: number;
  /** Diagnostic command token; never a persistence operation ID. */
  readonly diagnosticToken?: string;
  readonly draggedItemId?: string;
  readonly sourceColumn?: string;
  readonly targetColumn?: string;
  readonly operationId?: string;
  readonly moveId?: string;
}
interface ShoppingMoveLifecycleScope {
  readonly diagnosticToken: string;
  readonly draggedItemId: string;
  readonly sourceColumn?: string;
  readonly targetColumn?: string;
  readonly generation: number;
  readonly previous?: ShoppingMoveLifecycleScope;
}
type ShoppingMoveLifecycleLink = Omit<
  ShoppingMoveLifecycleRecord,
  "phase" | "atMs" | "epochMs"
>;
// No lifecycle maps, arrays or tokens are allocated on the disabled path.
let lifecycle: ShoppingMoveLifecycleRecord[] | undefined;
let acceptedMoveLinks: Map<string, ShoppingMoveLifecycleLink> | undefined;
let activeMoveScope: ShoppingMoveLifecycleScope | undefined;
let lifecycleSequence = 0;
const LIMIT = 500;
let enabled = false;
let sequence = 0;
let generation = 0;
const samples: Sample[] = [];
const renders = new Map<string, number>();
export const shoppingPerformance = {
  enable(value = true) {
    enabled = value;
    if (!enabled) activeMoveScope = undefined;
  },
  reset() {
    samples.length = 0;
    renders.clear();
    if (lifecycle) lifecycle.length = 0;
    acceptedMoveLinks?.clear();
    activeMoveScope = undefined;
    generation++;
  },
  read() {
    const groups = new Map<string, number[]>();
    for (const sample of samples) {
      const key = `${sample.operation}:${sample.phase}`;
      const group = groups.get(key) ?? [];
      group.push(sample.durationMs);
      groups.set(key, group);
    }
    return {
      samples: [...samples],
      lifecycle: lifecycle?.map((record) => ({ ...record })) ?? [],
      renders: Object.fromEntries(renders),
      summary: Object.fromEntries(
        [...groups].map(([key, values]) => {
          values.sort((a, b) => a - b);
          return [
            key,
            {
              count: values.length,
              medianMs:
                (values[Math.floor((values.length - 1) / 2)] +
                  values[Math.floor(values.length / 2)]) /
                2,
              p95Ms: values[Math.ceil(values.length * 0.95) - 1],
            },
          ];
        }),
      ),
    };
  },
};
if (typeof window !== "undefined")
  Object.assign(window, { __espShoppingPerformance: shoppingPerformance });
export function measureShoppingOperation(
  operation: string,
  phase: Sample["phase"] = "input",
): () => void {
  if (!enabled) return () => {};
  const start = performance.now();
  const id = ++sequence;
  const acceptedGeneration = generation;
  let finished = false;
  return () => {
    if (finished || !enabled || acceptedGeneration !== generation) return;
    finished = true;
    const record = (samplePhase: Sample["phase"]) => {
      if (!enabled || acceptedGeneration !== generation) return;
      samples.push({
        operation,
        phase: samplePhase,
        durationMs: performance.now() - start,
        sequence: id,
      });
      if (samples.length > LIMIT) samples.splice(0, samples.length - LIMIT);
    };
    record(phase);
    if (phase === "input" && typeof requestAnimationFrame === "function")
      requestAnimationFrame(() => setTimeout(() => record("paint"), 0));
  };
}
export function recordShoppingRender(component: string): void {
  if (enabled) renders.set(component, (renders.get(component) ?? 0) + 1);
}
function lifecycleLink(
  scope: ShoppingMoveLifecycleScope | undefined,
): ShoppingMoveLifecycleLink {
  return scope
    ? {
        diagnosticToken: scope.diagnosticToken,
        draggedItemId: scope.draggedItemId,
        sourceColumn: scope.sourceColumn,
        targetColumn: scope.targetColumn,
      }
    : {};
}
function recordLifecycle(
  phase: ShoppingMoveLifecyclePhase,
  link: ShoppingMoveLifecycleLink,
): void {
  if (!enabled) return;
  try {
    const atMs = performance.now();
    const records = (lifecycle ??= []);
    records.push({
      ...link,
      phase,
      atMs,
      epochMs: performance.timeOrigin + atMs,
    });
    if (records.length > LIMIT) records.splice(0, records.length - LIMIT);
  } catch {
    // Diagnostic allocation, clocks and observers must never change an action.
  }
}
/** Synchronous command context only; it never issues a save ID or crosses await. */
export function beginShoppingMoveLifecycle(
  actualDragToken: symbol | undefined,
  draggedItemId: string,
  sourceColumn?: string,
  targetColumn?: string,
): ShoppingMoveLifecycleScope | undefined {
  if (!enabled || !actualDragToken) return undefined;
  try {
    const scope: ShoppingMoveLifecycleScope = {
      diagnosticToken:
        "shopping-diagnostic:" + generation + ":" + ++lifecycleSequence,
      draggedItemId,
      sourceColumn,
      targetColumn,
      generation,
      previous: activeMoveScope,
    };
    activeMoveScope = scope;
    recordLifecycle("move-command-entry", lifecycleLink(scope));
    return scope;
  } catch {
    return undefined;
  }
}
export function endShoppingMoveLifecycle(
  scope: ShoppingMoveLifecycleScope | undefined,
): void {
  if (!scope) return;
  if (activeMoveScope === scope)
    activeMoveScope =
      enabled && scope.generation === generation ? scope.previous : undefined;
}
/** A computed proposal exists; this deliberately does not imply acceptance. */
export function recordShoppingMovePlanReady(): void {
  if (!enabled || !activeMoveScope) return;
  try {
    recordLifecycle("plan-ready", lifecycleLink(activeMoveScope));
  } catch {
    // Diagnostics cannot turn a proposal into a failure.
  }
}
/** Only call after the real queue has accepted and issued its receipt IDs. */
export function recordAcceptedShoppingMove(
  operationId: string,
  moveId: string,
): void {
  if (!enabled) return;
  try {
    const link = {
      ...lifecycleLink(activeMoveScope),
      operationId,
      moveId,
    };
    const links = (acceptedMoveLinks ??= new Map());
    links.set(moveId, link);
    if (links.size > LIMIT) {
      const oldest = links.keys().next().value;
      if (oldest !== undefined) links.delete(oldest);
    }
    recordLifecycle("queue-accepted", link);
  } catch {
    // The real receipt remains accepted even if diagnostics cannot retain it.
  }
}
/** Success means the existing apply port returned, not React commit or paint. */
export function recordShoppingMoveUiApply(
  operationId: string,
  phase: "start" | "success" | "failure",
): void {
  if (!enabled || !acceptedMoveLinks) return;
  try {
    for (const link of acceptedMoveLinks.values()) {
      if (link.operationId !== operationId) continue;
      recordLifecycle(
        phase === "start"
          ? "ui-apply-start"
          : phase === "success"
            ? "ui-apply-success"
            : "ui-apply-failure",
        link,
      );
    }
  } catch {
    // Optional lifecycle diagnostics cannot affect committed-state adoption.
  }
}
