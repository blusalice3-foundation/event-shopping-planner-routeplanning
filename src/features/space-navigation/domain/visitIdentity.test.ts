import { describe, expect, it, vi } from "vitest";
import {
  buildSpaceKey,
  buildVisitId,
  buildVisitIdentity,
  isSameVisit,
  normalizeBaseSpaceNumber,
  normalizeSpaceBlock,
} from "./visitIdentity";

describe("visitIdentity", () => {
  it("normalizes full-width text, case, whitespace, and a trailing sub-number", () => {
    expect(normalizeBaseSpaceNumber(" ０１Ａ２ ")).toBe("01a");
    expect(normalizeBaseSpaceNumber("15c3")).toBe("15c");
    expect(normalizeBaseSpaceNumber("01Ab12")).toBe("01ab");
  });

  it("does not strip meaningful digits from numbers without a letter suffix", () => {
    expect(normalizeBaseSpaceNumber("012")).toBe("012");
    expect(normalizeBaseSpaceNumber("42")).toBe("42");
  });

  it("normalizes a block without changing its case-sensitive identity", () => {
    expect(normalizeSpaceBlock(" Ａ  西 ")).toBe("A 西");
    expect(buildSpaceKey(" A ", "０１A2")).toBe("A-01a");
  });

  it("includes priority in every visit id", () => {
    expect(buildVisitId({ block: "A", number: "01" })).toBe("A-01:none");
    expect(
      buildVisitId({ block: "A", number: "01", priorityLevel: "highest" }),
    ).toBe("A-01:highest");
    expect(
      buildVisitId({ block: "A", number: "01", priorityLevel: "priority" }),
    ).toBe("A-01:priority");
  });

  it("includes the focus phase while retaining a readable space identity", () => {
    expect(
      buildVisitIdentity({
        phase: "normal",
        block: "A",
        number: "01",
        priorityLevel: "highest",
      }),
    ).toEqual({
      id: "normal:A-01:highest",
      spaceKey: "A-01",
      phase: "normal",
      block: "A",
      number: "01",
      priorityLevel: "highest",
    });
    expect(
      buildVisitId({
        phase: "postponed",
        block: "A",
        number: "01",
        priorityLevel: "highest",
      }),
    ).toBe("postponed:A-01:highest");
  });

  it("treats normalized aliases as the same visit but separates priority and phase", () => {
    expect(
      isSameVisit(
        { block: "Ａ", number: "01A2", priorityLevel: "none" },
        { block: "A", number: "01a", priorityLevel: "none" },
      ),
    ).toBe(true);
    expect(
      isSameVisit(
        { block: "A", number: "01a", priorityLevel: "highest" },
        { block: "A", number: "01a", priorityLevel: "priority" },
      ),
    ).toBe(false);
    expect(
      isSameVisit(
        { phase: "normal", block: "A", number: "01a" },
        { phase: "late", block: "A", number: "01a" },
      ),
    ).toBe(false);
  });
});

describe("normalization reuse", () => {
  it("retains the original Unicode normalization rules for cold and repeated inputs", () => {
    const inputs = [
      "",
      " ",
      "\u3000\t\n",
      "\uFEFFＡ\u2000西 ",
      "A",
      "a",
      " Ａ  西 ",
      "東\t\n甲",
      "01a",
      "０１Ａ２",
      " 01 a3 ",
      "01Ab12",
      "012",
      "12",
      "001",
      "1-2a3",
      "1あ2",
      "①Ａ２",
      "ﬀ",
      "İ",
      "E\u0301",
      "É",
      "😀１２Ａ３",
      'A\\"',
    ];
    for (const input of inputs) {
      const block = input.normalize("NFKC").trim().replace(/\s+/g, " ");
      const normalizedNumber = input
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, "")
        .toLowerCase();
      const matched = /^(\d+[a-z]+)\d*$/i.exec(normalizedNumber);
      const number = matched ? matched[1] : normalizedNumber;

      expect(normalizeBaseSpaceNumber(input)).toBe(number);
      expect(normalizeSpaceBlock(input)).toBe(block);
      expect(normalizeBaseSpaceNumber(input)).toBe(number);
      expect(normalizeSpaceBlock(input)).toBe(block);
    }
  });

  it("resolves current item strings independently of prior aliases and other items", () => {
    const original = { block: " Ａ ", number: "０１Ａ２" };
    const copy = { ...original };
    expect(buildSpaceKey(original.block, original.number)).toBe("A-01a");
    expect(buildVisitId(original)).toBe("A-01a:none");

    original.block = "B";
    original.number = "02b";
    expect(buildSpaceKey(original.block, original.number)).toBe("B-02b");
    expect(buildVisitId(original)).toBe("B-02b:none");
    expect(buildVisitId(copy)).toBe("A-01a:none");

    copy.block = "a";
    copy.number = "001";
    expect(buildVisitId(copy)).toBe("a-001:none");
    original.block = " Ａ ";
    original.number = "０１Ａ２";
    expect(buildVisitId(original)).toBe("A-01a:none");
  });

  it.each([
    ["number", normalizeBaseSpaceNumber],
    ["block", normalizeSpaceBlock],
  ] as const)(
    "bounds retained %s inputs and recomputes an evicted value",
    (kind, normalize) => {
      const normalization = vi.spyOn(String.prototype, "normalize");
      const raw = ` eviction ${kind} Ａ０１ `;
      try {
        const expected = normalize(raw);
        expect(normalization).toHaveBeenCalledTimes(1);
        expect(normalize(raw)).toBe(expected);
        expect(normalization).toHaveBeenCalledTimes(1);

        for (let index = 0; index < 5000; index++) {
          normalize(`eviction-${kind}-${index}`);
        }
        const before = normalization.mock.calls.length;
        expect(normalize(raw)).toBe(expected);
        expect(normalization).toHaveBeenCalledTimes(before + 1);
        expect(normalize(raw)).toBe(expected);
        expect(normalization).toHaveBeenCalledTimes(before + 1);
      } finally {
        normalization.mockRestore();
      }
    },
  );
});
