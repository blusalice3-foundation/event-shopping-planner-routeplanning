import { db } from "../facade/indexedDbPersistence";
import { createPersistenceWorkerServer } from "./persistenceWorkerServer";

const server = createPersistenceWorkerServer(db);
let tail = Promise.resolve();
self.onmessage = (
  event: MessageEvent<{
    id: number;
    method: string;
    args: unknown[];
    storage: [string, string][];
  }>,
) => {
  const request = event.data;
  tail = tail
    .then(async () => {
      const values = new Map(request.storage);
      const changed = new Set<string>();
      // Browser-only fallback sources are captured as data, validated in the worker,
      // and removed on the main thread only if their original value still matches.
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          get length() {
            return values.size;
          },
          key: (index: number) => [...values.keys()][index] ?? null,
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => {
            values.set(key, value);
            changed.add(key);
          },
          removeItem: (key: string) => {
            values.delete(key);
            changed.add(key);
          },
        },
      });
      try {
        const method = request.method;
        const args = request.args;
        let result: unknown;
        if (method === "read") result = await server.read();
        else if (method === "commit")
          result = await server.commit(
            args[0] as Parameters<typeof server.commit>[0],
            args[1] as Parameters<typeof server.commit>[1],
          );
        else if (method === "day")
          result = await server.day(
            args[0] as Parameters<typeof server.day>[0],
            args[1] as string,
            args[2] as Record<string, number>,
          );
        else if (method === "items")
          result = await server.items(
            args[0] as Parameters<typeof server.items>[0],
            args[1] as string[],
            args[2] as Record<string, number>,
          );
        else {
          const command = (
            db as unknown as Record<
              string,
              (...args: unknown[]) => Promise<unknown>
            >
          )[method];
          if (!command || !method.startsWith("save"))
            throw new Error("Unknown persistence command.");
          result = await command(...args);
        }
        self.postMessage({
          id: request.id,
          result,
          storageChanges: [...changed].map((key) => [
            key,
            values.get(key) ?? null,
          ]),
        });
      } catch (error) {
        const value = error as Error & { recoveryBundle?: unknown };
        self.postMessage({
          id: request.id,
          error: {
            name: value.name,
            message: value.message,
            recoveryBundle: value.recoveryBundle,
          },
        });
      }
    })
    .catch(() => undefined);
};
