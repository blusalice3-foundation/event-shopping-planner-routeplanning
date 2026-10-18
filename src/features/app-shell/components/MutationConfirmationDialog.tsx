import { useLayoutEffect } from "react";
import type { useApplicationSnapshot } from "../../../app/state/useApplicationSnapshot";
import { useModalDialogBehavior } from "../../../hooks/useModalDialogBehavior";

export function MutationConfirmationDialog({
  application,
}: {
  application: Pick<
    ReturnType<typeof useApplicationSnapshot>,
    "confirmations" | "isConfirmationBusy" | "cancel" | "confirm" | "choose"
  >;
}) {
  const pending = application.confirmations[0];
  const { dialogRef, onDialogKeyDown } = useModalDialogBehavior({
    isOpen: Boolean(pending),
    containExternalFocus: true,
    onEscape: () => {
      if (pending && !application.isConfirmationBusy)
        application.cancel(pending.token);
    },
  });
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!pending || !dialog) return;
    const active = document.activeElement;
    if (
      !dialog.contains(active) ||
      (active instanceof HTMLElement && active.matches(":disabled"))
    )
      (dialog.querySelector<HTMLElement>('[tabindex="0"]') ?? dialog).focus({
        preventScroll: true,
      });
  }, [dialogRef, pending, application.isConfirmationBusy]);
  if (!pending) return null;
  const { token, confirmation } = pending;
  return (
    <div
      ref={dialogRef}
      onKeyDown={onDialogKeyDown}
      className="fixed inset-0 z-[21000] bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={confirmation.title}
      aria-busy={application.isConfirmationBusy}
    >
      <section className="flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded bg-white p-5 dark:bg-slate-800">
        <h2 className="mb-3 shrink-0 text-lg font-bold">
          {confirmation.title}
        </h2>
        <div
          role="region"
          aria-label="確認内容"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {confirmation.choices?.map((choice) => (
            <label key={choice.id} className="block my-3 text-sm">
              <span className="block font-medium mb-1">{choice.label}</span>
              <select
                className="w-full rounded border p-2 bg-white text-slate-900 dark:bg-slate-700 dark:text-slate-100"
                value={choice.value}
                disabled={application.isConfirmationBusy}
                onChange={(event) =>
                  application.choose(token, choice.id, event.target.value)
                }
              >
                {choice.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {confirmation.details.map((detail, index) => (
            <pre
              key={index}
              className="whitespace-pre-wrap break-all text-sm my-3"
            >
              {detail}
            </pre>
          ))}
        </div>
        <div className="mt-4 flex shrink-0 gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button
            disabled={application.isConfirmationBusy}
            onClick={() => application.cancel(token)}
          >
            取消
          </button>
          <button
            className="bg-blue-600 text-white rounded px-4 py-2"
            disabled={application.isConfirmationBusy}
            onClick={() => application.confirm(token)}
          >
            確認して保存
          </button>
        </div>
      </section>
    </div>
  );
}
