import type { MutationIntent } from "../commands/applicationMutationCoordinator";
import type { PersistenceSnapshot } from "./PersistenceCommandPort";
export interface ApplicationMutationPort {
  requestMutation(
    intent: Omit<MutationIntent, "id">,
  ): Promise<PersistenceSnapshot>;
  readExportSnapshot(): Promise<PersistenceSnapshot>;
}
