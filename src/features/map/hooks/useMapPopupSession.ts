import { useCallback, useLayoutEffect, useRef } from "react";

export type MapPopupSession = Readonly<{ scope: string; id: number }>;
type Owner = "popup" | "relay";

// Only committed contexts and event handlers own an unaccepted popup operation.
export function useMapPopupSession(scope: string) {
  const committedScope = useRef(scope);
  const sequence = useRef(0);
  const current = useRef<{ session: MapPopupSession; owner: Owner } | null>(
    null,
  );

  useLayoutEffect(() => {
    committedScope.current = scope;
    current.current = null;
    return () => {
      current.current = null;
    };
  }, [scope]);

  const begin = useCallback((expectedScope: string): MapPopupSession | null => {
    if (expectedScope !== committedScope.current) return null;
    const session = { scope: committedScope.current, id: ++sequence.current };
    current.current = { session, owner: "popup" };
    return session;
  }, []);
  const isCurrent = useCallback(
    (session: MapPopupSession | null | undefined, owner: Owner): boolean =>
      Boolean(
        session &&
        session.scope === committedScope.current &&
        current.current?.session.id === session.id &&
        current.current.owner === owner,
      ),
    [],
  );
  const transfer = useCallback(
    (session: MapPopupSession): boolean => {
      if (!isCurrent(session, "popup") && !isCurrent(session, "relay"))
        return false;
      current.current = { session, owner: "relay" };
      return true;
    },
    [isCurrent],
  );
  const invalidate = useCallback((session: MapPopupSession) => {
    if (current.current?.session.id === session.id) current.current = null;
  }, []);
  const isVisible = (
    session: MapPopupSession | null | undefined,
    owner: Owner,
  ) => session?.scope === scope && isCurrent(session, owner);

  return { begin, isCurrent, isVisible, transfer, invalidate };
}
