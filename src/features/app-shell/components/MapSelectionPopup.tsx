import { useId, useState, type ReactNode } from "react";

interface MapSelectionPopupProps {
  label: string;
  children: ReactNode;
}

export default function MapSelectionPopup({
  label,
  children,
}: MapSelectionPopupProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const contentId = useId();
  const buttonLabel = `${label}を${isMinimized ? "元の表示に戻す" : "最小化"}`;

  return (
    <section
      aria-label={label}
      className={`fixed z-50 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 ${
        isMinimized
          ? "bottom-4 left-4 h-11 w-11"
          : "bottom-4 left-1/2 -translate-x-1/2 p-4 min-w-80"
      }`}
      style={
        isMinimized
          ? {
              left: "max(1rem, env(safe-area-inset-left, 0px))",
              bottom: "max(1rem, env(safe-area-inset-bottom, 0px))",
            }
          : undefined
      }
    >
      <button
        type="button"
        aria-label={buttonLabel}
        title={buttonLabel}
        aria-expanded={!isMinimized}
        aria-controls={contentId}
        onClick={(event) => {
          event.stopPropagation();
          setIsMinimized((previous) => !previous);
        }}
        className={`flex items-center justify-center text-xl leading-none text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
          isMinimized
            ? "h-full w-full rounded-lg"
            : "absolute top-1 right-1 h-8 w-8 rounded"
        }`}
      >
        <span aria-hidden="true">{isMinimized ? "□" : "−"}</span>
      </button>
      <div id={contentId} hidden={isMinimized}>
        {children}
      </div>
    </section>
  );
}
