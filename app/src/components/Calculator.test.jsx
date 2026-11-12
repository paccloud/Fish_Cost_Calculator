/**
 * The calculator screen, rendered to markup with a fake `useAuth` and `useData` (there is no DOM
 * in this test run, as for the shell tests), plus what Save and Share do with the price on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRepository, guestScope } from '../lib/localRepository';
import { buildTicketModel } from './calculator/ticketModel';
import { priceCardFor, savedPriceRecord, savePrice } from './calculator/priceActions';
import { sharePriceCard } from './calculator/sharePrice';

// The hand-worked example: Sockeye Salmon, whole fish to skinless fillet, $4.50/lb at 46% yield
const CHOSEN = { species: 'Sockeye Salmon', fromState: 'Round', toState: 'Skinless Fillet' };
const WORKED = { ...CHOSEN, cost: '4.50', yieldPercent: '46', margin: '35', portion: '6' };
const SOCKEYE = { yield: 46, range: [41, 49], from: 'Round', to: 'Skinless Fillet' };
const workedModel = () => buildTicketModel({ mode: 'cost', ...WORKED, conversion: SOCKEYE });

function fakeUseData(over = {}) {
  return {
    customYields: [],
    refreshCustomYields: vi.fn(),
    readOnly: false,
    saveCalc: vi.fn(async (calc) => ({ ...calc, id: 'local-1', syncStatus: 'local' })),
    ...over,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../context/AuthContext');
  vi.doUnmock('../context/DataContext');
  vi.doUnmock('../config/platform');
});

async function renderCalculator({ initial, user = null, data = fakeUseData(), platform = { backendEnabled: true, isNativeApp: false } } = {}) {
  vi.resetModules();
  vi.doMock('../context/AuthContext', () => ({ useAuth: () => ({ user, getAuthHeaders: async () => ({}) }) }));
  vi.doMock('../context/DataContext', () => ({ useData: () => data }));
  vi.doMock('../config/platform', () => ({ thisDevice: 'this phone', ...platform }));
  const { MemoryRouter } = await import('react-router-dom');
  const { default: Calculator } = await import('./Calculator.jsx');
  return renderToStaticMarkup(
    <MemoryRouter>
      <Calculator initial={initial} />
    </MemoryRouter>,
  );
}

const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const ticketOf = (html) => html.slice(html.indexOf('<div class="ticket-dock"'), html.indexOf('<p class="sr-only" aria-live="polite"'));
const checkedRadios = (html) => [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)]
  .map(([tag]) => tag)
  .filter((tag) => /\schecked=""/.test(tag))
  .map((tag) => tag.match(/value="([^"]*)"/)[1]);

describe('the filled calculator', () => {
  it('prices the worked example on the ticket: $9.78/lb, its range, the sell price and a portion', async () => {
    const html = await renderCalculator({ initial: WORKED });
    const ticket = ticketOf(html);

    expect(ticket).toContain('<section class="ticket" aria-label="Your result">');
    expect(ticket).toContain('<p class="ticket-label">Your cost per lb of <b>Skinless fillet</b></p>');
    expect(ticket).toMatch(/<p class="ticket-figure"[^>]*>\$9\.78<small>\/lb<\/small><\/p>/);
    expect([...ticket.matchAll(/<li><span>([^<]*)<\/span><span>([^<]*)<\/span><\/li>/g)].map(([, label, value]) => [label, value])).toEqual([
      ['Across typical yields, 41–49%', '$9.18–$10.98/lb'],
      ['Sell price at 35% margin', '$15.05/lb'],
      ['6 oz portion', '$3.67'],
    ]);
  });

  it('never prints a zero, NaN or Infinity', async () => {
    for (const initial of [WORKED, undefined, CHOSEN, { ...WORKED, cost: 'abc' }, { ...WORKED, cost: '0' }, { ...WORKED, yieldPercent: '0' }]) {
      const text = textOf(await renderCalculator({ initial }));
      expect(text).not.toMatch(/\$0\.00|NaN|Infinity|undefined/);
    }
  });

  it('gives the ticket Save, Share and a labelled control for its details', async () => {
    const ticket = ticketOf(await renderCalculator({ initial: WORKED }));
    expect(ticket).toMatch(/<button type="button" class="ticket-action">.*?Save<\/button>/);
    expect(ticket).toMatch(/<button type="button" class="ticket-action" aria-label="Share this price">/);
    const [, expanded, controls] = ticket.match(/<button type="button" aria-expanded="(true|false)" aria-controls="([^"]+)"[^>]*>Price details/);
    expect(expanded).toBe('false');
    // Closed on a phone, always shown from 768px
    expect(ticket).toContain(`<div id="${controls}" class="hidden md:block">`);
    expect(textOf(ticket)).toContain('Include what I paid');
    expect(ticket).not.toMatch(/<input type="checkbox"[^>]*checked/);
  });

  it('names forms in plain words first, with the trade code or the yield on the second line', async () => {
    const html = await renderCalculator({ initial: WORKED });
    expect(checkedRadios(html)).toEqual(['Round', 'Skinless Fillet']);
    expect(html).toMatch(/value="Round"[^>]*\/><span[^>]*>Whole fish<small[^>]*>Round<\/small><\/span>/);
    expect(html).toMatch(/value="D\/H-On"[^>]*\/><span[^>]*>Gutted, head on<small[^>]*>D\/H-On<\/small><\/span>/);
    expect(html).toMatch(/value="Skinless Fillet"[^>]*\/><span[^>]*>Skinless fillet<small[^>]*>46% yield<\/small><\/span>/);
    // A product with a trade code keeps the yield second and the code third
    expect(html).toMatch(/name="calc-to"[^>]*value="D\/H-Off"[^>]*\/><span[^>]*>Gutted, head off<small[^>]*>74% yield<\/small><small[^>]*>D\/H-Off<\/small><\/span>/);
  });

  it('says where every yield came from', async () => {
    const html = await renderCalculator({ initial: WORKED });
    expect(html).toContain('<p class="type-species">Sockeye Salmon</p><p class="type-latin">Oncorhynchus nerka</p>');
    expect(html).toContain('<span class="stamp">MAB-37</span>');
    expect(html).toContain('<span class="stamp">MAB-37 · 41–49%</span>');
    expect(html).not.toContain('stamp-yours');

    const typed = await renderCalculator({ initial: { ...WORKED, yieldPercent: '44' } });
    expect(typed).toContain('<span class="stamp stamp-yours">Your yield</span>');
    expect(textOf(typed)).toContain('Reference yield 46%, typical 41–49%.');
  });

  it('has one title, in the display face, and numbered step headings', async () => {
    const html = await renderCalculator({ initial: WORKED });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="type-title">What does it really cost?</h1>');
    expect(html).toContain('<h2 id="step-fish" class="type-heading">Your fish</h2>');
    expect(html).toContain('<h2 id="step-numbers" class="type-heading">Your numbers</h2>');
    expect(html).not.toContain('rounded-2xl');
  });

  it('offers the two modes as a segmented control', async () => {
    const html = await renderCalculator({ initial: WORKED });
    expect([...html.matchAll(/<button type="button" aria-pressed="(true|false)" class="min-h-control[^"]*">([^<]*)<\/button>/g)].map(([, pressed, label]) => [label, pressed])).toEqual([
      ['Cost per lb', 'true'],
      ['Pounds to buy', 'false'],
    ]);
  });

  it('folds processing and shipping away until one of them has a value', async () => {
    const folded = await renderCalculator({ initial: WORKED });
    expect(folded).toMatch(/<button type="button" aria-expanded="false" aria-controls="calc-extras"[^>]*>.*?Add processing or shipping<\/button>/);
    expect(folded).not.toContain('id="calc-processing"');

    const open = await renderCalculator({ initial: { ...WORKED, processingCost: '0.50' } });
    expect(open).toMatch(/<button type="button" aria-expanded="true" aria-controls="calc-extras"[^>]*>.*?Remove processing and shipping<\/button>/);
    expect(open).toContain('id="calc-processing"');
    expect(open).toContain('id="calc-shipping"');
    expect(textOf(open)).toContain('$0.50 per lb of whole fish comes to $1.09 per lb of skinless fillet at 46% yield.');
    expect(textOf(ticketOf(open))).toContain('Fish $9.78/lb Processing $1.09/lb');
  });

  it('has optional margin and portion steppers in step 2', async () => {
    const html = await renderCalculator({ initial: WORKED });
    expect(html).toMatch(/<label for="calc-margin"[^>]*>Your margin<\/label>/);
    expect(html).toMatch(/<label for="calc-portion"[^>]*>Portion size<\/label>/);
    expect(html).toMatch(/<input[^>]*id="calc-margin"[^>]*value="35"/);
    expect(html).toMatch(/<input[^>]*id="calc-portion"[^>]*value="6"/);
    for (const label of ['Lower the margin by 1 point', 'Raise the margin by 1 point', 'Lower the portion by 1 oz', 'Raise the portion by 1 oz']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it('says what to type when margin is not a margin, and keeps the price', async () => {
    const html = await renderCalculator({ initial: { ...WORKED, margin: '120' } });
    expect(html).toMatch(/<input[^>]*id="calc-margin"[^>]*aria-invalid="true"[^>]*aria-describedby="calc-margin-error calc-margin-hint"/);
    expect(textOf(html)).toContain('Margin is a percentage from 0 to 99. Did you mean 35?');
    const ticket = textOf(ticketOf(html));
    expect(ticket).toContain('$9.78');
    expect(ticket).not.toContain('Sell price');
  });
});

describe('the calculator before there is an answer', () => {
  it('says what is missing in one sentence, with no figure and nothing to save or share', async () => {
    const ticket = ticketOf(await renderCalculator());
    expect(textOf(ticket)).toBe('Choose a species to see your cost per lb.');
    expect(ticket).not.toContain('ticket-figure');
    expect(ticket).not.toContain('<button');
  });

  it('asks for the next thing as the choices are made', async () => {
    expect(textOf(ticketOf(await renderCalculator({ initial: { species: 'Sockeye Salmon', fromState: 'Round' } })))).toBe('Choose what you’re making.');
    expect(textOf(ticketOf(await renderCalculator({ initial: { ...CHOSEN, yieldPercent: '46' } })))).toBe('Type what you pay per lb of whole fish.');
  });

  it('blanks the answer and says to use numbers when a box cannot be read', async () => {
    const html = await renderCalculator({ initial: { ...WORKED, cost: 'four fifty' } });
    expect(textOf(ticketOf(html))).toBe('Use numbers only in the boxes, like 4.50 or 1,000.');
    expect(html).toMatch(/<input[^>]*id="calc-cost"[^>]*aria-invalid="true"/);
  });

  it('keeps a polite live region for the price', async () => {
    expect(await renderCalculator({ initial: WORKED })).toContain('<p class="sr-only" aria-live="polite"></p>');
  });
});

describe('pounds to buy', () => {
  it('says how much to buy, and has no money lines, margin, portion or share', async () => {
    const html = await renderCalculator({ initial: { ...WORKED, mode: 'weight', targetWeight: '100' } });
    const ticket = ticketOf(html);
    expect(ticket).toContain('<p class="ticket-label">Buy this much <b>Whole fish</b></p>');
    expect(ticket).toMatch(/<p class="ticket-figure"[^>]*>217\.4<small> lbs<\/small><\/p>/);
    expect(textOf(ticket)).toContain('Makes, at 46% yield 100 lbs of skinless fillet');
    expect(textOf(ticket)).not.toMatch(/\$|margin|portion/);
    expect(ticket).not.toContain('Share this price');
    expect(html).not.toContain('id="calc-margin"');
    expect(html).not.toContain('calc-extras');
  });
});

describe('where saved prices live', () => {
  it('tells a guest, in one line, that signing in keeps them across devices', async () => {
    const html = await renderCalculator({ initial: WORKED });
    const text = textOf(html);
    expect(text).toContain('Saved prices stay on this phone. Signing in keeps them across your devices.');
    expect(html.match(/href="\/login"/g)).toHaveLength(1);
    expect(text).not.toMatch(/Want to keep this|to save your/);
  });

  it('mentions no accounts at all in a build with no backend', async () => {
    for (const initial of [WORKED, undefined]) {
      const html = await renderCalculator({ initial, platform: { backendEnabled: false, isNativeApp: true } });
      expect(textOf(html)).not.toMatch(/sign in|signing in|account|log ?in/i);
      expect(html).not.toContain('/login');
      // Saving still works: it is on the ticket
      if (initial) expect(ticketOf(html)).toMatch(/Save<\/button>/);
    }
  });

  it('does not ask someone who is signed in to sign in', async () => {
    const html = await renderCalculator({ initial: WORKED, user: { uid: 'u1', username: 'ada' } });
    expect(html).not.toContain('/login');
    expect(textOf(html)).toContain('Download CSV');
    expect(ticketOf(html)).toMatch(/<button type="button" class="ticket-action">.*?Save<\/button>/);
  });

  it('offers no saving while the app is read-only', async () => {
    const data = fakeUseData({ readOnly: true });
    const ticket = ticketOf(await renderCalculator({ initial: WORKED, data }));
    expect(ticket).toMatch(/<button type="button" class="ticket-action" disabled="">.*?Save<\/button>/);
  });
});

describe('saving as a guest', () => {
  it('goes through useData().saveCalc with the record My yields lists', async () => {
    const data = fakeUseData();
    const record = savedPriceRecord({ mode: 'cost', ...CHOSEN, targetWeight: NaN }, workedModel());

    expect(await savePrice(data, record)).toBe('saved');
    expect(data.saveCalc).toHaveBeenCalledExactlyOnceWith({
      name: 'Sockeye Salmon - Round → Skinless Fillet',
      species: 'Sockeye Salmon',
      product: 'Round → Skinless Fillet',
      mode: 'cost',
      cost: 4.5,
      target_weight: 0,
      yield: 46,
      result: expect.closeTo(9.7826, 4),
    });
  });

  it('lands in the guest scope on the device, ready to sync if the person signs in later', async () => {
    const db = {};
    const store = {
      get: async (key) => structuredClone(db[key]),
      set: async (key, value) => { db[key] = structuredClone(value); },
    };
    const repo = createRepository(guestScope({ getItem: () => 'install-1', setItem: () => {} }), { store });
    // What DataContext.saveCalc does for whoever is using the app: guest scope when signed out
    const data = fakeUseData({ saveCalc: (calc) => repo.addCalc(calc) });

    const record = savedPriceRecord({ mode: 'cost', ...CHOSEN, targetWeight: NaN }, workedModel());
    expect(await savePrice(data, record)).toBe('saved');

    const kept = await repo.getCalcs();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      scope: 'guest:install-1',
      syncStatus: 'local',
      is_private: true,
      name: 'Sockeye Salmon - Round → Skinless Fillet',
      species: 'Sockeye Salmon',
      product: 'Round → Skinless Fillet',
      cost: 4.5,
      yield: 46,
    });
    // The line My yields prints for a saved price
    expect(`$${Number(kept[0].result).toFixed(2)}/lb`).toBe('$9.78/lb');
  });

  it('saves nothing in read-only mode, when there is no answer, or when storage fails', async () => {
    const readOnly = fakeUseData({ readOnly: true });
    const record = savedPriceRecord({ mode: 'cost', ...CHOSEN, targetWeight: NaN }, workedModel());
    expect(await savePrice(readOnly, record)).toBe('read-only');
    expect(readOnly.saveCalc).not.toHaveBeenCalled();

    const noAnswer = buildTicketModel({ mode: 'cost', ...CHOSEN, cost: '', yieldPercent: '46', conversion: SOCKEYE });
    expect(savedPriceRecord({ mode: 'cost', ...CHOSEN }, noAnswer)).toBeNull();
    const data = fakeUseData();
    expect(await savePrice(data, null)).toBe('nothing');
    expect(data.saveCalc).not.toHaveBeenCalled();

    expect(await savePrice(fakeUseData({ saveCalc: async () => { throw new Error('quota'); } }), record)).toBe('failed');
    // DataContext.saveCalc resolves to null when it refuses the write
    expect(await savePrice(fakeUseData({ saveCalc: async () => null }), record)).toBe('failed');
  });

  it('keeps a pounds-to-buy answer with its mode and target weight', () => {
    const model = buildTicketModel({ mode: 'weight', ...CHOSEN, targetWeight: '100', yieldPercent: '46', conversion: SOCKEYE });
    expect(savedPriceRecord({ mode: 'weight', ...CHOSEN, targetWeight: 100 }, model)).toMatchObject({
      mode: 'weight', cost: 0, target_weight: 100, yield: 46, result: expect.closeTo(217.39, 2),
    });
  });
});

describe('sharing the price', () => {
  const FULL_CARD = [
    'Sockeye Salmon, skinless fillet: $9.78/lb',
    'From whole fish at 46% yield',
    'Range: $9.18–$10.98/lb',
    'Sell price: $15.05/lb at a 35% margin',
    '6 oz portion: $3.67',
  ].join('\n');

  it('builds the card from the ticket, without what was paid unless asked', () => {
    expect(priceCardFor(CHOSEN, workedModel())).toBe(FULL_CARD);
    expect(priceCardFor(CHOSEN, workedModel(), { includePaid: true })).toBe(`${FULL_CARD}\nPaid: $4.50/lb`);
  });

  it('copies the card to the clipboard where there is no share sheet', async () => {
    const writeText = vi.fn(async () => {});
    const outcome = await sharePriceCard(priceCardFor(CHOSEN, workedModel()), {
      native: false, nav: { clipboard: { writeText } }, doc: null,
    });
    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(FULL_CARD);
  });

  it('has no card for a pounds-to-buy answer or for no answer', () => {
    const weight = buildTicketModel({ mode: 'weight', ...CHOSEN, targetWeight: '100', yieldPercent: '46', conversion: SOCKEYE });
    expect(priceCardFor(CHOSEN, weight)).toBe('');
    expect(priceCardFor(CHOSEN, buildTicketModel({ mode: 'cost', ...CHOSEN, conversion: SOCKEYE }))).toBe('');
  });
});
