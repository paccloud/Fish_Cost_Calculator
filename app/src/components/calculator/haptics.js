import { isNativeApp } from '../../config/platform';

/**
 * A light tap under the thumb: a stepper press, a successful save. Only in the store app, and
 * never worth an error: a phone with haptics off, or without them, simply does nothing.
 * The Capacitor plugin is imported only when it is used, so a browser never downloads it.
 *
 * @param {object} [where] — replaceable in tests
 */
export async function tapHaptic(where = {}) {
  const { native = isNativeApp, loadHaptics = () => import('@capacitor/haptics') } = where;
  if (!native) return;
  try {
    const { Haptics, ImpactStyle } = await loadHaptics();
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* no haptics here */
  }
}
