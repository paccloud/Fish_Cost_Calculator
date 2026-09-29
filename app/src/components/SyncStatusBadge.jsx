import React from 'react';
import { Cloud, CloudOff, Loader2, AlertCircle, CheckCircle, TriangleAlert, Clock } from 'lucide-react';
import { useData } from '../context/DataContext';

const CONFIG = {
  synced:   { icon: CheckCircle,   label: 'Synced',   color: 'text-green-300' },
  syncing:  { icon: Loader2,       label: 'Syncing…', color: 'text-brand-yellow', spin: true },
  pending:  { icon: Clock,         label: 'Pending',  color: 'text-yellow-300' },
  offline:  { icon: CloudOff,      label: 'Offline',  color: 'text-white/80' },
  error:    { icon: AlertCircle,   label: 'Error',    color: 'text-red-300' },
  conflict: { icon: TriangleAlert, label: 'Conflict', color: 'text-orange-300' },
  idle:     { icon: Cloud,         label: 'Idle',     color: 'text-white/80' },
};

/**
 * Compact sync status badge for the NavBar.
 * Clicking opens the details panel (via onToggleDetails).
 */
export default function SyncStatusBadge({ onToggleDetails }) {
  const { syncStatus, pendingCount } = useData();
  const { icon: Icon, label, color, spin } = CONFIG[syncStatus] ?? CONFIG.idle;

  return (
    <button
      onClick={onToggleDetails}
      className={`flex min-h-[2.75rem] items-center gap-1 px-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-white/10 ${color}`}
      title={`Sync status: ${label}${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`}
      aria-label={`Sync status: ${label}`}
    >
      <Icon size={14} className={spin ? 'animate-spin' : ''} />
      <span className="hidden sm:inline">{label}</span>
      {pendingCount > 0 && syncStatus !== 'syncing' && (
        <span className="bg-current/20 rounded-full px-1 text-[10px] leading-none py-0.5">
          {pendingCount}
        </span>
      )}
    </button>
  );
}
