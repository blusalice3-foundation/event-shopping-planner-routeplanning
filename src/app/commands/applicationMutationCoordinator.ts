import type {
  ApplicationSnapshotRead,
  PersistenceSnapshot,
} from "../ports/PersistenceCommandPort";

export function semanticSignature(value: unknown): string {
  const canonical = (entry: unknown): unknown =>
    Array.isArray(entry)
      ? entry.map(canonical)
      : entry !== null && typeof entry === "object"
        ? Object.fromEntries(
            Object.entries(entry)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, nested]) => [key, canonical(nested)]),
          )
        : entry;
  return JSON.stringify(canonical(value));
}
export interface MutationConfirmation {
  title: string;
  details: string[];
  comparison: unknown;
}
export interface MutationPlan {
  snapshot: PersistenceSnapshot;
  confirmation?: MutationConfirmation;
  invalidatedEvents?: string[];
}
export interface MutationIntent {
  id: string;
  events: string[];
  expectedGenerations?: Record<string, number>;
  plan(snapshot: PersistenceSnapshot): MutationPlan;
}
export interface ConfirmationToken {
  readonly operationId: string;
  readonly generation: string;
  readonly signature: string;
  readonly sequence: number;
}
export type MutationResult =
  | { status: "committed"; snapshot: PersistenceSnapshot }
  | {
      status: "confirmation-required";
      token: ConfirmationToken;
      confirmation: MutationConfirmation;
    }
  | { status: "cancelled" | "expired" };
export class MutationConflictError extends Error {
  constructor() {
    super("保存の競合が続いています。最新の内容を確認して再試行してください。");
    this.name = "MutationConflict";
  }
}
export class CommittedStateApplyError extends Error {
  constructor(readonly cause: unknown) {
    super(
      "保存は完了しましたが画面の更新に失敗しました。再読み込みしてください。",
    );
    this.name = "CommittedStateApplyError";
  }
}
export interface MutationCoordinatorPorts {
  readCurrent(): PersistenceSnapshot;
  drain(): Promise<void>;
  readDurable(): Promise<ApplicationSnapshotRead>;
  commit(snapshot: PersistenceSnapshot, expectedRoots: object): Promise<void>;
  apply(snapshot: PersistenceSnapshot, invalidatedEvents: string[]): void;
  onApplyFailure?(error: CommittedStateApplyError): void;
  onExpired?(operationIds: string[]): void;
}
/** One queue owns calculation, CAS, persistence, and successful state application. */
export function createApplicationMutationCoordinator(
  ports: MutationCoordinatorPorts,
) {
  let tail: Promise<unknown> = Promise.resolve();
  let sequence = 0;
  let stopped = false;
  const generations = new Map<string, number>();
  const pending = new Map<
    string,
    { intent: MutationIntent; generation: string; token?: ConfirmationToken }
  >();
  const completed = new Set<string>();
  const generation = (events: string[]) =>
    semanticSignature(
      events.map((event) => [event, generations.get(event) ?? 0]),
    );
  function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const result = tail.then(() => {
      if (stopped) throw new Error("保存済み状態を再読み込みしてください。");
      return task();
    });
    tail = result.catch(() => undefined);
    return result;
  }
  function invalidate(events: string[]): void {
    for (const event of events)
      generations.set(event, (generations.get(event) ?? 0) + 1);
  }
  async function execute(
    id: string,
    confirmation?: ConfirmationToken,
  ): Promise<MutationResult> {
    if (completed.has(id))
      return { status: "committed", snapshot: ports.readCurrent() };
    const operation = pending.get(id);
    if (
      !operation ||
      operation.generation !== generation(operation.intent.events)
    ) {
      pending.delete(id);
      return { status: "expired" };
    }
    if (confirmation && operation.token !== confirmation)
      return { status: "expired" };
    // Confirmation never keeps a transaction or this queue occupied.
    await ports.drain();
    for (let attempt = 0; attempt < 3; attempt++) {
      const read = await ports.readDurable();
      if (operation.generation !== generation(operation.intent.events))
        return { status: "expired" };
      // drain persisted every earlier accepted single-store intent. The coherent
      // read now includes other tabs; apply this intent to exactly those roots.
      const plan = operation.intent.plan(structuredClone(read.snapshot));
      if (plan.confirmation) {
        const signature = semanticSignature(plan.confirmation.comparison);
        if (!confirmation || confirmation.signature !== signature) {
          const token: ConfirmationToken = {
            operationId: id,
            generation: operation.generation,
            signature,
            sequence: ++sequence,
          };
          operation.token = token;
          return {
            status: "confirmation-required",
            token,
            confirmation: plan.confirmation,
          };
        }
      }
      try {
        await ports.commit(plan.snapshot, read.expectedRoots);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "PersistenceConflict" ||
            error.name === "PersistenceConflictError")
        )
          continue;
        throw error;
      }
      invalidate(plan.invalidatedEvents ?? []);
      const result: MutationResult = {
        status: "committed",
        snapshot: plan.snapshot,
      };
      completed.add(id);
      pending.delete(id);
      try {
        ports.apply(plan.snapshot, plan.invalidatedEvents ?? []);
      } catch (error) {
        stopped = true;
        const failure = new CommittedStateApplyError(error);
        ports.onApplyFailure?.(failure);
        throw failure;
      }
      const expired = [...pending]
        .filter(
          ([, value]) => value.generation !== generation(value.intent.events),
        )
        .map(([operationId]) => operationId);
      for (const operationId of expired) pending.delete(operationId);
      if (expired.length) ports.onExpired?.(expired);
      return result;
    }
    throw new MutationConflictError();
  }
  return {
    enqueue,
    request(intent: MutationIntent): Promise<MutationResult> {
      if (
        intent.expectedGenerations &&
        Object.entries(intent.expectedGenerations).some(
          ([event, expected]) => (generations.get(event) ?? 0) !== expected,
        )
      )
        return Promise.resolve({ status: "expired" });
      if (!pending.has(intent.id) && !completed.has(intent.id))
        pending.set(intent.id, {
          intent,
          generation: generation(intent.events),
        });
      return enqueue(() => execute(intent.id));
    },
    confirm(token: ConfirmationToken): Promise<MutationResult> {
      return enqueue(() => execute(token.operationId, token));
    },
    cancel(token: ConfirmationToken): void {
      if (pending.get(token.operationId)?.token === token)
        pending.delete(token.operationId);
    },
    invalidate,
    generation: (event: string): number => generations.get(event) ?? 0,
    // Wait for earlier mutations, then preserve the accepted in-memory values.
    // Export is read-only and must remain available when persistence fails.
    readExportSnapshot: (): Promise<PersistenceSnapshot> =>
      enqueue(() => structuredClone(ports.readCurrent())),
  };
}
