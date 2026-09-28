import { describe, expect, it, vi } from 'vitest';
import {
  buildSharePreviewFields,
  createYieldShareFlow,
  describeShareAttribution,
} from './yieldSharing';
import { resolveCommunityAttribution } from '../../../shared/handlers/communityData.js';

// The repo has no React renderer in its test setup, so the share-confirmation
// flow is tested at the controller level: DataManagement's share icon calls
// flow.toggle(), ShareYieldModal's buttons call flow.confirm()/flow.cancel().

const ITEM = { id: 'local-1', serverId: 42, species: 'Cod', product: 'Fillet', yield: 40, source: 'Dock test', is_shared: false };

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
