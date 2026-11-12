/**
 * sharePrice.js — hand a price card to the system share sheet, or to the clipboard.
 *
 *   in the store app      → the native share sheet (@capacitor/share)
 *   on the web            → navigator.share where the browser has it
 *   anywhere else         → the clipboard
 *
 * The Capacitor plugin is imported only when it is used, so a browser never downloads it.
 */
import { isNativeApp } from '../../config/platform';

// Closing the share sheet without choosing anything is a decision, not a failure.
// The web says AbortError; the Capacitor plugin rejects with "Share canceled".
const wasCancelled = (error) => error?.name === 'AbortError' || /cancel/i.test(String(error?.message ?? ''));

async function copyText(text, { nav, doc }) {
  try {
    if (typeof nav?.clipboard?.writeText === 'function') {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* blocked or not allowed here: try the older way */
  }
  // Pages that are not served securely, and some in-app browsers, have no async clipboard
  try {
    if (!doc?.body || typeof doc.execCommand !== 'function') return false;
    const box = doc.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    doc.body.appendChild(box);
    box.select();
    const copied = doc.execCommand('copy');
    doc.body.removeChild(box);
    return Boolean(copied);
  } catch {
    return false;
  }
}

/**
 * Share a price card.
 *
 * @param {string} text — the card from `buildPriceCard`
 * @param {object} [where] — the platform, replaceable in tests
 * @param {boolean} [where.native] — inside the store app
 * @param {Navigator} [where.nav]
 * @param {Document} [where.doc]
 * @param {() => Promise<{Share: {share: Function}}>} [where.loadNativeShare]
 * @returns {Promise<'shared'|'copied'|'cancelled'|'failed'|'empty'>}
 *   'shared' went to a share sheet; 'copied' is on the clipboard; 'cancelled' the person closed
 *   the sheet; 'failed' nothing could take it; 'empty' there was no card to share.
 */
export async function sharePriceCard(text, where = {}) {
  const {
    native = isNativeApp,
    nav = globalThis.navigator,
    doc = globalThis.document,
    loadNativeShare = () => import('@capacitor/share'),
  } = where;

  if (typeof text !== 'string' || text.trim() === '') return 'empty';

  if (native) {
    try {
      const { Share } = await loadNativeShare();
      await Share.share({ text, dialogTitle: 'Share this price' });
      return 'shared';
    } catch (error) {
      if (wasCancelled(error)) return 'cancelled';
    }
  } else if (typeof nav?.share === 'function') {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (error) {
      if (wasCancelled(error)) return 'cancelled';
    }
  }

  return (await copyText(text, { nav, doc })) ? 'copied' : 'failed';
}
