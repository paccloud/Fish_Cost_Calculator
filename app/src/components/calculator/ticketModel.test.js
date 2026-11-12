import { describe, expect, it } from 'vitest';
import {
  buildTicketModel, marginProblem, portionProblem, yieldProblem, yieldSource, NUMBERS_ONLY,
} from './ticketModel';

// The hand-worked example used across the app: Sockeye Salmon, whole fish to skinless fillet,
// $4.50/lb at the reference yield of 46% (typical 41–49%).
const SOCKEYE = { yield: 46, range: [41, 49], from: 'Round', to: 'Skinless Fillet' };
const worked = (over = {}) => ({
  mode: 'cost',
  species: 'Sockeye Salmon',
  fromState: 'Round',
  toState: 'Skinless Fillet',
  cost: '4.50',
  targetWeight: '',
  yieldPercent: '46',
  processingCost: '',
  weightType: 'incoming',
  shipping: '',
  shippingWeightType: 'outgoing',
  margin: '',
  portion: '',
  conversion: SOCKEYE,
  ...over,
});
const lines = (model) => model.lines.map((line) => [line.id, line.label, line.value]);
const everythingSaid = (model) => JSON.stringify([model.answer, model.lines, model.prompt, model.sentence]);

describe('buildTicketModel: the worked example', () => {
  it('prices the fillet at $9.78/lb and names it in plain words', () => {
    const model = buildTicketModel(worked());
    expect(model.answer).toEqual({ label: 'Your cost per lb of', subject: 'Skinless fillet', figure: '$9.78', unit: '/lb' });
    expect(model.prompt).toBe('');
    expect(model.sentence).toBe('$9.78 per lb of skinless fillet');
    expect(model.result).toBeCloseTo(9.7826, 4);
  });

  it('shows the range, the sell price and the portion, in that order', () => {
    const model = buildTicketModel(worked({ margin: '35', portion: '6' }));
    expect(lines(model)).toEqual([
      ['range', 'Across typical yields, 41–49%', '$9.18–$10.98/lb'],
      ['sell', 'Sell price at 35% margin', '$15.05/lb'],
      ['portion', '6 oz portion', '$3.67'],
    ]);
    expect(model.sell).toEqual({ price: expect.closeTo(15.0502, 3), marginPct: 35 });
    expect(model.portion).toEqual({ ounces: 6, cost: expect.closeTo(3.6685, 3) });
  });

  it('puts the cost parts between the range and the sell price once processing or shipping is set', () => {
    const model = buildTicketModel(worked({ processingCost: '0.50', shipping: '0.75', margin: '35' }));
    expect(model.answer.figure).toBe('$11.62');
    expect(lines(model)).toEqual([
      ['range', 'Across typical yields, 41–49%', '$10.95–$12.95/lb'],
      ['fish', 'Fish', '$9.78/lb'],
      ['processing', 'Processing', '$1.09/lb'],
      ['shipping', 'Shipping', '$0.75/lb'],
      ['sell', 'Sell price at 35% margin', '$17.88/lb'],
    ]);
  });

  it('reads numbers the way people type them', () => {
    expect(buildTicketModel(worked({ cost: '$4.50' })).answer.figure).toBe('$9.78');
    expect(buildTicketModel(worked({ cost: '4,50' })).answer.figure).toBe('$9.78');
    expect(buildTicketModel(worked({ cost: '1,000' })).answer.figure).toBe('$2,173.91');
    expect(buildTicketModel(worked({ yieldPercent: '42%' })).answer.figure).toBe('$10.71');
  });
});

describe('buildTicketModel: a line only when it has something true to say', () => {
  it('has no lines when there is no range, no extras, no margin and no portion', () => {
    const model = buildTicketModel(worked({ conversion: { yield: 46, range: null, from: 'Round' } }));
    expect(model.answer.figure).toBe('$9.78');
    expect(model.lines).toEqual([]);
  });

  it('keeps the range while the typed yield is inside it, and drops it once it is outside', () => {
    expect(lines(buildTicketModel(worked({ yieldPercent: '44' })))).toEqual([
      ['range', 'Across typical yields, 41–49%', '$9.18–$10.98/lb'],
    ]);
    const outside = buildTicketModel(worked({ yieldPercent: '60' }));
    expect(outside.answer.figure).toBe('$7.50');
    expect(outside.lines).toEqual([]);
    expect(outside.range).toBeNull();
  });

  it('drops a range with nothing between its ends', () => {
    expect(buildTicketModel(worked({ conversion: { yield: 46, range: [46, 46] } })).lines).toEqual([]);
  });

  it('leaves out the sell price for a margin that cannot be used, and the portion for a size that cannot', () => {
    for (const margin of ['100', '250', 'lots', '-5']) {
      expect(lines(buildTicketModel(worked({ margin }))).map(([id]) => id), margin).toEqual(['range']);
    }
    for (const portion of ['0', 'big', '-2']) {
      expect(lines(buildTicketModel(worked({ portion }))).map(([id]) => id), portion).toEqual(['range']);
    }
    // A bad margin or portion does not take the price away
    expect(buildTicketModel(worked({ margin: 'lots', portion: 'big' })).answer.figure).toBe('$9.78');
  });

  it('prices a fish that cost nothing when there is processing to pay for, without a $0.00 fish line', () => {
    const model = buildTicketModel(worked({ cost: '0', processingCost: '1.00' }));
    expect(model.answer.figure).toBe('$2.17');
    expect(lines(model).map(([id]) => id)).toEqual(['range', 'processing']);
  });
});

describe('buildTicketModel: one sentence saying what is missing', () => {
  it('asks for each choice in turn', () => {
    expect(buildTicketModel(worked({ species: '', fromState: '', toState: '' })).prompt).toBe('Choose a species to see your cost per lb.');
    expect(buildTicketModel(worked({ fromState: '', toState: '' })).prompt).toBe('Choose what you have.');
    expect(buildTicketModel(worked({ toState: '' })).prompt).toBe('Choose what you’re making.');
    expect(buildTicketModel(worked({ cost: '' })).prompt).toBe('Type what you pay per lb of whole fish.');
    expect(buildTicketModel(worked({ yieldPercent: '' })).prompt).toBe('Type a yield, like 46%.');
  });

  it('says to use numbers when a box cannot be read, and blanks the answer', () => {
    for (const over of [{ cost: 'abc' }, { yieldPercent: 'half' }, { processingCost: 'x' }, { shipping: '1.2.3' }]) {
      const model = buildTicketModel(worked(over));
      expect(model.answer, JSON.stringify(over)).toBeNull();
      expect(model.result).toBeNull();
      expect(model.prompt).toBe(NUMBERS_ONLY);
      expect(model.sentence).toBe(NUMBERS_ONLY);
      expect(model.lines).toEqual([]);
    }
  });

  it('says what a yield is when it is 0 or over 100', () => {
    for (const yieldPercent of ['0', '120']) {
      const model = buildTicketModel(worked({ yieldPercent }));
      expect(model.answer).toBeNull();
      expect(model.prompt).toBe('Yield is a percentage above 0 and up to 100, like 46.');
    }
  });

  it('does not read "choose a species" aloud', () => {
    expect(buildTicketModel(worked({ species: '', fromState: '', toState: '' })).sentence).toBe('');
    expect(buildTicketModel(worked({ cost: '' })).sentence).toBe('');
  });
});

describe('buildTicketModel: never $0.00, NaN, Infinity', () => {
  const nasty = ['', ' ', '0', '0.00', '0.001', '.', '-1', 'abc', 'NaN', 'Infinity', '1e309', '9'.repeat(400), '$', '%', '1,00,0', '00', '4.50'];

  it('says nothing false for any mix of awkward entries', () => {
    for (const cost of nasty) {
      for (const yieldPercent of ['', '0', '0.0001', '46', '100', '101', 'abc']) {
        for (const extra of ['', '0', 'abc', '0.004', '9'.repeat(400)]) {
          const model = buildTicketModel(worked({ cost, yieldPercent, processingCost: extra, shipping: extra, margin: extra || '99.99', portion: extra || '0.0001' }));
          const said = everythingSaid(model);
          const where = JSON.stringify({ cost, yieldPercent, extra });
          expect(said, where).not.toMatch(/NaN|Infinity|undefined|null lbs|\$0\.00|e\+/);
          if (model.answer) {
            expect(model.answer.figure, where).toMatch(/^\$\d{1,3}(,\d{3})*\.\d{2}$/);
            expect(Number.isFinite(model.result) && model.result > 0, where).toBe(true);
            for (const line of model.lines) expect(line.value, where).toMatch(/^\$[\d,]+\.\d{2}/);
          } else {
            expect(model.prompt, where).not.toBe('');
            expect(model.lines, where).toEqual([]);
            expect(model.result, where).toBeNull();
          }
        }
      }
    }
  });

  it('has no answer when the price paid is nothing and nothing else is charged', () => {
    for (const cost of ['0', '0.00', '0.001']) {
      const model = buildTicketModel(worked({ cost }));
      expect(model.answer, cost).toBeNull();
      expect(model.prompt).not.toBe('');
    }
  });
});

describe('buildTicketModel: pounds to buy', () => {
  const weight = (over = {}) => worked({ mode: 'weight', cost: '', targetWeight: '100', ...over });

  it('says how much to buy and what it makes, and leaves out the money lines', () => {
    const model = buildTicketModel(weight({ margin: '35', portion: '6', processingCost: '0.50' }));
    expect(model.answer).toEqual({ label: 'Buy this much', subject: 'Whole fish', figure: '217.4', unit: 'lbs' });
    expect(lines(model)).toEqual([['makes', 'Makes, at 46% yield', '100 lbs of skinless fillet']]);
    expect(model.sentence).toBe('Buy 217.4 lbs of whole fish');
  });

  it('asks for the weight, and never shows 0.0 lbs', () => {
    expect(buildTicketModel(weight({ targetWeight: '' })).prompt).toBe('Type how many lbs of skinless fillet you need.');
    expect(buildTicketModel(weight({ targetWeight: '0' })).answer).toBeNull();
    expect(buildTicketModel(weight({ species: '', fromState: '', toState: '' })).prompt).toBe('Choose a species to see how much to buy.');
  });

  it('ignores text left in the cost-mode boxes', () => {
    expect(buildTicketModel(weight({ cost: 'abc', processingCost: 'x' })).answer.figure).toBe('217.4');
  });

  it('groups thousands', () => {
    expect(buildTicketModel(weight({ targetWeight: '5,000' })).answer.figure).toBe('10,869.6');
  });
});

describe('yieldSource: every yield says where it came from', () => {
  it('stamps a reference yield with its source and range', () => {
    expect(yieldSource(SOCKEYE, '46')).toEqual({ tone: 'reference', text: 'MAB-37 · 41–49%' });
    // The two ends of the range are the source's own figures too
    expect(yieldSource(SOCKEYE, '41').tone).toBe('reference');
    expect(yieldSource(SOCKEYE, '49').tone).toBe('reference');
    expect(yieldSource({ yield: 40, range: null }, '40')).toEqual({ tone: 'reference', text: 'MAB-37' });
  });

  it('says "Your yield" once the person types their own, or uses one they recorded', () => {
    expect(yieldSource(SOCKEYE, '44')).toEqual({ tone: 'yours', text: 'Your yield' });
    expect(yieldSource({ yield: 52, from: 'Custom', to: 'Fillet' }, '52')).toEqual({ tone: 'yours', text: 'Your yield' });
  });

  it('has nothing to say before a product is chosen', () => {
    expect(yieldSource(null, '')).toBeNull();
  });
});

describe('what to type when a box is wrong', () => {
  it('yield', () => {
    expect(yieldProblem('46', SOCKEYE)).toBe('');
    expect(yieldProblem('', SOCKEYE)).toBe('');
    expect(yieldProblem('abc', SOCKEYE)).toBe(''); // unreadable text is the ticket's "use numbers" message
    expect(yieldProblem('150', SOCKEYE)).toBe('Yield is a percentage above 0 and up to 100, like 46.');
    expect(yieldProblem('150', null)).toBe('Yield is a percentage above 0 and up to 100.');
  });

  it('margin', () => {
    expect(marginProblem('')).toBe('');
    expect(marginProblem('0')).toBe('');
    expect(marginProblem('35')).toBe('');
    expect(marginProblem('100')).toMatch(/^Margin is a percentage from 0 to 99\./);
    expect(marginProblem('lots')).toMatch(/Type a number, like 35\.$/);
  });

  it('portion', () => {
    expect(portionProblem('')).toBe('');
    expect(portionProblem('6')).toBe('');
    expect(portionProblem('0')).toBe('');
    expect(portionProblem('big')).toBe('Portion size is in ounces. Type a number, like 6.');
  });
});
