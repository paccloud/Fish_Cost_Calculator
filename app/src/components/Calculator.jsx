import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useId } from 'react';
import { Link } from 'react-router-dom';
import { ACRONYMS, FISH_DATA_V3, PROFILES_DATA } from '../data/fish_data_v3';
import { Calculator as CalcIcon, Save, HelpCircle, Download, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../config/api';
import { calculate } from '../lib/calcEngine';
import { parseAmount } from '../lib/numberInput';

/**
 * Help bubble that works for mouse (hover), keyboard (focus) and touch (tap).
 * Hover-only tooltips are invisible on phones, which is where most people use this.
 *
 * The bubble is `position: fixed` and placed from the trigger's rect. Fixed elements never add
 * scrollable overflow, so a bubble near the screen edge can't widen the page on mobile.
 */
const Tooltip = ({ text, label, iconOnly = false, children }) => {
  const [show, setShow] = useState(false);
  const bubbleId = useId();
  const wrapperRef = useRef(null);
  const bubbleRef = useRef(null);
  const lastPointer = useRef('mouse');

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const trigger = wrapperRef.current;
    if (!show || !bubble || !trigger) return;
    const gap = 8;
    const vv = window.visualViewport;
    const viewportWidth = vv?.width ?? document.documentElement.clientWidth;
    const minX = (vv?.offsetLeft ?? 0) + gap;
    const maxX = (vv?.offsetLeft ?? 0) + viewportWidth - gap;
    // The CSS cap is in layout units; when zoomed in the visible area is narrower, so cap it here too
    bubble.style.maxWidth = `${Math.min(parseFloat(getComputedStyle(bubble).maxWidth) || Infinity, maxX - minX)}px`;
    const t = trigger.getBoundingClientRect();
    const { width, height } = bubble.getBoundingClientRect();
    const left = Math.min(Math.max(t.left, minX), Math.max(minX, maxX - width));
    // Prefer above the trigger; drop below when it would slide under the 56px sticky navbar
    const fitsAbove = t.top - height - gap >= (vv?.offsetTop ?? 0) + 64;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${fitsAbove ? t.top - height - gap : t.bottom + gap}px`;
  }, [show]);

  // Tapping elsewhere closes it (iOS never blurs a tapped button); scrolling would detach it
  useEffect(() => {
    if (!show) return undefined;
    const close = (e) => {
      if (e.type === 'scroll' || !wrapperRef.current?.contains(e.target)) setShow(false);
    };
    document.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [show]);

  return (
    <span ref={wrapperRef} className="inline-block">
      <button
        type="button"
        aria-label={label}
        aria-describedby={show ? bubbleId : undefined}
        aria-expanded={show}
        className={`cursor-help rounded text-left ${
          // 44px hit area without moving the layout: padding out, negative margin back in
          iconOnly
            ? '-m-[13px] p-[13px]'
            : "relative before:absolute before:-inset-2.5 before:content-['']"
        }`}
        onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setShow(true); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setShow(false); }}
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setShow(true); }}
        onBlur={() => setShow(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setShow(false); }}
        onClick={(e) => {
          // detail === 0 means keyboard or assistive-tech activation: always open (Esc closes)
          if (e.detail === 0) setShow(true);
          else if (lastPointer.current !== 'mouse') setShow((s) => !s);
        }}
      >
        {children}
      </button>
      {show && (
        <span
          id={bubbleId}
          ref={bubbleRef}
          role="tooltip"
          className="fixed left-0 top-0 z-50 w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-line-strong bg-surface-raised px-3 py-2 text-sm font-normal leading-snug text-text-primary shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
};

/** One big tap target in a group of choices (a radio button styled as a tile). */
const Tile = ({ name, value, checked, onChange, label, sub }) => (
  <label className="relative block">
    <input
      type="radio"
      name={name}
      value={value}
      checked={checked}
      onChange={onChange}
      className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
    />
    <span
      className="flex h-full min-h-[3.5rem] flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-line-strong bg-surface-raised px-3 py-2 text-center text-base font-bold leading-tight text-text-primary transition-colors peer-hover:border-accent peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--color-focus)] peer-checked:[&_small]:text-white"
    >
      {label}
      {sub && <small className="text-sm font-medium text-text-secondary">{sub}</small>}
    </span>
  </label>
);

const stepButton =
  'min-h-[3.5rem] rounded-xl border-2 border-line-strong bg-surface-raised text-3xl font-bold leading-none text-text-primary transition-colors hover:border-accent active:translate-y-px active:bg-surface';

/** A number field with big − / + buttons either side, for wet or gloved hands. */
const Stepper = ({ id, value, onChange, step, format, prefix, suffix, lessLabel, moreLabel, placeholder, describedBy }) => {
  const inputRef = useRef(null);
  const invalid = String(value).trim() !== '' && Number.isNaN(parseAmount(value));
  const bump = (delta) => onChange(format(Math.max(0, (parseAmount(value) || 0) + delta)));
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] gap-2">
      <button type="button" onClick={() => bump(-step)} aria-label={lessLabel} className={stepButton}>−</button>
      {/* The input is sized to its text so the $ or unit sits right beside the number; a tap anywhere in the box focuses it */}
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex cursor-text items-center justify-center gap-1 overflow-hidden rounded-xl border-2 border-line-strong bg-surface-raised px-3 has-[[aria-invalid=true]]:border-danger focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-[color:var(--color-focus)]">
        {prefix && <span aria-hidden="true" className="text-xl font-bold text-text-secondary">{prefix}</span>}
        <input
          ref={inputRef}
          id={id}
          size={Math.max(String(value || placeholder || '').length, 2)}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="min-h-[3.25rem] min-w-0 max-w-full bg-transparent text-center text-2xl font-extrabold tabular-nums text-text-primary placeholder-text-muted focus:outline-none"
        />
        {suffix && <span aria-hidden="true" className="whitespace-nowrap text-lg font-bold text-text-secondary">{suffix}</span>}
      </div>
      <button type="button" onClick={() => bump(step)} aria-label={moreLabel} className={stepButton}>+</button>
    </div>
  );
};

const money = (n) => n.toFixed(2);
const plainNumber = (n) => String(Number(n.toFixed(2)));
const dollars = (n) => `$${n.toFixed(2)}`;

/**
 * A per-lb charge (processing or shipping) and which weight it is charged on.
 * Processors differ: some bill every pound you drop off (incoming), some only the pounds you take back (outgoing).
 */
const ExtraCost = ({ id, title, amount, onAmount, basis, onBasis, basisLegend, fromState, toState, perFinishedLb, yieldPercent }) => {
  const hintId = `${id}-hint`;
  const charged = parseAmount(amount) > 0;
  let hint = `Pick which weight the ${title.toLowerCase()} price is per pound of.`;
  if (charged && basis === 'incoming') {
    hint = `${dollars(parseAmount(amount))} per lb of ${fromState} works out to ${dollars(perFinishedLb)} per lb of ${toState} at ${yieldPercent}% yield.`;
  } else if (charged) {
    hint = `${dollars(parseAmount(amount))} per lb of ${toState}, added as is.`;
  }
  return (
    <div className="space-y-3">
      <label htmlFor={id} className="block text-base font-bold text-text-primary">
        {title} <span className="font-normal text-text-secondary">per lb, optional</span>
      </label>
      <Stepper
        id={id}
        value={amount}
        onChange={onAmount}
        step={0.05}
        format={money}
        prefix="$"
        placeholder="0.00"
        lessLabel={`${title}: 5 cents less`}
        moreLabel={`${title}: 5 cents more`}
        describedBy={hintId}
      />
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-text-primary">{basisLegend}</legend>
        <div className="grid grid-cols-2 gap-2.5">
          <Tile
            name={`${id}-basis`}
            value="incoming"
            checked={basis === 'incoming'}
            onChange={() => onBasis('incoming')}
            label="Incoming weight"
            sub={`lbs of ${fromState}`}
          />
          <Tile
            name={`${id}-basis`}
            value="outgoing"
            checked={basis === 'outgoing'}
            onChange={() => onBasis('outgoing')}
            label="Outgoing weight"
            sub={`lbs of ${toState}`}
          />
        </div>
      </fieldset>
      <p id={hintId} className="text-sm text-text-secondary">{hint}</p>
    </div>
  );
};

const StepHeading = ({ number, children, id }) => (
  <h2 id={id} className="flex items-center gap-3 text-xl font-bold text-text-primary">
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-white"
    >
      {number}
    </span>
    {children}
  </h2>
);

const TO_LIMIT = 6;

const Calculator = () => {
  const { user, getAuthHeaders } = useAuth();
  const [mode, setMode] = useState('cost');
  const [targetWeight, setTargetWeight] = useState('');
  const [species, setSpecies] = useState('');
  const [fromState, setFromState] = useState('');
  const [toState, setToState] = useState('');
  const [showAllTo, setShowAllTo] = useState(false);
  const [cost, setCost] = useState('');
  const [yieldPercent, setYieldPercent] = useState('');
  const [processingCost, setProcessingCost] = useState('');
  const [weightType, setWeightType] = useState('incoming');
  const [shipping, setShipping] = useState('');
  const [shippingWeightType, setShippingWeightType] = useState('outgoing');
  // Which inputs the last save was for, so "Saved" disappears as soon as anything changes
  const [saveState, setSaveState] = useState({ key: null, text: '' });
  const [announcement, setAnnouncement] = useState('');
  const dockRef = useRef(null);

  const [customData, setCustomData] = useState({});
  const [_history, setHistory] = useState([]);
  const [publicHistory, setPublicHistory] = useState([]);

  const [fishData, setFishData] = useState(FISH_DATA_V3);
  const [profilesData, setProfilesData] = useState(PROFILES_DATA);
  const [dataLoading, _setDataLoading] = useState(false);

  useEffect(() => {
    fetch(apiUrl('/api/fish-data'))
      .then(res => res.json())
      .then(data => {
        if (data.fishData && Object.keys(data.fishData).length > 0) setFishData(data.fishData);
        if (data.profiles && Object.keys(data.profiles).length > 0) setProfilesData(data.profiles);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(apiUrl('/api/public-calcs'))
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setPublicHistory(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      getAuthHeaders().then(headers => {
        fetch(apiUrl('/api/user-data'), { headers })
          .then(res => res.json())
          .then(data => {
            if (Array.isArray(data)) {
              const mapped = {};
              data.forEach(item => {
                if (!mapped[item.species]) mapped[item.species] = { conversions: {} };
                mapped[item.species].conversions[`Custom: ${item.product}`] = {
                  yield: parseFloat(item.yield),
                  from: 'Custom',
                  to: item.product
                };
              });
              setCustomData(mapped);
            }
          })
          .catch(() => {});

        fetch(apiUrl('/api/saved-calcs'), { headers })
          .then(res => res.json())
          .then(data => setHistory(data))
          .catch(() => {});
      });
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCustomData({});
      setHistory([]);
    }
  }, [user, getAuthHeaders]);

  const combinedData = useMemo(() => {
    const merged = { ...fishData };
    Object.keys(customData).forEach(sp => {
      if (!merged[sp]) merged[sp] = customData[sp];
      else merged[sp] = { ...merged[sp], conversions: { ...merged[sp].conversions, ...customData[sp].conversions } };
    });
    return merged;
  }, [fishData, customData]);

  const speciesList = Object.keys(combinedData).sort();

  const conversionsFor = (sp) => Object.values(combinedData[sp]?.conversions || {});

  // Kept in the data's order (Round → D/H-On → D/H-Off …), which follows the cutting line, with Round first
  const fromStates = useMemo(() => {
    if (!species || !combinedData[species]) return [];
    const states = [...new Set(Object.values(combinedData[species].conversions || {}).map(c => c.from).filter(Boolean))];
    return states.includes('Round') ? ['Round', ...states.filter(s => s !== 'Round')] : states;
  }, [species, combinedData]);

  const toStates = useMemo(() => {
    if (!species || !fromState || !combinedData[species]) return [];
    return Object.values(combinedData[species].conversions || {})
      .filter(conv => conv.from === fromState && conv.to)
      .map(conv => ({ to: conv.to, yield: conv.yield, range: conv.range }));
  }, [species, fromState, combinedData]);

  const currentConversion = useMemo(() => {
    if (!species || !fromState || !toState || !combinedData[species]) return null;
    return Object.values(combinedData[species].conversions || {}).find(
      conv => conv.from === fromState && conv.to === toState
    );
  }, [species, fromState, toState, combinedData]);

  const profile = species ? profilesData[species] : null;
  const scientificName = species && combinedData[species] ? combinedData[species].scientific_name : null;
  const yieldRange = currentConversion?.range || null;

  const chooseFrom = (from) => {
    setFromState(from);
    setToState(''); setYieldPercent(''); setShowAllTo(false);
  };

  const handleSpeciesChange = (e) => {
    const sp = e.target.value;
    setSpecies(sp);
    // Most people start from the whole fish, so pick it for them (or the only choice there is)
    const froms = [...new Set(conversionsFor(sp).map(c => c.from).filter(Boolean))];
    chooseFrom(froms.includes('Round') ? 'Round' : froms.length === 1 ? froms[0] : '');
  };

  const chooseTo = (to) => {
    setToState(to);
    const conv = toStates.find(t => t.to === to);
    setYieldPercent(conv ? String(conv.yield) : '');
  };

  // The answer is worked out live from what is on screen, so it can never describe different numbers
  const ready = Boolean(species && fromState && toState);
  const mainInput = mode === 'cost' ? cost : targetWeight;
  const hasMainInput = Number.isFinite(parseAmount(mainInput));
  // A box with text that isn't a number would otherwise count as 0 and give a wrong answer, so show none
  const badInput = [mainInput, yieldPercent, ...(mode === 'cost' ? [processingCost, shipping] : [])]
    .some(v => String(v).trim() !== '' && Number.isNaN(parseAmount(v)));
  const calc = useMemo(() => {
    if (!ready) return null;
    return calculate({
      mode,
      yieldPercent: parseAmount(yieldPercent),
      targetWeight: parseAmount(targetWeight),
      cost: parseAmount(cost),
      processingCost: parseAmount(processingCost),
      weightType,
      shipping: parseAmount(shipping),
      shippingWeightType,
    });
  }, [ready, mode, yieldPercent, targetWeight, cost, processingCost, weightType, shipping, shippingWeightType]);
  const result = calc && hasMainInput && !badInput ? calc.result : null;

  const inputsKey = JSON.stringify([
    mode, species, fromState, toState, cost, targetWeight, yieldPercent,
    processingCost, weightType, shipping, shippingWeightType,
  ]);
  const saveStatus = saveState.key === inputsKey ? saveState.text : '';

  const numbersOnly = 'Use numbers only in the boxes, like 4.50 or 1,000';
  let resultSentence = '';
  if (result !== null) {
    resultSentence = mode === 'cost' ? `${dollars(result)} per lb of ${toState}` : `Buy ${result.toFixed(1)} lbs of ${fromState}`;
  } else if (ready && badInput) {
    resultSentence = numbersOnly;
  }

  // Screen readers hear the answer once typing pauses, not on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setAnnouncement(resultSentence), 900);
    return () => clearTimeout(timer);
  }, [resultSentence]);

  // Tabbing or scrolling a field into view must not leave it under the pinned result bar (WCAG 2.4.11)
  useEffect(() => {
    const bar = dockRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return undefined;
    const root = document.documentElement;
    const apply = () => { root.style.scrollPaddingBottom = `${bar.offsetHeight + 16}px`; };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => { observer.disconnect(); root.style.scrollPaddingBottom = ''; };
  }, []);

  const handleSave = async () => {
    if (!user || result === null) return;
    const key = inputsKey;
    try {
      const headers = await getAuthHeaders('application/json');
      const res = await fetch(apiUrl('/api/save-calc'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: `${species} - ${fromState} → ${toState}`,
          species, product: `${fromState} → ${toState}`,
          mode, cost: mode === 'cost' ? parseAmount(cost) : 0,
          target_weight: mode === 'weight' ? parseAmount(targetWeight) : 0,
          yield: parseAmount(yieldPercent), result
        })
      });
      setSaveState({ key, text: res.ok ? 'Saved!' : 'Failed to save' });
    } catch {
      setSaveState({ key, text: 'Error saving' });
    }
  };

  const handleExport = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(apiUrl('/api/export?type=calcs'), { headers });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'calculations.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      /* silent */
    }
  };

  const handleExportXlsx = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(apiUrl('/api/export?type=calcs&format=xlsx'), { headers });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'calculations.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      /* silent */
    }
  };

  const shownTo = showAllTo || toStates.length <= TO_LIMIT
    ? toStates
    : toStates.filter((t, i) => i < TO_LIMIT || t.to === toState);

  const presets = currentConversion && yieldRange
    ? [['Low', yieldRange[0]], ['Average', currentConversion.yield], ['High', yieldRange[1]]]
    : [];

  const extras = calc?.breakdown
    ? [['Processing', calc.breakdown.processing], ['Shipping', calc.breakdown.shipping]].filter(([, v]) => v > 0)
    : [];

  let dockPrompt = 'Pick a species, what you have, and what you’re making';
  if (ready && badInput) dockPrompt = numbersOnly;
  else if (ready) dockPrompt = mode === 'cost' ? `Enter what you pay per lb of ${fromState}` : `Enter how many lbs of ${toState} you need`;

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-48">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight text-text-primary">Fish Cost Calculator</h1>
        <p className="mt-1 text-base text-text-secondary">
          Tap your fish. Your real cost per pound shows at the bottom the whole time.
        </p>
      </header>

      <div
        role="group"
        aria-label="What do you want to work out?"
        className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line-strong bg-surface-raised p-1.5"
      >
        {[
          { id: 'cost', label: 'Cost per pound' },
          { id: 'weight', label: 'Pounds to buy' },
        ].map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
            className={`min-h-[3.5rem] rounded-xl px-2 text-base font-bold transition-colors sm:text-lg ${
              mode === id ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Step 1: the fish */}
      <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="step-fish">
        <StepHeading number="1" id="step-fish">Your fish</StepHeading>

        <div>
          <label htmlFor="calc-species" className="mb-2 block text-base font-bold text-text-primary">Species</label>
          {dataLoading ? (
            <div className="form-select text-text-muted">Loading species data…</div>
          ) : (
            <select
              id="calc-species"
              value={species}
              onChange={handleSpeciesChange}
              className="form-select min-h-[3.5rem] rounded-xl border-2 text-lg font-bold"
            >
              <option value="">Choose a species</option>
              {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {scientificName && <p className="mt-1.5 text-sm italic text-text-secondary">{scientificName}</p>}
        </div>

        <fieldset disabled={!species} className="min-w-0">
          <legend className="mb-2 flex items-center gap-2.5 text-base font-bold text-text-primary">
            What you have
            <Tooltip iconOnly label="Help: what you have" text="The form of the fish you're starting with. Round means the whole fish, as caught.">
              <HelpCircle size={18} className="text-text-secondary" aria-hidden="true" />
            </Tooltip>
          </legend>
          {species ? (
            fromStates.length > 0 ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {fromStates.map(f => (
                  <Tile key={f} name="calc-from" value={f} checked={fromState === f} onChange={() => chooseFrom(f)} label={f} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No yield data for this species yet.</p>
            )
          ) : (
            <p className="text-sm text-text-secondary">Choose a species first.</p>
          )}
        </fieldset>

        <fieldset disabled={!fromState} className="min-w-0">
          <legend className="mb-2 flex items-center gap-2.5 text-base font-bold text-text-primary">
            What you&apos;re making
            <Tooltip iconOnly label="Help: what you're making" text="The finished cut or product you'll sell, such as a skinless fillet.">
              <HelpCircle size={18} className="text-text-secondary" aria-hidden="true" />
            </Tooltip>
          </legend>
          {fromState ? (
            <>
              <div id="calc-to-list" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {shownTo.map(t => (
                  <Tile
                    key={t.to}
                    name="calc-to"
                    value={t.to}
                    checked={toState === t.to}
                    onChange={() => chooseTo(t.to)}
                    label={t.to}
                    sub={`${t.yield}% yield`}
                  />
                ))}
              </div>
              {toStates.length > TO_LIMIT && (
                <button
                  type="button"
                  aria-controls="calc-to-list"
                  aria-expanded={showAllTo}
                  onClick={() => setShowAllTo(s => !s)}
                  className="mt-2 min-h-[3rem] px-1 text-base font-bold text-link underline underline-offset-4"
                >
                  {showAllTo ? 'Show fewer products' : `Show all ${toStates.length} products`}
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-text-secondary">Choose what you have first.</p>
          )}
        </fieldset>

        {profile && (
          <div className="space-y-1 border-l-2 border-brand-terracotta/50 pl-3 text-sm text-text-secondary">
            {profile.description && <p>{profile.description}</p>}
            {profile.edible_portions && (
              <p><span className="font-semibold">Edible portions: </span>{profile.edible_portions}</p>
            )}
            {profile.url && (
              <a href={profile.url} target="_blank" rel="noreferrer" className="inline-block font-medium text-link underline">
                Read more →
              </a>
            )}
          </div>
        )}
      </section>

      {/* Step 2: the numbers */}
      <section className="card space-y-6 p-5 sm:p-6" aria-labelledby="step-numbers">
        <StepHeading number="2" id="step-numbers">Your numbers</StepHeading>

        {mode === 'cost' ? (
          <div className="space-y-2">
            <label htmlFor="calc-cost" className="block text-base font-bold text-text-primary">
              What you pay per lb <span className="font-normal text-text-secondary">({fromState || 'whole fish'})</span>
            </label>
            <Stepper
              id="calc-cost"
              value={cost}
              onChange={setCost}
              step={0.25}
              format={money}
              prefix="$"
              placeholder="0.00"
              lessLabel="25 cents less"
              moreLabel="25 cents more"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="calc-target" className="block text-base font-bold text-text-primary">
              Pounds of {toState || 'finished product'} you need
            </label>
            <Stepper
              id="calc-target"
              value={targetWeight}
              onChange={setTargetWeight}
              step={10}
              format={plainNumber}
              suffix="lbs"
              placeholder="0"
              lessLabel="10 pounds less"
              moreLabel="10 pounds more"
            />
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="calc-yield" className="block text-base font-bold text-text-primary">
            Yield <span className="font-normal text-text-secondary">how much is left after cutting</span>
          </label>
          <Stepper
            id="calc-yield"
            value={yieldPercent}
            onChange={setYieldPercent}
            step={1}
            format={plainNumber}
            suffix="%"
            placeholder="0"
            lessLabel="1 percent less yield"
            moreLabel="1 percent more yield"
            describedBy="calc-yield-hint"
          />
          <p id="calc-yield-hint" className="text-sm text-text-secondary">
            {!currentConversion
              ? 'Choose what you’re making to fill this in.'
              : yieldRange
                ? `Typical ${yieldRange[0]}–${yieldRange[1]}%. It changes with fish size and cutting skill.`
                : 'No typical range reported for this cut.'}
          </p>
          {presets.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {presets.map(([name, value]) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={parseAmount(yieldPercent) === value}
                  onClick={() => setYieldPercent(String(value))}
                  className="min-h-[3.25rem] rounded-xl border-2 border-line-strong bg-surface-raised px-2 text-sm font-bold leading-tight text-text-primary transition-colors hover:border-accent aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-white"
                >
                  {name}<br /><span className="tabular-nums">{value}%</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === 'cost' && (
          <div className="space-y-6 border-t border-line-subtle pt-5">
            <h3 className="text-lg font-bold text-text-primary">Other costs</h3>
            <ExtraCost
              id="calc-processing"
              title="Processing"
              amount={processingCost}
              onAmount={setProcessingCost}
              basis={weightType}
              onBasis={setWeightType}
              basisLegend="Your processor charges on"
              fromState={fromState || 'starting fish'}
              toState={toState || 'finished product'}
              perFinishedLb={calc?.breakdown?.processing ?? 0}
              yieldPercent={yieldPercent}
            />
            <ExtraCost
              id="calc-shipping"
              title="Shipping"
              amount={shipping}
              onAmount={setShipping}
              basis={shippingWeightType}
              onBasis={setShippingWeightType}
              basisLegend="Shipping is charged on"
              fromState={fromState || 'starting fish'}
              toState={toState || 'finished product'}
              perFinishedLb={calc?.breakdown?.shipping ?? 0}
              yieldPercent={yieldPercent}
            />
          </div>
        )}
      </section>

      {/* Keep it */}
      {result !== null && (
        user ? (
          <section className="card flex flex-wrap items-center gap-x-2 gap-y-2 p-5" aria-label="Keep this result">
            <button type="button" onClick={handleSave} className="btn-secondary">
              <Save size={18} aria-hidden="true" /> Save calculation
            </button>
            <button type="button" onClick={handleExport} className="btn-ghost">
              <Download size={16} aria-hidden="true" /> CSV
            </button>
            <button type="button" onClick={handleExportXlsx} className="btn-ghost">
              <Download size={16} aria-hidden="true" /> Excel
            </button>
            <span role="status" className={`text-sm font-semibold ${saveStatus === 'Saved!' ? 'text-success' : 'text-danger'}`}>
              {saveStatus}
            </span>
          </section>
        ) : (
          <p className="text-center text-base text-text-secondary">
            Want to keep this? <Link to="/login" className="font-semibold text-link underline">Sign in</Link> to save your calculations.
          </p>
        )
      )}

      {/* Abbreviation reference (collapsed: regulars know these, newcomers can open it) */}
      <details className="card group">
        <summary className="flex min-h-[3rem] cursor-pointer list-none items-center gap-2 rounded-xl px-5 py-3 text-base font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
          <HelpCircle size={18} className="text-link" aria-hidden="true" />
          What do D/H-On, S/B and Round mean?
          <ChevronDown size={18} className="ml-auto shrink-0 text-text-secondary transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-line-subtle px-5 py-4 sm:grid-cols-2">
          {Object.entries(ACRONYMS).map(([abbr, full]) => (
            <div key={abbr}>
              <dt className="text-sm font-bold text-accent">{abbr}</dt>
              <dd className="text-sm text-text-secondary">{full.split(' - ')[0]}</dd>
            </div>
          ))}
        </dl>
      </details>

      {/* Community recent calculations */}
      {publicHistory.length > 0 && (
        <section className="card p-5" aria-labelledby="community-calcs">
          <h2 id="community-calcs" className="mb-4 flex items-center gap-2 text-base font-semibold text-text-primary">
            <CalcIcon size={18} className="text-link" aria-hidden="true" />
            Recent community calculations
          </h2>
          <ul className="divide-y divide-line-subtle">
            {publicHistory.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="break-words text-base font-medium text-text-primary">{c.name || c.species}</p>
                  <p className="mt-0.5 text-sm text-text-secondary">{c.product} · {c.yield}% yield</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold tabular-nums text-accent">
                    ${parseFloat(c.result).toFixed(2)}/lb
                  </p>
                  <p className="text-sm text-text-secondary">
                    {new Date(c.date).toLocaleDateString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {!user && (
            <p className="mt-4 border-t border-line-subtle pt-3 text-center text-sm text-text-secondary">
              <Link to="/login" className="font-semibold text-link underline">Sign in</Link> to save your own calculations
            </p>
          )}
        </section>
      )}

      {/* The answer, pinned to the bottom of the screen so it is always in view while numbers change */}
      <div
        ref={dockRef}
        role="region"
        aria-label="Your result"
        className="focus-on-dark fixed inset-x-0 bottom-0 z-30 border-t-4 border-brand-yellow bg-brand-teal pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-4px_16px_rgba(0,0,0,0.18)]"
      >
        <div className="mx-auto max-w-2xl px-4 py-3">
          {result === null ? (
            <p className="py-2 text-lg font-bold">{dockPrompt}</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-white/90">
                {mode === 'cost' ? `Your cost per lb of ${toState}` : `Buy this much ${fromState}`}
              </p>
              <p className="text-[clamp(2.5rem,11vw,3.5rem)] font-extrabold leading-none tracking-tight tabular-nums text-brand-yellow">
                {mode === 'cost' ? dollars(result) : result.toFixed(1)}
                <span className="ml-1 text-xl font-bold">{mode === 'cost' ? '/lb' : 'lbs'}</span>
              </p>
              <p className="mt-1 text-sm text-white/90">
                {mode === 'cost'
                  ? `${yieldPercent || 100}% yield · ${fromState} → ${toState}`
                  : `makes ${parseAmount(targetWeight).toLocaleString('en-US')} lbs of ${toState} · ${yieldPercent || 100}% yield`}
              </p>
              {mode === 'cost' && extras.length > 0 && (
                <p className="text-sm tabular-nums text-white/90">
                  {[['Fish', calc.breakdown.fish], ...extras].map(([name, v]) => `${name} ${dollars(v)}`).join(' + ')}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
};

export default Calculator;
