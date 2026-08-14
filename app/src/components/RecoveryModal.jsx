import React from 'react';
import { Archive, LogIn, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Modal shown when unscoped legacy browser records are found after migration.
 *
 * Props:
 *   calcs        {number}   count of recovered saved calculations
 *   yields       {number}   count of recovered custom-yield observations
 *   isAuthenticated {bool}  whether a user is signed in
 *   assigning    {bool}     assignment in progress
 *   onAssign     {Function} copy recovery records into active account scope
 *   onDiscard    {Function} permanently remove recovery records
 *   onLater      {Function} dismiss modal without any action
 */
export default function RecoveryModal({ calcs, yields, isAuthenticated, assigning, onAssign, onDiscard, onLater }) {
  const total = calcs + yields;
  const parts = [];
  if (calcs > 0) parts.push(`${calcs} saved calculation${calcs !== 1 ? 's' : ''}`);
  if (yields > 0) parts.push(`${yields} yield observation${yields !== 1 ? 's' : ''}`);
  const summary = parts.join(' and ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
    >
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <Archive size={22} className="text-brand-terracotta mt-0.5 shrink-0" />
          <div>
            <h2 id="recovery-title" className="text-lg font-bold text-text-primary">
              Recovered data from a previous session
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              {total} record{total !== 1 ? 's were' : ' was'} found that {total !== 1 ? 'were' : 'was'} not
              yet synced to an account: {summary}. These records are held in a private recovery area
              and will not sync until you assign them.
            </p>
          </div>
        </div>

        {isAuthenticated ? (
          <div className="space-y-2">
            <button
              onClick={onAssign}
              disabled={assigning}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              {assigning ? 'Assigning…' : 'Add to my account'}
            </button>
            <div className="flex gap-2">
              <button
                onClick={onLater}
                disabled={assigning}
                className="flex-1 px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary border border-line rounded transition disabled:opacity-50"
              >
                Review later
              </button>
              <button
                onClick={onDiscard}
                disabled={assigning}
                className="px-4 py-2 text-sm font-medium text-red-500 hover:text-red-400 border border-line rounded transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 size={14} />
                Discard
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-text-secondary">
              Sign in to assign these records to your account.
            </p>
            <div className="flex gap-2">
              <Link
                to="/login"
                className="flex-1 btn-primary text-center flex items-center justify-center gap-2"
                onClick={onLater}
              >
                <LogIn size={16} />
                Sign in
              </Link>
              <button
                onClick={onLater}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary border border-line rounded transition"
              >
                Later
              </button>
              <button
                onClick={onDiscard}
                className="px-4 py-2 text-sm font-medium text-red-500 hover:text-red-400 border border-line rounded transition flex items-center gap-1.5"
              >
                <Trash2 size={14} />
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
