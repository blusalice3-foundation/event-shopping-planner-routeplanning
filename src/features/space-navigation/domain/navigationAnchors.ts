/** Track visible navigation anchors once; scroll events never scan the whole DOM. */
export function observeViewportAnchors(
  container: HTMLElement,
  selector: string,
  onChange: () => void,
  attributeFilter = [
    "data-space-navigation-visit-id",
    "data-space-navigation-anchor",
  ],
) {
  const all = new Set<HTMLElement>();
  const visible = new Set<HTMLElement>();
  let receivedIntersection = false;
  const intersection =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            receivedIntersection = true;
            for (const entry of entries) {
              if (entry.isIntersecting)
                visible.add(entry.target as HTMLElement);
              else visible.delete(entry.target as HTMLElement);
            }
            onChange();
          },
          { rootMargin: "500px" },
        )
      : null;
  const add = (element: HTMLElement) => {
    if (all.has(element)) return;
    all.add(element);
    intersection?.observe(element);
  };
  const remove = (element: HTMLElement) => {
    all.delete(element);
    visible.delete(element);
    intersection?.unobserve(element);
  };
  const visit = (node: Node, action: (element: HTMLElement) => void) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(selector)) action(node);
    node.querySelectorAll<HTMLElement>(selector).forEach(action);
  };
  visit(container, add);
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        const element = record.target as HTMLElement;
        if (element.matches(selector)) add(element);
        else remove(element);
      } else {
        record.removedNodes.forEach((node) => visit(node, remove));
        record.addedNodes.forEach((node) => visit(node, add));
      }
    }
    onChange();
  });
  mutations.observe(container, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter,
  });
  const initialCandidates = () => {
    const candidates = new Set<HTMLElement>();
    const document = container.ownerDocument;
    const view = document.defaultView;
    if (typeof document.elementsFromPoint === "function" && view) {
      const rect = container.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(view.innerWidth - 1, rect.left + rect.width / 2),
      );
      for (let y = 0; y < view.innerHeight; y += 80) {
        for (const element of document.elementsFromPoint(x, y)) {
          const row = element.closest<HTMLElement>(selector);
          if (row && container.contains(row)) candidates.add(row);
        }
      }
    } else {
      // Environments without hit testing still avoid measuring the entire list.
      for (const element of all) {
        candidates.add(element);
        if (candidates.size >= 16) break;
      }
    }
    return candidates;
  };
  return {
    candidates: () =>
      intersection
        ? receivedIntersection
          ? visible
          : initialCandidates()
        : all,
    dispose: () => {
      mutations.disconnect();
      intersection?.disconnect();
      all.clear();
      visible.clear();
    },
  };
}

export function observeNavigationAnchors(
  container: HTMLElement,
  kind: string,
  onChange: () => void,
) {
  return observeViewportAnchors(
    container,
    `[data-space-navigation-visit-id][data-space-navigation-anchor="${kind}"]`,
    onChange,
  );
}
