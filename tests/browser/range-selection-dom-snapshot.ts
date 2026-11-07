// This function is serialized by Playwright and runs entirely in the browser.
// Navigation may use mounted geometry; selection/order evidence comes only from DOM reads.
export async function readRangeSelectionDomSnapshot({
  count,
  strategy = "adaptive",
}: {
  count: number;
  strategy?: "adaptive" | "fixed";
}) {
  const seen = new Map<string, boolean>();
  const positions = new Map<number, string>();
  const idPositions = new Map<string, number>();
  const traversal = {
    strategy,
    steps: 0,
    adaptiveSteps: 0,
    fallbackSteps: 0,
    fallbackReason: null as string | null,
  };
  const paint = async () => {
    await new Promise(requestAnimationFrame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise(requestAnimationFrame);
  };
  const collect = () => {
    const mounted: Array<{ position: number; row: HTMLElement }> = [];
    let firstNewPosition = Infinity;
    document
      .querySelectorAll<HTMLElement>("[data-item-id]")
      .forEach((entry) => {
        const input = entry.querySelector<HTMLInputElement>(
          'input[type="checkbox"]',
        );
        if (!input) return;
        const id = entry.dataset.itemId!;
        const accessibleRow = entry.closest<HTMLElement>("[aria-posinset]");
        const position = Number(accessibleRow?.getAttribute("aria-posinset"));
        if (
          !Number.isInteger(position) ||
          position < 1 ||
          position > count ||
          accessibleRow?.getAttribute("aria-setsize") !== String(count)
        )
          throw new Error(
            `Invalid displayed position: ${id}, position=${position}`,
          );
        if (positions.has(position) && positions.get(position) !== id)
          throw new Error(`Two IDs at displayed position ${position}`);
        if (idPositions.has(id) && idPositions.get(id) !== position)
          throw new Error(`Displayed position changed during scan: ${id}`);
        if (entry.dataset.isSelected !== String(input.checked))
          throw new Error(`Selection attribute mismatch: ${id}`);
        if (!positions.has(position))
          firstNewPosition = Math.min(firstNewPosition, position);
        positions.set(position, id);
        idPositions.set(id, position);
        seen.set(id, input.checked);
        mounted.push({
          position,
          row: accessibleRow!,
        });
      });
    let contiguousThrough = 0;
    while (positions.has(contiguousThrough + 1)) contiguousThrough++;
    // A far-away pinned focus row must never authorize skipping unseen positions.
    const contiguousMounted = mounted.filter(
      ({ position }) => position <= contiguousThrough,
    );
    const last = contiguousMounted.reduce<
      { position: number; row: HTMLElement } | undefined
    >(
      (highest, entry) =>
        !highest || entry.position > highest.position ? entry : highest,
      undefined,
    );
    const bottom =
      seen.size < count && strategy !== "fixed" && last
        ? last.row.getBoundingClientRect().bottom + scrollY
        : undefined;
    return { contiguousThrough, bottom, firstNewPosition };
  };
  const initialScrollAttempts: Array<{
    scrollY: number;
    firstMounted: boolean;
    focusedItemId: string | null;
  }> = [];
  const startAtTop = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      scrollTo({ top: 0, left: 0, behavior: "instant" });
      await paint();
      const firstMounted = Boolean(
        document.querySelector('[data-item-id="r1"] input[type="checkbox"]'),
      );
      initialScrollAttempts.push({
        scrollY,
        firstMounted,
        focusedItemId:
          document.activeElement?.closest<HTMLElement>("[data-item-id]")
            ?.dataset.itemId ?? null,
      });
      if (scrollY <= 1 && firstMounted) return collect();
    }
    // Fallback is for traversal coverage only; a failed first-row proof is fatal.
    throw new Error(
      `DOM scan could not reach the first row: ${JSON.stringify(initialScrollAttempts)}`,
    );
  };
  let observed = await startAtTop();
  let fixedTraversal = strategy === "fixed";
  let previous = -1;
  let phaseSteps = 0;
  while (seen.size < count && phaseSteps < count * 4) {
    const beforeScroll = scrollY;
    const beforeContiguous = observed.contiguousThrough;
    const bottom = document.documentElement.scrollHeight - innerHeight;
    const step = Math.max(100, innerHeight * 0.65);
    const fixedNext = Math.min(bottom, beforeScroll + step);
    // Keep at least the original 35% viewport overlap with already observed rows.
    const observedNext =
      observed.bottom !== undefined && Number.isFinite(observed.bottom)
        ? observed.bottom - innerHeight * 0.35
        : fixedNext;
    const next = fixedTraversal
      ? fixedNext
      : Math.min(bottom, Math.max(fixedNext, observedNext));
    const adaptiveStep = !fixedTraversal && next > fixedNext + 1;
    scrollTo(0, next);
    await paint();
    observed = collect();
    traversal.steps++;
    phaseSteps++;
    if (adaptiveStep) traversal.adaptiveSteps++;
    if (fixedTraversal && strategy !== "fixed") traversal.fallbackSteps++;
    let fallbackReason: string | null = null;
    if (!fixedTraversal && seen.size < count) {
      if (
        adaptiveStep &&
        observed.contiguousThrough === beforeContiguous &&
        observed.firstNewPosition > beforeContiguous + 1
      )
        fallbackReason = "gap-after-adaptive-step";
      else if (scrollY <= beforeScroll)
        fallbackReason = "scroll-did-not-advance";
      else if (scrollY >= bottom - 1) fallbackReason = "incomplete-at-bottom";
      else if (phaseSteps >= count * 4) fallbackReason = "adaptive-step-limit";
    }
    if (fallbackReason) {
      traversal.fallbackReason = fallbackReason;
      // Recheck every position on the original fixed-step route. Never catch or
      // discard any duplicate, position, or checkbox/attribute inconsistency.
      seen.clear();
      // Preserve identity/position history so the fallback cannot hide a change.
      observed = await startAtTop();
      fixedTraversal = true;
      previous = -1;
      phaseSteps = 0;
      continue;
    }
    if (scrollY === previous || (scrollY >= bottom - 1 && seen.size === count))
      break;
    previous = scrollY;
  }
  // These are actual accessible display positions, never item-ID ordering.
  const rowPositions = [...positions]
    .filter(([, id]) => seen.has(id))
    .sort(([left], [right]) => left - right);
  const observedOrder = rowPositions.map(([, id]) => id);
  return {
    initialScrollAttempts,
    observedOrder,
    rowPositions,
    selectedIds: observedOrder.filter((id) => seen.get(id)),
    traversal,
  };
}
