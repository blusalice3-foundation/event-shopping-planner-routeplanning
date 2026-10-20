import { useEffect, useMemo, useRef } from "react";
import type { FocusPhase } from "../../../types/focus";
import type { ShoppingItem } from "../../../types/item";

type VisitGroup = {
  key: string;
  items: ShoppingItem[];
};

interface UseAutoSkipEmptyVisitArgs {
  paused?: boolean;
  finishPhase: () => void;
  isCompleted: boolean;
  allVisitsLength: number;
  currentVisitDisplayItemsLength: number;
  currentPhaseVisits: VisitGroup[];
  currentPhaseIndex: number;
  currentPhase: FocusPhase;
  postponedPhaseItemIds: Set<string>;
  latePhaseItemIds: Set<string>;
  executeItems: ShoppingItem[];
  isResumeChoiceOpen: boolean;
  clearAutoAdvanceTimer: () => void;
  setPostponedPhaseItemIds: (ids: Set<string>) => void;
  setLatePhaseItemIds: (ids: Set<string>) => void;
  setNotification: (message: string) => void;
  setCurrentPhase: (phase: FocusPhase) => void;
  setCurrentPhaseIndex: (index: number) => void;
  setIsCompleted: (isCompleted: boolean) => void;
}

export function useAutoSkipEmptyVisit({
  paused = false,
  finishPhase,
  isCompleted,
  allVisitsLength,
  currentVisitDisplayItemsLength,
  currentPhaseVisits,
  currentPhaseIndex,
  currentPhase,
  postponedPhaseItemIds,
  latePhaseItemIds,
  executeItems,
  isResumeChoiceOpen,
  clearAutoAdvanceTimer,
  setPostponedPhaseItemIds,
  setLatePhaseItemIds,
  setNotification,
  setCurrentPhase,
  setCurrentPhaseIndex,
  setIsCompleted,
}: UseAutoSkipEmptyVisitArgs) {
  const autoAdvanceProcessedRef = useRef<string | null>(null);

  useEffect(() => {
    if (paused) {
      autoAdvanceProcessedRef.current = null;
      return;
    }

    if (isResumeChoiceOpen) {
      autoAdvanceProcessedRef.current = null;
      return;
    }

    if (isCompleted || allVisitsLength === 0) {
      autoAdvanceProcessedRef.current = null;
      return;
    }

    if (currentVisitDisplayItemsLength > 0) {
      autoAdvanceProcessedRef.current = null;
      return;
    }

    const position = `${currentPhase}:${currentPhaseIndex}`;
    if (autoAdvanceProcessedRef.current === position) return;
    autoAdvanceProcessedRef.current = position;

    for (let i = currentPhaseIndex + 1; i < currentPhaseVisits.length; i++) {
      const visit = currentPhaseVisits[i];
      let hasItems = false;
      if (currentPhase === "normal") {
        hasItems = visit.items.length > 0;
      } else if (currentPhase === "postponed") {
        hasItems = visit.items.some((item) =>
          postponedPhaseItemIds.has(item.id),
        );
      } else {
        hasItems = visit.items.some((item) => latePhaseItemIds.has(item.id));
      }
      if (hasItems) {
        setCurrentPhaseIndex(i);
        return;
      }
    }

    clearAutoAdvanceTimer();
    finishPhase();
  }, [
    finishPhase,
    paused,
    isCompleted,
    allVisitsLength,
    currentVisitDisplayItemsLength,
    currentPhaseVisits,
    currentPhaseIndex,
    currentPhase,
    postponedPhaseItemIds,
    latePhaseItemIds,
    executeItems,
    clearAutoAdvanceTimer,
    isResumeChoiceOpen,
    setPostponedPhaseItemIds,
    setLatePhaseItemIds,
    setNotification,
    setCurrentPhase,
    setCurrentPhaseIndex,
    setIsCompleted,
  ]);

  return useMemo(
    () =>
      !paused &&
      !isResumeChoiceOpen &&
      !isCompleted &&
      allVisitsLength > 0 &&
      currentVisitDisplayItemsLength === 0,
    [
      paused,
      isResumeChoiceOpen,
      isCompleted,
      allVisitsLength,
      currentVisitDisplayItemsLength,
    ],
  );
}
