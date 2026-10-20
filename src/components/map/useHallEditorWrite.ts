import { useCallback, useRef, useState } from "react";
import type { HallDefinition } from "../../types/map";
import type { MapEditorSession } from "../../features/map/domain/mapEditorSession";
import {
  isHallWriteTerminalError,
  type HallWriteResult,
} from "../../app/ports/HallEditorCommandPort";

/** Owns only the panel's submission state, never application snapshot state. */
export function useHallEditorWrite(session: MapEditorSession | undefined) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresReload, setRequiresReload] = useState(false);
  const busyRef = useRef(false);
  const stoppedRef = useRef(false);
  const ownerRef = useRef(session?.sessionId);
  ownerRef.current = session?.sessionId;
  const submit = useCallback(
    async (
      write: () => Promise<HallWriteResult>,
      apply: (halls: HallDefinition[]) => void,
    ): Promise<boolean> => {
      if (busyRef.current || stoppedRef.current) return false;
      const owner = ownerRef.current;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await write();
        if (ownerRef.current !== owner || result.status !== "saved")
          return false;
        if (owner !== undefined && result.sessionId !== owner) return false;
        apply([...result.committedHalls]);
        return true;
      } catch (failure) {
        if (ownerRef.current !== owner) return false;
        const terminal = isHallWriteTerminalError(failure);
        if (terminal) {
          stoppedRef.current = true;
          setRequiresReload(true);
        }
        setError(
          terminal
            ? "保存結果を確認できません。入力を保持しています。再送せず、再読込・復旧の案内に従ってください。"
            : "ホールを保存できませんでした。入力を保持しています。もう一度お試しください。",
        );
        return false;
      } finally {
        if (ownerRef.current === owner) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [],
  );
  const canClose = useCallback(() => !busyRef.current, []);
  return { busy, error, requiresReload, submit, canClose };
}
