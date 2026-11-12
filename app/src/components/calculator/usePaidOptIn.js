import { useState } from 'react';

/**
 * "Include what I paid" on the shared price: a yes for one price, and only while it is on the
 * ticket.
 *
 * `paidKey` says which price that is (the fish, the two forms and the cost). The yes is dropped
 * as soon as the key changes, so a different fish, form or cost needs a new yes, and so does the
 * same cost typed again after a different one.
 *
 * @param {string} paidKey
 * @returns {[boolean, (on: boolean) => void]} whether to include it, and the checkbox's setter
 */
export function usePaidOptIn(paidKey) {
  // Holds the key of the price the yes was given for
  const [optIn, setOptIn] = useState(null);
  // Dropped while rendering, not in an effect, so no render shows a yes given for another price
  if (optIn !== null && optIn !== paidKey) setOptIn(null);
  return [optIn === paidKey, (on) => setOptIn(on ? paidKey : null)];
}
