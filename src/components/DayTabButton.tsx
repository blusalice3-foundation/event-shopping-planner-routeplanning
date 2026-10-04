import { useEffect, useRef } from "react";
export interface DayTabButtonProps {
  tab: string;
  label: string;
  count?: number;
  active: boolean;
  onSelect(): void;
  onLongPress?: () => void;
}
export default function DayTabButton({
  label,
  count,
  active,
  onSelect,
  onLongPress,
}: DayTabButtonProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const latest = useRef(onLongPress);
  latest.current = onLongPress;
  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => () => clear(), []);
  return (
    <button
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || !latest.current) return;
        clear();
        fired.current = false;
        timer.current = setTimeout(() => {
          timer.current = null;
          fired.current = true;
          latest.current?.();
        }, 500);
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onPointerLeave={clear}
      onClick={() => {
        clear();
        if (fired.current) {
          fired.current = false;
          return;
        }
        onSelect();
      }}
      className={`px-4 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${active ? "bg-blue-600 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"}`}
    >
      {label}
      {count !== undefined && (
        <span className="text-xs bg-slate-200 dark:bg-slate-700 rounded-full px-2 py-0.5 ml-1">
          {count}
        </span>
      )}
    </button>
  );
}
