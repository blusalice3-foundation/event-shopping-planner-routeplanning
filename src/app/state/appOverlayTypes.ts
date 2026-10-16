import type { BulkImportResult } from "../../types/import";
import type { BulkAddMetadata } from "../../features/events/bulkAdd";
import type {
  DifferentSourceEventAnalysis,
  SameSourceEventAnalysis,
} from "../../features/events/duplicateEvent";

export type PendingDuplicateEventImport = {
  analysis: SameSourceEventAnalysis | DifferentSourceEventAnalysis;
  metadata?: BulkAddMetadata;
  eventGeneration?: number;
  complete?: (result: BulkImportResult) => void;
};

export type PendingXlsxRestoreCompletion = {
  errors: string[];
  itemCount: number;
};
