// "Save my unsent changes" file for the move to Firebase (issue #130).
// The new app's import (#127) reads this format; see docs/move-runbook.md.

export const UNSENT_CHANGES_FORMAT = 'local-catch-unsent-changes';
export const UNSENT_CHANGES_VERSION = 1;

// Bookkeeping fields that mean nothing outside this app's sync layer.
const INTERNAL_FIELDS = new Set([
  'scope', 'syncStatus', 'revision', 'serverRevision',
  'guestSourceId', 'conflict', 'serverVersion', 'is_private',
]);

function publicFields(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !INTERNAL_FIELDS.has(key)));
}

// serverId is the record's id in Neon: null for a record that never reached
// the server, set for an edit to one that did (the copy from Neon holds the
// older version of it).
function yieldFields(record) {
  const { id, serverId, species, product, yield: yieldValue, source, createdAt, updatedAt } = record;
  return { id, serverId: serverId ?? null, species, product, yield: yieldValue, source: source ?? null, createdAt, updatedAt };
}

function calcFields(record) {
  return { ...publicFields(record), serverId: record.serverId ?? null };
}

function summary(record) {
  return { id: record.id, serverId: record.serverId ?? null, species: record.species ?? null, product: record.product ?? null };
}

// 'conflicted' is a local edit the server refused because it changed there too;
// 'conflict-delete' is a local delete in the same situation.
const isUnsentEdit = (record) => ['local', 'conflicted', undefined].includes(record.syncStatus);
const isPendingDelete = (record) => ['pending-delete', 'conflict-delete'].includes(record.syncStatus);
const PUBLICATION_INTENTS = { 'pending-publish': 'publish', 'pending-unpublish': 'unpublish' };

/**
 * Build the file from records that never reached the server.
 * @param {Object} parts
 * @param {Array} parts.accountCalcs  - signed-in user's pending calcs (repo.getPendingSync().calcs)
 * @param {Array} parts.accountYields - signed-in user's pending yields
 * @param {Array} parts.accountConflicts - signed-in user's conflicted yields (repo.getConflictedYields())
 * @param {Array} parts.guestCalcs    - every calc saved on this device as a guest
 * @param {Array} parts.guestYields   - every custom yield saved on this device as a guest
 */
export function buildUnsentChangesFile({
  accountCalcs = [], accountYields = [], accountConflicts = [], guestCalcs = [], guestYields = [],
  exportedAt = new Date().toISOString(),
} = {}) {
  const calcs = [...accountCalcs, ...guestCalcs];
  const yields = [...accountYields, ...accountConflicts, ...guestYields];
  return {
    format: UNSENT_CHANGES_FORMAT,
    version: UNSENT_CHANGES_VERSION,
    exportedAt,
    customYields: yields.filter(isUnsentEdit).map(yieldFields),
    savedCalculations: calcs.filter(isUnsentEdit).map(calcFields),
    // Deletions that never reached the server: the copy from Neon will still
    // contain these, so the owner can remove them again in the new app.
    pendingDeletes: {
      customYields: yields.filter(isPendingDelete).map(summary),
      savedCalculations: calcs.filter(isPendingDelete).map(summary),
    },
    // Publish or unpublish requests that never reached the server.
    pendingPublication: calcs
      .filter((record) => PUBLICATION_INTENTS[record.syncStatus])
      .map((record) => ({ ...summary(record), intent: PUBLICATION_INTENTS[record.syncStatus] })),
  };
}

export function countUnsentChanges(file) {
  return file.customYields.length
    + file.savedCalculations.length
    + file.pendingDeletes.customYields.length
    + file.pendingDeletes.savedCalculations.length
    + file.pendingPublication.length;
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
