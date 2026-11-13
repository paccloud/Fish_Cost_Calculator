/**
 * priceActions.js — what Save and Share do with the price on the ticket.
 *
 * Both start from the ticket model, so what is kept or sent is the number on the screen.
 */
import { buildPriceCard } from '../../lib/priceCard';
import { tileName, YOUR_YIELDS_FROM } from './names';

/**
 * The record for a saved price, in the shape "My yields" lists.
 *
 * A price (`mode: 'cost'`) is what the sync sends to the server: name, species, product, cost,
 * yield and result. The server keeps no `mode`, so a record that comes back without one is a
 * price, whatever its cost: a fish that cost nothing still has a price once there is processing
 * or shipping to pay for.
 *
 * A "Pounds to buy" answer (`mode: 'weight'`, `cost: 0`, the result in pounds) is never sent. It
 * stays on the device it was saved on (`isDeviceOnlyCalc` in lib/localRepository.js).
 *
 * @param {{mode: string, species: string, fromState: string, toState: string, targetWeight: number}} chosen
 * @param {import('./ticketModel').TicketModel} model
 * @returns {object|null} null when there is no answer to save
 */
export function savedPriceRecord({ mode, species, fromState, toState, targetWeight }, model) {
  if (!model || model.result === null) return null;
  const weightMode = mode === 'weight';
  const product = `${fromState} → ${toState}`;
  return {
    name: `${species} - ${product}`,
    species,
    product,
    mode: weightMode ? 'weight' : 'cost',
    cost: weightMode || !Number.isFinite(model.paid) ? 0 : model.paid,
    target_weight: weightMode && Number.isFinite(targetWeight) ? targetWeight : 0,
    yield: model.yieldUsed,
    result: model.result,
  };
}

/**
 * Save a price through the data layer: on this device first, for a guest and for someone signed
 * in alike. A signed-in person's price then reaches their account by the sync that the data
 * layer already runs after every change. A "Pounds to buy" answer stays on the device.
 *
 * @param {{saveCalc: (record: object) => Promise<object|null>, readOnly?: boolean}} data — `useData()`
 * @param {object|null} record — from `savedPriceRecord`
 * @returns {Promise<'saved'|'failed'|'read-only'|'nothing'>}
 */
export async function savePrice(data, record) {
  if (!record) return 'nothing';
  if (!data || data.readOnly) return 'read-only';
  try {
    const kept = await data.saveCalc(record);
    return kept ? 'saved' : 'failed';
  } catch {
    // Site storage blocked or full: nothing was kept
    return 'failed';
  }
}

/**
 * The price on the ticket as plain text for the share sheet.
 *
 * @param {{species: string, fromState: string, toState: string}} chosen
 * @param {import('./ticketModel').TicketModel} model
 * @param {{includePaid?: boolean}} [options] — what was paid is left out unless asked for: the
 *   card is often going to a buyer
 * @returns {string} '' when there is no cost per lb to share
 */
export function priceCardFor({ species, fromState, toState }, model, { includePaid = false } = {}) {
  if (!model?.answer || model.answer.unit !== '/lb') return '';
  return buildPriceCard({
    species,
    fromName: fromState === YOUR_YIELDS_FROM ? '' : tileName(fromState).name,
    productName: tileName(toState).name,
    costPerLb: model.result,
    yieldPct: model.yieldUsed,
    sellPrice: model.sell?.price,
    marginPct: model.sell?.marginPct,
    portion: model.portion ?? undefined,
    range: model.range ?? undefined,
    includePurchasePrice: includePaid,
    purchasePrice: model.paid,
  });
}
