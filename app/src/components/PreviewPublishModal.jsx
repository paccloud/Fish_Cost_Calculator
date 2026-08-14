import React, { useEffect, useRef } from 'react';
import { Globe, Lock } from 'lucide-react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Shows the exact fields that will become public before the user confirms
 * publication of a saved calculation.
 *
 * Props:
 *   calc    — the local calc record { species, product, cost, yield, result, createdAt, name }
 *   loading — true while the publish API call is in flight
 *   onConfirm — called when the user clicks "Publish"
 *   onCancel  — called when the user cancels
 */
export default function PreviewPublishModal({ calc, loading, onConfirm, onCancel }) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!calc) return;
    triggerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = dialog ? Array.from(dialog.querySelectorAll(FOCUSABLE)) : [];
    focusable[0]?.focus();
    const trigger = triggerRef.current;
    return () => { trigger?.focus(); };
  }, [calc]);

  if (!calc) return null;

  function handleKeyDown(e) {
    if (e.key === 'Escape') { onCancel(); return; }
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

  const date = calc.createdAt
    ? new Date(calc.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '—';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-publish-title"
        className="bg-surface border border-border rounded-xl shadow-xl p-6 max-w-sm w-full mx-4"
      >
        <div className="flex items-center gap-2 mb-1">
          <Globe size={18} className="text-brand-teal" />
          <h2 id="preview-publish-title" className="text-base font-semibold text-text-primary">
            Publish calculation
          </h2>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          The following fields will become visible to the public community feed.
          Contributor attribution is anonymous by default.
        </p>

        {/* Snapshot preview */}
        <div className="rounded-lg border border-border bg-surface/50 p-4 space-y-2 mb-5 text-sm">
          {calc.name && (
            <Row label="Name" value={calc.name} />
          )}
          <Row label="Species" value={calc.species} />
          <Row label="Product" value={calc.product} />
          {calc.cost != null && calc.cost !== 0 && (
            <Row label="Cost / lb" value={`$${Number(calc.cost).toFixed(2)}`} />
          )}
          <Row label="Yield" value={`${calc.yield}%`} />
          <Row label="Result" value={`$${Number(calc.result).toFixed(2)} / lb`} />
          <Row label="Date" value={date} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 text-sm font-medium px-4 py-2 rounded-lg border border-border bg-surface text-text-secondary hover:bg-surface/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-brand-teal text-white hover:bg-brand-teal/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Globe size={14} />
            {loading ? 'Publishing…' : 'Publish'}
          </button>
        </div>

        <p className="mt-3 text-xs text-text-muted text-center">
          <Lock size={11} className="inline mr-0.5 relative -top-px" />
          You can unpublish at any time from My Data.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className="text-text-primary font-medium text-right truncate">{value}</span>
    </div>
  );
}
