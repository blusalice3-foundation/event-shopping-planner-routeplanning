import { isPersistenceWriteStopReason } from "./PersistenceCommandPort";
import type { HallDefinition } from "../../types/map";
import type { MapEditorSession } from "../../features/map/domain/mapEditorSession";

export type HallWriteResult =
  | {
      status: "saved";
      sessionId: string;
      committedHalls: readonly HallDefinition[];
    }
  | { status: "cancelled" };

export type HallEditorSave = (
  halls: HallDefinition[],
  session?: MapEditorSession,
) => Promise<HallWriteResult>;
export type HallEditorSync = (
  targetDates: string[],
  halls: HallDefinition[],
  session?: MapEditorSession,
) => Promise<HallWriteResult>;

export const isHallWriteTerminalError = isPersistenceWriteStopReason;
