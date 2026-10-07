// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  updatePriceSelectOptions,
  updateQuantitySelectOptions,
} from "./shoppingItemNativeSelectOptions";

describe("native select option templates", () => {
  it("reinitializes choices when React reuses a select for a different layout control", () => {
    const select = document.createElement("select");
    updatePriceSelectOptions(select, 1255);
    expect(select.options).toHaveLength(103);
    expect(select.value).toBe("1255");
    updateQuantitySelectOptions(select, 25);
    expect(select.options).toHaveLength(21);
    expect(select.value).toBe("25");
    expect(select.options[20].text).toBe("25（現在値）");
    updatePriceSelectOptions(select, null);
    expect(select.options).toHaveLength(102);
    expect(select.value).toBe("");
    expect(select.options[0].text).toBe("価格未定");
  });

  it("clones detached templates without sharing DOM children or poisoning later cards", () => {
    const first = document.createElement("select");
    const second = document.createElement("select");
    updatePriceSelectOptions(first, 500);
    updatePriceSelectOptions(second, 2000);
    expect(first.options[2]).not.toBe(second.options[2]);
    first.options[2].textContent = "changed";
    const third = document.createElement("select");
    updatePriceSelectOptions(third, 0);
    expect(second.options[2].text).toBe("100");
    expect(third.options[2].text).toBe("100");
    expect(first.value).toBe("500");
    expect(second.value).toBe("2000");
    expect(third.value).toBe("0");
  });

  it("uses the target document for cloned options", () => {
    const otherDocument = document.implementation.createHTMLDocument("other");
    const select = otherDocument.createElement("select");
    updateQuantitySelectOptions(select, 2);
    expect(select.options[0].ownerDocument).toBe(otherDocument);
    expect(select.value).toBe("2");
  });

  it.each([-5, 50, 1255, 10050])(
    "keeps custom price %s sorted without accumulating earlier custom choices",
    (price) => {
      const select = document.createElement("select");
      updatePriceSelectOptions(select, 123);
      updatePriceSelectOptions(select, price);
      const values = Array.from(select.options)
        .slice(1)
        .map((option) => Number(option.value));
      expect(values).toEqual(
        [
          ...new Set([
            0,
            ...Array.from({ length: 100 }, (_, index) => (index + 1) * 100),
            price,
          ]),
        ].sort((a, b) => a - b),
      );
      expect(select.options).toHaveLength(103);
      expect(select.value).toBe(String(price));
    },
  );

  it.each([NaN, Infinity])(
    "preserves the native select fallback for an invalid quantity %s",
    (quantity) => {
      const select = document.createElement("select");
      updateQuantitySelectOptions(select, quantity);
      expect(select.options).toHaveLength(20);
      expect(select.value).toBe("1");
    },
  );
});
