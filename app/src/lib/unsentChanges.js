// "Save my unsent changes" file for the move to Firebase (issue #130).
// The new app's import (#127) reads this format; see docs/move-runbook.md.

export const UNSENT_CHANGES_FORMAT = 'local-catch-unsent-changes';
export const UNSENT_CHANGES_VERSION = 1;

// Bookkeeping fields that mean nothing outside this app's sync layer.
const INTERNAL_FIELDS = new Set([
  'scope', 'syncStatus', 'serverId', 'revision', 'serverRevision',
  'guestSourceId', 'conflict', 'serverVersion', 'is_private',
]);

function publicFields(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !INTERNAL_FIELDS.has(key)));
}

function yieldFields(record) {
  const { id, species, product, yield: yieldValue, source, createdAt, updatedAt } = record;
  return { id, species, product, yield: yieldValue, source: source ?? null, createdAt, updatedAt };
}

function summary(record) {
  return { id: record.serverId ?? record.id, species: record.species ?? null, product: record.product ?? null };
}

const isNew = (record) => record.syncStatus === 'local' || record.syncStatus === undefined;
const isPendingDelete = (record) => record.syncStatus === 'pending-delete';

/**
 * Build the file from records that never reached the server.
 * @param {Object} parts
 * @param {Array} parts.accountCalcs  - signed-in user's pending calcs (repo.getPendingSync().calcs)
 * @param {Array} parts.accountYields - signed-in user's pending yields
 * @param {Array} parts.guestCalcs    - every calc saved on this device as a guest
 * @param {Array} parts.guestYields   - every custom yield saved on this device as a guest
 */
export function buildUnsentChangesFile({
  accountCalcs = [], accountYields = [], guestCalcs = [], guestYields = [], exportedAt = new Date().toISOString(),
} = {}) {
  const calcs = [...accountCalcs, ...guestCalcs];
  const yields = [...accountYields, ...guestYields];
  return {
    format: UNSENT_CHANGES_FORMAT,
    version: UNSENT_CHANGES_VERSION,
    exportedAt,
    customYields: yields.filter(isNew).map(yieldFields),
    savedCalculations: calcs.filter(isNew).map(publicFields),
    // Deletions that never reached the server: the copy from Neon will still
    // contain these, so the owner can remove them again in the new app.
    pendingDeletes: {
      customYields: yields.filter(isPendingDelete).map(summary),
      savedCalculations: calcs.filter(isPendingDelete).map(summary),
    },
  };
}

export function countUnsentChanges(file) {
  return file.customYields.length
    + file.savedCalculations.length
    + file.pendingDeletes.customYields.length
    + file.pendingDeletes.savedCalculations.length;
}

export function downloadUnsentChanges(file, { document: doc = globalThis.document } = {}) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = `local-catch-unsent-changes-${file.exportedAt.slice(0, 10)}.json`;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
