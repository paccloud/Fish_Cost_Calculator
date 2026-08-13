import React from 'react';
import { Cloud, CloudOff, Loader2, AlertCircle, CheckCircle, TriangleAlert, Clock } from 'lucide-react';
import { useData } from '../context/DataContext';

const CONFIG = {
  synced:   { icon: CheckCircle,   label: 'Synced',   color: 'text-green-500' },
  syncing:  { icon: Loader2,       label: 'Syncing…', color: 'text-brand-teal', spin: true },
  pending:  { icon: Clock,         label: 'Pending',  color: 'text-yellow-400' },
  offline:  { icon: CloudOff,      label: 'Offline',  color: 'text-text-muted' },
  error:    { icon: AlertCircle,   label: 'Error',    color: 'text-red-400' },
  conflict: { icon: TriangleAlert, label: 'Conflict', color: 'text-orange-400' },
  idle:     { icon: Cloud,         label: 'Idle',     color: 'text-text-muted' },
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
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10 ${color}`}
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
