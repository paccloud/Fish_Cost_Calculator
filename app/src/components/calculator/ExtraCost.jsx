import { parseAmount } from '../../lib/numberInput';
import { formatMoney } from '../../lib/priceCard';
import ChoiceTile from './ChoiceTile';
import FieldError from './FieldError';
import Stepper from './Stepper';

const cents = (n) => n.toFixed(2);

/**
 * A per-lb charge (processing or shipping) and which weight it is charged on.
 * Processors differ: some bill every pound you drop off (incoming), some only the pounds you
 * take back (outgoing).
 */
export default function ExtraCost({
  id, title, amount, onAmount, basis, onBasis, basisLegend, fromWords, productWords, perFinishedLb, yieldPercent,
}) {
  const hintId = `${id}-hint`;
  const typed = parseAmount(amount);
  const unreadable = String(amount).trim() !== '' && Number.isNaN(typed);
  const spread = formatMoney(perFinishedLb);
  let hint = `Choose which weight the ${title.toLowerCase()} price is per lb of.`;
  if (unreadable) {
    hint = `${title} is a price per lb. Type a number, like 0.50.`;
  } else if (typed > 0 && basis === 'incoming' && perFinishedLb > 0 && spread) {
    hint = `${formatMoney(typed)} per lb of ${fromWords} comes to ${spread} per lb of ${productWords} at ${yieldPercent}% yield.`;
  } else if (typed > 0 && basis === 'outgoing') {
    hint = `${formatMoney(typed)} per lb of ${productWords}, added as is.`;
  }
  return (
    <div className="space-y-3">
      <label htmlFor={id} className="block text-base font-bold text-text-primary">
        {title} <span className="font-normal text-text-secondary">per lb</span>
      </label>
      <Stepper
        id={id}
        value={amount}
        onChange={onAmount}
        step={0.05}
        format={cents}
        prefix="$"
        placeholder="0.00"
        lessLabel={`Lower the ${title.toLowerCase()} price by 5 cents`}
        moreLabel={`Raise the ${title.toLowerCase()} price by 5 cents`}
        describedBy={hintId}
      />
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-semibold text-text-primary">{basisLegend}</legend>
        <div className="grid grid-cols-2 gap-2">
          <ChoiceTile
            name={`${id}-basis`}
            value="incoming"
            checked={basis === 'incoming'}
            onChange={() => onBasis('incoming')}
            label="Incoming weight"
            sub={`lbs of ${fromWords}`}
          />
          <ChoiceTile
            name={`${id}-basis`}
            value="outgoing"
            checked={basis === 'outgoing'}
            onChange={() => onBasis('outgoing')}
            label="Outgoing weight"
            sub={`lbs of ${productWords}`}
          />
        </div>
      </fieldset>
      {unreadable
        ? <FieldError id={hintId}>{hint}</FieldError>
        : <p id={hintId} className="text-sm text-text-secondary">{hint}</p>}
    </div>
  );
}
