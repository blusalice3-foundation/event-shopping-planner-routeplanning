import { describe, expect, it } from "vitest";
import { emptyApplicationSnapshot } from "../../app/state/useApplicationSnapshot";
import { createEventConsistency } from "../../types/consistency";
import {
  planEventDelete,
  planEventRename,
  planEventRestore,
} from "../consistency/domain/eventMutations";
import { applyChangedFields } from "../consistency/domain/mutations";
import { renameRecordKey } from "./recordOps";
import { analyzeDuplicateEventImport } from "./duplicateEvent";
import { createAppBackup, parseAppBackup } from "../../utils/appBackup";
import type { ShoppingItem } from "../../types/item";
const item: ShoppingItem = {
  id: "1",
  circle: "ユーザー登録",
  title: "本",
  eventDate: "1日目",
  block: "A",
  number: "01a",
  price: 500,
  remarks: "エラーが発生しました",
  quantity: 1,
  purchaseStatus: "Purchased",
};
describe.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
  "own event record %s",
  (name) => {
    it("creates, restores, renames, exports and removes the literal name without changing prototypes", () => {
      const source = {
        ...emptyApplicationSnapshot(),
        eventLists: { [name]: [item], other: [{ ...item, id: "other" }] },
        eventConsistency: {
          [name]: createEventConsistency(),
          other: createEventConsistency(),
        },
      };
      const parsed = parseAppBackup(createAppBackup(source));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("invalid backup");
      const restored = planEventRestore(
        emptyApplicationSnapshot(),
        parsed.data,
        name,
        name,
      ).snapshot;
      expect(
        Object.prototype.hasOwnProperty.call(restored.eventLists, name),
      ).toBe(true);
      expect(Object.getPrototypeOf(restored.eventLists)).toBe(Object.prototype);
      const renamed = planEventRename(restored, name, "別名").snapshot;
      expect(renamed.eventLists["別名"]).toEqual([item]);
      const back = planEventRename(renamed, "別名", name).snapshot;
      expect(back.eventLists[name]).toEqual([item]);
      expect(Object.getPrototypeOf(back.eventLists)).toBe(Object.prototype);
      expect(
        Object.prototype.hasOwnProperty.call(
          planEventDelete(back, name).snapshot.eventLists,
          name,
        ),
      ).toBe(false);
      const merged = applyChangedFields({}, { [name]: [item] }, {}) as Record<
        string,
        unknown
      >;
      expect(Object.prototype.hasOwnProperty.call(merged, name)).toBe(true);
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
      expect(renameRecordKey({ old: [item] }, "old", name)[name]).toEqual([
        item,
      ]);
    });
    it("does not recognize an inherited property as an existing event", () => {
      expect(
        analyzeDuplicateEventImport({
          eventName: name,
          incomingItems: [item],
          eventLists: {},
          eventMetadata: {},
        }).kind,
      ).toBe("create");
    });
  },
);
