import { useCallback, useLayoutEffect, useRef } from "react";
/** Stable controls read the last committed render without invalidating sibling cards. */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}

export function useStableOptionalCallback<Args extends unknown[], Result>(
  callback: ((...args: Args) => Result) | undefined,
): ((...args: Args) => Result) | undefined {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  const stable = useCallback(
    (...args: Args) => latest.current?.(...args) as Result,
    [],
  );
  return callback ? stable : undefined;
}
