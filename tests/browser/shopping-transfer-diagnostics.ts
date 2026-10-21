import type { Browser, CDPSession, Page, Worker } from "@playwright/test";

type DiagnosticCommit = {
  at: number;
  rendered: string[];
  mounted: string[];
  overheadMs: number;
  propChanges: Array<{
    componentId: number;
    componentName: string;
    functionName: string;
    tag: number;
    renders: number;
    unchangedPropRenders: number;
    changedKeys: Record<string, number>;
  }>;
};
type GeometryRead = {
  at: number;
  method: string;
  origin: "product" | "observer";
  overheadMs: number;
};
type LongTask = { at: number; durationMs: number; name: string };
type InputStage = { at: number; type: string; trusted: boolean };
type DiagnosticProbe = {
  reset(): void;
  read(
    start: number,
    end: number,
  ): {
    version: string;
    rendererInjected: boolean;
    commits: DiagnosticCommit[];
    geometryReads: GeometryRead[];
    longTasks: LongTask[];
    inputs: InputStage[];
  };
};
declare global {
  interface Window {
    __shoppingTransferDiagnostics?: DiagnosticProbe;
  }
}

/** Explicit diagnostics only: never installed in acceptance performance cases. */
export async function installTransferDiagnostics(page: Page) {
  await page.addInitScript(() => {
    type Fiber = {
      flags: number;
      tag: number;
      type?: {
        name?: string;
        displayName?: string;
        render?: { name?: string; displayName?: string };
      };
      alternate?: Fiber;
      child?: Fiber;
      sibling?: Fiber;
      memoizedProps?: {
        [key: string]: unknown;
        item?: { id?: string };
        onUpdate?: unknown;
        row?: { kind?: string; rowKey?: string };
        render?: unknown;
        layoutMode?: unknown;
      };
    };
    const componentIds = new WeakMap<object, number>();
    let nextComponentId = 1;
    let enabled = false;
    let rendererInjected = false;
    let commits: DiagnosticCommit[] = [];
    let geometryReads: GeometryRead[] = [];
    let longTasks: LongTask[] = [];
    let inputs: InputStage[] = [];
    const epoch = () => performance.timeOrigin + performance.now();
    const consumeLongTasks = (entries: PerformanceEntry[]) => {
      if (!enabled) return;
      for (const entry of entries)
        longTasks.push({
          at: performance.timeOrigin + entry.startTime,
          durationMs: entry.duration,
          name: entry.name,
        });
    };
    const observer = new PerformanceObserver((list) =>
      consumeLongTasks(list.getEntries()),
    );
    observer.observe({ type: "longtask", buffered: false });
    const probe: DiagnosticProbe = {
      reset() {
        observer.takeRecords();
        commits = [];
        geometryReads = [];
        longTasks = [];
        inputs = [];
        enabled = true;
      },
      read(start, end) {
        consumeLongTasks(observer.takeRecords());
        enabled = false;
        const inWindow = (entry: { at: number }) =>
          entry.at >= start && entry.at <= end;
        return {
          version: "shopping-transfer-diagnostics-v1",
          rendererInjected,
          commits: commits.filter(inWindow),
          geometryReads: geometryReads.filter(inWindow),
          longTasks: longTasks.filter(
            (entry) => entry.at <= end && entry.at + entry.durationMs >= start,
          ),
          inputs: inputs.filter(inWindow),
        };
      },
    };
    Object.assign(window, {
      __shoppingTransferDiagnostics: probe,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        renderers: new Map(),
        inject(renderer: unknown) {
          rendererInjected = true;
          this.renderers.set(1, renderer);
          return 1;
        },
        onCommitFiberRoot(_id: unknown, root: { current: Fiber }) {
          if (!enabled) return;
          const began = performance.now();
          const rendered: string[] = [],
            mounted: string[] = [];
          const propChanges = new Map<
            string,
            DiagnosticCommit["propChanges"][number]
          >();
          const visit = (fiber?: Fiber) => {
            if (!fiber) return;
            const props = fiber.memoizedProps;
            const key =
              props?.item?.id && props.onUpdate
                ? `item:${props.item.id}`
                : props?.row?.kind === "group" &&
                    props.render &&
                    !props.layoutMode
                  ? `group:${props.row.rowKey}`
                  : undefined;
            if (key && (fiber.flags & 1) !== 0)
              (fiber.alternate ? rendered : mounted).push(key);
            if (
              fiber.alternate &&
              fiber.flags & 1 &&
              [0, 11, 15].includes(fiber.tag)
            ) {
              const component =
                fiber.tag === 11 ? fiber.type?.render : fiber.type;
              if (component) {
                let componentId = componentIds.get(component);
                if (!componentId)
                  componentIds.set(
                    component,
                    (componentId = nextComponentId++),
                  );
                const groupKey = `${componentId}:${fiber.tag}`;
                const entry = propChanges.get(groupKey) ?? {
                  componentId,
                  componentName:
                    fiber.type?.displayName ??
                    component.displayName ??
                    component.name ??
                    "(anonymous)",
                  functionName: component.name ?? "(anonymous)",
                  tag: fiber.tag,
                  renders: 0,
                  unchangedPropRenders: 0,
                  changedKeys: {} as Record<string, number>,
                };
                const before = fiber.alternate.memoizedProps ?? {},
                  after = props ?? {};
                let changed = false;
                for (const prop of new Set([
                  ...Object.keys(before),
                  ...Object.keys(after),
                ])) {
                  if (Object.is(before[prop], after[prop])) continue;
                  const change = `${prop}:${typeof before[prop]}->${typeof after[prop]}`;
                  entry.changedKeys[change] =
                    (entry.changedKeys[change] ?? 0) + 1;
                  changed = true;
                }
                entry.renders++;
                if (!changed) entry.unchangedPropRenders++;
                propChanges.set(groupKey, entry);
              }
            }
            if (!fiber.alternate || fiber.child !== fiber.alternate.child)
              visit(fiber.child);
            visit(fiber.sibling);
          };
          visit(root.current);
          commits.push({
            at: epoch(),
            rendered,
            mounted,
            propChanges: [...propChanges.values()],
            overheadMs: performance.now() - began,
          });
        },
        onCommitFiberUnmount() {},
      },
    });
    const recordGeometry = (element: Element, method: string) => {
      if (!enabled) return;
      const began = performance.now();
      if (!element.closest("[data-shopping-drag-column]")) return;
      const stack = new Error().stack ?? "";
      geometryReads.push({
        at: performance.timeOrigin + began,
        method,
        origin: stack.includes(`${location.origin}/assets/`)
          ? "product"
          : "observer",
        overheadMs: performance.now() - began,
      });
    };
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      recordGeometry(this, "getBoundingClientRect");
      return rect.call(this);
    };
    for (const [owner, method] of [
      [HTMLElement.prototype, "offsetHeight"],
      [Element.prototype, "clientHeight"],
      [Element.prototype, "scrollHeight"],
    ] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, method);
      if (!descriptor?.get) continue;
      const get = descriptor.get;
      Object.defineProperty(owner, method, {
        ...descriptor,
        get(this: Element) {
          recordGeometry(this, method);
          return get.call(this);
        },
      });
    }
    for (const type of ["drop", "dragend", "touchend", "touchcancel"])
      document.addEventListener(
        type,
        (event) => {
          if (enabled)
            inputs.push({ at: epoch(), type, trusted: event.isTrusted });
        },
        true,
      );
  });
}
export async function resetTransferDiagnostics(page: Page) {
  await page.evaluate(() => window.__shoppingTransferDiagnostics!.reset());
}
export async function readTransferDiagnostics(
  page: Page,
  start: number,
  end: number,
) {
  return page.evaluate(
    ({ start, end }) => window.__shoppingTransferDiagnostics!.read(start, end),
    { start, end },
  );
}
type WorkerDiagnosticEvent = {
  at: number;
  stage: "message-observed" | "reply-posted";
  id?: unknown;
  method?: string;
  operationId?: string;
};
type WorkerCost = {
  at: number;
  method: "structuredClone" | "crypto.subtle.digest" | "IDBObjectStore.put";
  syncDurationMs: number;
  probeOverheadMs: number;
  threw: boolean;
  shape?: {
    kind: string;
    length?: number;
    ownKeyCount?: number;
    keys?: string[];
    arrayBranches?: Array<{ key: string; length: number }>;
  };
  algorithm?: string;
  inputBytes?: number;
  store?: string;
  key?: string | number;
  keyKind?: string;
  metadataUnavailable?: string;
};
type WorkerProbe = {
  reset(): void;
  read(
    start: number,
    end: number,
  ): {
    events: WorkerDiagnosticEvent[];
    costs: WorkerCost[];
    installed: string[];
  };
};
export async function installWorkerTransferDiagnostics(worker: Worker) {
  await worker.evaluate(() => {
    const state = globalThis as unknown as {
      __shoppingWorkerDiagnosticProbe?: WorkerProbe;
    };
    if (state.__shoppingWorkerDiagnosticProbe) return;
    let enabled = false;
    let events: WorkerDiagnosticEvent[] = [];
    let costs: WorkerCost[] = [];
    const installed: string[] = [];
    const epoch = () => performance.timeOrigin + performance.now();
    const shape = (value: unknown): WorkerCost["shape"] => {
      if (Array.isArray(value)) return { kind: "array", length: value.length };
      if (!value || typeof value !== "object")
        return { kind: value === null ? "null" : typeof value };
      const keys = Object.keys(value);
      const arrayBranches = keys.flatMap((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor &&
          "value" in descriptor &&
          Array.isArray(descriptor.value)
          ? [{ key, length: descriptor.value.length }]
          : [];
      });
      return {
        kind: "object",
        ownKeyCount: keys.length,
        keys: keys.slice(0, 24),
        arrayBranches,
      };
    };
    const observe = (
      method: WorkerCost["method"],
      invoke: () => unknown,
      metadata: () => Partial<WorkerCost>,
    ) => {
      if (!enabled) return invoke();
      const began = performance.now();
      const at = performance.timeOrigin + began;
      let threw = true;
      try {
        const result = invoke();
        threw = false;
        return result;
      } finally {
        const completed = performance.now();
        let details: Partial<WorkerCost>;
        try {
          details = metadata();
        } catch {
          details = {
            metadataUnavailable:
              "Input metadata could not be inspected without changing native result",
          };
        }
        const record: WorkerCost = {
          at,
          method,
          syncDurationMs: completed - began,
          probeOverheadMs: 0,
          threw,
          ...details,
        };
        costs.push(record);
        record.probeOverheadMs = performance.now() - completed;
      }
    };
    const patch = (
      object: object,
      key: string,
      invoke: (
        target: (...args: unknown[]) => unknown,
        receiver: unknown,
        args: unknown[],
      ) => unknown,
    ) => {
      let owner: object | null = object;
      while (owner && !Object.prototype.hasOwnProperty.call(owner, key))
        owner = Object.getPrototypeOf(owner);
      const descriptor = owner && Object.getOwnPropertyDescriptor(owner, key);
      if (!owner || !descriptor || typeof descriptor.value !== "function")
        throw new Error(`Diagnostic native method is unavailable: ${key}`);
      Object.defineProperty(owner, key, {
        ...descriptor,
        value: new Proxy(descriptor.value, { apply: invoke }),
      });
      installed.push(key);
    };
    patch(globalThis, "structuredClone", (target, receiver, args) =>
      observe(
        "structuredClone",
        () => Reflect.apply(target, receiver, args),
        () => ({ shape: shape(args[0]) }),
      ),
    );
    patch(crypto.subtle, "digest", (target, receiver, args) =>
      observe(
        "crypto.subtle.digest",
        () => Reflect.apply(target, receiver, args),
        () => {
          const algorithm =
            typeof args[0] === "string"
              ? args[0]
              : args[0] && typeof args[0] === "object"
                ? Object.getOwnPropertyDescriptor(args[0], "name")?.value
                : undefined;
          const bytes = args[1];
          return {
            algorithm: typeof algorithm === "string" ? algorithm : undefined,
            inputBytes:
              bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes)
                ? bytes.byteLength
                : undefined,
          };
        },
      ),
    );
    patch(IDBObjectStore.prototype, "put", (target, receiver, args) =>
      observe(
        "IDBObjectStore.put",
        () => Reflect.apply(target, receiver, args),
        () => ({
          store: (receiver as IDBObjectStore).name,
          key:
            typeof args[1] === "string" || typeof args[1] === "number"
              ? args[1]
              : undefined,
          keyKind: args.length < 2 ? "omitted" : typeof args[1],
          shape: shape(args[0]),
        }),
      ),
    );
    globalThis.addEventListener(
      "message",
      (
        event: MessageEvent<{
          id?: unknown;
          method?: string;
          args?: unknown[];
        }>,
      ) => {
        if (enabled)
          events.push({
            at: epoch(),
            stage: "message-observed",
            id: event.data?.id,
            method: event.data?.method,
            operationId:
              typeof event.data?.args?.[1] === "string"
                ? event.data.args[1]
                : undefined,
          });
      },
      true,
    );
    patch(globalThis, "postMessage", (target, receiver, args) => {
      if (enabled)
        events.push({
          at: epoch(),
          stage: "reply-posted",
          id: (args[0] as { id?: unknown } | undefined)?.id,
        });
      return Reflect.apply(target, receiver, args);
    });
    state.__shoppingWorkerDiagnosticProbe = {
      reset() {
        events = [];
        costs = [];
        enabled = true;
      },
      read(start, end) {
        enabled = false;
        const inWindow = (entry: { at: number }) =>
          entry.at >= start && entry.at <= end;
        return {
          events: events.filter(inWindow),
          costs: costs.filter(inWindow),
          installed: [...installed],
        };
      },
    };
  });
}
export async function resetWorkerTransferDiagnostics(worker: Worker) {
  await worker.evaluate(() =>
    (
      globalThis as unknown as { __shoppingWorkerDiagnosticProbe: WorkerProbe }
    ).__shoppingWorkerDiagnosticProbe.reset(),
  );
}
export async function readWorkerTransferDiagnostics(
  worker: Worker,
  start: number,
  end: number,
) {
  return worker.evaluate(
    ({ start, end }) =>
      (
        globalThis as unknown as {
          __shoppingWorkerDiagnosticProbe: WorkerProbe;
        }
      ).__shoppingWorkerDiagnosticProbe.read(start, end),
    { start, end },
  );
}

export type DiagnosticCpuProfile = {
  startTime: number;
  endTime: number;
  nodes: Array<{
    id: number;
    children?: number[];
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
  }>;
  samples?: number[];
  timeDeltas?: number[];
};

/** A second CDP client samples the existing Worker without changing its handler. */
export async function createWorkerCpuProfiler(
  browser: Browser,
  pageSession: CDPSession,
  worker: Worker,
) {
  const connection = await browser.newBrowserCDPSession();
  let sessionId = "";
  let sequence = 0;
  let profiling = false;
  let closed = false;
  const pending = new Map<
    number,
    {
      timer: ReturnType<typeof setTimeout>;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  const failPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  const receive = (event: { sessionId: string; message: string }) => {
    if (event.sessionId !== sessionId) return;
    let reply: {
      id?: number;
      result?: unknown;
      error?: { code: number; message: string };
    };
    try {
      reply = JSON.parse(event.message);
    } catch {
      failPending(new Error("Malformed Worker CDP response"));
      return;
    }
    if (reply.id === undefined) return;
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timer);
    if (reply.error)
      request.reject(
        new Error(`Worker CDP ${reply.error.code}: ${reply.error.message}`),
      );
    else request.resolve(reply.result);
  };
  const request = <T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error("Worker CPU profiler is closed"));
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Worker CDP timed out: ${method}`));
      }, 10000);
      pending.set(id, {
        timer,
        resolve: (value) => resolve(value as T),
        reject,
      });
      void connection
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch((error: Error) => {
          const waiting = pending.get(id);
          if (!waiting) return;
          pending.delete(id);
          clearTimeout(waiting.timer);
          waiting.reject(error);
        });
    });
  const dispose = async () => {
    if (closed) return;
    try {
      if (profiling) {
        await request("Profiler.stop");
        profiling = false;
      }
      if (sessionId) await request("Profiler.disable");
    } finally {
      closed = true;
      failPending(new Error("Worker CPU profiler detached"));
      connection.off("Target.receivedMessageFromTarget", receive);
      if (sessionId)
        await connection
          .send("Target.detachFromTarget", { sessionId })
          .catch(() => {});
      await connection.detach().catch(() => {});
    }
  };
  try {
    const { targetInfo: pageTarget } = await pageSession.send(
      "Target.getTargetInfo",
    );
    const { targetInfos } = await connection.send("Target.getTargets");
    const candidates = targetInfos.filter(
      (target) =>
        target.type === "worker" &&
        target.url === worker.url() &&
        target.browserContextId === pageTarget.browserContextId &&
        (!target.openerId || target.openerId === pageTarget.targetId),
    );
    if (candidates.length !== 1)
      throw new Error(
        `Expected exactly one matching persistence Worker target, found ${candidates.length}`,
      );
    const target = candidates[0];
    ({ sessionId } = await connection.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    }));
    connection.on("Target.receivedMessageFromTarget", receive);
    const identity = await worker.evaluate(() => ({
      url: location.href,
      timeOrigin: performance.timeOrigin,
    }));
    const remote = await request<{ result: { value?: string } }>(
      "Runtime.evaluate",
      {
        expression:
          "JSON.stringify({url:location.href,timeOrigin:performance.timeOrigin})",
        returnByValue: true,
      },
    );
    const remoteIdentity = JSON.parse(remote.result.value ?? "null") as {
      url?: string;
      timeOrigin?: number;
    } | null;
    if (
      identity.url !== target.url ||
      !Number.isFinite(identity.timeOrigin) ||
      remoteIdentity?.url !== identity.url ||
      remoteIdentity?.timeOrigin !== identity.timeOrigin
    )
      throw new Error("Attached CDP target does not match the measured Worker");
    await request("Profiler.enable");
    await request("Profiler.setSamplingInterval", { interval: 1000 });
    return {
      target: {
        targetId: target.targetId,
        url: target.url,
        type: target.type,
        browserContextId: target.browserContextId,
        openerId: target.openerId,
        pageTargetId: pageTarget.targetId,
        workerTimeOrigin: identity.timeOrigin,
        identityVerified: true,
        transport: "Target.attachToTarget(flatten:false) message relay",
      },
      async start() {
        if (profiling) throw new Error("Worker CPU profiler already started");
        await request("Profiler.start");
        profiling = true;
      },
      async stop(): Promise<DiagnosticCpuProfile> {
        if (!profiling) throw new Error("Worker CPU profiler was not started");
        const result = await request<{ profile: DiagnosticCpuProfile }>(
          "Profiler.stop",
        );
        profiling = false;
        return result.profile;
      },
      dispose,
    };
  } catch (error) {
    await dispose().catch(() => {});
    throw error;
  }
}
