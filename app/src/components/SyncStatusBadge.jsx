import React from 'react';
import { Cloud, CloudOff, Loader2, AlertCircle, CheckCircle, TriangleAlert, Clock } from 'lucide-react';
import { useData } from '../context/DataContext';

// Colours are theme tokens that read on surface and surface-raised in both themes. The word
// always shows beside the icon, so the state never rests on colour alone.
const CONFIG = {
  synced:   { icon: CheckCircle,   label: 'Synced',        color: 'text-success' },
  syncing:  { icon: Loader2,       label: 'Syncing…',      color: 'text-accent', spin: true },
  pending:  { icon: Clock,         label: 'Waiting to sync', color: 'text-text-secondary' },
  offline:  { icon: CloudOff,      label: 'Offline',       color: 'text-text-secondary' },
  error:    { icon: AlertCircle,   label: 'Sync failed',   color: 'text-danger' },
  conflict: { icon: TriangleAlert, label: 'Needs a look',  color: 'text-link' },
  idle:     { icon: Cloud,         label: 'Not synced yet', color: 'text-text-secondary' },
};

/**
 * Sync status button for the Account screen.
 * Clicking opens the details panel (via onToggleDetails).
 */
export default function SyncStatusBadge({ onToggleDetails }) {
  const { syncStatus, pendingCount } = useData();
  const { icon: Icon, label, color, spin } = CONFIG[syncStatus] ?? CONFIG.idle;

  return (
    <button
      onClick={onToggleDetails}
      type="button"
      className={`flex min-h-target items-center gap-2 rounded-lg border border-line-strong bg-surface-raised px-3 text-sm font-semibold transition-colors hover:border-accent ${color}`}
    >
      <Icon size={16} aria-hidden="true" className={spin ? 'animate-spin' : ''} />
      <span>
        <span className="sr-only">Sync status: </span>
        {label}
        {pendingCount > 0 && syncStatus !== 'syncing' && (
          <span className="font-normal text-text-secondary tabular-nums"> · {pendingCount} to send</span>
        )}
      </span>
    </button>
  );
}
