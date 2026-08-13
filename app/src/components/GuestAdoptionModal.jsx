import React from 'react';
import { ArrowRight, FolderOpen } from 'lucide-react';

/**
 * Modal shown at sign-in when guest-owned records exist.
 * Asks the user whether to move them into their account or leave them as guest data.
 *
 * Props:
 *   calcs   {number} - count of adoptable saved calculations
 *   yields  {number} - count of adoptable custom yields
 *   loading {boolean} - true while adoption is in progress
 *   onConfirm {() => void}
 *   onDecline {() => void}
 */
export default function GuestAdoptionModal({ calcs, yields, loading, onConfirm, onDecline }) {
  const parts = [];
  if (calcs > 0) parts.push(`${calcs} saved calculation${calcs !== 1 ? 's' : ''}`);
  if (yields > 0) parts.push(`${yields} custom yield${yields !== 1 ? 's' : ''}`);
  const summary = parts.join(' and ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
            <FolderOpen className="text-blue-600 dark:text-blue-300" size={22} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Move guest data to your account?
          </h2>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-300">
          You have {summary} saved as guest data. Moving them to your account
          keeps them accessible across devices and backs them up automatically.
        </p>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Declining leaves guest data on this device only and excludes it from
          account sync.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? (
              <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <ArrowRight size={16} />
            )}
            Move to my account
          </button>
          <button
            onClick={onDecline}
            disabled={loading}
            className="flex-1 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            Keep as guest data
          </button>
        </div>
      </div>
    </div>
  );
}
