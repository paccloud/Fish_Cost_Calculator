/**
 * Feature flag controlling whether the identity-scoped lifecycle
 * (LocalRepository + SyncCoordinator) is active for the current client.
 *
 * Precedence (highest to lowest):
 *   1. localStorage override  — for internal testing / emergency rollback
 *   2. VITE_LIFECYCLE_ENABLED  — deployment-time flag
 *   3. default: true           — lifecycle on by default
 *
 * Rollback: set localStorage.setItem('lifecycle_override', 'false') or
 * redeploy with VITE_LIFECYCLE_ENABLED=false.
 */

const LS_OVERRIDE_KEY = 'lifecycle_override';

export function isLifecycleEnabled() {
  try {
    const override = localStorage.getItem(LS_OVERRIDE_KEY);
    if (override !== null) return override !== 'false';
  } catch {
    // localStorage unavailable (SSR, privacy mode) — fall through
  }

  const envFlag = import.meta.env.VITE_LIFECYCLE_ENABLED;
  if (envFlag !== undefined) return envFlag !== 'false';

  return true;
}

/**
 * Force-enable the lifecycle for internal users regardless of env flag.
 * Does NOT override a 'false' localStorage value — a deliberate rollback wins.
 */
export function enableLifecycleForSession() {
  try {
    const existing = localStorage.getItem(LS_OVERRIDE_KEY);
    if (existing === 'false') return; // respect rollback
    localStorage.setItem(LS_OVERRIDE_KEY, 'true');
  } catch {
    // ignore
  }
}

/** Emergency rollback: disable lifecycle for this browser session. */
export function disableLifecycleForSession() {
  try {
    localStorage.setItem(LS_OVERRIDE_KEY, 'false');
  } catch {
    // ignore
  }
}
