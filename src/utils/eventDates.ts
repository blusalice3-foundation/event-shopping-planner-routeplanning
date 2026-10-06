import { ShoppingItem } from "../types/item";
import { normalizeExecutionVisitDay } from "./visitProjection";

export function extractEventDates(items: ShoppingItem[]): string[] {
  const eventDates = new Set<string>();
  items.forEach((item) => {
    const eventDate = normalizeExecutionVisitDay(item.eventDate);
    if (eventDate) {
      eventDates.add(eventDate);
    }
  });

  return Array.from(eventDates).sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
    const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b, "ja");
  });
}
