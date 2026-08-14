import React, { useEffect, useRef, useState } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function SignOutGuardModal({ calcs, yields, onKeep, onDiscard, onCancel }) {
  const parts = [];
  if (calcs > 0) parts.push(`${calcs} saved calc${calcs !== 1 ? 's' : ''}`);
  if (yields > 0) parts.push(`${yields} custom yield${yields !== 1 ? 's' : ''}`);
  const summary = parts.join(' and ');
  const plural = calcs + yields !== 1;

  const [processing, setProcessing] = useState(false);

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
    if (e.key === 'Escape') { if (!processing) { e.preventDefault(); onCancel(); } return; }
    if (e.key !== 'Tab') return;
    const focusable = dialogRef.current
      ? Array.from(dialogRef.current.querySelectorAll(FOCUSABLE))
      : [];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  async function handleKeep() {
    setProcessing(true);
    try { await onKeep(); } finally { setProcessing(false); }
  }

  async function handleDiscard() {
    setProcessing(true);
    try { await onDiscard(); } finally { setProcessing(false); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-out-guard-title"
        aria-busy={processing}
        className="bg-surface border border-border rounded-xl shadow-xl p-6 max-w-sm w-full mx-4"
      >
        <h2 id="sign-out-guard-title" className="text-lg font-semibold text-text-primary mb-2">
          Unsynchronized data
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          You have {summary} that {plural ? "haven't" : "hasn't"} been saved to the server yet.
          {' '}What would you like to do before signing out?
        </p>
        <div className="space-y-2">
          <button
            onClick={handleKeep}
            disabled={processing}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-lg bg-brand-teal text-white hover:bg-brand-teal/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {processing ? 'Working…' : 'Keep locally — save for next sign-in'}
          </button>
          <button
            onClick={handleDiscard}
            disabled={processing}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-lg border border-border bg-surface text-text-secondary hover:bg-brand-terracotta/10 hover:text-brand-terracotta hover:border-brand-terracotta/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Discard unsaved data and sign out
          </button>
          <button
            onClick={onCancel}
            disabled={processing}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-lg text-text-muted hover:text-text-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
