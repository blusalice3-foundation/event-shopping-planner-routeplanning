import type { BulkImportResult } from "../../types/import";
import type { ShoppingItem } from "../../types/item";
import type {
  PendingEventUpdate,
  SpreadsheetSource,
} from "../../features/events/updateFlow";

export type EventUpdateOperationPhase =
  | "selection"
  | "loading"
  | "url"
  | "confirmation"
  | "saving"
  | "finished";

/** One owner survives URL retries and captures its original import completion. */
export interface EventUpdateOperation {
  readonly id: string;
  readonly eventName: string;
  readonly complete?: (result: BulkImportResult) => void;
  readonly isCurrentInput?: () => boolean;
  readonly eventGeneration?: number;
  phase: EventUpdateOperationPhase;
  acquisitionGeneration: number;
  requestId?: string;
  ownsUntrackedOverlay?: boolean;
  baseItems: ShoppingItem[] | null;
  baseSource: SpreadsheetSource | null;
  pending?: PendingEventUpdate;
}

export interface EventUpdateOperationRegistry {
  current: EventUpdateOperation | null;
  onFinish?: (
    operation: EventUpdateOperation,
    result: BulkImportResult,
  ) => void;
  start(input: {
    eventName: string;
    complete?: (result: BulkImportResult) => void;
    isCurrentInput?: () => boolean;
    eventGeneration?: number;
    phase?: EventUpdateOperationPhase;
  }): EventUpdateOperation | null;
  finish(id: string, result: BulkImportResult): void;
  changePhase(
    operation: EventUpdateOperation,
    phase: EventUpdateOperationPhase,
  ): void;
  subscribe(listener: () => void): () => void;
  isSaving(): boolean;
}

export function createEventUpdateOperationRegistry(): EventUpdateOperationRegistry {
  let sequence = 0;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  const registry: EventUpdateOperationRegistry = {
    current: null,
    start(input) {
      if (registry.isSaving()) {
        input.complete?.({ status: "invalidated" });
        return null;
      }
      if (registry.current)
        registry.finish(registry.current.id, { status: "invalidated" });
      // Completion callbacks may synchronously start a later request.
      if (registry.current) {
        input.complete?.({ status: "invalidated" });
        return null;
      }
      const operation: EventUpdateOperation = {
        ...input,
        id: `event-update:${++sequence}`,
        phase: input.phase ?? "selection",
        acquisitionGeneration: 0,
        ownsUntrackedOverlay: false,
        baseItems: null,
        baseSource: null,
      };
      registry.current = operation;
      changed();
      return operation;
    },
    finish(id, result) {
      const operation = registry.current;
      if (!operation || operation.id !== id || operation.phase === "finished")
        return;
      // Clear ownership before invoking any callback, including reentrant imports.
      operation.phase = "finished";
      registry.current = null;
      try {
        registry.onFinish?.(operation, result);
      } finally {
        changed();
        operation.complete?.(result);
      }
    },
    changePhase(operation, phase) {
      if (registry.current !== operation || operation.phase === "finished")
        return;
      operation.phase = phase;
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isSaving: () => registry.current?.phase === "saving",
  };
  return registry;
}
