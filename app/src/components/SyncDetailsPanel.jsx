import React from 'react';
import { X, RefreshCw, CloudOff, CheckCircle, AlertCircle, TriangleAlert, Clock } from 'lucide-react';
import { useData } from '../context/DataContext';

const STATUS_COPY = {
  synced:   { icon: CheckCircle,   text: 'All data is up to date.',            color: 'text-green-500' },
  syncing:  { icon: RefreshCw,     text: 'Synchronizing with server…',         color: 'text-brand-teal' },
  pending:  { icon: Clock,         text: 'Changes queued — syncing soon.',     color: 'text-yellow-400' },
  offline:  { icon: CloudOff,      text: 'You are offline. Changes saved locally.', color: 'text-text-muted' },
  error:    { icon: AlertCircle,   text: 'Sync encountered an error.',         color: 'text-red-400' },
  conflict: { icon: TriangleAlert, text: 'Conflict detected — retry to resolve.', color: 'text-orange-400' },
  idle:     { icon: CheckCircle,   text: 'Sync idle.',                         color: 'text-text-muted' },
};

export default function SyncDetailsPanel({ onClose }) {
  const { syncStatus, syncError, pendingCount, isOnline, retrySync } = useData();

  const { icon: StatusIcon, text: statusText, color } = STATUS_COPY[syncStatus] ?? STATUS_COPY.idle;
  const canRetry = (syncStatus === 'error' || syncStatus === 'conflict' || pendingCount > 0) && isOnline;
  const authError = syncError === 'auth';

  function handleRetry() {
    retrySync();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Sync details"
      className="absolute right-0 top-full mt-1 w-72 bg-surface-raised border border-line rounded-lg shadow-lg z-50 text-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <span className="font-semibold text-text-primary">Sync Status</span>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      {/* Status summary */}
      <div className="px-4 py-3 flex items-start gap-2">
        <StatusIcon size={16} className={`mt-0.5 shrink-0 ${color}`} />
        <p className="text-text-secondary leading-snug">{statusText}</p>
      </div>

      {/* Pending count */}
      {pendingCount > 0 && (
        <div className="px-4 pb-3">
          <p className="text-text-muted text-xs">
            {pendingCount} change{pendingCount !== 1 ? 's' : ''} waiting to sync
          </p>
        </div>
      )}

      {/* Auth error detail */}
      {authError && (
        <div className="mx-4 mb-3 p-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-300 text-xs">
          Session expired — sign out and sign back in to re-authenticate.
        </div>
      )}

      {/* Offline notice */}
      {!isOnline && (
        <div className="mx-4 mb-3 p-2 rounded bg-surface border border-line text-text-muted text-xs">
          Changes will sync automatically when you reconnect.
        </div>
      )}

      {/* Manual retry */}
      {canRetry && !authError && (
        <div className="px-4 pb-4">
          <button
            onClick={handleRetry}
            className="w-full flex items-center justify-center gap-1.5 bg-brand-teal hover:bg-brand-teal-light text-white rounded px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <RefreshCw size={13} />
            Retry Sync
          </button>
        </div>
      )}
    </div>
  );
}
