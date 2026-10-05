import { useCallback, useEffect, useRef, useState } from "react";

export interface SearchScrollRequest {
  itemId: string;
  requestId: number;
}

/** A search request belongs to one set of search and display conditions. */
export function useSearchScrollRequest(contextKey: string) {
  const sequence = useRef(0);
  const [pending, setPending] = useState<
    (SearchScrollRequest & { contextKey: string }) | null
  >(null);

  useEffect(() => {
    setPending(null);
  }, [contextKey]);

  const request = useCallback(
    (itemId: string) => {
      setPending({ itemId, requestId: ++sequence.current, contextKey });
    },
    [contextKey],
  );
  const consume = useCallback((requestId: number) => {
    setPending((current) =>
      current?.requestId === requestId ? null : current,
    );
  }, []);
  const clear = useCallback(() => setPending(null), []);

  // Hide invalid requests during render, before a child's effects can scroll.
  const searchScrollRequest =
    pending?.contextKey === contextKey ? pending : null;
  return { searchScrollRequest, request, consume, clear };
}
