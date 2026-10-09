import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MutationPlan,
  MutationChoices,
} from "./applicationMutationCoordinator";
import { planDayModeToggle } from "../../features/consistency/domain/dayMode";
import {
  duplicateEventDays,
  planDayMerge,
} from "../../features/consistency/domain/dayMerge";
import type { ApplicationMutationPort } from "../ports/ApplicationMutationPort";
import {
  existingDayKey,
  getContextHalls,
  getDayConsistency,
  hallGroupKey,
  resolveDayMap,
  resolveDayKey,
  sameDay,
} from "../../features/consistency/domain/context";
import { createMembershipResolver } from "../../features/consistency/domain/membership";
import { applyVisitHistory } from "../../features/consistency/domain/visitHistory";
import { planProjectedMutation } from "../../features/consistency/domain/mutations";
import type { DayMapData, HallDefinition } from "../../types/map";
import type { ActiveTab } from "../../features/app-shell/types";
import type { ShoppingItem } from "../../types/item";
import type { PersistenceSnapshot } from "../ports/PersistenceCommandPort";

type ExecuteModeItemsStore = PersistenceSnapshot["executeModeItems"];
type ExecuteModeItemsUpdater = (
  current: ExecuteModeItemsStore,
) => ExecuteModeItemsStore;

export interface MapVisitListStatePort {
  readonly generation?: number;
  readonly activeEventName: string | null;
  readonly activeEventDate: string;
  readonly isMapTab: boolean;
  readonly currentMapTabName: string | null;
  readonly executeModeItems: ExecuteModeItemsStore;
  readonly panelOpen: boolean;
  readonly panelMapTab: string | null;
  readonly hasUnsavedChanges: boolean;
  readonly originalOrder: readonly string[];
  readonly confirmDialogOpen: boolean;
  readonly pendingTabChange: ActiveTab | null;
}

export interface MapVisitListActionPort {
  updateExecuteModeItems(updater: ExecuteModeItemsUpdater): void;
  openPanel(mapTab: string, originalOrder: readonly string[]): void;
  setUnsaved(hasUnsavedChanges: boolean): void;
  requestConfirmClose(pendingTabChange: ActiveTab | null): void;
  closePanel(): void;
  confirmClose(): void;
  discardClose(): void;
}

export interface MapVisitListNavigationPort {
  navigateToTab(tab: ActiveTab): void;
}

export interface MapVisitListCommandPorts extends Pick<
  ApplicationMutationPort,
  "requestMutation"
> {
  readonly readCurrentSnapshot?: () => PersistenceSnapshot;
  readonly state: MapVisitListStatePort;
  readonly actions: MapVisitListActionPort;
  readonly navigation: MapVisitListNavigationPort;
}

export type MapVisitListTransitionResult =
  | "ignored"
  | "confirmation"
  | "navigated"
  | "pending";

export interface MapVisitListCommands {
  readonly historyVersion: number;
  openPanel(mapTab: string): void;
  updateOrder(items: readonly ShoppingItem[]): Promise<void>;
  saveChanges(): Promise<void>;
  discardChanges(): Promise<void>;
  requestClose(): MapVisitListTransitionResult;
  requestTabChange(
    tab: ActiveTab,
    afterTransition?: () => void,
  ): MapVisitListTransitionResult;
  requestDayModeChange(tab: ActiveTab): MapVisitListTransitionResult;
  confirmPendingTransition(): Promise<void>;
  discardPendingTransition(): Promise<void>;
}

interface VisitSession {
  event: string;
  day: string;
  map: string;
  generation: number;
  baseline: string[];
  latest: string[];
}
type SessionTransition = (
  snapshot: PersistenceSnapshot,
  choices?: MutationChoices,
) => MutationPlan;

/** Reviews source and target changes before either is persisted. */
function planSessionTransition(
  snapshot: PersistenceSnapshot,
  value: VisitSession,
  choices?: MutationChoices,
  transition?: SessionTransition,
): MutationPlan {
  const transitionPlan = transition?.(snapshot, choices);
  const sourceChoices = transition
    ? Object.fromEntries(
        Object.entries(choices ?? {})
          .filter(([key]) => key.startsWith("source:"))
          .map(([key, choice]) => [key.slice("source:".length), choice]),
      )
    : choices;
  const mergePlan = planDayMerge(
    transitionPlan?.snapshot ?? snapshot,
    value.event,
    value.day,
    undefined,
    sourceChoices,
  );

  const sourceReview = mergePlan.confirmation
    ? {
        ...mergePlan.confirmation,
        choices: mergePlan.confirmation.choices?.map((choice) => ({
          ...choice,
          id: transition ? `source:${choice.id}` : choice.id,
          label: transition ? `${value.day} / ${choice.label}` : choice.label,
        })),
      }
    : undefined;
  const review =
    transitionPlan?.confirmation && sourceReview
      ? {
          title: transitionPlan.confirmation.title,
          choices: [
            ...(transitionPlan.confirmation.choices ?? []),
            ...(sourceReview.choices ?? []),
          ],
          details: [
            ...transitionPlan.confirmation.details,
            ...sourceReview.details,
          ],
          comparison: {
            transition: transitionPlan.confirmation.comparison,
            source: sourceReview.comparison,
          },
        }
      : (sourceReview ?? transitionPlan?.confirmation);
  return { ...mergePlan, confirmation: review };
}
export const useMapVisitListCommands = ({
  state,
  actions,
  navigation,
  requestMutation,
  readCurrentSnapshot,
}: MapVisitListCommandPorts): MapVisitListCommands => {
  const current = useRef(state);
  current.current = state;
  const session = useRef<VisitSession | null>(null);
  const opening = useRef<{
    event: string;
    day: string;
    generation: number;
  } | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const pendingWrites = useRef(0);
  const pendingModeChange = useRef<ActiveTab | null>(null);
  const transitioning = useRef(false);
  const afterTransition = useRef<(() => void) | undefined>(undefined);
  const valid = useCallback(
    (value: VisitSession | null): value is VisitSession =>
      !!value &&
      value.event === current.current.activeEventName &&
      value.generation === (current.current.generation ?? 0),
    [],
  );
  const openPanel = useCallback(
    (map: string) => {
      const value = current.current;
      if (
        !value.activeEventName ||
        !value.activeEventDate ||
        map !== value.currentMapTabName
      )
        return;
      if (opening.current) return;
      const event = value.activeEventName;
      const requestedDay = value.activeEventDate;
      const generation = value.generation ?? 0;
      const target = { event, day: requestedDay, generation };
      const open = (snapshot?: PersistenceSnapshot) => {
        const days =
          snapshot?.executeModeItems[event] ??
          value.executeModeItems[event] ??
          {};
        const day = existingDayKey(days, requestedDay) ?? requestedDay;
        const selectedMap = snapshot
          ? getDayConsistency(snapshot.eventConsistency[event], day)
              ?.selectedMapKey
          : null;
        const resolvedMap = selectedMap ?? map;
        if (
          current.current.activeEventName !== event ||
          (current.current.generation ?? 0) !== generation ||
          !sameDay(current.current.activeEventDate, requestedDay) ||
          (current.current.currentMapTabName !== map &&
            current.current.currentMapTabName !== resolvedMap)
        )
          return;
        const ids = [...(days[day] ?? [])];
        session.current = {
          event,
          day,
          map: resolvedMap,
          generation,
          baseline: ids,
          latest: ids,
        };
        afterTransition.current = undefined;
        pendingModeChange.current = null;
        actions.openPanel(resolvedMap, ids);
      };
      const snapshot = readCurrentSnapshot?.();
      const duplicates = snapshot
        ? duplicateEventDays(snapshot, event).some((day) =>
            sameDay(day, requestedDay),
          )
        : resolveDayKey(value.executeModeItems[event], requestedDay).status ===
          "ambiguous";
      if (!duplicates) {
        open(snapshot);
        return;
      }
      opening.current = target;
      void requestMutation({
        events: [event],
        expectedGenerations: { [event]: generation },
        plan: (snapshot, choices) => {
          if (
            opening.current !== target ||
            current.current.activeEventName !== event ||
            (current.current.generation ?? 0) !== generation ||
            !sameDay(current.current.activeEventDate, requestedDay)
          )
            throw new Error("訪問リストの操作は終了しています。");
          return planDayMerge(
            snapshot,
            event,
            requestedDay,
            undefined,
            choices,
          );
        },
      })
        .then((snapshot) => {
          if (opening.current === target) open(snapshot);
        })
        .catch(() => {
          // The mutation port presents cancellation and persistence errors.
        })
        .finally(() => {
          if (opening.current === target) opening.current = null;
        });
    },
    [actions, readCurrentSnapshot, requestMutation],
  );
  useEffect(() => {
    const pending = opening.current;
    if (
      pending &&
      (state.activeEventName !== pending.event ||
        (state.generation ?? 0) !== pending.generation ||
        !sameDay(state.activeEventDate, pending.day))
    )
      opening.current = null;
    const value = session.current;
    if (!state.panelOpen) {
      session.current = null;
      pendingModeChange.current = null;
      afterTransition.current = undefined;
      return;
    }
    if (value && !valid(value)) {
      session.current = null;
      pendingModeChange.current = null;
      afterTransition.current = undefined;
      actions.closePanel();
      return;
    }
    if (!value) return;
    if (
      (state.activeEventDate !== value.day &&
        existingDayKey({ [value.day]: true }, state.activeEventDate) ===
          undefined) ||
      state.currentMapTabName !== value.map
    ) {
      if (state.hasUnsavedChanges || pendingWrites.current > 0) {
        if (!state.confirmDialogOpen)
          actions.requestConfirmClose(state.activeEventDate);
      } else if (state.currentMapTabName) openPanel(state.currentMapTabName);
    }
  }, [
    state.panelOpen,
    state.activeEventName,
    state.activeEventDate,
    state.currentMapTabName,
    state.generation,
    state.hasUnsavedChanges,
    state.confirmDialogOpen,
    actions,
    openPanel,
    valid,
  ]);
  const applyOrder = useCallback(
    (
      ids: readonly string[],
      dirty: boolean,
      transition?: (
        snapshot: PersistenceSnapshot,
        choices?: MutationChoices,
      ) => MutationPlan,
    ): Promise<void> => {
      const value = session.current;
      if (!valid(value)) return Promise.resolve();
      pendingWrites.current += 1;
      let rebase: { day: string; map: string; baseline: string[] } | undefined;
      const task = requestMutation({
        events: [value.event],
        expectedGenerations: { [value.event]: value.generation },
        plan: (snapshot, choices) => {
          if (!valid(value) || session.current !== value)
            throw new Error("訪問リストの操作は終了しています。");
          // Target mode changes and source-day merges share one confirmed commit.
          const sourceDuplicated = duplicateEventDays(
            snapshot,
            value.event,
          ).some((day) => sameDay(day, value.day));
          const mergePlan = planSessionTransition(
            snapshot,
            value,
            choices,
            transition,
          );
          snapshot = mergePlan.snapshot;
          rebase = undefined;
          const review = mergePlan.confirmation;
          const dayKey = existingDayKey(
            snapshot.executeModeItems[value.event],
            value.day,
          );
          if (!dayKey) return { snapshot, confirmation: review };
          const items = snapshot.eventLists[value.event] as ShoppingItem[];
          const day = getDayConsistency(
            snapshot.eventConsistency[value.event],
            dayKey,
          );
          const maps = snapshot.mapData[value.event] as
            | Record<string, DayMapData>
            | undefined;
          const mapKey = day?.selectedMapKey ?? value.map;
          const map = resolveDayMap(maps, dayKey, mapKey);
          const context = day?.maps[mapKey];
          if (sourceDuplicated || dayKey !== value.day || mapKey !== value.map)
            rebase = {
              day: dayKey,
              map: mapKey,
              baseline: [...snapshot.executeModeItems[value.event][dayKey]],
            };
          const halls = getContextHalls(
            snapshot.hallDefinitions[value.event] as Record<
              string,
              HallDefinition[]
            >,
            dayKey,
            mapKey,
          );
          const resolve = createMembershipResolver({
            items,
            day: dayKey,
            map,
            context,
            halls,
          });
          const order = applyVisitHistory(
            snapshot.executeModeItems[value.event][dayKey],
            ids,
            items,
            (item) =>
              hallGroupKey({
                hall: resolve(item).hall,
                priority: item.priorityLevel ?? "none",
              }),
          );
          const orderPlan = planProjectedMutation(
            snapshot,
            {
              executeModeItems: {
                ...snapshot.executeModeItems,
                [value.event]: {
                  ...snapshot.executeModeItems[value.event],
                  [dayKey]: order,
                },
              },
            },
            {
              eventName: value.event,
              day: dayKey,
              mapKey,
              confirm: false,
            },
          );
          if (!review) return orderPlan;
          const beforeOrder = snapshot.executeModeItems[value.event][dayKey];
          const afterOrder =
            orderPlan.snapshot.executeModeItems[value.event][dayKey];
          return {
            ...orderPlan,
            confirmation: {
              ...review,
              details: [
                ...review.details,
                `${value.day} の訪問順: ${JSON.stringify(beforeOrder)} → ${JSON.stringify(afterOrder)}`,
              ],
              comparison: {
                review: review.comparison,
                beforeOrder,
                afterOrder,
              },
            },
          };
        },
      }).then((snapshot) => {
        if (!valid(value) || session.current !== value) return;
        const day = existingDayKey(
          snapshot.executeModeItems[value.event],
          value.day,
        );
        value.latest = day
          ? [...snapshot.executeModeItems[value.event][day]]
          : [];
        if (day) value.day = day;
        if (rebase) {
          value.map = rebase.map;
          value.baseline = dirty ? rebase.baseline : [...value.latest];
          setHistoryVersion((version) => version + 1);
        }
        actions.setUnsaved(dirty);
      });
      const settled = task.finally(() => {
        pendingWrites.current -= 1;
        // Awaiters still receive this failure, while a later user action can retry.
        if (writes.current === settled) writes.current = Promise.resolve();
      });
      writes.current = settled;
      return settled;
    },
    [requestMutation, valid, actions],
  );
  const updateOrder = useCallback(
    (items: readonly ShoppingItem[]) =>
      applyOrder(
        items.map((item) => item.id),
        true,
      ),
    [applyOrder],
  );
  const saveChanges = useCallback(
    async (transition?: SessionTransition) => {
      await writes.current;
      const value = session.current;
      if (!valid(value)) return;
      let merged = false;
      const currentSnapshot = await requestMutation({
        events: [value.event],
        expectedGenerations: { [value.event]: value.generation },
        plan: (snapshot, choices) => {
          if (!valid(value) || session.current !== value)
            throw new Error("訪問リストの操作は終了しています。");
          const plan = planSessionTransition(
            snapshot,
            value,
            choices,
            transition,
          );
          merged = !!plan.confirmation;
          return plan;
        },
      });
      if (!valid(value) || session.current !== value) return;
      const currentDay = existingDayKey(
        currentSnapshot.executeModeItems[value.event],
        value.day,
      );
      if (merged || (currentDay && currentDay !== value.day))
        setHistoryVersion((version) => version + 1);
      if (currentSnapshot && currentDay) {
        value.day = currentDay;
        value.map =
          getDayConsistency(
            currentSnapshot.eventConsistency[value.event],
            currentDay,
          )?.selectedMapKey ?? value.map;
        value.latest = [
          ...currentSnapshot.executeModeItems[value.event][currentDay],
        ];
      }
      value.baseline = [...value.latest];
      actions.openPanel(value.map, value.baseline);
      actions.setUnsaved(false);
    },
    [valid, actions, requestMutation],
  );
  const discardChanges = useCallback(async () => {
    await writes.current;
    const value = session.current;
    if (!valid(value)) return;
    await applyOrder(value.baseline, false);
  }, [valid, applyOrder]);
  const requestClose = useCallback((): MapVisitListTransitionResult => {
    if (
      !current.current.panelOpen ||
      current.current.confirmDialogOpen ||
      transitioning.current
    )
      return "ignored";
    if (current.current.hasUnsavedChanges || pendingWrites.current > 0) {
      pendingModeChange.current = null;
      afterTransition.current = undefined;
      actions.requestConfirmClose(null);
      return "confirmation";
    }
    session.current = null;
    actions.closePanel();
    return "navigated";
  }, [actions]);
  const requestTabChange = useCallback(
    (tab: ActiveTab, after?: () => void): MapVisitListTransitionResult => {
      if (current.current.confirmDialogOpen || transitioning.current)
        return "ignored";
      opening.current = null;
      if (
        current.current.panelOpen &&
        (current.current.hasUnsavedChanges || pendingWrites.current > 0)
      ) {
        pendingModeChange.current = null;
        afterTransition.current = after;
        actions.requestConfirmClose(tab);
        return "confirmation";
      }
      session.current = null;
      if (current.current.panelOpen) actions.closePanel();
      navigation.navigateToTab(tab);
      after?.();
      return "navigated";
    },
    [actions, navigation],
  );
  const requestDayModeChange = useCallback(
    (tab: ActiveTab): MapVisitListTransitionResult => {
      const state = current.current;
      if (
        !state.activeEventName ||
        state.confirmDialogOpen ||
        transitioning.current
      )
        return "ignored";
      if (
        state.panelOpen &&
        (state.hasUnsavedChanges || pendingWrites.current > 0)
      ) {
        pendingModeChange.current = tab;
        afterTransition.current = undefined;
        actions.requestConfirmClose(tab);
        return "confirmation";
      }
      opening.current = null;
      const event = state.activeEventName;
      const generation = state.generation ?? 0;
      transitioning.current = true;
      void requestMutation({
        events: [event],
        expectedGenerations: { [event]: generation },
        dayMutation: { kind: "mode", eventName: event, day: tab },
        plan: (snapshot, choices) =>
          planDayModeToggle(snapshot, event, tab, choices),
      })
        .then(() => {
          if (
            current.current.activeEventName !== event ||
            (current.current.generation ?? 0) !== generation
          )
            return;
          session.current = null;
          if (current.current.panelOpen) actions.closePanel();
          navigation.navigateToTab(tab);
        })
        .catch(() => {
          // The application mutation port presents cancellation or persistence errors.
        })
        .finally(() => {
          transitioning.current = false;
        });
      return "pending";
    },
    [requestMutation, actions, navigation],
  );
  const finishTransition = useCallback(
    async (discard: boolean) => {
      if (
        !current.current.confirmDialogOpen ||
        !valid(session.current) ||
        transitioning.current
      )
        return;
      const value = session.current;
      const tab = current.current.pendingTabChange;
      const callback = afterTransition.current;
      const modeTab = pendingModeChange.current;
      transitioning.current = true;
      try {
        if (modeTab !== null) {
          await writes.current;
          if (!valid(value) || session.current !== value) return;
          if (discard) {
            await applyOrder(value.baseline, false, (snapshot, choices) =>
              planDayModeToggle(snapshot, value.event, modeTab, choices),
            );
          } else {
            await saveChanges((snapshot, choices) =>
              planDayModeToggle(snapshot, value.event, modeTab, choices),
            );
          }
        } else if (discard) await discardChanges();
        else await saveChanges();
      } finally {
        transitioning.current = false;
      }
      if (!valid(value) || session.current !== value) return;
      session.current = null;
      pendingModeChange.current = null;
      afterTransition.current = undefined;
      if (discard) actions.discardClose();
      else actions.confirmClose();
      if (tab !== null) navigation.navigateToTab(tab);
      callback?.();
    },
    [valid, discardChanges, saveChanges, applyOrder, actions, navigation],
  );
  return {
    historyVersion,
    openPanel,
    updateOrder,
    saveChanges,
    discardChanges,
    requestClose,
    requestTabChange,
    requestDayModeChange,
    confirmPendingTransition: () => finishTransition(false),
    discardPendingTransition: () => finishTransition(true),
  };
};
