import React, { useEffect, useRef } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Asked at sign-out when changes have not reached the cloud (issue #123).
 *
 * Props:
 *   waiting   {bool}      true while the app keeps waiting for a connection
 *   onWait    {Function}  keep waiting
 *   onDiscard {Function}  drop the unsent changes and sign out
 *   onCancel  {Function}  stay signed in (also stops waiting)
 */
export default function PendingWritesModal({ waiting, onWait, onDiscard, onCancel }) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(document.activeElement);

  useEffect(() => {
    const dialog = dialogRef.current;
    const focusable = dialog ? Array.from(dialog.querySelectorAll(FOCUSABLE)) : [];
    focusable[0]?.focus();
    const trigger = triggerRef.current;
    return () => { trigger?.focus(); };
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key !== 'Tab') return;
    const focusable = dialogRef.current ? Array.from(dialogRef.current.querySelectorAll(FOCUSABLE)) : [];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else if (document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onKeyDown={handleKeyDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-writes-title"
        aria-busy={waiting}
        className="bg-surface border border-border rounded-xl shadow-xl p-6 max-w-sm w-full mx-4"
      >
        <h2 id="pending-writes-title" className="text-lg font-semibold text-text-primary mb-2">
          Some changes haven't reached the cloud
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          {waiting
            ? 'Waiting for a connection. Your changes will be sent as soon as you are online.'
            : 'You seem to be offline. Wait for a connection so your changes are sent, or discard them and sign out now.'}
        </p>
        <div className="space-y-2">
          {!waiting && (
            <button
              onClick={onWait}
              className="w-full text-sm font-medium px-4 py-2.5 rounded-lg bg-brand-teal text-white hover:bg-brand-teal/90 transition-colors"
            >
              Wait for a connection
            </button>
          )}
          {!waiting && (
            <button
              onClick={onDiscard}
              className="w-full text-sm font-medium px-4 py-2.5 rounded-lg border border-border bg-surface text-text-secondary hover:bg-brand-terracotta/10 hover:text-link hover:border-brand-terracotta/30 transition-colors"
            >
              Discard the changes and sign out
            </button>
          )}
          <button
            onClick={onCancel}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-lg text-text-muted hover:text-text-primary transition-colors"
          >
            {waiting ? 'Stop waiting and stay signed in' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
