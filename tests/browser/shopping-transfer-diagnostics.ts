import type { Page, Worker } from "@playwright/test";

type DiagnosticCommit = {
  at: number;
  rendered: string[];
  mounted: string[];
  overheadMs: number;
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
      alternate?: Fiber;
      child?: Fiber;
      sibling?: Fiber;
      memoizedProps?: {
        item?: { id?: string };
        onUpdate?: unknown;
        row?: { kind?: string; rowKey?: string };
        render?: unknown;
        layoutMode?: unknown;
      };
    };
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
            if (!fiber.alternate || fiber.child !== fiber.alternate.child)
              visit(fiber.child);
            visit(fiber.sibling);
          };
          visit(root.current);
          commits.push({
            at: epoch(),
            rendered,
            mounted,
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
export async function installWorkerTransferDiagnostics(worker: Worker) {
  await worker.evaluate(() => {
    const state = globalThis as unknown as {
      __shoppingWorkerDiagnosticEvents: Array<{
        at: number;
        stage: "message-observed" | "reply-posted";
        id?: unknown;
        method?: string;
        operationId?: string;
      }>;
    };
    state.__shoppingWorkerDiagnosticEvents = [];
    globalThis.addEventListener(
      "message",
      (
        event: MessageEvent<{
          id?: unknown;
          method?: string;
          args?: unknown[];
        }>,
      ) => {
        state.__shoppingWorkerDiagnosticEvents.push({
          at: performance.timeOrigin + performance.now(),
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
    const post = globalThis.postMessage;
    globalThis.postMessage = function (...args: unknown[]) {
      const message = args[0] as { id?: unknown } | undefined;
      state.__shoppingWorkerDiagnosticEvents.push({
        at: performance.timeOrigin + performance.now(),
        stage: "reply-posted",
        id: message?.id,
      });
      return Reflect.apply(post, globalThis, args);
    };
  });
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
          __shoppingWorkerDiagnosticEvents: Array<{ at: number }>;
        }
      ).__shoppingWorkerDiagnosticEvents.filter(
        (event) => event.at >= start && event.at <= end,
      ),
    { start, end },
  );
}
