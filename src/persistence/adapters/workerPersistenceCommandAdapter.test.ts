import { afterEach, expect, it, vi } from "vitest";
import { createWorkerPersistenceCommandAdapter } from "./workerPersistenceCommandAdapter";
import { emptyApplicationSnapshot } from "../../app/state/useApplicationSnapshot";
import type { WorkerSnapshotRead } from "../worker/snapshotDelta";
afterEach(() => vi.unstubAllGlobals());
it("adopts equal UI references before the first day command and never rescans historical items", async () => {
  let raw = emptyApplicationSnapshot();
  raw.eventLists = {
    event: [{ id: "1", title: "ユーザー登録" }] as never[],
    past: Array.from({ length: 10000 }, (_, index) => ({
      id: "past-" + index,
      title: "過去",
    })) as never[],
  };
  raw.dayModes = { event: { "1日目": "execute" } };
  const replies: WorkerSnapshotRead[] = [
    {
      delta: { full: structuredClone(raw) },
      observationId: 1,
      consistencyMissing: false,
    },
    {
      delta: {
        branches: [
          {
            store: "dayModes",
            eventName: "event",
            path: ["1日目"],
            present: true,
            value: "edit",
          },
        ],
      },
      observationId: 2,
      consistencyMissing: false,
    },
    {
      delta: {
        branches: [
          {
            store: "eventLists",
            eventName: "event",
            path: [],
            present: true,
            value: [{ id: "1", title: "他タブ" }],
          },
        ],
      },
      observationId: 3,
      consistencyMissing: false,
    },
  ];
  class MockWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: (event: Event) => void;
    postMessage(request: { id: number }) {
      const read = replies.shift()!;
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            id: request.id,
            result: request.id === 1 ? read : { status: "committed", read },
            storageChanges: [],
          },
        } as MessageEvent),
      );
    }
    terminate() {}
  }
  vi.stubGlobal("localStorage", {
    length: 0,
    key: () => null,
    getItem: () => null,
  });
  vi.stubGlobal("Worker", MockWorker);
  const port = createWorkerPersistenceCommandAdapter();
  const release = port.bindApplicationSettings({
    read: () => raw,
    save: async () => {},
  });
  const initial = await port.readApplicationSnapshot();
  expect(initial.snapshot.eventLists).toBe(raw.eventLists);
  raw = structuredClone(initial.snapshot) as typeof raw;
  port.adoptCommittedSnapshot!(raw);
  const past = raw.eventLists.past;
  const inspect = vi.fn(() => {
    throw new Error("Historical item was inspected");
  });
  Object.defineProperty(past[0], "title", { get: inspect, enumerable: true });
  const mode = await port.commitDayMutation!(
    { kind: "mode", eventName: "event", day: "1日目" },
    "mode",
    {},
  );
  expect(mode.status).toBe("committed");
  if (mode.status !== "committed") throw new Error("not committed");
  raw = mode.read.snapshot as typeof raw;
  expect(raw.eventLists.past).toBe(past);
  expect(inspect).not.toHaveBeenCalled();
  const remote = await port.commitDayMutation!(
    { kind: "mode", eventName: "event", day: "1日目" },
    "remote",
    {},
  );
  if (remote.status !== "committed") throw new Error("not committed");
  expect(remote.read.snapshot.eventLists.event[0]).toMatchObject({
    title: "他タブ",
  });
  expect(remote.read.snapshot.eventLists.past).toBe(past);
  expect(inspect).not.toHaveBeenCalled();
  release();
});
