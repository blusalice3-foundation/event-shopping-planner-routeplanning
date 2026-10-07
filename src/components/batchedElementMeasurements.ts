import { flushSync } from "react-dom";

interface Measurement {
  readonly elements: Element[];
  readonly read: () => (() => void) | undefined;
  active: boolean;
}

const subscribers = new Map<Element, Set<Measurement>>();
const pending = new Set<Measurement>();
let observer: ResizeObserver | undefined;
let scheduled = false;

const schedule = (measurement: Measurement) => {
  pending.add(measurement);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const batch = [...pending];
    pending.clear();
    // Read every element before publishing any result that can change layout.
    const results = batch
      .filter((entry) => entry.active)
      .map((entry) => ({ entry, publish: entry.read() }));
    if (!results.some(({ entry, publish }) => entry.active && publish)) return;
    // Finish the shared update before paint or the next user input.
    flushSync(() => {
      for (const { entry, publish } of results) {
        if (entry.active) publish?.();
      }
    });
  });
};

export const observeBatchedElementMeasurements = (
  elements: readonly (Element | null)[],
  read: () => (() => void) | undefined,
): (() => void) => {
  const measurement: Measurement = {
    elements: [...new Set(elements.filter((element) => element !== null))],
    read,
    active: true,
  };
  if (measurement.elements.length === 0) return () => {};

  observer ??= new ResizeObserver((entries) => {
    for (const { target } of entries) {
      for (const subscriber of subscribers.get(target) ?? []) {
        schedule(subscriber);
      }
    }
  });

  for (const element of measurement.elements) {
    let elementSubscribers = subscribers.get(element);
    if (!elementSubscribers) {
      elementSubscribers = new Set();
      subscribers.set(element, elementSubscribers);
      observer.observe(element);
    }
    elementSubscribers.add(measurement);
  }
  schedule(measurement);

  return () => {
    measurement.active = false;
    pending.delete(measurement);
    for (const element of measurement.elements) {
      const elementSubscribers = subscribers.get(element);
      elementSubscribers?.delete(measurement);
      if (elementSubscribers?.size === 0) {
        subscribers.delete(element);
        observer?.unobserve(element);
      }
    }
    if (subscribers.size === 0) {
      observer?.disconnect();
      observer = undefined;
    }
  };
};
