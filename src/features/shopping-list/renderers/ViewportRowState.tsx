import type { ShoppingItem } from "../../../types/item";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type SetStateAction,
} from "react";
export const AcceptedItemContext = createContext<
  ((itemId: string) => ShoppingItem | undefined) | null
>(null);
export type CardExpansion = ReadonlySet<"circle" | "title">;
export const ViewportRowStateContext = createContext<Map<
  string,
  CardExpansion
> | null>(null);
/** State belongs to the list and survives releasing a card's controls. */
export function useCardExpansion(itemId: string) {
  const states = useContext(ViewportRowStateContext);
  const [value, setValue] = useState<CardExpansion>(
    () => states?.get(itemId) ?? new Set(),
  );
  const update = useCallback(
    (action: SetStateAction<CardExpansion>) => {
      setValue((previous) => {
        const next = typeof action === "function" ? action(previous) : action;
        states?.set(itemId, next);
        return next;
      });
    },
    [itemId, states],
  );
  return [value, update] as const;
}
