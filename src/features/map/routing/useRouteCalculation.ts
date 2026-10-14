import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateRouteJob,
  emptyRouteJobResult,
  routeJobKey,
  type RouteJob,
  type RouteJobResults,
} from "./worker/routeJob";

function routeGeometryInputs(job: RouteJob): unknown[] {
  return job.kind === "focus"
    ? [job.kind, job.mapData, job.visitKeys, job.cells]
    : job.kind === "segments"
      ? [job.kind, job.mapData, job.points, job.enabled]
      : [
          job.kind,
          job.params.displayMapData,
          job.params.mapInsertMapData,
          job.params.displayRoutePoints,
          job.params.mapInsertRoutePoints,
          job.params.includeDisplayRoute,
          job.params.includeMapInsertRoute,
          job.constraint,
        ];
}

function routeJobEnabled(job: RouteJob): boolean {
  if (job.kind === "segments") return job.enabled;
  if (job.kind === "focus")
    return job.enabled !== false && job.mapData !== null;
  return !!(job.params.includeDisplayRoute || job.params.includeMapInsertRoute);
}
/** Never expose a stale route. Terminating an obsolete worker interrupts its search. */
export function useRouteCalculation<K extends RouteJob["kind"]>(
  job: RouteJob & { kind: K },
) {
  const enabled = routeJobEnabled(job);
  // Disabled routes must not scan geometry, construct a worker, or send a job.
  const geometryInputs = enabled ? routeGeometryInputs(job) : [job.kind, false];
  const keyCache = useRef<{ inputs: unknown[]; key: string }>();
  if (
    !keyCache.current ||
    geometryInputs.some(
      (input, index) => input !== keyCache.current!.inputs[index],
    )
  )
    keyCache.current = {
      inputs: geometryInputs,
      key: enabled ? routeJobKey(job) : `${job.kind}:disabled`,
    };
  const key = keyCache.current.key;
  const requestNumber = useRef(0);
  const jobRef = useRef(job);
  jobRef.current = job;
  const workerRef = useRef<Worker | null>(null);
  const busyRef = useRef(false);
  const available = typeof Worker === "function";
  const [completed, setCompleted] = useState<{
    key: string;
    result: RouteJobResults[K];
    error?: string;
  }>();
  const synchronous = useMemo(
    () =>
      available || !enabled
        ? undefined
        : {
            key,
            result: calculateRouteJob(jobRef.current) as RouteJobResults[K],
          },
    [available, enabled, key],
  );
  useEffect(() => {
    if (!enabled) {
      ++requestNumber.current;
      workerRef.current?.terminate();
      workerRef.current = null;
      busyRef.current = false;
      setCompleted(undefined);
      return;
    }
    if (!available) return;
    if (busyRef.current) {
      workerRef.current?.terminate();
      workerRef.current = null;
    }
    const request = ++requestNumber.current;
    let active = true;
    let worker: Worker;
    try {
      worker =
        workerRef.current ??
        new Worker(new URL("./worker/route.worker.ts", import.meta.url), {
          type: "module",
        });
      workerRef.current = worker;
      busyRef.current = true;
      worker.onmessage = (
        event: MessageEvent<{
          key: string;
          result: RouteJobResults[K];
          error?: string;
        }>,
      ) => {
        if (
          !active ||
          request !== requestNumber.current ||
          event.data.key !== key ||
          keyCache.current?.key !== key
        )
          return;
        busyRef.current = false;
        setCompleted(event.data);
      };
      worker.onerror = () => {
        if (
          !active ||
          request !== requestNumber.current ||
          keyCache.current?.key !== key
        )
          return;
        busyRef.current = false;
        worker.terminate();
        workerRef.current = null;
        setCompleted({
          key,
          result: emptyRouteJobResult(jobRef.current) as RouteJobResults[K],
          error: "経路を計算できませんでした。",
        });
      };
      worker.postMessage({ key, job: jobRef.current });
    } catch (error) {
      busyRef.current = false;
      setCompleted({
        key,
        result: emptyRouteJobResult(jobRef.current) as RouteJobResults[K],
        error: String(error),
      });
    }
    return () => {
      active = false;
      // Ignore a reply arriving after the input changed but before the next request.
      if (workerRef.current) workerRef.current.onmessage = null;
    };
  }, [available, enabled, key]);
  useEffect(
    () => () => {
      workerRef.current?.terminate();
    },
    [],
  );
  const placeholderRef = useRef<{ key: string; result: RouteJobResults[K] }>();
  if (placeholderRef.current?.key !== key) {
    placeholderRef.current = {
      key,
      result: emptyRouteJobResult(jobRef.current) as RouteJobResults[K],
    };
  }
  const placeholder = placeholderRef.current.result;
  const current =
    synchronous ?? (completed?.key === key ? completed : undefined);
  return {
    result: current?.result ?? placeholder,
    pending: enabled && !current,
    error: enabled && completed?.key === key ? completed.error : undefined,
    key,
  };
}
