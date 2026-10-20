/** Shared App boundary for snapshot invalidation and successful delete/rename. */
export function createEventUpdateInvalidationBoundary(invalidate: {
  current: (eventName: string) => void;
}) {
  return {
    applied(eventNames: readonly string[]): void {
      for (const eventName of eventNames) invalidate.current(eventName);
    },
    closeEventUpdateForEvent(eventName: string): void {
      invalidate.current(eventName);
    },
  };
}
