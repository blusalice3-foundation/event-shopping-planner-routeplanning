import type { ReactElement } from "react";
import { STANDARD_PRICE_CHOICES } from "./shoppingItemNativeSelectOptions";
import {
  buildQuantityOptions,
  isStandardQuantityOption,
} from "./quantityOptions";

const standardPriceOptions = STANDARD_PRICE_CHOICES.map(({ value, label }) => (
  <option key={value === null ? "" : value} value={value === null ? "" : value}>
    {label}
  </option>
));
const standardQuantityOptions = buildQuantityOptions().map((quantity) => (
  <option key={quantity} value={quantity}>
    {quantity}
  </option>
));

export const getPriceOptionElements = (
  currentPrice: number | null,
): readonly ReactElement[] => {
  if (
    currentPrice === null ||
    STANDARD_PRICE_CHOICES.some(({ value }) => value === currentPrice)
  )
    return standardPriceOptions;
  const options = [...standardPriceOptions];
  const index = STANDARD_PRICE_CHOICES.findIndex(
    ({ value }) => value !== null && value > currentPrice,
  );
  options.splice(
    index < 0 ? options.length : index,
    0,
    <option key={currentPrice} value={currentPrice}>
      {currentPrice.toLocaleString()}
    </option>,
  );
  return options;
};

export const getQuantityOptionElements = (
  currentQuantity: number,
): readonly ReactElement[] => {
  if (isStandardQuantityOption(currentQuantity)) return standardQuantityOptions;
  return buildQuantityOptions(currentQuantity).map(
    (quantity) =>
      standardQuantityOptions[quantity - 1] ?? (
        <option key={quantity} value={quantity}>
          {quantity}（現在値）
        </option>
      ),
  );
};
