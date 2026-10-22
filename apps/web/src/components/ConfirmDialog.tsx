import { useEscapeKey } from "../lib/useEscapeKey.ts";

/**
 * In-app replacement for window.confirm(): embedded browsers (the Claude
 * desktop app's pane, some kiosk setups) silently cancel native dialogs, so
 * an action behind one looked broken. Same two-button contract.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeKey(onCancel);
  return (
    <div className="modal-backdrop pt-[18vh]" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-sm font-semibold text-fg-strong">
          {title}
        </h2>
        {body !== undefined && <p className="mt-2 text-sm text-fg-soft">{body}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-soft hover:bg-press"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              danger ? "bg-danger text-white hover:opacity-90" : "bg-accent text-on-accent hover:bg-accent-hover"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
