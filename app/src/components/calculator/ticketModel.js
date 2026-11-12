/**
 * ticketModel.js — everything the ticket says, worked out from what is typed on the screen.
 *
 * Pure: typed text and the chosen conversion in, words and numbers out. The screen draws what
 * comes back and never does arithmetic of its own, so the ticket, a saved price and a shared
 * price card can never describe different numbers.
 *
 * The rule throughout is the engine's: a wrong price is worse than none. There is an answer only
 * when it is a finite amount above zero that does not round away, and a line item only when it
 * has something true to say. "$0.00", "NaN" and "Infinity" cannot come out of here.
 */
import { calculate, costAcrossYields, sellPriceAtMargin, portionCost } from '../../lib/calcEngine';
import { parseAmount } from '../../lib/numberInput';
import { parseYieldPercent } from '../../lib/fishDataShape';
import { formatMoney } from '../../lib/priceCard';
import { nameInSentence, tileName, YOUR_YIELDS_FROM, REFERENCE_SOURCE } from './names';

export const NUMBERS_ONLY = 'Use numbers only in the boxes, like 4.50 or 1,000.';

const EN_DASH = '–';

const isBlank = (value) => String(value ?? '').trim() === '';
// Text in a box that cannot be read as a number. It never counts as 0.
const isUnreadable = (value) => !isBlank(value) && Number.isNaN(parseAmount(value));
// 46 → "46", 46.50 → "46.5", without float noise
const plain = (n) => String(Number(n.toFixed(2)));
// An amount worth printing: finite, above 0 and not rounding down to $0.00. '' otherwise.
const money = (n) => (Number.isFinite(n) && n > 0 && Number(n.toFixed(2)) > 0 ? formatMoney(n) : '');

// 217.39 → "217.4", 12345.6 → "12,345.6". '' when it is not a weight worth printing.
function pounds(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  const [whole, tenth] = n.toFixed(1).split('.');
  if (tenth === undefined || Number(n.toFixed(1)) <= 0) return '';
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${tenth}`;
}

/** What to say under the yield box when the yield cannot be used. '' when it can. */
export function yieldProblem(yieldPercent, conversion) {
  const n = parseAmount(yieldPercent);
  if (!Number.isFinite(n) || parseYieldPercent(n) !== null) return '';
  const example = parseYieldPercent(conversion?.yield);
  return `Yield is a percentage above 0 and up to 100${example !== null ? `, like ${plain(example)}` : ''}.`;
}

/** What to say under the margin box. Margin is on the sell price, so it stops short of 100%. */
export function marginProblem(margin) {
  if (isBlank(margin)) return '';
  const n = parseAmount(margin);
  if (Number.isNaN(n)) return 'Margin is a percentage from 0 to 99. Type a number, like 35.';
  return n >= 100 ? 'Margin is a percentage from 0 to 99. Did you mean 35?' : '';
}

/** What to say under the portion box. */
export function portionProblem(portion) {
  return isUnreadable(portion) ? 'Portion size is in ounces. Type a number, like 6.' : '';
}

/**
 * Where the yield in the box came from, for its Stamp.
 *
 * A reference yield is one of the three figures the source reports (the average and the two ends
 * of its range). Anything else the person typed, or a yield they recorded themselves, is theirs.
 *
 * @returns {{tone: 'reference'|'yours', text: string}|null} null before a product is chosen
 */
export function yieldSource(conversion, yieldPercent) {
  if (!conversion) return null;
  if (conversion.from === YOUR_YIELDS_FROM) return { tone: 'yours', text: 'Your yield' };
  const typed = parseAmount(yieldPercent);
  const range = Array.isArray(conversion.range) ? conversion.range : [];
  if (Number.isFinite(typed) && ![conversion.yield, ...range].includes(typed)) {
    return { tone: 'yours', text: 'Your yield' };
  }
  return {
    tone: 'reference',
    text: range.length === 2 ? `${REFERENCE_SOURCE} · ${range[0]}${EN_DASH}${range[1]}%` : REFERENCE_SOURCE,
  };
}

/**
 * @typedef {Object} TicketInputs
 * @property {'cost'|'weight'} mode
 * @property {string} species
 * @property {string} fromState
 * @property {string} toState
 * @property {string} cost — typed price paid per lb
 * @property {string} targetWeight — typed lbs of product needed ("weight" mode)
 * @property {string} yieldPercent — typed yield
 * @property {string} processingCost
 * @property {'incoming'|'outgoing'} weightType
 * @property {string} shipping
 * @property {'incoming'|'outgoing'} shippingWeightType
 * @property {string} [margin] — typed margin, percent of the sell price
 * @property {string} [portion] — typed portion size, ounces
 * @property {{yield: number, range?: [number, number]|null, from?: string}|null} [conversion]
 */

/**
 * @typedef {Object} TicketModel
 * @property {boolean} ready — species, starting form and product are all chosen
 * @property {{label: string, subject: string, figure: string, unit: string}|null} answer
 * @property {string} prompt — one sentence saying what is missing; '' when there is an answer
 * @property {Array<{id: string, label: string, value: string}>} lines — the line items, in order
 * @property {string} sentence — what a screen reader hears once typing pauses
 * @property {number|null} result — cost per lb, or lbs to buy; null when there is no answer
 * @property {object|null} breakdown — the engine's cost parts, as soon as the choices are made
 * @property {{low: number, high: number}|null} range — cost across the typical yields
 * @property {{price: number, marginPct: number}|null} sell
 * @property {{ounces: number, cost: number}|null} portion
 * @property {number} paid — price paid per lb, NaN when blank
 * @property {number} yieldUsed — the yield in the box, NaN when blank
 */

/**
 * @param {TicketInputs} inputs
 * @returns {TicketModel}
 */
export function buildTicketModel(inputs) {
  const {
    mode = 'cost', species, fromState, toState, cost, targetWeight, yieldPercent,
    processingCost, weightType = 'incoming', shipping, shippingWeightType = 'outgoing',
    margin, portion, conversion = null,
  } = inputs;

  const costMode = mode !== 'weight';
  const ready = Boolean(species && fromState && toState);
  const fromWords = nameInSentence(fromState, 'whole fish');
  const productWords = nameInSentence(toState, 'finished product');

  const mainInput = costMode ? cost : targetWeight;
  const mainNumber = parseAmount(mainInput);
  const yieldUsed = parseAmount(yieldPercent);
  const yieldValid = parseYieldPercent(yieldUsed) !== null;
  const yieldMessage = yieldProblem(yieldPercent, conversion);
  const badInput = [mainInput, yieldPercent, ...(costMode ? [processingCost, shipping] : [])].some(isUnreadable);

  const engineInputs = {
    mode: costMode ? 'cost' : 'weight',
    yieldPercent: yieldUsed,
    targetWeight: parseAmount(targetWeight),
    cost: parseAmount(cost),
    processingCost: parseAmount(processingCost),
    weightType,
    shipping: parseAmount(shipping),
    shippingWeightType,
  };
  const calc = ready ? calculate(engineInputs) : null;

  let result = null;
  let figure = '';
  if (calc && !badInput && yieldValid && Number.isFinite(mainNumber)) {
    figure = costMode ? money(calc.result) : pounds(calc.result);
    if (figure) result = calc.result;
  }

  const model = {
    ready,
    answer: null,
    prompt: '',
    lines: [],
    sentence: '',
    result,
    breakdown: calc?.breakdown ?? null,
    range: null,
    sell: null,
    portion: null,
    paid: engineInputs.cost,
    yieldUsed,
  };

  if (result === null) {
    if (!species) {
      model.prompt = costMode ? 'Choose a species to see your cost per lb.' : 'Choose a species to see how much to buy.';
    } else if (!fromState) model.prompt = 'Choose what you have.';
    else if (!toState) model.prompt = 'Choose what you’re making.';
    else if (badInput) model.prompt = NUMBERS_ONLY;
    else if (yieldMessage) model.prompt = yieldMessage;
    else if (!yieldValid) model.prompt = 'Type a yield, like 46%.';
    else if (!Number.isFinite(mainNumber) || mainNumber === 0) {
      model.prompt = costMode
        ? `Type what you pay per lb of ${fromWords}.`
        : `Type how many lbs of ${productWords} you need.`;
    } else model.prompt = 'That number is too big or too small to price. Check what you typed.';
    // Mistakes are read out; "choose a species" is not, or it would speak on every visit
    if (ready && (badInput || yieldMessage)) model.sentence = model.prompt;
    return model;
  }

  const productName = tileName(toState).name;
  const fromName = tileName(fromState).name;

  if (!costMode) {
    model.answer = { label: 'Buy this much', subject: fromName, figure, unit: 'lbs' };
    model.sentence = `Buy ${figure} lbs of ${fromWords}`;
    // As typed, so 100 stays "100" and not "100.0"
    const made = mainNumber > 0 ? Number(mainNumber.toFixed(2)).toLocaleString('en-US') : '';
    if (made && made !== '0') {
      model.lines.push({
        id: 'makes',
        label: `Makes, at ${plain(yieldUsed)}% yield`,
        value: `${made} lbs of ${productWords}`,
      });
    }
    return model;
  }

  model.answer = { label: 'Your cost per lb of', subject: productName, figure, unit: '/lb' };
  model.sentence = `${figure} per lb of ${productWords}`;

  // 1. The price across the typical yields, while the yield in use is one of them. Once the
  //    person types a yield outside the range, the range no longer brackets their price.
  const [first, second] = Array.isArray(conversion?.range) ? conversion.range : [];
  const lowYield = Math.min(first, second);
  const highYield = Math.max(first, second);
  if (lowYield < highYield && yieldUsed >= lowYield && yieldUsed <= highYield) {
    const across = costAcrossYields(engineInputs, [lowYield, highYield]);
    const low = across ? money(across.low) : '';
    const high = across ? money(across.high) : '';
    if (low && high && low !== high) {
      model.range = across;
      model.lines.push({
        id: 'range',
        label: `Across typical yields, ${plain(lowYield)}${EN_DASH}${plain(highYield)}%`,
        value: `${low}${EN_DASH}${high}/lb`,
      });
    }
  }

  // 2. What the price is made of, once processing or shipping adds to it
  const parts = [
    ['fish', 'Fish', calc.breakdown.fish],
    ['processing', 'Processing', calc.breakdown.processing],
    ['shipping', 'Shipping', calc.breakdown.shipping],
  ].filter(([, , amount]) => money(amount));
  if (parts.some(([id]) => id !== 'fish')) {
    for (const [id, label, amount] of parts) model.lines.push({ id, label, value: `${money(amount)}/lb` });
  }

  // 3. What to charge
  if (!isBlank(margin)) {
    const marginPct = parseAmount(margin);
    const price = sellPriceAtMargin(result, marginPct);
    if (price !== null && money(price)) {
      model.sell = { price, marginPct };
      model.lines.push({
        id: 'sell',
        label: `Sell price at ${plain(marginPct)}% margin`,
        value: `${money(price)}/lb`,
      });
    }
  }

  // 4. What one portion costs
  if (!isBlank(portion)) {
    const ounces = parseAmount(portion);
    const each = portionCost(result, ounces);
    if (each !== null && money(each)) {
      model.portion = { ounces, cost: each };
      model.lines.push({ id: 'portion', label: `${plain(ounces)} oz portion`, value: money(each) });
    }
  }

  return model;
}
