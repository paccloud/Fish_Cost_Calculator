import React from 'react';

export default function ConflictResolutionModal({ conflicts, onUseLocal, onUseServer, onKeepBoth }) {
  if (!conflicts || conflicts.length === 0) return null;

  const editConflicts = conflicts.filter((c) => c.syncStatus === 'conflicted');
  const deleteConflicts = conflicts.filter((c) => c.syncStatus === 'conflict-delete');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8">
      <div className="bg-surface border border-border rounded-xl shadow-xl p-6 max-w-lg w-full mx-4 my-auto">
        <h2 className="text-lg font-semibold text-text-primary mb-1">Sync conflict</h2>
        <p className="text-sm text-text-secondary mb-5">
          {conflicts.length === 1
            ? 'A yield entry was edited on another device at the same time.'
            : `${conflicts.length} yield entries have sync conflicts.`}
          {editConflicts.length > 0 && ' Choose how to resolve each edit conflict below.'}
        </p>
        <div className="space-y-5">
          {editConflicts.map((c) => (
            <EditConflictItem
              key={c.id}
              conflict={c}
              onUseLocal={() => onUseLocal(c.id)}
              onUseServer={() => onUseServer(c.id)}
              onKeepBoth={() => onKeepBoth(c.id)}
            />
          ))}
          {deleteConflicts.map((c) => (
            <DeleteConflictItem key={c.id} conflict={c} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EditConflictItem({ conflict, onUseLocal, onUseServer, onKeepBoth }) {
  const local = conflict.conflictLocal;
  const server = conflict.conflictServer;

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">
        {conflict.species} — {conflict.product}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <VersionCard label="Your edit" data={local} />
        <VersionCard label="Server version" data={server} />
      </div>
      <div className="space-y-1.5">
        <button
          onClick={onUseLocal}
          className="w-full text-sm font-medium px-4 py-2 rounded-lg bg-brand-teal text-white hover:bg-brand-teal/90 transition-colors"
        >
          Use local — retry my edit
        </button>
        <button
          onClick={onUseServer}
          className="w-full text-sm font-medium px-4 py-2 rounded-lg border border-border bg-surface text-text-secondary hover:bg-surface/80 transition-colors"
        >
          Use server — accept server version
        </button>
        <button
          onClick={onKeepBoth}
          className="w-full text-sm font-medium px-4 py-2 rounded-lg text-text-muted hover:text-text-primary transition-colors"
        >
          Keep both — save as a separate entry
        </button>
      </div>
    </div>
  );
}

function DeleteConflictItem({ conflict }) {
  const server = conflict.conflictServer;
  return (
    <div className="border border-amber-300 dark:border-amber-700 rounded-lg p-4 bg-amber-50 dark:bg-amber-900/20">
      <div className="text-xs font-medium text-amber-800 dark:text-amber-300 uppercase tracking-wide mb-2">
        Delete conflict — held for review
      </div>
      <p className="text-sm text-text-secondary">
        <span className="font-medium">{conflict.species} — {conflict.product}</span>: you deleted
        this yield, but the server has a newer version
        {server ? ` (${server.yield}%)` : ''}.
        {' '}No data has been deleted or restored automatically. Contact support or re-add manually if needed.
      </p>
    </div>
  );
}

function VersionCard({ label, data }) {
  const missing = !data;
  return (
    <div className={`rounded p-3 border ${missing ? 'border-dashed border-border opacity-60' : 'border-border bg-surface/50'}`}>
      <div className="text-xs font-medium text-text-muted mb-1">{label}</div>
      {missing ? (
        <div className="text-xs text-text-muted italic">Fetching…</div>
      ) : (
        <>
          <div className="text-sm font-semibold text-text-primary">
            {data.yield != null ? `${data.yield}%` : '—'}
          </div>
          <div className="text-xs text-text-secondary mt-0.5">
            {data.species} — {data.product}
          </div>
          {data.source && (
            <div className="text-xs text-text-muted mt-0.5">{data.source}</div>
          )}
        </>
      )}
    </div>
  );
}
