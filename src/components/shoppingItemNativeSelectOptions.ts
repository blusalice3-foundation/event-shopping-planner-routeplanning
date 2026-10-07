import {
  buildQuantityOptions,
  isStandardQuantityOption,
} from "./quantityOptions";

const standardPriceValues = [
  null,
  0,
  ...Array.from({ length: 100 }, (_, index) => (index + 1) * 100),
];
const templates = new WeakMap<
  Document,
  {
    price: DocumentFragment;
    quantity: DocumentFragment;
  }
>();
const customOptions = new WeakMap<HTMLSelectElement, HTMLOptionElement>();
const selectKinds = new WeakMap<HTMLSelectElement, "price" | "quantity">();
const createOption = (document: Document, value: string, label: string) => {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
};
const priceLabel = (price: number | null) =>
  price === null ? "価格未定" : price === 0 ? "0" : price.toLocaleString();

export const STANDARD_PRICE_CHOICES = standardPriceValues.map((value) => ({
  value,
  label: priceLabel(value),
}));

const getTemplates = (document: Document) => {
  let existing = templates.get(document);
  if (!existing) {
    const price = document.createDocumentFragment();
    const quantity = document.createDocumentFragment();
    for (const { value, label } of STANDARD_PRICE_CHOICES) {
      price.appendChild(
        createOption(document, value === null ? "" : String(value), label),
      );
    }
    for (const value of buildQuantityOptions()) {
      quantity.appendChild(
        createOption(document, String(value), String(value)),
      );
    }
    existing = { price, quantity };
    templates.set(document, existing);
  }
  return existing;
};

const initializeOptions = (
  select: HTMLSelectElement,
  kind: "price" | "quantity",
) => {
  if (selectKinds.get(select) === kind) return;
  select.replaceChildren(
    getTemplates(select.ownerDocument)[kind].cloneNode(true),
  );
  selectKinds.set(select, kind);
  customOptions.delete(select);
};

const replaceCustomOption = (select: HTMLSelectElement) => {
  customOptions.get(select)?.remove();
  customOptions.delete(select);
};

// React owns the select and its controlled value; this module owns only its
// option children. All choices exist during the ref commit, before paint/input.
// textContent escapes labels, and only detached templates are cloned/reused.
export const updatePriceSelectOptions = (
  select: HTMLSelectElement | null,
  currentPrice: number | null,
) => {
  if (!select) return;
  initializeOptions(select, "price");
  replaceCustomOption(select);
  if (currentPrice !== null && !standardPriceValues.includes(currentPrice)) {
    const option = createOption(
      select.ownerDocument,
      String(currentPrice),
      priceLabel(currentPrice),
    );
    const index = standardPriceValues.findIndex(
      (price) => price !== null && price > currentPrice,
    );
    select.insertBefore(option, index < 0 ? null : select.options[index]);
    customOptions.set(select, option);
  }
  select.value = currentPrice === null ? "" : String(currentPrice);
};

export const updateQuantitySelectOptions = (
  select: HTMLSelectElement | null,
  currentQuantity: number,
) => {
  if (!select) return;
  initializeOptions(select, "quantity");
  replaceCustomOption(select);
  const quantity = Number(currentQuantity);
  if (Number.isFinite(quantity) && !isStandardQuantityOption(quantity)) {
    const option = createOption(
      select.ownerDocument,
      String(quantity),
      String(quantity) + "（現在値）",
    );
    const index = buildQuantityOptions().findIndex((value) => value > quantity);
    select.insertBefore(option, index < 0 ? null : select.options[index]);
    customOptions.set(select, option);
  }
  select.value = String(currentQuantity);
  if (select.selectedIndex < 0) select.selectedIndex = 0;
};
