/**
 * Share-with-community flow for custom yield rows (issue #26).
 *
 * Mirrors the saved-calc publish preview (requestPublish/confirmPublish):
 *  - Sharing is a two-step action: request() opens a preview listing exactly
 *    which fields become public and how they will be attributed; only
 *    confirm() calls the share API. cancel() makes no request.
 *  - Unsharing needs no confirmation and is sent immediately.
 *
 * Kept free of React so the flow can be unit-tested without a renderer;
 * DataManagement wires it to component state and ShareYieldModal.
 *
 * @module lib/yieldSharing
 */

import { isExplicitOptIn } from './contributorProfile';

/**
 * Public attribution for the current user's shared rows, given their
 * contributor profile (GET /api/contributor, null when none exists).
 *
 * Must match resolveCommunityAttribution in shared/handlers/communityData.js:
 * a name/organization is shown only when a profile exists AND show_on_page is
 * explicitly true (SQLite returns 1, Postgres returns true). Otherwise the
 * row is anonymous.
 *
 * @param {{display_name?: string|null, organization?: string|null, show_on_page?: boolean|number|null}|null} profile
 * @returns {{contributor: string|null, organization: string|null}}
 */
export function describeShareAttribution(profile) {
  const optedIn = isExplicitOptIn(profile?.show_on_page);
  if (!optedIn) return { contributor: null, organization: null };
  const clean = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return {
    contributor: clean(profile.display_name),
    organization: clean(profile.organization),
  };
}

/**
 * The fields of a yield row that become public when shared, in display order.
 * These are exactly the row fields the community feed returns (plus the
 * attribution shown separately).
 *
 * @param {{species: string, product: string, yield: number|string, source?: string|null}} item
 * @returns {{label: string, value: string}[]}
 */
export function buildSharePreviewFields(item) {
  return [
    { label: 'Species', value: String(item.species ?? '') },
    { label: 'Product', value: String(item.product ?? '') },
    { label: 'Yield', value: `${item.yield}%` },
    { label: 'Source', value: item.source ? String(item.source) : '—' },
  ];
}

async function readError(res, fallback) {
  try {
    const body = await res.json();
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Why a row cannot be shared right now, or null if it can.
 *
 * The share API publishes the SERVER copy of the row (it takes only the id),
 * while the preview shows the LOCAL fields. They are the same only when the
 * row is fully synced. A row with an unsynced local edit, a conflict, or a
 * pending delete would preview one thing and publish another, and sharing
 * bumps the server revision, which would then make the pending edit conflict.
 *
 * @param {{serverId?: string|number|null, syncStatus?: string}} item
 * @returns {string|null}
 */
export function getShareBlocker(item) {
  if (!item?.serverId) return 'Sync this entry before sharing it.';
  if (item.syncStatus !== 'synced') {
    return 'Sync your latest changes to this entry before sharing it, so what you preview is what gets published.';
  }
  return null;
}

/**
 * Create the share/unshare controller.
 *
 * Pending state emitted through onPendingChange is either null (no preview
 * open) or:
 *   { item, attribution: { status: 'loading'|'ready'|'unavailable', contributor, organization }, sending, error? }
 *
 * @param {Object} initialDeps
 * @param {{shareUserDataRaw: Function, unshareUserDataRaw: Function, getContributorProfile: Function}} initialDeps.client
 * @param {() => Promise<Record<string,string>>} [initialDeps.getHeaders]
 * @param {(pending: Object|null) => void} initialDeps.onPendingChange
 * @param {(item: Object, isShared: boolean) => void} [initialDeps.onSharingChanged]
 */
export function createYieldShareFlow(initialDeps) {
  const deps = { ...initialDeps };
  let pending = null;

  /**
   * Replace callbacks after creation (e.g. when a React component re-renders
   * with a new getAuthHeaders) without losing the open preview.
   */
  function configure(nextDeps) {
    Object.assign(deps, nextDeps);
  }

  function setPending(next) {
    pending = next;
    deps.onPendingChange?.(next);
  }

  async function headers() {
    return (await deps.getHeaders?.()) ?? {};
  }

  /** Open the share preview. Loads attribution (read-only); never shares. */
  async function request(item) {
    const blocker = getShareBlocker(item);
    if (blocker) return { ok: false, error: blocker };
    const opened = {
      item,
      attribution: { status: 'loading', contributor: null, organization: null },
      sending: false,
    };
    setPending(opened);
    let attribution;
    try {
      const profile = await deps.client.getContributorProfile(await headers());
      attribution = { status: 'ready', ...describeShareAttribution(profile) };
    } catch {
      attribution = { status: 'unavailable', contributor: null, organization: null };
    }
    // Ignore a late profile response unless THIS exact preview is still the
    // open one. Comparing the row is not enough: closing and reopening the same
    // row creates a new preview, and an older response must not mark it ready.
    if (pending !== opened) return { ok: true, action: 'preview' };
    setPending({ ...pending, attribution });
    return { ok: true, action: 'preview' };
  }

  /** Close the preview without sharing. Makes no request. */
  function cancel() {
    setPending(null);
  }

  /** Share the previewed row. The only path that calls the share API. */
  async function confirm() {
    const current = pending;
    if (!current || current.sending) return { ok: false };
    // Never publish a row whose attribution the preview could not show: while
    // the profile is loading or if loading failed, the server would still apply
    // the stored show_on_page consent and could credit a name the user never saw.
    if (current.attribution?.status !== 'ready') {
      return {
        ok: false,
        error: 'We could not confirm how this row will be credited. Close this and try again.',
      };
    }
    const { item } = current;
    const blocker = getShareBlocker(item);
    if (blocker) {
      setPending(null);
      return { ok: false, error: blocker };
    }
    setPending({ ...current, sending: true });
    try {
      const res = await deps.client.shareUserDataRaw(item.serverId, await headers());
      if (!res.ok) {
        const error = await readError(res, 'Failed to update sharing.');
        // Keep the failure on the pending state so the open dialog can show it
        // (a page-level banner would render behind the modal).
        if (pending?.item === item) setPending({ ...pending, sending: false, error });
        return { ok: false, error };
      }
      deps.onSharingChanged?.(item, true);
      setPending(null);
      return { ok: true, action: 'share' };
    } catch {
      const error = 'Network error occurred.';
      if (pending?.item === item) setPending({ ...pending, sending: false, error });
      return { ok: false, error };
    }
  }

  /** Remove a row from the community pool immediately (no confirmation). */
  async function unshare(item) {
    try {
      const res = await deps.client.unshareUserDataRaw(item.serverId, await headers());
      if (!res.ok) {
        return { ok: false, error: await readError(res, 'Failed to update sharing.') };
      }
      deps.onSharingChanged?.(item, false);
      return { ok: true, action: 'unshare' };
    } catch {
      return { ok: false, error: 'Network error occurred.' };
    }
  }

  /**
   * Entry point for the share/unshare icon: shared rows are unshared at once,
   * unshared rows open the confirmation preview.
   */
  async function toggle(item) {
    if (item.is_shared) return unshare(item);
    return request(item);
  }

  return { configure, request, cancel, confirm, unshare, toggle, getPending: () => pending };
}
