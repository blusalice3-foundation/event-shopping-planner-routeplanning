import type { ShoppingItem } from "../../../types/item";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
export const AcceptedItemContext = createContext<
  ((itemId: string) => ShoppingItem | undefined) | null
>(null);
export const ItemCommandContext = createContext<
  | ((
      items: readonly ShoppingItem[],
      options?: { saveImmediately?: boolean },
    ) => void)
  | null
>(null);
export function AcceptedItemCommandsProvider({
  read,
  commit,
  children,
}: {
  read: (itemId: string) => ShoppingItem | undefined;
  commit: (
    items: readonly ShoppingItem[],
    options?: { saveImmediately?: boolean },
  ) => void;
  children: ReactNode;
}) {
  return (
    <AcceptedItemContext.Provider value={read}>
      <ItemCommandContext.Provider value={commit}>
        {children}
      </ItemCommandContext.Provider>
    </AcceptedItemContext.Provider>
  );
}
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
