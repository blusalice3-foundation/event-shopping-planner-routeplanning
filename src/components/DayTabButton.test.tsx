// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DayTabButton from "./DayTabButton";
afterEach(() => vi.useRealTimers());
function pointer(button: HTMLElement, type: string, options = {}) {
  const event = new Event(type === "pointerleave" ? "pointerout" : type, {
    bubbles: true,
  });
  Object.assign(event, { isPrimary: true, button: 0, ...options });
  fireEvent(button, event);
}
describe("day tab press", () => {
  it("runs the target day's long press once and suppresses its following click", () => {
    vi.useFakeTimers();
    const select = vi.fn(),
      longPress = vi.fn();
    render(
      <DayTabButton
        tab="2日目"
        label="2日目"
        active={false}
        onSelect={select}
        onLongPress={longPress}
      />,
    );
    const button = screen.getByRole("button");
    pointer(button, "pointerdown");
    act(() => vi.advanceTimersByTime(2000));
    pointer(button, "pointerup");
    fireEvent.click(button);
    expect(longPress).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(select).toHaveBeenCalledOnce();
  });
  it.each(["pointerup", "pointercancel", "pointerleave"])(
    "cancels the timer on %s before the threshold",
    (type) => {
      vi.useFakeTimers();
      const longPress = vi.fn();
      render(
        <DayTabButton
          tab="2日目"
          label="2日目"
          active={false}
          onSelect={vi.fn()}
          onLongPress={longPress}
        />,
      );
      const button = screen.getByRole("button");
      pointer(button, "pointerdown");
      pointer(button, type);
      act(() => vi.advanceTimersByTime(1000));
      expect(longPress).not.toHaveBeenCalled();
    },
  );
  it("clears pending timers when unmounted and ignores non-primary pointers", () => {
    vi.useFakeTimers();
    const longPress = vi.fn();
    const view = render(
      <DayTabButton
        tab="2日目"
        label="2日目"
        active={false}
        onSelect={vi.fn()}
        onLongPress={longPress}
      />,
    );
    const button = screen.getByRole("button");
    pointer(button, "pointerdown", { isPrimary: false });
    act(() => vi.advanceTimersByTime(1000));
    expect(longPress).not.toHaveBeenCalled();
    pointer(button, "pointerdown");
    view.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(longPress).not.toHaveBeenCalled();
  });
});
