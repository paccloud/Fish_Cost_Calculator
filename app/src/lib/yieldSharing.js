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
  const optedIn = profile?.show_on_page === true || profile?.show_on_page === 1;
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
 * Create the share/unshare controller.
 *
 * Pending state emitted through onPendingChange is either null (no preview
 * open) or:
 *   { item, attribution: { status: 'loading'|'ready'|'unavailable', contributor, organization }, sending }
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
    // Ignore a late profile response if the preview was closed or replaced.
    if (pending?.item !== item) return;
    setPending({ ...pending, attribution });
  }

  /** Close the preview without sharing. Makes no request. */
  function cancel() {
    setPending(null);
  }

  /** Share the previewed row. The only path that calls the share API. */
  async function confirm() {
    const current = pending;
    if (!current || current.sending) return { ok: false };
    const { item } = current;
    if (!item.serverId) {
      setPending(null);
      return { ok: false, error: 'Sync this entry before sharing it.' };
    }
    setPending({ ...current, sending: true });
    try {
      const res = await deps.client.shareUserDataRaw(item.serverId, await headers());
      if (!res.ok) {
        const error = await readError(res, 'Failed to update sharing.');
        if (pending?.item === item) setPending({ ...pending, sending: false });
        return { ok: false, error };
      }
      deps.onSharingChanged?.(item, true);
      setPending(null);
      return { ok: true, action: 'share' };
    } catch {
      if (pending?.item === item) setPending({ ...pending, sending: false });
      return { ok: false, error: 'Network error occurred.' };
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
    await request(item);
    return { ok: true, action: 'preview' };
  }

  return { configure, request, cancel, confirm, unshare, toggle, getPending: () => pending };
}
