import type {
  ApplicationDayMutation,
  ApplicationDayScope,
} from "../../../app/ports/PersistenceCommandPort";
import { sameDay } from "./context";

export const dayScopeDays = (scope: ApplicationDayScope): readonly string[] => [
  scope.day,
  ...(scope.additionalDays ?? []),
];
export const matchesScopeDay = (scope: ApplicationDayScope, day: string) =>
  dayScopeDays(scope).some((candidate) => sameDay(candidate, day));
export const sameDayScope = (
  left: ApplicationDayScope,
  right: ApplicationDayScope,
) =>
  left.eventName === right.eventName &&
  dayScopeDays(left).every((day) => matchesScopeDay(right, day)) &&
  dayScopeDays(right).every((day) => matchesScopeDay(left, day));

export function dayMutationScope(
  command: ApplicationDayMutation,
): ApplicationDayScope {
  return {
    eventName: command.eventName,
    day: command.day,
    ...(command.kind === "visits" &&
    command.modeDay &&
    !sameDay(command.day, command.modeDay)
      ? { additionalDays: [command.modeDay] }
      : {}),
  };
}
