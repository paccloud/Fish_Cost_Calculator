/**
 * Aggregate, privacy-safe telemetry for the saved-data lifecycle.
 *
 * Privacy contract:
 *   - No calculation values, custom-yield payloads, species/product names
 *   - No access tokens or owner identifiers
 *   - Counts and durations only
 *
 * Emission:
 *   - window.va?.track() when Vercel Analytics is present
 *   - console.debug() in development
 */

const isDev = import.meta.env.DEV;

/**
 * Emit one telemetry event. Properties must be PII-free.
 *
 * @param {string} eventName  - lifecycle:<category>:<outcome>
 * @param {object} [props]    - numeric/boolean/string scalars; no user data
 */
export function track(eventName, props = {}) {
  const payload = { event: eventName, ...props };

  try {
    if (typeof globalThis.va?.track === 'function') {
      globalThis.va.track(eventName, props);
    }
  } catch {
    // Vercel Analytics call must not crash the app
  }

  if (isDev) {
    console.debug('[lifecycle]', payload); // eslint-disable-line no-console
  }
}

// ---------------------------------------------------------------------------
// Sync telemetry
// ---------------------------------------------------------------------------

export function trackSyncAttempt() {
  track('lifecycle:sync:attempt');
}

/**
 * @param {{ pushed: number, pulled: number, conflicts: number }} stats
 */
export function trackSyncSuccess(stats) {
  track('lifecycle:sync:success', {
    pushed: stats.pushed ?? 0,
    pulled: stats.pulled ?? 0,
    conflicts: stats.conflicts ?? 0,
  });
}

/**
 * @param {'auth'|'network'|'server'|'unknown'} category
 * @param {number} [consecutiveCount] - how many consecutive failures so far
 */
export function trackSyncFailure(category, consecutiveCount = 1) {
  track('lifecycle:sync:failure', { category, consecutiveCount });
}

/**
 * @param {number} pendingCount  - number of pending items
 * @param {number} oldestAgeMs   - age of the oldest pending item in ms; -1 if unknown
 */
export function trackPendingAge(pendingCount, oldestAgeMs) {
  track('lifecycle:sync:pending_age', { pendingCount, oldestAgeMs });
}

// ---------------------------------------------------------------------------
// Conflict telemetry
// ---------------------------------------------------------------------------

/** @param {'kept_local'|'kept_remote'|'merged'} outcome */
export function trackConflictResolved(outcome) {
  track('lifecycle:conflict:resolved', { outcome });
}

// ---------------------------------------------------------------------------
// Guest adoption telemetry
// ---------------------------------------------------------------------------

/**
 * @param {'accepted'|'declined'} decision
 * @param {number} calcsCount
 * @param {number} yieldsCount
 */
export function trackGuestAdoption(decision, calcsCount, yieldsCount) {
  track('lifecycle:adoption:guest', { decision, calcsCount, yieldsCount });
}

// ---------------------------------------------------------------------------
// Legacy migration telemetry
// ---------------------------------------------------------------------------

/**
 * @param {'success'|'failure'|'skipped'} outcome
 * @param {number} [recordCount]
 */
export function trackMigration(outcome, recordCount = 0) {
  track('lifecycle:migration:legacy', { outcome, recordCount });
}

// ---------------------------------------------------------------------------
// Duplicate prevention telemetry
// ---------------------------------------------------------------------------

export function trackDuplicatePrevented() {
  track('lifecycle:dedup:prevented');
}

// ---------------------------------------------------------------------------
// Publication queue telemetry
// ---------------------------------------------------------------------------

/** @param {'queued'|'flushed'|'failed'} outcome */
export function trackPublicationQueue(outcome) {
  track('lifecycle:publication:queue', { outcome });
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Evaluate sync health from accumulated stats and return a health object.
 *
 * @param {{
 *   consecutiveFailures: number,
 *   oldestPendingAgeMs: number,
 *   migrationFailed: boolean,
 * }} healthState
 * @returns {{ healthy: boolean, issues: string[] }}
 */
export function getSyncHealth(healthState) {
  const FAILURE_THRESHOLD = 5;       // consecutive failures before alert
  const PENDING_AGE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 h

  const issues = [];

  if (healthState.consecutiveFailures >= FAILURE_THRESHOLD) {
    issues.push(`sustained_sync_failure:${healthState.consecutiveFailures}`);
  }

  if (
    healthState.oldestPendingAgeMs > 0 &&
    healthState.oldestPendingAgeMs > PENDING_AGE_THRESHOLD_MS
  ) {
    issues.push(`pending_age_exceeded:${Math.round(healthState.oldestPendingAgeMs / 3600000)}h`);
  }

  if (healthState.migrationFailed) {
    issues.push('migration_failed');
  }

  return { healthy: issues.length === 0, issues };
}
