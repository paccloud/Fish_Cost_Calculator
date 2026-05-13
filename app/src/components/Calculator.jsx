import React, { useState, useEffect, useMemo } from 'react';
import { ACRONYMS, FISH_DATA_V3, PROFILES_DATA } from '../data/fish_data_v3';
import { Info, Calculator as CalcIcon, Save, HelpCircle, Download, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../config/api';

const Tooltip = ({ text, children }) => {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-block cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs bg-surface-raised text-text-primary rounded-md shadow-lg whitespace-nowrap border border-line">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-surface-raised"></span>
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
          <Tooltip key={i} text={part.tooltip}>
            <span className="border-b border-dashed border-brand-terracotta/50 text-brand-teal dark:text-brand-yellow">{part.text}</span>
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
    onClick={onClick}
    className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${
      active
        ? 'bg-brand-teal text-white'
        : 'bg-surface border border-line text-text-secondary hover:text-text-primary hover:border-brand-teal/50'
    }`}
  >
    {label}
  </button>
);

const Calculator = () => {
  const { user } = useAuth();
  const [mode, setMode] = useState('cost');
  const [targetWeight, setTargetWeight] = useState('');
  const [species, setSpecies] = useState('');
  const [fromState, setFromState] = useState('');
  const [toState, setToState] = useState('');
  const [cost, setCost] = useState('');
  const [yieldPercent, setYieldPercent] = useState('');
  const [yieldRange, setYieldRange] = useState(null);
  const [processingCost, setProcessingCost] = useState('');
  const [coldStorage, setColdStorage] = useState('');
  const [shipping, setShipping] = useState('');
  const [weightType, setWeightType] = useState('incoming');
  const [result, setResult] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [useRangeMin, setUseRangeMin] = useState(false);
  const [useRangeMax, setUseRangeMax] = useState(false);

  const [customData, setCustomData] = useState({});
  const [history, setHistory] = useState([]);
  const [publicHistory, setPublicHistory] = useState([]);

  const [fishData, setFishData] = useState(FISH_DATA_V3);
  const [profilesData, setProfilesData] = useState(PROFILES_DATA);
  const [dataLoading, setDataLoading] = useState(false);

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
      const token = localStorage.getItem('token');
      fetch(apiUrl('/api/user-data'), {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      })
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

      fetch(apiUrl('/api/saved-calcs'), {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      })
        .then(res => res.json())
        .then(data => setHistory(data))
        .catch(() => {});
    } else {
      setCustomData({});
      setHistory([]);
    }
  }, [user]);

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
      setYieldPercent(String(currentConversion.yield));
      setYieldRange(currentConversion.range);
      setUseRangeMin(false);
      setUseRangeMax(false);
    }
  }, [currentConversion]);

  useEffect(() => {
    if (yieldRange && useRangeMin) setYieldPercent(String(yieldRange[0]));
    else if (yieldRange && useRangeMax) setYieldPercent(String(yieldRange[1]));
    else if (currentConversion && !useRangeMin && !useRangeMax) setYieldPercent(String(currentConversion.yield));
  }, [useRangeMin, useRangeMax, yieldRange, currentConversion]);

  const calculate = () => {
    const y = (parseFloat(yieldPercent) || 100) / 100;

    if (mode === 'weight') {
      const target = parseFloat(targetWeight) || 0;
      setResult(y > 0 ? target / y : 0);
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
    setSaveStatus('');
  };

  const handleSave = async () => {
    if (!user || !result) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl('/api/save-calc'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(apiUrl('/api/export?type=calcs'), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
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

  const canCalculate = species && toState;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Fish Cost Calculator</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Estimate processed cost per pound from raw input cost and yield data.
        </p>
      </div>

      {/* Main calculator card */}
      <div className="card p-5 sm:p-6">
        {/* Mode toggle */}
        <div className="flex bg-surface rounded-md p-0.5 border border-line mb-6">
          <button
            onClick={() => { setMode('cost'); setResult(null); }}
            className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
              mode === 'cost'
                ? 'bg-brand-teal text-white shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Cost per Pound
          </button>
          <button
            onClick={() => { setMode('weight'); setResult(null); }}
            className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-colors ${
              mode === 'weight'
                ? 'bg-brand-teal text-white shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Required Input Weight
          </button>
        </div>

        <div className="space-y-5">
          {/* Species */}
          <div>
            <label className="form-label">Species</label>
            {dataLoading ? (
              <div className="form-select text-text-muted">Loading species data…</div>
            ) : (
              <select value={species} onChange={handleSpeciesChange} className="form-select">
                <option value="">Select a species</option>
                {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {scientificName && (
              <p className="mt-1 text-xs text-text-muted italic">{scientificName}</p>
            )}
          </div>

          {/* From / To */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label flex items-center gap-1.5">
                From State
                <Tooltip text="Starting form of the fish (e.g., Round = whole fish as caught)">
                  <HelpCircle size={13} className="text-text-muted" />
                </Tooltip>
              </label>
              <select
                value={fromState}
                onChange={handleFromChange}
                className="form-select"
                disabled={!species}
              >
                <option value="">{species ? 'Select starting form' : '— select species first —'}</option>
                {fromStates.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <div>
              <label className="form-label flex items-center gap-1.5">
                To Product
                <Tooltip text="Final form after processing">
                  <HelpCircle size={13} className="text-text-muted" />
                </Tooltip>
              </label>
              <select
                value={toState}
                onChange={handleToChange}
                className="form-select"
                disabled={!fromState}
              >
                <option value="">{fromState ? 'Select product form' : '— select from state first —'}</option>
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
            <div className="bg-brand-teal/5 dark:bg-brand-teal/15 border border-brand-teal/20 rounded-md p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-teal dark:text-text-secondary">
                <Info size={13} />
                Conversion Details
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  <span className="text-text-secondary">Conversion: </span>
                  <TextWithTooltips text={currentConversion.from} />
                  <ChevronRight size={12} className="inline mx-0.5 text-text-muted" />
                  <TextWithTooltips text={currentConversion.to} />
                </span>
                <span>
                  <span className="text-text-secondary">Avg yield: </span>
                  <span className="font-semibold text-text-primary">{currentConversion.yield}%</span>
                </span>
                {currentConversion.range && (
                  <span>
                    <span className="text-text-secondary">Range: </span>
                    <span className="text-text-primary">{currentConversion.range[0]}–{currentConversion.range[1]}%</span>
                  </span>
                )}
              </div>

              {currentConversion.range && (
                <div className="flex gap-2 flex-wrap">
                  <RangeButton
                    active={useRangeMin}
                    onClick={() => { setUseRangeMin(true); setUseRangeMax(false); }}
                    label={`Min (${currentConversion.range[0]}%)`}
                  />
                  <RangeButton
                    active={!useRangeMin && !useRangeMax}
                    onClick={() => { setUseRangeMin(false); setUseRangeMax(false); }}
                    label={`Avg (${currentConversion.yield}%)`}
                  />
                  <RangeButton
                    active={useRangeMax}
                    onClick={() => { setUseRangeMax(true); setUseRangeMin(false); }}
                    label={`Max (${currentConversion.range[1]}%)`}
                  />
                </div>
              )}
            </div>
          )}

          {/* Species profile */}
          {profile && (
            <div className="text-sm space-y-1 text-text-secondary border-l-2 border-brand-terracotta/40 pl-3">
              {profile.description && <p>{profile.description}</p>}
              {profile.edible_portions && (
                <p><span className="text-text-muted">Edible portions: </span>{profile.edible_portions}</p>
              )}
              {profile.url && (
                <a href={profile.url} target="_blank" rel="noreferrer" className="text-brand-terracotta hover:underline text-xs">
                  Read more →
                </a>
              )}
            </div>
          )}

          <div className="section-divider" />

          {/* Cost/weight + yield row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {mode === 'cost' ? (
              <div>
                <label className="form-label">
                  Cost per lb ({fromState || 'whole fish'})
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
                  <input
                    type="number"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="form-input pl-7"
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="form-label">
                  Target output (lbs of {toState || 'product'})
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={targetWeight}
                    onChange={(e) => setTargetWeight(e.target.value)}
                    className="form-input pr-10"
                    placeholder="e.g. 100"
                    inputMode="decimal"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">lbs</span>
                </div>
              </div>
            )}

            <div>
              <label className="form-label">Yield percentage</label>
              <div className="relative">
                <input
                  type="number"
                  value={yieldPercent}
                  onChange={(e) => { setYieldPercent(e.target.value); setUseRangeMin(false); setUseRangeMax(false); }}
                  className="form-input pr-8"
                  placeholder="0"
                  inputMode="decimal"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">%</span>
              </div>
              {yieldRange && (
                <p className="mt-1 text-xs text-text-muted">
                  Reported range: {yieldRange[0]}–{yieldRange[1]}%
                </p>
              )}
            </div>
          </div>

          {/* Additional costs (cost mode only) */}
          {mode === 'cost' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Processing cost (optional)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
                  <input
                    type="number"
                    value={processingCost}
                    onChange={(e) => setProcessingCost(e.target.value)}
                    className="form-input pl-7"
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Applied to weight</label>
                <select
                  value={weightType}
                  onChange={(e) => setWeightType(e.target.value)}
                  className="form-select"
                >
                  <option value="incoming">Incoming ({fromState || 'whole'})</option>
                  <option value="outgoing">Outgoing ({toState || 'product'})</option>
                </select>
              </div>
            </div>
          )}

          {/* Calculate */}
          <button
            onClick={calculate}
            disabled={!canCalculate}
            className="btn-primary w-full"
          >
            {mode === 'cost' ? 'Calculate Cost per Pound' : 'Calculate Required Input Weight'}
          </button>

          {/* Result */}
          {result !== null && (
            <div className="mt-2 rounded-md border border-brand-teal/25 bg-brand-teal/5 dark:bg-brand-teal/10 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">
                {mode === 'cost' ? `Cost per lb — ${toState}` : `Required ${fromState} input`}
              </p>
              <p className="text-4xl font-bold tracking-tight text-brand-teal dark:text-text-primary">
                {mode === 'cost' ? `$${result.toFixed(2)}` : `${result.toFixed(1)} lbs`}
              </p>
              <p className="mt-1.5 text-sm text-text-secondary">
                {mode === 'cost'
                  ? `At ${yieldPercent}% yield from ${fromState} to ${toState}`
                  : `${result.toFixed(1)} lbs ${fromState} needed to yield ${targetWeight} lbs of ${toState}`
                }
              </p>

              {user ? (
                <div className="mt-4 flex items-center gap-4 flex-wrap">
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-1.5 text-sm font-medium text-brand-terracotta hover:text-brand-terracotta-light transition-colors"
                  >
                    <Save size={15} /> Save calculation
                  </button>
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <Download size={15} /> Export history
                  </button>
                  {saveStatus && (
                    <span className="text-xs text-text-muted">{saveStatus}</span>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-text-muted">
                  <a href="/login" className="text-brand-terracotta hover:underline">Sign in</a> to save calculations
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Acronym reference */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <HelpCircle size={14} className="text-brand-terracotta" />
          Acronym Reference
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {Object.entries(ACRONYMS).slice(0, 9).map(([abbr, full]) => (
            <div key={abbr} className="flex items-baseline gap-1.5 text-sm">
              <span className="font-semibold text-brand-teal dark:text-brand-yellow shrink-0">{abbr}</span>
              <span className="text-text-muted text-xs truncate">{full.split(' - ')[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Community recent calculations */}
      {publicHistory.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
            <CalcIcon size={14} className="text-brand-terracotta" />
            Recent Community Calculations
          </h3>
          <div className="divide-y divide-line-subtle">
            {publicHistory.slice(0, 8).map((calc) => (
              <div key={calc.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{calc.name || calc.species}</p>
                  <p className="text-xs text-text-muted mt-0.5">{calc.product} · {calc.yield}% yield</p>
                </div>
                <div className="text-right ml-4 shrink-0">
                  <p className="text-sm font-semibold text-brand-teal dark:text-brand-yellow">
                    ${parseFloat(calc.result).toFixed(2)}/lb
                  </p>
                  <p className="text-xs text-text-muted">
                    {new Date(calc.date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {!user && (
            <p className="mt-4 text-xs text-text-muted text-center border-t border-line-subtle pt-3">
              <a href="/login" className="text-brand-terracotta hover:underline">Sign in</a> to save your own calculations
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default Calculator;
