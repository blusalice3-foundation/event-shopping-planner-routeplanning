// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSearchScrollRequest } from "./useSearchScrollRequest";

describe("search scroll request lifetime", () => {
  it("expires a pending request when its conditions change and does not replay it on return", () => {
    const rendered: Array<[string, string | null]> = [];
    const view = renderHook(
      ({ context }) => {
        const state = useSearchScrollRequest(context);
        rendered.push([context, state.searchScrollRequest?.itemId ?? null]);
        return state;
      },
      {
        initialProps: { context: "original" },
      },
    );
    act(() => view.result.current.request("110"));
    expect(view.result.current.searchScrollRequest?.itemId).toBe("110");
    view.rerender({ context: "changed conditions" });
    expect(view.result.current.searchScrollRequest).toBeNull();
    expect(rendered).not.toContainEqual(["changed conditions", "110"]);
    view.rerender({ context: "original" });
    expect(view.result.current.searchScrollRequest).toBeNull();
  });
  it("consumes a request once, repeats the same item, and ignores older acknowledgements", () => {
    const view = renderHook(() => useSearchScrollRequest("same search"));
    act(() => view.result.current.request("110"));
    const first = view.result.current.searchScrollRequest!.requestId;
    act(() => view.result.current.request("110"));
    const second = view.result.current.searchScrollRequest!.requestId;
    expect(second).toBeGreaterThan(first);
    act(() => view.result.current.consume(first));
    expect(view.result.current.searchScrollRequest?.requestId).toBe(second);
    act(() => view.result.current.consume(second));
    expect(view.result.current.searchScrollRequest).toBeNull();
  });
  it("clears a request when its event is replaced", () => {
    const view = renderHook(() =>
      useSearchScrollRequest("same event and items"),
    );
    act(() => view.result.current.request("110"));
    act(() => view.result.current.clear());
    expect(view.result.current.searchScrollRequest).toBeNull();
  });
});
