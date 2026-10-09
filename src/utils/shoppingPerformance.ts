type Sample = {
  operation: string;
  phase: "input" | "paint" | "save";
  durationMs: number;
  sequence: number;
};
const LIMIT = 500;
let enabled = false;
let sequence = 0;
let generation = 0;
const samples: Sample[] = [];
const renders = new Map<string, number>();
export const shoppingPerformance = {
  enable(value = true) {
    enabled = value;
  },
  reset() {
    samples.length = 0;
    renders.clear();
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
      renders: Object.fromEntries(renders),
      summary: Object.fromEntries(
        [...groups].map(([key, values]) => {
          values.sort((a, b) => a - b);
          return [
            key,
            {
              count: values.length,
              medianMs: values[Math.ceil(values.length * 0.5) - 1],
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
