import { describe, expect, it, vi } from 'vitest';
import {
  buildSharePreviewFields,
  createYieldShareFlow,
  describeShareAttribution,
  getShareBlocker,
} from './yieldSharing';
import { resolveCommunityAttribution } from '../../../shared/handlers/communityData.js';

// The repo has no React renderer in its test setup, so the share-confirmation
// flow is tested at the controller level: DataManagement's share icon calls
// flow.toggle(), ShareYieldModal's buttons call flow.confirm()/flow.cancel().

const ITEM = { id: 'local-1', serverId: 42, syncStatus: 'synced', species: 'Cod', product: 'Fillet', yield: 40, source: 'Dock test', is_shared: false };

function okRes() {
  return { ok: true, status: 200, json: async () => ({}) };
}

function makeFlow({ profile = null, profileError = null, shareRes = okRes() } = {}) {
  const client = {
    getContributorProfile: profileError
      ? vi.fn().mockRejectedValue(profileError)
      : vi.fn().mockResolvedValue(profile),
    shareUserDataRaw: vi.fn().mockResolvedValue(shareRes),
    unshareUserDataRaw: vi.fn().mockResolvedValue(okRes()),
  };
  const onPendingChange = vi.fn();
  const onSharingChanged = vi.fn();
  const flow = createYieldShareFlow({
    client,
    getHeaders: async () => ({ Authorization: 'Bearer t' }),
    onPendingChange,
    onSharingChanged,
  });
  return { flow, client, onPendingChange, onSharingChanged };
}

describe('yield share confirmation flow', () => {
  it('"Share with community" opens the confirmation without calling the share API', async () => {
    const { flow, client, onPendingChange } = makeFlow();

    const result = await flow.toggle(ITEM);

    expect(result).toEqual({ ok: true, action: 'preview' });
    expect(client.shareUserDataRaw).not.toHaveBeenCalled();
    expect(onPendingChange).toHaveBeenCalled();
    expect(flow.getPending().item).toBe(ITEM);
    expect(flow.getPending().attribution).toEqual({ status: 'ready', contributor: null, organization: null });
  });

  it('cancel closes the confirmation and makes no share request', async () => {
    const { flow, client, onSharingChanged } = makeFlow();

    await flow.toggle(ITEM);
    flow.cancel();

    expect(flow.getPending()).toBeNull();
    expect(client.shareUserDataRaw).not.toHaveBeenCalled();
    expect(client.unshareUserDataRaw).not.toHaveBeenCalled();
    expect(onSharingChanged).not.toHaveBeenCalled();
    // A confirm after cancel is a no-op too.
    expect(await flow.confirm()).toEqual({ ok: false });
    expect(client.shareUserDataRaw).not.toHaveBeenCalled();
  });

  it('confirm calls the share API once and marks the row shared', async () => {
    const { flow, client, onSharingChanged } = makeFlow();

    await flow.toggle(ITEM);
    const result = await flow.confirm();

    expect(result).toEqual({ ok: true, action: 'share' });
    expect(client.shareUserDataRaw).toHaveBeenCalledTimes(1);
    expect(client.shareUserDataRaw).toHaveBeenCalledWith(42, { Authorization: 'Bearer t' });
    expect(onSharingChanged).toHaveBeenCalledWith(ITEM, true);
    expect(flow.getPending()).toBeNull();
  });

  it('keeps the confirmation open and reports the error when sharing fails', async () => {
    const { flow, onSharingChanged } = makeFlow({
      shareRes: { ok: false, status: 404, json: async () => ({ error: 'Not found' }) },
    });

    await flow.toggle(ITEM);
    const result = await flow.confirm();

    expect(result).toEqual({ ok: false, error: 'Not found' });
    expect(onSharingChanged).not.toHaveBeenCalled();
    expect(flow.getPending().sending).toBe(false);
    // The dialog is still open, so the error is carried on the pending state.
    expect(flow.getPending().error).toBe('Not found');
  });

  it('keeps a network failure on the pending state so the open dialog can show it', async () => {
    const { flow, client } = makeFlow();
    client.shareUserDataRaw.mockRejectedValue(new Error('offline'));
    await flow.toggle(ITEM);

    const result = await flow.confirm();

    expect(result).toEqual({ ok: false, error: 'Network error occurred.' });
    expect(flow.getPending().error).toBe('Network error occurred.');
    expect(flow.getPending().sending).toBe(false);
  });

  it('ignores a late profile response from a closed preview when the same row is reopened', async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const { flow, client } = makeFlow();
    let resolveFirst;
    let resolveSecond;
    client.getContributorProfile
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));

    const first = flow.toggle(ITEM);
    await tick();
    flow.cancel();
    const second = flow.toggle(ITEM); // same row object, new preview
    await tick();

    // The first (stale) request now answers with an opted-in profile.
    resolveFirst({ display_name: 'Old Name', organization: 'Old Org', show_on_page: true });
    await first;

    // The new preview must still be waiting for its own answer.
    expect(flow.getPending().attribution.status).toBe('loading');
    expect((await flow.confirm()).ok).toBe(false);
    expect(client.shareUserDataRaw).not.toHaveBeenCalled();

    // Its own (current) answer is the one that counts: no profile → anonymous.
    resolveSecond(null);
    await second;
    expect(flow.getPending().attribution).toEqual({ status: 'ready', contributor: null, organization: null });
  });

  it.each(['local', 'conflicted', 'pending-delete', 'conflict-delete', undefined])(
    'refuses to preview or share a row that is not fully synced (syncStatus: %s)',
    async (syncStatus) => {
      const { flow, client } = makeFlow({ profile: { display_name: 'A', show_on_page: true } });
      const dirty = { ...ITEM, syncStatus };

      const opened = await flow.toggle(dirty);

      expect(opened.ok).toBe(false);
      expect(opened.error).toMatch(/sync/i);
      expect(flow.getPending()).toBeNull(); // no preview of fields that would not be published
      expect(client.getContributorProfile).not.toHaveBeenCalled();
      expect(client.shareUserDataRaw).not.toHaveBeenCalled();
    }
  );

  it('re-checks at confirm time so a row that stopped being synced is never published', async () => {
    const { flow, client } = makeFlow();
    const row = { ...ITEM }; // own copy: never mutate the shared fixture
    await flow.toggle(row);
    expect(flow.getPending().attribution.status).toBe('ready');
    // Simulate the previewed snapshot no longer matching the server copy.
    row.syncStatus = 'local';

    const result = await flow.confirm();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/sync/i);
    expect(client.shareUserDataRaw).not.toHaveBeenCalled();
    expect(flow.getPending()).toBeNull();
  });

  it('getShareBlocker allows only fully synced rows that exist on the server', () => {
    expect(getShareBlocker(ITEM)).toBeNull();
    expect(getShareBlocker({ ...ITEM, serverId: null })).toMatch(/sync/i);
    expect(getShareBlocker({ ...ITEM, syncStatus: 'local' })).toMatch(/sync/i);
  });

  it('still lets a user stop sharing a row that has unsynced edits', async () => {
    const { flow, client } = makeFlow();
    const result = await flow.toggle({ ...ITEM, syncStatus: 'local', is_shared: true });
    expect(result).toEqual({ ok: true, action: 'unshare' });
    expect(client.unshareUserDataRaw).toHaveBeenCalledTimes(1);
  });

  it('unsharing needs no confirmation', async () => {
    const { flow, client, onSharingChanged } = makeFlow();
    const shared = { ...ITEM, is_shared: true };

    const result = await flow.toggle(shared);

    expect(result).toEqual({ ok: true, action: 'unshare' });
    expect(flow.getPending()).toBeNull();
    expect(client.getContributorProfile).not.toHaveBeenCalled();
    expect(client.unshareUserDataRaw).toHaveBeenCalledWith(42, { Authorization: 'Bearer t' });
    expect(onSharingChanged).toHaveBeenCalledWith(shared, false);
  });

  it('shows public attribution when the profile opts in', async () => {
    const { flow } = makeFlow({
      profile: { display_name: 'Deckhand Dana', organization: 'Sitka Fishers', show_on_page: 1 },
    });
    await flow.request(ITEM);
    expect(flow.getPending().attribution)
      .toEqual({ status: 'ready', contributor: 'Deckhand Dana', organization: 'Sitka Fishers' });
  });

  it('refuses to share when the profile could not be loaded, so unseen attribution is never published', async () => {
    const { flow, client } = makeFlow({ profileError: new Error('timeout') });
    await flow.toggle(ITEM);
    expect(flow.getPending().attribution.status).toBe('unavailable');

    const result = await flow.confirm();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not confirm/i);
    expect(client.shareUserDataRaw).not.toHaveBeenCalled();
    expect(flow.getPending().item).toBe(ITEM); // preview stays open, nothing sent
  });

  it('refuses to share while attribution is still loading', async () => {
    let resolveProfile;
    const { flow, client } = makeFlow();
    client.getContributorProfile.mockReturnValue(new Promise((r) => { resolveProfile = r; }));
    const opening = flow.toggle(ITEM);
    await Promise.resolve();
    expect(flow.getPending().attribution.status).toBe('loading');

    const result = await flow.confirm();

    expect(result.ok).toBe(false);
    expect(client.shareUserDataRaw).not.toHaveBeenCalled();
    resolveProfile(null);
    await opening;
  });

  it('a user with no profile at all (404 → null) can still share, anonymously', async () => {
    const { flow, client } = makeFlow({ profile: null });
    await flow.toggle(ITEM);
    expect(flow.getPending().attribution.status).toBe('ready');
    const result = await flow.confirm();
    expect(result).toEqual({ ok: true, action: 'share' });
    expect(client.shareUserDataRaw).toHaveBeenCalledTimes(1);
  });

  it('marks attribution unavailable (not public) when the profile cannot be loaded', async () => {
    const { flow, client } = makeFlow({ profileError: new Error('offline') });
    await flow.request(ITEM);
    expect(flow.getPending().attribution).toEqual({ status: 'unavailable', contributor: null, organization: null });
    expect(client.shareUserDataRaw).not.toHaveBeenCalled();
  });
});

describe('share preview content', () => {
  it('lists exactly the public row fields', () => {
    expect(buildSharePreviewFields(ITEM)).toEqual([
      { label: 'Species', value: 'Cod' },
      { label: 'Product', value: 'Fillet' },
      { label: 'Yield', value: '40%' },
      { label: 'Source', value: 'Dock test' },
    ]);
  });

  it('attribution preview matches the server-side community feed rules', () => {
    const profiles = [
      null,
      { display_name: 'Quiet', organization: 'Co-op', show_on_page: 0 },
      { display_name: 'Quiet', organization: 'Co-op', show_on_page: false },
      { display_name: 'Dana', organization: 'Sitka', show_on_page: 1 },
      { display_name: 'Dana', organization: null, show_on_page: true },
      { display_name: ' ', organization: 'Sitka', show_on_page: true },
    ];
    for (const profile of profiles) {
      const serverSide = resolveCommunityAttribution(profile && {
        contributor_display_name: profile.display_name,
        contributor_organization: profile.organization,
        contributor_show_on_page: profile.show_on_page,
      });
      expect(describeShareAttribution(profile)).toEqual(serverSide);
    }
  });
});
