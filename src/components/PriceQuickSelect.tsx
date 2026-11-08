import {
  useLayoutEffect,
  useRef,
  useState,
  type SelectHTMLAttributes,
} from "react";
import { isAppleTouchWebKit } from "../utils/appleTouchWebKit";

/** Keep iOS VoiceOver swipe navigation from activating the native price picker. */
export function PriceQuickSelect(
  props: SelectHTMLAttributes<HTMLSelectElement>,
) {
  const [expanded, setExpanded] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const needsActivation = isAppleTouchWebKit();

  useLayoutEffect(() => {
    if (!needsActivation) return;
    if (expanded) selectRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      buttonRef.current?.focus();
    }
  }, [expanded, needsActivation]);

  if (!needsActivation) return <select {...props} />;

  const close = () => {
    restoreFocus.current = true;
    setExpanded(false);
  };
  return (
    <>
      <button
        ref={buttonRef}
        id={expanded ? undefined : props.id}
        type="button"
        className={props.className}
        disabled={props.disabled}
        aria-label={expanded ? "クイック選択を閉じる" : "クイック選択を開く"}
        aria-expanded={expanded}
        onClick={() => {
          if (expanded) close();
          else setExpanded(true);
        }}
      >
        {expanded ? "クイック選択を閉じる" : "クイック選択を開く"}
      </button>
      {expanded && (
        <select
          {...props}
          ref={selectRef}
          aria-label={props["aria-label"] ?? "クイック選択"}
          onChange={(event) => {
            props.onChange?.(event);
            close();
          }}
          onBlur={(event) => {
            props.onBlur?.(event);
            if (event.relatedTarget !== buttonRef.current) setExpanded(false);
          }}
          onKeyDown={(event) => {
            props.onKeyDown?.(event);
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        />
      )}
    </>
  );
}
