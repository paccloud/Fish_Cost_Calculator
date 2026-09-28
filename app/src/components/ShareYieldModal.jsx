import React, { useEffect, useRef } from 'react';
import { Share2, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buildSharePreviewFields } from '../lib/yieldSharing';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Confirmation shown before a custom yield row is shared with the public
 * community pool. Lists exactly which fields become public and how the row
 * will be attributed. Mirrors PreviewPublishModal.
 *
 * Props:
 *   pending   — { item, attribution: {status, contributor, organization}, sending } from createYieldShareFlow
 *   onConfirm — called when the user clicks "Share"
 *   onCancel  — called when the user cancels (no request is made)
 */
export default function ShareYieldModal({ pending, onConfirm, onCancel }) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const item = pending?.item;

  useEffect(() => {
    if (!item) return;
    triggerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = dialog ? Array.from(dialog.querySelectorAll(FOCUSABLE)) : [];
    focusable[0]?.focus();
    const trigger = triggerRef.current;
    return () => { trigger?.focus(); };
  }, [item]);

  if (!item) return null;

  const { attribution, sending } = pending;
  const loadingAttribution = attribution.status === 'loading';

  function handleKeyDown(e) {
    if (e.key === 'Escape') { if (!sending) onCancel(); return; }
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

  let contributorLabel;
  let attributionNote;
  if (loadingAttribution) {
    contributorLabel = 'Checking…';
  } else if (attribution.status === 'unavailable') {
    contributorLabel = 'Anonymous unless your profile is public';
    attributionNote = 'We could not load your contributor profile. Your display name and organization are shown only if your profile has "Show on contributors page" turned on; otherwise the row is Anonymous.';
  } else if (attribution.contributor || attribution.organization) {
    contributorLabel = attribution.contributor || 'Anonymous';
    attributionNote = 'Attributed from your public contributor profile. Turn off "Show on contributors page" to share anonymously.';
  } else {
    contributorLabel = 'Anonymous';
    attributionNote = 'Your account name and email are never shown. Add a public contributor profile if you want credit.';
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
        aria-labelledby="share-yield-title"
        className="bg-surface border border-border rounded-xl shadow-xl p-6 max-w-sm w-full mx-4"
      >
        <div className="flex items-center gap-2 mb-1">
          <Share2 size={18} className="text-brand-teal" />
          <h2 id="share-yield-title" className="text-base font-semibold text-text-primary">
            Share with community
          </h2>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          The following fields will become public in the Community Data Pool and its CSV download.
        </p>

        <div className="rounded-lg border border-border bg-surface/50 p-4 space-y-2 mb-3 text-sm">
          {buildSharePreviewFields(item).map((field) => (
            <Row key={field.label} label={field.label} value={field.value} />
          ))}
          <Row label="Contributor" value={contributorLabel} />
          {attribution.organization && (
            <Row label="Organization" value={attribution.organization} />
          )}
        </div>

        {attributionNote && (
          <p className="text-xs text-text-muted mb-5">
            {attributionNote}{' '}
            <Link to="/profile" onClick={onCancel} className="text-brand-teal hover:underline">Edit profile</Link>
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={sending}
            className="flex-1 text-sm font-medium px-4 py-2 rounded-lg border border-border bg-surface text-text-secondary hover:bg-surface/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={sending || loadingAttribution}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-brand-teal text-white hover:bg-brand-teal/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Share2 size={14} />
            {sending ? 'Sharing…' : 'Share'}
          </button>
        </div>

        <p className="mt-3 text-xs text-text-muted text-center">
          <Lock size={11} className="inline mr-0.5 relative -top-px" />
          You can stop sharing at any time from My Data.
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
