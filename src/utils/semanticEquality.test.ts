import { describe, expect, it } from "vitest";
import { semanticSignature } from "../app/commands/applicationMutationCoordinator";
import {
  jsonEqual,
  reuseEqualReferences,
  semanticEqual,
} from "./semanticEquality";

describe("canonical mutation equality", () => {
  it("matches canonical signatures for persisted values and JSON normalization", () => {
    const values: unknown[] = [
      undefined,
      null,
      false,
      true,
      0,
      1,
      "日本語",
      NaN,
      Infinity,
      [],
      [null],
      [undefined],
      new Array(1),
      { a: undefined },
      {},
      { a: 1, b: [null, { x: "金額" }] },
      { b: [undefined, { x: "金額" }], a: 1 },
      { a: [1, 2] },
      { a: [2, 1] },
    ];
    for (const left of values)
      for (const right of values)
        expect(semanticEqual(left, right)).toBe(
          semanticSignature(left) === semanticSignature(right),
        );
  });
  it("keeps JSON property ordering when selecting a persistence path", () => {
    const values = [
      null,
      0,
      NaN,
      Infinity,
      [],
      [null],
      [undefined],
      new Array(1),
      {},
      { a: undefined },
      { a: 1, b: { c: 2, d: 3 } },
      { b: { c: 2, d: 3 }, a: 1 },
      { a: 1, b: { d: 3, c: 2 } },
    ];
    for (const left of values)
      for (const right of values)
        expect(jsonEqual(left, right)).toBe(
          JSON.stringify(left) === JSON.stringify(right),
        );
    expect(semanticEqual(values[10], values[11])).toBe(true);
    expect(jsonEqual(values[10], values[11])).toBe(false);
  });
  it("keeps only unchanged immutable branches and never mutates either input", () => {
    const previous = {
      event: [
        { id: "1", price: 500 },
        { id: "2", price: 600 },
      ],
      map: { cells: [{ row: 1, col: 2 }] },
    };
    const next = structuredClone(previous);
    next.event[0].price = 700;
    const result = reuseEqualReferences(previous, next);
    expect(result).toEqual(next);
    expect(result).not.toBe(previous);
    expect(result.event[0]).not.toBe(previous.event[0]);
    expect(result.event[1]).toBe(previous.event[1]);
    expect(result.map).toBe(previous.map);
    expect(previous.event[0].price).toBe(500);
    expect(next.map).not.toBe(previous.map);
  });
  it("preserves changed property order while sharing unchanged child values", () => {
    const previous = { first: { value: 1 }, second: { value: 2 } };
    const next = { second: { value: 2 }, first: { value: 1 } };
    const result = reuseEqualReferences(previous, next);
    expect(Object.keys(result)).toEqual(["second", "first"]);
    expect(result.first).toBe(previous.first);
    expect(result.second).toBe(previous.second);
    expect(Object.keys(previous)).toEqual(["first", "second"]);
  });
  it("preserves own properties for event names that match prototype keys", () => {
    const previous = JSON.parse('{"__proto__":{"price":500},"constructor":[]}');
    const next = JSON.parse('{"__proto__":{"price":700},"constructor":[]}');
    const result = reuseEqualReferences(previous, next);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result).toEqual(next);
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(
      true,
    );
  });
});

it("preserves nested optional-field removal and array holes when sharing saved clones", () => {
  const previous: { nested: { quantity?: undefined }; array: unknown[] } = {
    nested: { quantity: undefined },
    array: new Array(1),
  };
  const next = { nested: {}, array: [undefined] };
  const value = reuseEqualReferences(previous, next);
  expect(value.nested).not.toHaveProperty("quantity");
  expect(Object.keys(value.array)).toEqual(["0"]);
  expect(previous.nested).toHaveProperty("quantity");
  expect(Object.keys(previous.array)).toEqual([]);
});
