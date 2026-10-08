/** Track visible navigation anchors once; scroll events never scan the whole DOM. */
export function observeNavigationAnchors(
  container: HTMLElement,
  kind: string,
  onChange: () => void,
) {
  const selector = `[data-space-navigation-visit-id][data-space-navigation-anchor="${kind}"]`;
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
    attributeFilter: [
      "data-space-navigation-visit-id",
      "data-space-navigation-anchor",
    ],
  });
  return {
    candidates: () => (intersection && receivedIntersection ? visible : all),
    dispose: () => {
      mutations.disconnect();
      intersection?.disconnect();
      all.clear();
      visible.clear();
    },
  };
}
