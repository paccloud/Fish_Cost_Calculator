import React, { useEffect, useRef } from 'react';

export default function SignOutGuardModal({ calcs, yields, onKeep, onDiscard, onCancel }) {
  const parts = [];
  if (calcs > 0) parts.push(`${calcs} saved calc${calcs !== 1 ? 's' : ''}`);
  if (yields > 0) parts.push(`${yields} custom yield${yields !== 1 ? 's' : ''}`);
  const summary = parts.join(' and ');
  const plural = calcs + yields !== 1;

  const firstButtonRef = useRef(null);
  const triggerRef = useRef(document.activeElement);

  useEffect(() => {
    firstButtonRef.current?.focus();
    const trigger = triggerRef.current;
    return () => { trigger?.focus(); };
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-out-guard-title"
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
            ref={firstButtonRef}
            onClick={onKeep}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-lg bg-brand-teal text-white hover:bg-brand-teal/90 transition-colors"
          >
            Keep locally — save for next sign-in
          </button>
          <button
            onClick={onDiscard}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-lg border border-border bg-surface text-text-secondary hover:bg-brand-terracotta/10 hover:text-brand-terracotta hover:border-brand-terracotta/30 transition-colors"
          >
            Discard unsaved data and sign out
          </button>
          <button
            onClick={onCancel}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-lg text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
