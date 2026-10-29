import type {
  MoveLifecycleRecord,
  InputStage,
  selectWorkerDispatchWindow,
} from "./shopping-transfer-diagnostics";

export type MoveFrameMeasurement = {
  measurementId: string;
  startEpoch: number;
  domMs: number;
  operationId: string | null;
  durationMs: number;
  correlation: {
    input: { pid: number; ts: number };
    dom: { pid: number; ts: number };
    paint: { pid: number; ts: number };
    drawFrame: { pid: number; ts: number };
    frame: { epochMs: number; traceTs: number; sessionId: number };
  };
};

/** Diagnostic-only join; IDs come from actual receipts, never inferred ordinals. */
export function correlateTransferMoves(
  records: readonly MoveLifecycleRecord[],
  inputs: readonly InputStage[],
  measurement: MoveFrameMeasurement | undefined,
  worker: ReturnType<typeof selectWorkerDispatchWindow>,
) {
  const unavailable = (reason: string) => ({
    status: "unavailable" as const,
    reason,
    moves: [],
  });
  if (!measurement) return unavailable("Content-verified frame is missing");
  if (worker.status !== "available")
    return unavailable("Actual Worker dispatch/reply window is missing");
  if (!worker.operationId || worker.operationId !== measurement.operationId)
    return unavailable("Frame and Worker operation IDs do not match");
  const accepted = records.filter(
    (record) =>
      record.phase === "queue-accepted" &&
      record.operationId === worker.operationId,
  );
  if (!accepted.length)
    return unavailable("Accepted move receipts are missing");
  const ids = new Set<string>();
  const moves = [];
  for (const receipt of accepted) {
    if (!receipt.moveId || ids.has(receipt.moveId) || !receipt.diagnosticToken)
      return unavailable("Missing or duplicated actual move identity");
    ids.add(receipt.moveId);
    const forMove = records.filter(
      (record) =>
        record.diagnosticToken === receipt.diagnosticToken &&
        (!record.moveId || record.moveId === receipt.moveId) &&
        (!record.operationId || record.operationId === receipt.operationId),
    );
    const stage = (phase: string) => {
      const found = forMove.filter((record) => record.phase === phase);
      return found.length === 1 ? found[0] : undefined;
    };
    const command = stage("move-command-entry");
    const plan = stage("plan-ready");
    const applyStart = stage("ui-apply-start");
    const applySuccess = stage("ui-apply-success");
    const frame = measurement.correlation;
    const input = inputs
      .filter(
        (entry) =>
          entry.trusted &&
          (entry.type === "drop" || entry.type === "touchend") &&
          entry.at >= measurement.startEpoch &&
          entry.at <= (command?.epochMs ?? -Infinity),
      )
      .sort((a, b) => b.at - a.at)[0];
    const timeline = [
      measurement.startEpoch,
      input?.at,
      command?.epochMs,
      plan?.epochMs,
      receipt.epochMs,
      worker.handlerDispatchEpoch,
      ...worker.durableCommitEpochs,
      worker.replyPostedEpoch,
      applyStart?.epochMs,
      applySuccess?.epochMs,
      measurement.startEpoch + measurement.domMs,
      frame.frame.epochMs,
    ];
    if (
      timeline.some((value) => !Number.isFinite(value)) ||
      timeline.some(
        (value, index) => index > 0 && value! < timeline[index - 1]!,
      )
    )
      return unavailable("Move stages are missing, duplicated or out of order");
    moves.push({
      operationId: receipt.operationId,
      moveId: receipt.moveId,
      diagnosticToken: receipt.diagnosticToken,
      draggedItemId: receipt.draggedItemId,
      sourceColumn: receipt.sourceColumn,
      targetColumn: receipt.targetColumn,
      input: {
        measurementId: measurement.measurementId,
        startEpoch: measurement.startEpoch,
        actualEvent: input,
        trace: frame.input,
        commandEntry: command,
      },
      plan,
      queueAccepted: receipt,
      worker,
      uiApply: { start: applyStart, success: applySuccess },
      dom: {
        epochMs: measurement.startEpoch + measurement.domMs,
        ...frame.dom,
      },
      paint: frame.paint,
      drawFrame: frame.drawFrame,
      frame: frame.frame,
      interpretation:
        "Actual per-move receipt and command token joined to the shared persistence batch and the content-verified measurement frame; Worker and frame stages may be shared by moves in one batch",
    });
  }
  return { status: "available" as const, moves };
}
