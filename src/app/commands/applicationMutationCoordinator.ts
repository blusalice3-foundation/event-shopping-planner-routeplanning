import type {
  ApplicationSnapshotRead,
  ApplicationDayMutation,
  ApplicationBackupFile,
  PersistenceSnapshot,
  ItemContentEdit,
  ApplicationItemEditsResult,
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
export type MutationChoices = Readonly<Record<string, string>>;
export interface MutationChoice {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}
export interface MutationConfirmation {
  choices?: MutationChoice[];
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
  itemContentEdits?: readonly ItemContentEdit[];
  dayMutation?: ApplicationDayMutation;
  /** Keep ordinary accepted edits visible after persistence failures or exhausted CAS retries. */
  retainOnConflict?: boolean;
  plan(snapshot: PersistenceSnapshot, choices?: MutationChoices): MutationPlan;
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
export class MutationTargetMissingError extends Error {
  constructor() {
    super(
      "編集対象が削除されています。最新のイベント・マップを選び直して編集を開き直してください。",
    );
    this.name = "MutationTargetMissing";
  }
}
export class PendingAcceptedMutationError extends Error {
  constructor() {
    super("未保存で保留中の操作を再試行または取り消してから保存してください。");
    this.name = "PendingAcceptedMutation";
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
  readExportCurrent?(): PersistenceSnapshot;
  /** Overlay accepted, unsaved edits for planning; durable roots remain unchanged. */
  readMutationCurrent?(
    durable: PersistenceSnapshot,
    operationId: string,
  ): PersistenceSnapshot;
  hasPendingAcceptedChanges?(operationId: string): boolean;
  drain(): Promise<void>;
  readDurable(): Promise<ApplicationSnapshotRead>;
  commitItemContentEdits?(
    edits: readonly ItemContentEdit[],
    operationIds: readonly string[],
    expectedEventGenerations: Readonly<Record<string, number>>,
  ): Promise<ApplicationItemEditsResult>;
  createBackupFile?(
    base: PersistenceSnapshot,
    accepted: PersistenceSnapshot,
  ): Promise<ApplicationBackupFile>;
  commitDayMutation?(
    command: ApplicationDayMutation,
    operationId: string,
    expectedEventGenerations: Readonly<Record<string, number>>,
  ): Promise<ApplicationItemEditsResult>;
  commit(
    snapshot: PersistenceSnapshot,
    expectedRoots: object,
    base: PersistenceSnapshot,
    invalidatedEvents?: readonly string[],
  ): Promise<void>;
  apply(snapshot: PersistenceSnapshot, invalidatedEvents: string[]): void;
  onApplyFailure?(error: CommittedStateApplyError): void;
  onExpired?(operationIds: string[]): void;
}
function clearedConfirmation(
  previous: MutationConfirmation,
  before: PersistenceSnapshot,
  after: PersistenceSnapshot,
): MutationConfirmation {
  const changes: Array<{ path: string[]; before: unknown; after: unknown }> =
    [];
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const compare = (base: unknown, next: unknown, path: string[]) => {
    if (semanticSignature(base) === semanticSignature(next)) return;
    if (isRecord(base) && isRecord(next)) {
      for (const key of [
        ...new Set([...Object.keys(base), ...Object.keys(next)]),
      ].sort())
        compare(base[key], next[key], [...path, key]);
    } else changes.push({ path, before: base, after: next });
  };
  compare(before, after, []);
  const labels: Record<keyof PersistenceSnapshot, string> = {
    eventLists: "購入品目",
    eventConsistency: "所属・巡回設定",
    eventMetadata: "イベント設定",
    executeModeItems: "実行列",
    dayModes: "表示モード",
    mapData: "マップ",
    mapRotationSettings: "マップの回転",
    mapViewportSettings: "マップの表示位置",
    routeSettings: "経路設定",
    hallDefinitions: "ホール定義",
    hallRouteSettings: "ホール巡回設定",
  };
  return {
    title: previous.title,
    details: [
      "最新の状態では前回の確認対象が解消しています。以下の変更内容を改めて確認してください。",
      ...changes.map(
        (change) =>
          `${change.path.map((key, index) => (index === 0 ? labels[key as keyof PersistenceSnapshot] : key)).join(" / ")}: ${JSON.stringify(change.before) ?? "未設定"} → ${JSON.stringify(change.after) ?? "未設定"}`,
      ),
      ...(changes.length ? [] : ["保存する変更はありません。"]),
    ],
    comparison: { confirmationCleared: true, changes },
  };
}
/** One queue owns calculation, CAS, persistence, and successful state application. */
export function createApplicationMutationCoordinator(
  ports: MutationCoordinatorPorts,
) {
  let tail: Promise<unknown> = Promise.resolve();
  let sequence = 0;
  let stopped = false;
  const generations = new Map<string, number>();
  let durableGenerations: Readonly<Record<string, number>> = {};
  const durableGeneration = (
    values: Readonly<Record<string, number>>,
    event: string,
  ) =>
    Object.prototype.hasOwnProperty.call(values, event) ? values[event] : 0;
  const pending = new Map<
    string,
    {
      intent: MutationIntent;
      generation: string;
      token?: ConfirmationToken;
      choices: Record<string, string>;
      confirmation?: MutationConfirmation;
      committing?: boolean;
    }
  >();
  const completed = new Set<string>();
  let openItemBatch: {
    ids: string[];
    resolvers: Map<
      string,
      { resolve(result: MutationResult): void; reject(error: unknown): void }
    >;
  } | null = null;
  const generation = (events: string[]) =>
    semanticSignature(
      events.map((event) => [event, generations.get(event) ?? 0]),
    );
  function enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    openItemBatch = null;
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
  function expirePending(): void {
    const expired = [...pending]
      .filter(
        ([, value]) => value.generation !== generation(value.intent.events),
      )
      .map(([operationId]) => operationId);
    for (const operationId of expired) pending.delete(operationId);
    if (expired.length) ports.onExpired?.(expired);
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
    const validity = (): MutationResult | undefined => {
      if (pending.get(id) !== operation) return { status: "cancelled" };
      if (
        operation.generation !== generation(operation.intent.events) ||
        (confirmation && operation.token !== confirmation)
      )
        return { status: "expired" };
      return undefined;
    };
    // Confirmation never keeps a transaction or this queue occupied.
    await ports.drain();
    const afterDrain = validity();
    if (afterDrain) return afterDrain;
    if (
      operation.intent.dayMutation &&
      ports.commitDayMutation &&
      !operation.confirmation &&
      !confirmation &&
      !ports.hasPendingAcceptedChanges?.(id)
    ) {
      operation.committing = true;
      try {
        const result = await ports.commitDayMutation(
          operation.intent.dayMutation,
          id,
          durableGenerations,
        );
        if (result.status === "committed") {
          const nextGenerations =
            result.read.eventGenerations ?? durableGenerations;
          const invalidated = [
            ...new Set([
              ...Object.keys(durableGenerations),
              ...Object.keys(nextGenerations),
            ]),
          ].filter(
            (event) =>
              durableGeneration(durableGenerations, event) !==
              durableGeneration(nextGenerations, event),
          );
          durableGenerations = { ...nextGenerations };
          completed.add(id);
          pending.delete(id);
          invalidate(invalidated);
          try {
            ports.apply(result.read.snapshot, invalidated);
          } catch (error) {
            stopped = true;
            const failure = new CommittedStateApplyError(error);
            ports.onApplyFailure?.(failure);
            throw failure;
          }
          expirePending();
          return { status: "committed", snapshot: result.read.snapshot };
        }
      } finally {
        operation.committing = false;
      }
      const afterCommand = validity();
      if (afterCommand) return afterCommand;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const beforeRead = validity();
      if (beforeRead) return beforeRead;
      const read = await ports.readDurable();
      const nextGenerations = read.eventGenerations ?? durableGenerations;
      const externallyInvalidated = [
        ...new Set([
          ...Object.keys(durableGenerations),
          ...Object.keys(nextGenerations),
        ]),
      ].filter(
        (event) =>
          durableGeneration(durableGenerations, event) !==
          durableGeneration(nextGenerations, event),
      );
      durableGenerations = { ...nextGenerations };
      if (externallyInvalidated.length) {
        invalidate(externallyInvalidated);
        expirePending();
        try {
          ports.apply(structuredClone(read.snapshot), externallyInvalidated);
        } catch (error) {
          stopped = true;
          const failure = new CommittedStateApplyError(error);
          ports.onApplyFailure?.(failure);
          throw failure;
        }
      }
      if (operation.generation !== generation(operation.intent.events))
        return { status: "expired" };
      const afterRead = validity();
      if (afterRead) return afterRead;
      // Planning includes retained edits as well as the latest other-tab values.
      // They may be previewed, but must be saved or discarded before this commit.
      const current = structuredClone(read.snapshot);
      const planning = ports.readMutationCurrent?.(current, id) ?? current;
      // A previous review remains mandatory even if its original cause clears.
      // Capture the input before planners can mutate it in place.
      const before = operation.confirmation
        ? structuredClone(planning)
        : undefined;
      let plan: MutationPlan;
      try {
        plan = operation.intent.plan(planning, operation.choices);
      } catch (error) {
        if (error instanceof MutationTargetMissingError) {
          // The other tab's removal is durable. End stale sessions and adopt
          // that snapshot without writing any part of this proposed edit.
          pending.delete(id);
          invalidate(operation.intent.events);
          expirePending();
          ports.apply(structuredClone(read.snapshot), operation.intent.events);
        }
        throw error;
      }
      const review =
        plan.confirmation ??
        (operation.confirmation && before
          ? clearedConfirmation(operation.confirmation, before, plan.snapshot)
          : undefined);
      const afterPlan = validity();
      if (afterPlan) return afterPlan;
      if (review) {
        const signature = semanticSignature(review.comparison);
        if (!confirmation || confirmation.signature !== signature) {
          const token: ConfirmationToken = {
            operationId: id,
            generation: operation.generation,
            signature,
            sequence: ++sequence,
          };
          operation.token = token;
          operation.confirmation = review;
          return {
            status: "confirmation-required",
            token,
            confirmation: review,
          };
        }
      }
      if (ports.hasPendingAcceptedChanges?.(id))
        throw new PendingAcceptedMutationError();
      const beforeCommit = validity();
      if (beforeCommit) return beforeCommit;
      try {
        operation.committing = true;
        await ports.commit(
          plan.snapshot,
          read.expectedRoots,
          read.snapshot,
          plan.invalidatedEvents,
        );
      } catch (error) {
        operation.committing = false;
        const afterFailure = validity();
        if (afterFailure) return afterFailure;
        if (error instanceof CommittedStateApplyError) {
          stopped = true;
          ports.onApplyFailure?.(error);
          throw error;
        }
        if (
          error instanceof Error &&
          (error.name === "PersistenceConflict" ||
            error.name === "PersistenceConflictError")
        )
          continue;
        throw error;
      }
      durableGenerations = Object.fromEntries([
        ...Object.entries(durableGenerations),
        ...[...new Set(plan.invalidatedEvents ?? [])].map((event) => [
          event,
          durableGeneration(durableGenerations, event) + 1,
        ]),
      ]);
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
      expirePending();
      return result;
    }
    throw new MutationConflictError();
  }
  async function executeItemBatch(batch: NonNullable<typeof openItemBatch>) {
    if (openItemBatch === batch) openItemBatch = null;
    const ids = batch.ids.filter((id) => pending.has(id) && !completed.has(id));
    try {
      await ports.drain();
      const operations = ids.map((id) => pending.get(id)!);
      if (!operations.length) return;
      if (
        operations.some(
          (operation) =>
            operation.generation !== generation(operation.intent.events) ||
            ports.hasPendingAcceptedChanges?.(operation.intent.id),
        )
      ) {
        for (const id of ids)
          batch.resolvers.get(id)?.resolve(await execute(id));
        return;
      }
      for (const operation of operations) operation.committing = true;
      const result = await ports.commitItemContentEdits!(
        operations.flatMap(
          (operation) => operation.intent.itemContentEdits ?? [],
        ),
        ids,
        durableGenerations,
      );
      if (result.status === "review-required") {
        for (const operation of operations) operation.committing = false;
        for (const id of ids)
          batch.resolvers.get(id)?.resolve(await execute(id));
        return;
      }
      durableGenerations = { ...result.read.eventGenerations };
      for (const id of ids) {
        completed.add(id);
        pending.delete(id);
      }
      try {
        ports.apply(result.read.snapshot, []);
      } catch (error) {
        stopped = true;
        const failure = new CommittedStateApplyError(error);
        ports.onApplyFailure?.(failure);
        throw failure;
      }
      for (const id of ids)
        batch.resolvers
          .get(id)
          ?.resolve({ status: "committed", snapshot: result.read.snapshot });
    } catch (error) {
      for (const id of ids) {
        const operation = pending.get(id);
        if (operation) operation.committing = false;
        batch.resolvers.get(id)?.reject(error);
      }
    } finally {
      for (const id of batch.ids) {
        if (!ids.includes(id))
          batch.resolvers.get(id)?.resolve({ status: "expired" });
      }
    }
  }
  return {
    enqueue,
    request(intent: MutationIntent): Promise<MutationResult> {
      if (completed.has(intent.id))
        return Promise.resolve({
          status: "committed",
          snapshot: ports.readCurrent(),
        });
      if (openItemBatch?.resolvers.has(intent.id))
        return enqueue(() => execute(intent.id));
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
          choices: {},
          generation: generation(intent.events),
        });
      if (
        intent.itemContentEdits &&
        ports.commitItemContentEdits &&
        !pending.get(intent.id)?.confirmation
      ) {
        if (!openItemBatch) {
          const batch = {
            ids: [] as string[],
            resolvers: new Map<
              string,
              {
                resolve(result: MutationResult): void;
                reject(error: unknown): void;
              }
            >(),
          };
          openItemBatch = batch;
          void enqueue(() => executeItemBatch(batch)).catch((error) => {
            for (const resolver of batch.resolvers.values())
              resolver.reject(error);
          });
          openItemBatch = batch;
        }
        const batch = openItemBatch;
        batch.ids.push(intent.id);
        return new Promise<MutationResult>((resolve, reject) =>
          batch.resolvers.set(intent.id, { resolve, reject }),
        );
      }
      openItemBatch = null;
      return enqueue(() => execute(intent.id));
    },
    retry(operationId: string): Promise<MutationResult> {
      return enqueue(() => execute(operationId));
    },
    discard(operationId: string): boolean {
      if (pending.get(operationId)?.committing) return false;
      return pending.delete(operationId);
    },
    choose(
      token: ConfirmationToken,
      choiceId: string,
      value: string,
    ): Promise<MutationResult> {
      return enqueue(() => {
        const operation = pending.get(token.operationId);
        if (
          !operation ||
          operation.generation !== generation(operation.intent.events)
        )
          return { status: "expired" };
        const choice = operation.confirmation?.choices?.find(
          (entry) => entry.id === choiceId,
        );
        if (
          token.generation !== operation.generation ||
          !choice?.options.some((option) => option.value === value)
        ) {
          return operation.token && operation.confirmation
            ? {
                status: "confirmation-required",
                token: operation.token,
                confirmation: operation.confirmation,
              }
            : { status: "expired" };
        }
        operation.choices = { ...operation.choices, [choiceId]: value };
        // Rapid choices may come from the previous preview of this same operation.
        // Apply the selection to the latest data and renew the token; never write.
        return execute(token.operationId);
      });
    },
    confirm(token: ConfirmationToken): Promise<MutationResult> {
      return enqueue(() => execute(token.operationId, token));
    },
    cancel(token: ConfirmationToken): boolean {
      const operation = pending.get(token.operationId);
      if (operation?.token !== token || operation.committing) return false;
      return pending.delete(token.operationId);
    },
    initializeEventGenerations(read: ApplicationSnapshotRead): void {
      durableGenerations = { ...read.eventGenerations };
    },
    invalidate,
    generation: (event: string): number => generations.get(event) ?? 0,
    createBackupFile: async (): Promise<ApplicationBackupFile> => {
      if (!ports.createBackupFile)
        throw new Error("Backup worker is unavailable.");
      const captured = await enqueue(() => ({
        base: ports.readCurrent(),
        accepted: (ports.readExportCurrent ?? ports.readCurrent)(),
      }));
      return ports.createBackupFile(captured.base, captured.accepted);
    },
    // Wait for earlier mutations, then preserve the accepted in-memory values.
    // Export is read-only and must remain available when persistence fails.
    readExportSnapshot: (): Promise<PersistenceSnapshot> =>
      enqueue(() =>
        structuredClone((ports.readExportCurrent ?? ports.readCurrent)()),
      ),
  };
}
