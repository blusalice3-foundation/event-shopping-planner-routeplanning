import React, { createContext, useContext } from "react";

const ShoppingItemSelectionContext = createContext(false);
type CardBackground = {
  readonly isStriped: boolean;
  readonly blockBackgroundColor?: string;
};
const ShoppingItemBackgroundContext = createContext<CardBackground | null>(
  null,
);

export const ShoppingItemSelectionProvider =
  ShoppingItemSelectionContext.Provider;
export const ShoppingItemBackgroundProvider =
  ShoppingItemBackgroundContext.Provider;

type BackgroundProps = {
  unselectedBackgroundClassName?: string;
  blockColorEligible?: boolean;
};

const backgroundClassName = (
  background: CardBackground | null,
  blockColorEligible: boolean | undefined,
  info: boolean,
  fallback: string | undefined,
): string | undefined => {
  if (!background) return fallback;
  if (blockColorEligible && background.blockBackgroundColor) {
    return info
      ? "bg-transparent dark:bg-slate-900/45"
      : background.blockBackgroundColor;
  }
  if (info) {
    return background.isStriped
      ? "bg-blue-50/40 dark:bg-slate-900/25"
      : "bg-white/80 dark:bg-slate-800/35";
  }
  return background.isStriped
    ? "bg-blue-50/50 dark:bg-slate-900/50"
    : "bg-white dark:bg-slate-800";
};

export const ShoppingItemSelectionFrame = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & BackgroundProps
>(function ShoppingItemSelectionFrame(
  { className, unselectedBackgroundClassName, blockColorEligible, ...props },
  ref,
) {
  const selected = useContext(ShoppingItemSelectionContext);
  const currentBackground = useContext(ShoppingItemBackgroundContext);
  const background = selected
    ? "bg-blue-100 dark:bg-blue-900/50"
    : backgroundClassName(
        currentBackground,
        blockColorEligible,
        false,
        unselectedBackgroundClassName,
      );
  return (
    <div
      {...props}
      ref={ref}
      className={`${className ?? ""} ${background ?? ""}`}
    />
  );
});

export const ShoppingItemSelectionStripe = ({
  className = "absolute left-0 top-0 bottom-0 w-1.5 bg-blue-500",
}: {
  className?: string;
}) => {
  const selected = useContext(ShoppingItemSelectionContext);
  return <div className={selected ? className : `${className} invisible`} />;
};

export const ShoppingItemSelectionCheckbox = React.forwardRef<
  HTMLInputElement,
  Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "checked" | "defaultChecked"
  >
>(function ShoppingItemSelectionCheckbox(props, ref) {
  const selected = useContext(ShoppingItemSelectionContext);
  return <input {...props} ref={ref} checked={selected} />;
});

export const ShoppingItemSelectionInfoBackground = ({
  unselectedBackgroundClassName,
  blockColorEligible,
}: BackgroundProps) => {
  const selected = useContext(ShoppingItemSelectionContext);
  const currentBackground = useContext(ShoppingItemBackgroundContext);
  const background = selected
    ? "bg-blue-100/80 dark:bg-blue-900/30"
    : backgroundClassName(
        currentBackground,
        blockColorEligible,
        true,
        unselectedBackgroundClassName,
      );
  return (
    <div
      className={`absolute inset-0 rounded-lg pointer-events-none ${background ?? ""}`}
    />
  );
};

export const ShoppingItemSelectionWarning = ({
  children,
}: {
  children: React.ReactNode;
}) => (useContext(ShoppingItemSelectionContext) ? null : <>{children}</>);
