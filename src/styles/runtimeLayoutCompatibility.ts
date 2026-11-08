/** CSP-safe compatibility path: mutate only rules in our external stylesheet. */
const SHEET_MARKER = "--esp-runtime-layout-sheet";
const OWNER_ATTRIBUTE = "data-esp-runtime-layout";
const attributeProperties = {
  "data-footer-height": "--footer-height",
  "data-app-header-height": "--app-header-height",
  "data-layout-left": "left",
  "data-layout-right": "right",
  "data-layout-top": "top",
  "data-layout-width": "width",
  "data-layout-max-width": "max-width",
  "data-layout-height": "height",
  "data-layout-translate-y": "transform",
  "data-nav-left": "left",
  "data-nav-right": "right",
} as const;

type LayoutProperty =
  | (typeof attributeProperties)[keyof typeof attributeProperties]
  | "--esp-body-scroll-left"
  | "--esp-body-scroll-top";
const allowedProperties = new Set<string>([
  ...Object.values(attributeProperties),
  "--esp-body-scroll-left",
  "--esp-body-scroll-top",
]);
interface Entry {
  rule: CSSStyleRule;
  sheet: CSSStyleSheet;
}
const entries = new Map<Element, Entry>();
let nextId = 0;
const sheetCache = new WeakMap<
  Document,
  { owner: CSSStyleSheet; layout: CSSStyleSheet }
>();

function findLayoutSheet(): CSSStyleSheet | null {
  const cached = sheetCache.get(document);
  if (cached && Array.from(document.styleSheets).includes(cached.owner))
    return cached.layout;
  const find = (sheet: CSSStyleSheet): CSSStyleSheet | null => {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSImportRule) {
          const found = rule.styleSheet && find(rule.styleSheet);
          if (found) return found;
        } else if (
          rule instanceof CSSStyleRule &&
          rule.style.getPropertyValue(SHEET_MARKER).trim() === "1"
        ) {
          return sheet;
        }
      }
    } catch {
      // Unrelated cross-origin stylesheets are deliberately inaccessible.
    }
    return null;
  };
  for (const sheet of Array.from(document.styleSheets)) {
    if (
      !sheet.href ||
      new URL(sheet.href, document.baseURI).origin !== location.origin
    )
      continue;
    const found = find(sheet);
    if (found) {
      sheetCache.set(document, { owner: sheet, layout: found });
      return found;
    }
  }
  return null;
}

function entryFor(element: Element): Entry | null {
  const existing = entries.get(element);
  if (existing) return existing;
  const sheet = findLayoutSheet();
  if (!sheet) return null;
  const id = String(++nextId);
  // Repetition gives this rule precedence over static class defaults.
  const selector = `[${OWNER_ATTRIBUTE}="${id}"][${OWNER_ATTRIBUTE}="${id}"]`;
  const index = sheet.insertRule(`${selector} {}`, sheet.cssRules.length);
  const entry = { sheet, rule: sheet.cssRules[index] as CSSStyleRule };
  element.setAttribute(OWNER_ATTRIBUTE, id);
  entries.set(element, entry);
  return entry;
}

function validValue(value: string): boolean {
  return (
    value.length <= 300 &&
    /^[\da-z\s.+\-*/()%,]+$/i.test(value) &&
    !/\b(?:url|attr|expression)\s*\(/i.test(value)
  );
}

/** Only numeric layout expressions; no URLs, selectors, or arbitrary CSS. */
export function setRuntimeLayoutProperties(
  element: Element,
  properties: Partial<Record<LayoutProperty, string>>,
): void {
  const valid = Object.entries(properties).filter(
    ([property, value]) => allowedProperties.has(property) && validValue(value),
  );
  if (valid.length === 0) return;
  const entry = entryFor(element);
  if (!entry) return;
  for (const [property, value] of valid) {
    if (entry.rule.style.getPropertyValue(property) !== value)
      entry.rule.style.setProperty(property, value);
  }
}

export function clearRuntimeLayoutProperties(element: Element): void {
  const entry = entries.get(element);
  if (!entry) return;
  const index = Array.from(entry.sheet.cssRules).indexOf(entry.rule);
  if (index >= 0) entry.sheet.deleteRule(index);
  entries.delete(element);
  element.removeAttribute(OWNER_ATTRIBUTE);
}

/** No observer or CSSOM work at all in browsers with native typed attr(). */
export function installRuntimeLayoutCompatibility(): () => void {
  if (
    typeof CSS !== "undefined" &&
    CSS.supports(
      "height",
      "attr(data-layout-height type(<length-percentage>), auto)",
    )
  )
    return () => {};
  const selector = Object.keys(attributeProperties)
    .map((name) => `[${name}]`)
    .join(",");
  const sync = (element: Element) => {
    const properties: Partial<Record<LayoutProperty, string>> = {};
    for (const [attribute, property] of Object.entries(attributeProperties)) {
      const value = element.getAttribute(attribute);
      if (value !== null && validValue(value))
        properties[property] =
          property === "transform" ? `translateY(${value})` : value;
    }
    const entry = entries.get(element);
    if (entry) {
      for (const property of new Set(Object.values(attributeProperties))) {
        if (!(property in properties))
          entry.rule.style.removeProperty(property);
      }
    }
    setRuntimeLayoutProperties(element, properties);
    if (entry && entry.rule.style.length === 0)
      clearRuntimeLayoutProperties(element);
  };
  const scan = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (node.matches(selector)) sync(node);
    node.querySelectorAll(selector).forEach(sync);
  };
  const observer = new MutationObserver((records) => {
    const changed = new Set<Element>();
    const added = new Set<Node>();
    const removed: Node[] = [];
    for (const record of records) {
      if (record.type === "attributes") changed.add(record.target as Element);
      else {
        record.addedNodes.forEach((node) => added.add(node));
        removed.push(...Array.from(record.removedNodes));
      }
    }
    // Mutation observers run before rendering; updates do not wait for rAF.
    changed.forEach((element) => {
      if (element.isConnected) sync(element);
    });
    added.forEach((node) => {
      if (!node.isConnected) return;
      // A committed parent already includes all its inserted descendants.
      for (let parent = node.parentNode; parent; parent = parent.parentNode) {
        if (added.has(parent)) return;
      }
      scan(node);
    });
    // Search only removed subtrees, never the entire retained list on updates.
    const releaseRemoved = (element: Element) => {
      if (!element.isConnected) clearRuntimeLayoutProperties(element);
    };
    removed.forEach((node) => {
      if (!(node instanceof Element)) return;
      releaseRemoved(node);
      node.querySelectorAll(`[${OWNER_ATTRIBUTE}]`).forEach(releaseRemoved);
    });
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: Object.keys(attributeProperties),
    childList: true,
    subtree: true,
  });
  scan(document.documentElement);
  // A stylesheet still loading at startup is retried when its link completes.
  const loaded = (event: Event) => {
    if (event.target instanceof HTMLLinkElement) scan(document.documentElement);
  };
  document.addEventListener("load", loaded, true);
  return () => {
    observer.disconnect();
    document.removeEventListener("load", loaded, true);
    for (const element of entries.keys()) clearRuntimeLayoutProperties(element);
  };
}
