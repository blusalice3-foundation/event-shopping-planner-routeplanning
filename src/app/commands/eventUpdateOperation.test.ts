import { describe, expect, it, vi } from "vitest";
import { createEventUpdateOperationRegistry } from "./eventUpdateOperation";

describe("event update operation ownership", () => {
  it("settles once before a completion callback reenters finish", () => {
    const registry = createEventUpdateOperationRegistry();
    const complete = vi.fn(() =>
      registry.finish(operation.id, { status: "failed" }),
    );
    const operation = registry.start({ eventName: "A", complete })!;
    registry.finish(operation.id, { status: "saved" });
    expect(complete).toHaveBeenCalledExactlyOnceWith({ status: "saved" });
    expect(registry.current).toBeNull();
  });

  it.each(["selection", "saving"] as const)(
    "keeps a reentrant %s owner instead of overwriting it",
    (phase) => {
      const registry = createEventUpdateOperationRegistry();
      const reentrantComplete = vi.fn();
      registry.start({
        eventName: "A",
        complete: () => {
          registry.start({
            eventName: "C",
            complete: reentrantComplete,
            phase,
          });
        },
      });
      const refusedComplete = vi.fn();
      const result = registry.start({
        eventName: "B",
        complete: refusedComplete,
      });
      expect(result).toBeNull();
      expect(registry.current).toMatchObject({ eventName: "C", phase });
      expect(reentrantComplete).not.toHaveBeenCalled();
      expect(refusedComplete).toHaveBeenCalledExactlyOnceWith({
        status: "invalidated",
      });
    },
  );

  it("rejects only a new completion while the current operation is saving", () => {
    const registry = createEventUpdateOperationRegistry();
    const currentComplete = vi.fn();
    const current = registry.start({
      eventName: "A",
      complete: currentComplete,
      phase: "saving",
    });
    const refusedComplete = vi.fn();
    expect(
      registry.start({ eventName: "B", complete: refusedComplete }),
    ).toBeNull();
    expect(registry.current).toBe(current);
    expect(currentComplete).not.toHaveBeenCalled();
    expect(refusedComplete).toHaveBeenCalledExactlyOnceWith({
      status: "invalidated",
    });
  });
});
