import React, { createContext, useContext } from "react";

const ShoppingItemSelectionContext = createContext(false);

export const ShoppingItemSelectionProvider =
  ShoppingItemSelectionContext.Provider;

type BackgroundProps = {
  unselectedBackgroundClassName?: string;
};

export const ShoppingItemSelectionFrame = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & BackgroundProps
>(function ShoppingItemSelectionFrame(
  { className, unselectedBackgroundClassName, ...props },
  ref,
) {
  const selected = useContext(ShoppingItemSelectionContext);
  const background = selected
    ? "bg-blue-100 dark:bg-blue-900/50"
    : unselectedBackgroundClassName;
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
}: BackgroundProps) => {
  const selected = useContext(ShoppingItemSelectionContext);
  const background = selected
    ? "bg-blue-100/80 dark:bg-blue-900/30"
    : unselectedBackgroundClassName;
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
