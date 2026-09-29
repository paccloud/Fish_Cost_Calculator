import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useId } from 'react';
import { Link } from 'react-router-dom';
import { ACRONYMS, FISH_DATA_V3, PROFILES_DATA } from '../data/fish_data_v3';
import { Info, Calculator as CalcIcon, Save, HelpCircle, Download, ChevronRight, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../config/api';

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

const TextWithTooltips = ({ text }) => {
  if (!text) return null;
  const sortedAcronyms = Object.keys(ACRONYMS).sort((a, b) => b.length - a.length);
  let parts = [{ text, isAcronym: false }];

  sortedAcronyms.forEach(acronym => {
    const newParts = [];
    parts.forEach(part => {
      if (part.isAcronym) { newParts.push(part); return; }
      const regex = new RegExp(`(${acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g');
      const splits = part.text.split(regex);
      splits.forEach(s => {
        if (s === acronym) newParts.push({ text: s, isAcronym: true, tooltip: ACRONYMS[acronym] });
        else if (s) newParts.push({ text: s, isAcronym: false });
      });
    });
    parts = newParts;
  });

  return (
    <>
      {parts.map((part, i) =>
        part.isAcronym ? (
          <Tooltip key={i} text={part.tooltip} label={`${part.text}: ${part.tooltip}`}>
            <span className="border-b border-dashed border-brand-terracotta/60 font-medium text-accent">{part.text}</span>
          </Tooltip>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
};

const RangeButton = ({ active, onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`min-h-[2.75rem] rounded-lg px-4 text-sm font-semibold transition-colors ${
      active
        ? 'bg-primary text-white'
        : 'border border-line-strong bg-surface-raised text-text-primary hover:border-accent hover:text-accent'
    }`}
  >
    {label}
  </button>
);

const StepHeading = ({ number, children }) => (
  <h2 className="flex items-center gap-2.5 text-lg font-semibold text-text-primary">
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white"
    >
      {number}
    </span>
    {children}
  </h2>
);

const Calculator = () => {
  const { user, getAuthHeaders } = useAuth();
  const [mode, setMode] = useState('cost');
  const [targetWeight, setTargetWeight] = useState('');
  const [species, setSpecies] = useState('');
  const [fromState, setFromState] = useState('');
  const [toState, setToState] = useState('');
  const [cost, setCost] = useState('');
  const [yieldPercent, setYieldPercent] = useState('');
  const [yieldRange, setYieldRange] = useState(null);
  const [processingCost, setProcessingCost] = useState('');
  const [coldStorage, _setColdStorage] = useState('');
  const [shipping, _setShipping] = useState('');
  const [weightType, setWeightType] = useState('incoming');
  const [result, setResult] = useState(null);
  // Yield and target as they were when the result was computed, so the description never drifts from the number
  const [resultMeta, setResultMeta] = useState(null);
  const resultRef = useRef(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [useRangeMin, setUseRangeMin] = useState(false);
  const [useRangeMax, setUseRangeMax] = useState(false);

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

  const fromStates = useMemo(() => {
    if (!species || !combinedData[species]) return [];
    const states = new Set();
    Object.values(combinedData[species].conversions || {}).forEach(conv => {
      if (conv.from) states.add(conv.from);
    });
    return Array.from(states).sort();
  }, [species, combinedData]);

  const toStates = useMemo(() => {
    if (!species || !fromState || !combinedData[species]) return [];
    const states = [];
    Object.values(combinedData[species].conversions || {}).forEach(conv => {
      if (conv.from === fromState && conv.to) {
        states.push({ to: conv.to, yield: conv.yield, range: conv.range });
      }
    });
    return states.sort((a, b) => a.to.localeCompare(b.to));
  }, [species, fromState, combinedData]);

  const currentConversion = useMemo(() => {
    if (!species || !fromState || !toState || !combinedData[species]) return null;
    return Object.values(combinedData[species].conversions || {}).find(
      conv => conv.from === fromState && conv.to === toState
    );
  }, [species, fromState, toState, combinedData]);

  const profile = species ? profilesData[species] : null;
  const scientificName = species && combinedData[species] ? combinedData[species].scientific_name : null;

  const handleSpeciesChange = (e) => {
    setSpecies(e.target.value);
    setFromState(''); setToState(''); setYieldPercent(''); setYieldRange(null); setResult(null);
  };

  const handleFromChange = (e) => {
    setFromState(e.target.value);
    setToState(''); setYieldPercent(''); setYieldRange(null); setResult(null);
  };

  const handleToChange = (e) => { setToState(e.target.value); setResult(null); };

  useEffect(() => {
    if (currentConversion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setYieldPercent(String(currentConversion.yield));
      setYieldRange(currentConversion.range);
      setUseRangeMin(false);
      setUseRangeMax(false);
    }
  }, [currentConversion]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (yieldRange && useRangeMin) setYieldPercent(String(yieldRange[0]));
    else if (yieldRange && useRangeMax) setYieldPercent(String(yieldRange[1]));
    else if (currentConversion && !useRangeMin && !useRangeMax) setYieldPercent(String(currentConversion.yield));
  }, [useRangeMin, useRangeMax, yieldRange, currentConversion]);

  const calculate = () => {
    const y = (parseFloat(yieldPercent) || 100) / 100;

    if (mode === 'weight') {
      const target = parseFloat(targetWeight) || 0;
      setResult(y > 0 ? target / y : 0);
      setResultMeta({ yieldPercent, targetWeight });
      setSaveStatus('');
      return;
    }

    const c = parseFloat(cost) || 0;
    const proc = parseFloat(processingCost) || 0;
    const cold = parseFloat(coldStorage) || 0;
    const ship = parseFloat(shipping) || 0;

    let baseRes = c / y;
    if (weightType === 'incoming') baseRes += proc / y;
    else baseRes += proc;
    baseRes += cold + ship;

    setResult(baseRes);
    setResultMeta({ yieldPercent, targetWeight });
    setSaveStatus('');
  };

  // Bring a fresh result into view: on a phone it lands below the fold, under the keyboard
  useEffect(() => {
    if (result === null || !resultRef.current) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    resultRef.current.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [result]);

  const handleSave = async () => {
    if (!user || !result) return;
    try {
      const headers = await getAuthHeaders('application/json');
      const res = await fetch(apiUrl('/api/save-calc'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: `${species} - ${fromState} → ${toState}`,
          species, product: `${fromState} → ${toState}`,
          mode, cost: mode === 'cost' ? parseFloat(cost) : 0,
          target_weight: mode === 'weight' ? parseFloat(targetWeight) : 0,
          yield: parseFloat(yieldPercent), result
        })
      });
      setSaveStatus(res.ok ? 'Saved!' : 'Failed to save');
    } catch {
      setSaveStatus('Error saving');
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

  const canCalculate = species && toState;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (canCalculate) calculate();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Page header */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">Fish Cost Calculator</h1>
        <p className="mt-1 text-base text-text-secondary">
          See what your fish really costs per pound after cutting and trimming.
        </p>
      </header>

      {/* Main calculator card */}
      <div className="card p-5 sm:p-6">
        {/* Mode toggle */}
        <div
          role="group"
          aria-label="What do you want to work out?"
          className="mb-6 flex gap-1 rounded-xl border border-line-strong bg-surface p-1"
        >
          {[
            { id: 'cost', label: 'Cost per pound' },
            { id: 'weight', label: 'Pounds to buy' },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => { setMode(id); setResult(null); }}
              className={`min-h-[2.75rem] flex-1 rounded-lg px-2 text-sm font-semibold transition-colors sm:px-3 sm:text-base ${
                mode === id
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-7">
          {/* Step 1: the fish */}
          <section className="space-y-4" aria-labelledby="step-fish">
            <div id="step-fish"><StepHeading number="1">Your fish</StepHeading></div>

            <div>
              <label htmlFor="calc-species" className="form-label">Species</label>
              {dataLoading ? (
                <div className="form-select text-text-muted">Loading species data…</div>
              ) : (
                <select id="calc-species" value={species} onChange={handleSpeciesChange} className="form-select">
                  <option value="">Choose a species</option>
                  {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              {scientificName && (
                <p className="mt-1.5 text-sm italic text-text-secondary">{scientificName}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 flex items-center gap-2.5">
                  <label htmlFor="calc-from" className="text-sm font-semibold text-text-primary">What you have</label>
                  <Tooltip
                    iconOnly
                    label="Help: what you have"
                    text="The form of the fish you're starting with. Round means the whole fish, as caught."
                  >
                    <HelpCircle size={18} className="text-text-secondary" aria-hidden="true" />
                  </Tooltip>
                </div>
                <select
                  id="calc-from"
                  value={fromState}
                  onChange={handleFromChange}
                  className="form-select"
                  disabled={!species}
                >
                  <option value="">{species ? 'Choose starting form' : 'Choose a species first'}</option>
                  {fromStates.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-2.5">
                  <label htmlFor="calc-to" className="text-sm font-semibold text-text-primary">What you're making</label>
                  <Tooltip
                    iconOnly
                    label="Help: what you're making"
                    text="The finished cut or product you'll sell, such as a skinless fillet."
                  >
                    <HelpCircle size={18} className="text-text-secondary" aria-hidden="true" />
                  </Tooltip>
                </div>
                <select
                  id="calc-to"
                  value={toState}
                  onChange={handleToChange}
                  className="form-select"
                  disabled={!fromState}
                >
                  <option value="">{fromState ? 'Choose finished product' : 'Choose what you have first'}</option>
                  {toStates.map(t => (
                    <option key={t.to} value={t.to}>
                      {t.to} ({t.yield}%{t.range ? `, ${t.range[0]}–${t.range[1]}%` : ''})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Conversion info */}
            {currentConversion && (
              <div className="space-y-3 rounded-xl border border-brand-teal/25 bg-brand-teal/5 p-4 dark:bg-brand-teal/15">
                <div className="flex items-center gap-2 text-sm font-semibold text-accent">
                  <Info size={16} aria-hidden="true" />
                  Yield for this cut
                </div>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-base">
                  <span>
                    <TextWithTooltips text={currentConversion.from} />
                    <ChevronRight size={14} className="mx-1 inline text-text-secondary" aria-label="to" />
                    <TextWithTooltips text={currentConversion.to} />
                  </span>
                  <span>
                    <span className="text-text-secondary">Average yield </span>
                    <span className="font-bold tabular-nums text-text-primary">{currentConversion.yield}%</span>
                  </span>
                  {currentConversion.range && (
                    <span>
                      <span className="text-text-secondary">Typical range </span>
                      <span className="tabular-nums text-text-primary">{currentConversion.range[0]}–{currentConversion.range[1]}%</span>
                    </span>
                  )}
                </div>

                {currentConversion.range && (
                  <div>
                    <p className="mb-2 text-sm text-text-secondary">
                      Yield changes with fish size and cutting skill. Pick what fits your shop:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <RangeButton
                        active={useRangeMin}
                        onClick={() => { setUseRangeMin(true); setUseRangeMax(false); }}
                        label={`Low ${currentConversion.range[0]}%`}
                      />
                      <RangeButton
                        active={!useRangeMin && !useRangeMax}
                        onClick={() => { setUseRangeMin(false); setUseRangeMax(false); }}
                        label={`Average ${currentConversion.yield}%`}
                      />
                      <RangeButton
                        active={useRangeMax}
                        onClick={() => { setUseRangeMax(true); setUseRangeMin(false); }}
                        label={`High ${currentConversion.range[1]}%`}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Species profile */}
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

          <div className="section-divider !my-0" />

          {/* Step 2: the numbers */}
          <section className="space-y-4" aria-labelledby="step-numbers">
            <div id="step-numbers"><StepHeading number="2">Your numbers</StepHeading></div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {mode === 'cost' ? (
                <div>
                  <label htmlFor="calc-cost" className="form-label">
                    What you pay per lb
                    <span className="font-normal text-text-secondary"> ({fromState || 'whole fish'})</span>
                  </label>
                  <div className="relative">
                    <span aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-text-secondary">$</span>
                    <input
                      id="calc-cost"
                      type="number"
                      min="0"
                      step="any"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      className="form-input pl-8 tabular-nums"
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="calc-target" className="form-label">
                    Pounds of {toState || 'finished product'} you need
                  </label>
                  <div className="relative">
                    <input
                      id="calc-target"
                      type="number"
                      min="0"
                      step="any"
                      value={targetWeight}
                      onChange={(e) => setTargetWeight(e.target.value)}
                      className="form-input pr-12 tabular-nums"
                      placeholder="e.g. 100"
                      inputMode="decimal"
                    />
                    <span aria-hidden="true" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-text-secondary">lbs</span>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="calc-yield" className="form-label">Yield</label>
                <div className="relative">
                  <input
                    id="calc-yield"
                    type="number"
                    min="0"
                    step="any"
                    value={yieldPercent}
                    onChange={(e) => { setYieldPercent(e.target.value); setUseRangeMin(false); setUseRangeMax(false); }}
                    className="form-input pr-10 tabular-nums"
                    placeholder="0"
                    inputMode="decimal"
                    aria-describedby={yieldRange ? 'calc-yield-hint' : undefined}
                  />
                  <span aria-hidden="true" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-base text-text-secondary">%</span>
                </div>
                {yieldRange && (
                  <p id="calc-yield-hint" className="mt-1.5 text-sm text-text-secondary">
                    Typical range: {yieldRange[0]}–{yieldRange[1]}%
                  </p>
                )}
              </div>
            </div>

            {/* Additional costs (cost mode only) */}
            {mode === 'cost' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="calc-processing" className="form-label">
                    Processing cost per lb
                    <span className="font-normal text-text-secondary"> (optional)</span>
                  </label>
                  <div className="relative">
                    <span aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-text-secondary">$</span>
                    <input
                      id="calc-processing"
                      type="number"
                      min="0"
                      step="any"
                      value={processingCost}
                      onChange={(e) => setProcessingCost(e.target.value)}
                      className="form-input pl-8 tabular-nums"
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  </div>
                </div>

                {/* Only ask which weight it applies to once there is a processing cost */}
                {processingCost !== '' && (
                  <div>
                    <label htmlFor="calc-weight-type" className="form-label">Processing is charged per lb of</label>
                    <select
                      id="calc-weight-type"
                      value={weightType}
                      onChange={(e) => setWeightType(e.target.value)}
                      className="form-select"
                    >
                      <option value="incoming">Starting fish ({fromState || 'whole'})</option>
                      <option value="outgoing">Finished product ({toState || 'product'})</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Calculate */}
          <div>
            <button
              type="submit"
              disabled={!canCalculate}
              aria-describedby={canCalculate ? undefined : 'calc-hint'}
              className="btn-primary w-full"
            >
              <CalcIcon size={20} aria-hidden="true" />
              {mode === 'cost' ? 'Calculate cost per pound' : 'Calculate pounds to buy'}
            </button>
            {!canCalculate && (
              <p id="calc-hint" className="mt-2 text-center text-sm text-text-secondary">
                Choose a species, what you have, and what you're making to get started.
              </p>
            )}
          </div>
        </form>

        {/* Result: the live region stays mounted (so the first result is announced) and holds only the
            answer. Actions and save status live outside it to avoid duplicate announcements. */}
        <div ref={resultRef} className="scroll-mt-20">
          <div className={result !== null ? 'mt-6 rounded-xl border-2 border-brand-teal bg-brand-teal/5 p-5 dark:border-accent dark:bg-brand-teal/15' : ''}>
            <div aria-live="polite">
              {result !== null && (
                <>
                  <p className="text-sm font-semibold text-text-secondary">
                    {mode === 'cost' ? `Your cost per lb of ${toState}` : `You need to buy (${fromState})`}
                  </p>
                  <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight text-accent">
                    {mode === 'cost' ? `$${result.toFixed(2)}` : `${result.toFixed(1)} lbs`}
                  </p>
                  <p className="mt-2 text-base text-text-secondary">
                    {mode === 'cost'
                      ? `At ${resultMeta?.yieldPercent}% yield from ${fromState} to ${toState}`
                      : `${result.toFixed(1)} lbs of ${fromState} makes ${resultMeta?.targetWeight} lbs of ${toState}`
                    }
                  </p>
                </>
              )}
            </div>

            {result !== null && (user ? (
              <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <button type="button" onClick={handleSave} className="btn-secondary">
                  <Save size={18} aria-hidden="true" /> Save calculation
                </button>
                <button type="button" onClick={handleExport} className="btn-ghost">
                  <Download size={16} aria-hidden="true" /> CSV
                </button>
                <button type="button" onClick={handleExportXlsx} className="btn-ghost">
                  <Download size={16} aria-hidden="true" /> Excel
                </button>
                <span
                  role="status"
                  className={`text-sm font-semibold ${saveStatus === 'Saved!' ? 'text-success' : 'text-danger'}`}
                >
                  {saveStatus}
                </span>
              </div>
            ) : (
              <p className="mt-4 text-sm text-text-secondary">
                Want to keep this? <Link to="/login" className="font-semibold text-link underline">Sign in</Link> to save your calculations.
              </p>
            ))}
          </div>
        </div>
      </div>

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
            {publicHistory.slice(0, 8).map((calc) => (
              <li key={calc.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="break-words text-base font-medium text-text-primary">{calc.name || calc.species}</p>
                  <p className="mt-0.5 text-sm text-text-secondary">{calc.product} · {calc.yield}% yield</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold tabular-nums text-accent">
                    ${parseFloat(calc.result).toFixed(2)}/lb
                  </p>
                  <p className="text-sm text-text-secondary">
                    {new Date(calc.date).toLocaleDateString()}
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
    </div>
  );
};

export default Calculator;
