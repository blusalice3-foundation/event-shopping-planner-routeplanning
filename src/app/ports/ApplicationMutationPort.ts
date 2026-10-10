import type { MutationIntent } from "../commands/applicationMutationCoordinator";
import type {
  PersistenceSnapshot,
  ApplicationBackupFile,
} from "./PersistenceCommandPort";
export interface ApplicationMutationPort {
  requestMutation(
    intent: Omit<MutationIntent, "id">,
  ): Promise<PersistenceSnapshot>;
  readExportSnapshot(): Promise<PersistenceSnapshot>;
  createBackupFile?(): Promise<ApplicationBackupFile>;
}
