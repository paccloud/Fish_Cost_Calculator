import { describe, expect, it, vi } from 'vitest';
import { sharePriceCard } from './sharePrice';
import { tapHaptic } from './haptics';

const CARD = 'Sockeye Salmon, skinless fillet: $9.78/lb\nFrom whole fish at 46% yield';

const abort = () => Object.assign(new Error('Share canceled'), { name: 'AbortError' });

describe('sharePriceCard on the web', () => {
  it('falls back to the clipboard when the browser has no share sheet', async () => {
    const writeText = vi.fn(async () => {});
    const outcome = await sharePriceCard(CARD, { native: false, nav: { clipboard: { writeText } }, doc: null });
    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(CARD);
  });

  it('uses the share sheet when there is one, and leaves the clipboard alone', async () => {
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    const outcome = await sharePriceCard(CARD, { native: false, nav: { share, clipboard: { writeText } } });
    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledExactlyOnceWith({ text: CARD });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('treats closing the share sheet as a decision, not an error, and copies nothing', async () => {
    const writeText = vi.fn(async () => {});
    const nav = { share: vi.fn(async () => { throw abort(); }), clipboard: { writeText } };
    expect(await sharePriceCard(CARD, { native: false, nav })).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies instead when the share sheet fails for any other reason', async () => {
    const writeText = vi.fn(async () => {});
    const nav = { share: vi.fn(async () => { throw new TypeError('not allowed'); }), clipboard: { writeText } };
    expect(await sharePriceCard(CARD, { native: false, nav })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(CARD);
  });

  it('copies the older way where there is no async clipboard', async () => {
    const box = { style: {}, setAttribute: vi.fn(), select: vi.fn() };
    const doc = {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: vi.fn(() => box),
      execCommand: vi.fn(() => true),
    };
    expect(await sharePriceCard(CARD, { native: false, nav: {}, doc })).toBe('copied');
    expect(box.value).toBe(CARD);
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(doc.body.removeChild).toHaveBeenCalledWith(box);
  });

  it('says so when nothing can take the card', async () => {
    const blocked = { clipboard: { writeText: vi.fn(async () => { throw new Error('blocked'); }) } };
    expect(await sharePriceCard(CARD, { native: false, nav: blocked, doc: null })).toBe('failed');
    expect(await sharePriceCard(CARD, { native: false, nav: undefined, doc: undefined })).toBe('failed');
  });

  it('shares nothing when there is no card', async () => {
    const share = vi.fn();
    expect(await sharePriceCard('', { native: false, nav: { share } })).toBe('empty');
    expect(await sharePriceCard(undefined, { native: false, nav: { share } })).toBe('empty');
    expect(share).not.toHaveBeenCalled();
  });
});

describe('sharePriceCard in the store app', () => {
  it('opens the native share sheet, not the browser one', async () => {
    const Share = { share: vi.fn(async () => ({})) };
    const nav = { share: vi.fn() };
    const outcome = await sharePriceCard(CARD, { native: true, nav, loadNativeShare: async () => ({ Share }) });
    expect(outcome).toBe('shared');
    expect(Share.share).toHaveBeenCalledExactlyOnceWith({ text: CARD, dialogTitle: 'Share this price' });
    expect(nav.share).not.toHaveBeenCalled();
  });

  it('shows no error when the person cancels', async () => {
    // The Capacitor plugin rejects with this message when the sheet is dismissed
    const Share = { share: vi.fn(async () => { throw new Error('Share canceled'); }) };
    const writeText = vi.fn(async () => {});
    const outcome = await sharePriceCard(CARD, {
      native: true, nav: { clipboard: { writeText } }, loadNativeShare: async () => ({ Share }),
    });
    expect(outcome).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies when the plugin cannot be loaded', async () => {
    const writeText = vi.fn(async () => {});
    const outcome = await sharePriceCard(CARD, {
      native: true, nav: { clipboard: { writeText } }, loadNativeShare: async () => { throw new Error('no plugin'); },
    });
    expect(outcome).toBe('copied');
  });
});

describe('tapHaptic', () => {
  it('does nothing in a browser, without loading the plugin', async () => {
    const loadHaptics = vi.fn();
    await tapHaptic({ native: false, loadHaptics });
    expect(loadHaptics).not.toHaveBeenCalled();
  });

  it('is a light impact in the store app', async () => {
    const Haptics = { impact: vi.fn(async () => {}) };
    await tapHaptic({ native: true, loadHaptics: async () => ({ Haptics, ImpactStyle: { Light: 'LIGHT' } }) });
    expect(Haptics.impact).toHaveBeenCalledExactlyOnceWith({ style: 'LIGHT' });
  });

  it('never throws, whatever the phone does', async () => {
    await expect(tapHaptic({ native: true, loadHaptics: async () => { throw new Error('no plugin'); } })).resolves.toBeUndefined();
    const Haptics = { impact: vi.fn(async () => { throw new Error('off'); }) };
    await expect(tapHaptic({ native: true, loadHaptics: async () => ({ Haptics, ImpactStyle: {} }) })).resolves.toBeUndefined();
  });
});
