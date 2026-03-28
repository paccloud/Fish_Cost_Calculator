import React, { useState, useEffect, useMemo, useId } from 'react';
import { ACRONYMS, FISH_DATA_V3, PROFILES_DATA } from '../data/fish_data_v3';
import { Info, Calculator as CalcIcon, Save, HelpCircle, Download, Plus, X, Clock, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../context/useAuth';
import { useData } from '../context/DataContext';
import { apiUrl } from '../config/api';

// Process FISH_DATA_V3 into the format expected by the calculator
// (same shape as the API response: numeric yield, array range, from/to strings)
const PROCESSED_FISH_DATA = {};
Object.entries(FISH_DATA_V3).forEach(([species, data]) => {
  PROCESSED_FISH_DATA[species] = {
    scientific_name: data.scientific_name,
    category: data.category,
    conversions: {}
  };
  Object.entries(data.conversions).forEach(([convKey, conv]) => {
    const parts = convKey.split(' \u2192 ');
    const from = parts[0];
    const to = parts[1];
    const fromLabel = from !== 'Round' && from !== 'Whole' && from !== 'Raw Whole' ? `From ${from}: ` : '';
    const label = `${fromLabel}${to}`;
    PROCESSED_FISH_DATA[species].conversions[label] = {
      yield: conv.yield,
      range: conv.range || null,
      from,
      to
    };
  });
});

// Tooltip component for acronyms (mouse-only)
const Tooltip = ({ text, children }) => {
  const [show, setShow] = useState(false);
  const tooltipId = useId();
  const showTooltip = () => setShow(true);
  const hideTooltip = () => setShow(false);

  return (
    <span
      className="relative inline-block cursor-help"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      aria-describedby={tooltipId}
    >
      {children}
      <span
        id={tooltipId}
        role="tooltip"
        aria-hidden={!show}
        className={`absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-sm bg-surface-elevated text-navy dark:text-text-primary rounded-lg shadow-xl whitespace-nowrap border border-teal/30 ${show ? '' : 'hidden'}`}
      >
        {text}
        <span className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-white dark:border-t-slate-800"></span>
      </span>
    </span>
  );
};

// Help tooltip component for interactive help icons (keyboard-accessible)
const HelpTooltip = ({ text, ariaLabel }) => {
  const [show, setShow] = useState(false);
  const tooltipId = useId();
  const showTooltip = () => setShow(true);
  const hideTooltip = () => setShow(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-describedby={tooltipId}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        className="inline-flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-teal focus:ring-offset-2 rounded-full"
      >
        <HelpCircle size={14} className="text-text-secondary" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        aria-hidden={!show}
        className={`absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-sm bg-surface-elevated text-navy dark:text-text-primary rounded-lg shadow-xl whitespace-nowrap border border-teal/30 ${show ? '' : 'hidden'}`}
      >
        {text}
        <span className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-white dark:border-t-slate-800"></span>
      </span>
    </span>
  );
};

// Parse text and add tooltips for acronyms
const TextWithTooltips = ({ text }) => {
  if (!text) return null;
  
  // Sort acronyms by length (longest first) to avoid partial matches
  const sortedAcronyms = Object.keys(ACRONYMS).sort((a, b) => b.length - a.length);
  
  let result = text;
  let parts = [{ text: result, isAcronym: false }];
  
  sortedAcronyms.forEach(acronym => {
    const newParts = [];
    parts.forEach(part => {
      if (part.isAcronym) {
        newParts.push(part);
        return;
      }
      const regex = new RegExp(`(${acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g');
      const splits = part.text.split(regex);
      splits.forEach(s => {
        if (s === acronym) {
          newParts.push({ text: s, isAcronym: true, tooltip: ACRONYMS[acronym] });
        } else if (s) {
          newParts.push({ text: s, isAcronym: false });
        }
      });
    });
    parts = newParts;
  });
  
  return (
    <>
      {parts.map((part, i) => 
        part.isAcronym ? (
          <Tooltip key={i} text={part.tooltip}>
            <span className="border-b border-dashed border-teal/50 text-teal">{part.text}</span>
          </Tooltip>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
};

const Calculator = () => {
  const { user } = useAuth();
  const { savedCalcs, customYields, customSpecies: dataContextCustomSpecies, saveCalc: contextSaveCalc, removeCalc, dataLoaded, updateCustomSpecies } = useData();
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
  
  const [publicHistory, setPublicHistory] = useState([]);

  // Fish data from static import (instant, no loading needed)
  const fishData = PROCESSED_FISH_DATA;
  const profilesData = PROFILES_DATA;
  
  // Custom species state
  const [showCustomSpeciesModal, setShowCustomSpeciesModal] = useState(false);
  const [customSpeciesName, setCustomSpeciesName] = useState('');
  const [customSpeciesYield, setCustomSpeciesYield] = useState('');
  const [customSpeciesFrom, setCustomSpeciesFrom] = useState('Round');
  const [customSpeciesTo, setCustomSpeciesTo] = useState('Fillet');
  // Custom species from DataContext (persisted in IndexedDB)
  const localCustomSpecies = dataContextCustomSpecies;

  // Time tracking state (optional)
  const [showTimeTracking, setShowTimeTracking] = useState(false);
  const [processingSteps, setProcessingSteps] = useState([
    { id: 1, name: 'Processing', timeMinutes: '', laborCostPerHour: '' }
  ]);

  // Economy of Scale state (optional)
  const [showEconomyOfScale, setShowEconomyOfScale] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [priceBreaks, setPriceBreaks] = useState([
    { minQty: 100, discount: 5 },
    { minQty: 500, discount: 10 },
    { minQty: 1000, discount: 15 },
  ]);
  const [appliedDiscount, setAppliedDiscount] = useState(0);

  // Load public calculations for all users (including guests)
  useEffect(() => {
    fetch(apiUrl('/api/public-calcs'))
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setPublicHistory(data);
        }
      })
      .catch(err => console.error("Failed to load public calculations", err));
  }, []);

  // Custom yields from DataContext (replaces API user-data fetch)
  const customData = useMemo(() => {
    const mapped = {};
    customYields.forEach(item => {
      if (!mapped[item.species]) mapped[item.species] = { conversions: {} };
      mapped[item.species].conversions[`Custom: ${item.product}`] = {
        yield: parseFloat(item.yield),
        from: 'Custom',
        to: item.product
      };
    });
    return mapped;
  }, [customYields]);

  // Merge Data - combine API fish data with user custom data and local custom species
  const combinedData = useMemo(() => {
    const merged = { ...fishData };
    // Merge user-uploaded custom data
    Object.keys(customData).forEach(sp => {
      if (!merged[sp]) {
        merged[sp] = customData[sp];
      } else {
        merged[sp] = { 
          ...merged[sp], 
          conversions: { ...merged[sp].conversions, ...customData[sp].conversions }
        };
      }
    });
    // Merge local custom species (from localStorage)
    Object.keys(localCustomSpecies).forEach(sp => {
      if (!merged[sp]) {
        merged[sp] = localCustomSpecies[sp];
      } else {
        merged[sp] = { 
          ...merged[sp], 
          conversions: { ...merged[sp].conversions, ...localCustomSpecies[sp].conversions }
        };
      }
    });
    return merged;
  }, [fishData, customData, localCustomSpecies]);

  const speciesList = Object.keys(combinedData).sort();
  
  // Get available "from" states for selected species
  const fromStates = useMemo(() => {
    if (!species || !combinedData[species]) return [];
    const states = new Set();
    Object.values(combinedData[species].conversions || {}).forEach(conv => {
      if (conv.from) states.add(conv.from);
    });
    return Array.from(states).sort();
  }, [species, combinedData]);

  // Get available "to" states based on selected "from"
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

  // Handle species change
  const handleSpeciesChange = (e) => {
    const s = e.target.value;
    setSpecies(s);
    setFromState('');
    setToState('');
    setYieldPercent('');
    setYieldRange(null);
    setResult(null);
  };

  // Handle from state change
  const handleFromChange = (e) => {
    const f = e.target.value;
    setFromState(f);
    setToState('');
    setYieldPercent('');
    setYieldRange(null);
    setResult(null);
  };

  // Handle to state change
  const handleToChange = (e) => {
    const t = e.target.value;
    setToState(t);
    setResult(null);
  };

  // Handle adding custom species
  const handleAddCustomSpecies = () => {
    if (!customSpeciesName.trim() || !customSpeciesYield) return;
    
    const yieldValue = parseFloat(customSpeciesYield);
    if (isNaN(yieldValue) || yieldValue <= 0 || yieldValue > 100) return;
    
    const newSpecies = {
      conversions: {
        [`${customSpeciesFrom} to ${customSpeciesTo}`]: {
          yield: yieldValue,
          from: customSpeciesFrom,
          to: customSpeciesTo
        }
      }
    };
    
    const updated = { ...localCustomSpecies };
    if (updated[customSpeciesName.trim()]) {
      // Add conversion to existing species
      updated[customSpeciesName.trim()].conversions = {
        ...updated[customSpeciesName.trim()].conversions,
        ...newSpecies.conversions
      };
    } else {
      updated[customSpeciesName.trim()] = newSpecies;
    }
    
    updateCustomSpecies(updated);
    
    // Auto-select the new species
    setSpecies(customSpeciesName.trim());
    setFromState(customSpeciesFrom);
    setToState(customSpeciesTo);
    setYieldPercent(String(yieldValue));
    
    // Reset modal
    setShowCustomSpeciesModal(false);
    setCustomSpeciesName('');
    setCustomSpeciesYield('');
    setCustomSpeciesFrom('Round');
    setCustomSpeciesTo('Fillet');
  };

  // Update yield when conversion is selected
  useEffect(() => {
    if (currentConversion) {
      setYieldPercent(String(currentConversion.yield));
      setYieldRange(currentConversion.range);
      setUseRangeMin(false);
      setUseRangeMax(false);
    }
  }, [currentConversion]);

  // Apply range min/max
  useEffect(() => {
    if (yieldRange && useRangeMin) {
      setYieldPercent(String(yieldRange[0]));
    } else if (yieldRange && useRangeMax) {
      setYieldPercent(String(yieldRange[1]));
    } else if (currentConversion && !useRangeMin && !useRangeMax) {
      setYieldPercent(String(currentConversion.yield));
    }
  }, [useRangeMin, useRangeMax, yieldRange, currentConversion]);

  const calculate = () => {
    const y = (parseFloat(yieldPercent) || 100) / 100;

    if (mode === 'weight') {
      const target = parseFloat(targetWeight) || 0;
      if (y > 0) {
        setResult(target / y);
      } else {
        setResult(0);
      }
      setSaveStatus('');
      setAppliedDiscount(0);
      return;
    }

    const c = parseFloat(cost) || 0;
    const proc = parseFloat(processingCost) || 0;
    const cold = parseFloat(coldStorage) || 0;
    const ship = parseFloat(shipping) || 0;

    let baseRes = c / y;
    
    if (weightType === 'incoming') {
      baseRes += proc / y;
    } else {
      baseRes += proc;
    }

    baseRes += cold + ship;

    // Add time-based costs if enabled
    if (showTimeTracking) {
      let totalTimeCost = 0;
      processingSteps.forEach(step => {
        const time = parseFloat(step.timeMinutes) || 0;
        const laborRate = parseFloat(step.laborCostPerHour) || 0;
        // Convert minutes to hours and calculate cost
        totalTimeCost += (time / 60) * laborRate;
      });
      // Add time cost per pound (assuming time is per unit processed)
      baseRes += totalTimeCost;
    }

    // Apply economy of scale discount if enabled
    let discount = 0;
    if (showEconomyOfScale && quantity) {
      const qty = parseFloat(quantity) || 0;
      // Find the highest applicable discount
      const sortedBreaks = [...priceBreaks].sort((a, b) => b.minQty - a.minQty);
      for (const pb of sortedBreaks) {
        if (qty >= pb.minQty) {
          discount = pb.discount;
          break;
        }
      }
    }
    setAppliedDiscount(discount);
    
    if (discount > 0) {
      baseRes = baseRes * (1 - discount / 100);
    }

    setResult(baseRes);
    setSaveStatus('');
  };

  const handleSave = async () => {
    if (!result) return;

    try {
      await contextSaveCalc({
        name: `${species} - ${fromState} → ${toState}`,
        species,
        product: `${fromState} → ${toState}`,
        mode,
        cost: mode === 'cost' ? parseFloat(cost) : 0,
        target_weight: mode === 'weight' ? parseFloat(targetWeight) : 0,
        yield: parseFloat(yieldPercent),
        result,
        date: new Date().toISOString()
      });
      setSaveStatus('Saved to History!');
    } catch (e) {
      setSaveStatus('Error saving.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8 text-navy dark:text-text-primary">
      <div className="bg-surface-elevated border border-border rounded-xl p-8 shadow-lg dark:shadow-xl">
        <h2 className="text-3xl font-heading font-bold mb-6 flex items-center gap-3">
          <CalcIcon className="w-8 h-8 text-teal" />
          Fish Yield Calculator
        </h2>
        
        {/* Mode Toggle */}
        <div className="flex bg-surface p-1 rounded-lg mb-6">
          <button
            onClick={() => { setMode('cost'); setResult(null); }}
            className={`flex-1 py-2 rounded-md transition ${mode === 'cost' ? 'bg-teal text-white' : 'text-text-secondary hover:text-navy dark:hover:text-text-primary'}`}
          >
            Calculate Cost
          </button>
          <button
            onClick={() => { setMode('weight'); setResult(null); }}
            className={`flex-1 py-2 rounded-md transition ${mode === 'weight' ? 'bg-teal text-white' : 'text-text-secondary hover:text-navy dark:hover:text-text-primary'}`}
          >
            Calculate Input Weight
          </button>
        </div>
        
        <div className="space-y-6">
          {/* Species Selection */}
          <div>
            <label htmlFor="species-select" className="block text-sm font-medium mb-2 text-text-secondary">Species</label>
            <div className="flex gap-2">
              <select
                id="species-select"
                value={species}
                onChange={handleSpeciesChange}
                className="flex-1 bg-surface border border-border rounded-lg p-3 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
              >
                <option value="">Select Species</option>
                {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button
                onClick={() => setShowCustomSpeciesModal(true)}
                className="flex items-center gap-1 px-3 py-2 bg-rust hover:bg-[#B8532A] dark:hover:bg-[#F07D4A] text-white rounded-lg transition-all duration-200 text-sm font-medium"
                title="Add Custom Species"
              >
                <Plus size={18} />
                <span className="hidden sm:inline">Add</span>
              </button>
            </div>
            {scientificName && (
              <p className="mt-1 text-sm text-text-secondary italic">{scientificName}</p>
            )}
          </div>

          {/* From/To Conversion Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="from-state" className="block text-sm font-medium mb-2 text-text-secondary flex items-center gap-2">
                From State
                <HelpTooltip
                  text="The starting form of the fish (e.g., Round = whole fish as caught)"
                  ariaLabel="Help: Information about From State"
                />
              </label>
              <select
                id="from-state"
                value={fromState}
                onChange={handleFromChange}
                className="w-full bg-surface border border-border rounded-lg p-3 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary disabled:opacity-50"
                disabled={!species}
              >
                <option value="">Select From State</option>
                {fromStates.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label htmlFor="to-product" className="block text-sm font-medium mb-2 text-text-secondary flex items-center gap-2">
                To Product
                <HelpTooltip
                  text="The final form after processing"
                  ariaLabel="Help: Information about To Product"
                />
              </label>
              <select
                id="to-product"
                value={toState}
                onChange={handleToChange}
                className="w-full bg-surface border border-border rounded-lg p-3 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary disabled:opacity-50"
                disabled={!fromState}
              >
                <option value="">Select To Product</option>
                {toStates.map(t => (
                  <option key={t.to} value={t.to}>
                    {t.to} ({t.yield}%{t.range ? `, ${t.range[0]}-${t.range[1]}%` : ''})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Conversion Info Box */}
          {currentConversion && (
            <div className="bg-teal/5 dark:bg-teal/10 p-4 rounded-lg border border-teal/20 space-y-3">
              <h3 className="font-semibold text-teal flex items-center gap-2">
                <Info size={16} /> Conversion Details
              </h3>
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-text-secondary">Converting:</span>{' '}
                  <TextWithTooltips text={currentConversion.from} /> → <TextWithTooltips text={currentConversion.to} />
                </p>
                <p>
                  <span className="text-text-secondary">Average Yield:</span>{' '}
                  <span className="text-navy dark:text-text-primary font-medium font-mono">{currentConversion.yield}%</span>
                </p>
                {currentConversion.range && (
                  <p>
                    <span className="text-text-secondary">Expected Range:</span>{' '}
                    <span className="text-navy dark:text-text-primary font-mono">{currentConversion.range[0]}% - {currentConversion.range[1]}%</span>
                  </p>
                )}
              </div>
              
              {/* Range Quick Select */}
              {currentConversion.range && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => { setUseRangeMin(true); setUseRangeMax(false); }}
                    className={`px-3 py-1 text-xs rounded text-white ${useRangeMin ? 'bg-yellow-600' : 'bg-slate-400 dark:bg-slate-700'} hover:bg-yellow-500 transition`}
                  >
                    Use Min ({currentConversion.range[0]}%)
                  </button>
                  <button
                    onClick={() => { setUseRangeMin(false); setUseRangeMax(false); }}
                    className={`px-3 py-1 text-xs rounded text-white ${!useRangeMin && !useRangeMax ? 'bg-teal' : 'bg-slate-400 dark:bg-slate-700'} hover:bg-teal/80 transition`}
                  >
                    Use Average ({currentConversion.yield}%)
                  </button>
                  <button
                    onClick={() => { setUseRangeMax(true); setUseRangeMin(false); }}
                    className={`px-3 py-1 text-xs rounded text-white ${useRangeMax ? 'bg-green-600' : 'bg-slate-400 dark:bg-slate-700'} hover:bg-green-500 transition`}
                  >
                    Use Max ({currentConversion.range[1]}%)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Profile Info */}
          {profile && (
            <div className="bg-surface border border-border p-4 rounded-lg text-sm space-y-2">
              <h3 className="font-semibold text-teal flex items-center gap-2">
                <Info size={16} /> Species Info
              </h3>
              {profile.description && <p><span className="text-text-secondary">Description:</span> {profile.description}</p>}
              {profile.edible_portions && <p><span className="text-text-secondary">Edible:</span> {profile.edible_portions}</p>}
              {profile.url && <a href={profile.url} target="_blank" rel="noreferrer" className="text-teal hover:underline">Read more</a>}
            </div>
          )}

          {/* Cost/Weight Input */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {mode === 'cost' ? (
              <div>
                <label htmlFor="cost-per-pound" className="block text-sm font-medium mb-2 text-text-secondary">Cost per Pound ({fromState || 'Whole'})</label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-text-secondary">$</span>
                  <input
                    id="cost-per-pound"
                    type="number"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg p-3 pl-8 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
                    placeholder="0.00"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="target-output" className="block text-sm font-medium mb-2 text-text-secondary">Target Output (lbs of {toState || 'Product'})</label>
                <div className="relative">
                  <input
                    id="target-output"
                    type="number"
                    value={targetWeight}
                    onChange={(e) => setTargetWeight(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg p-3 pr-8 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
                    placeholder="e.g. 100"
                  />
                  <span className="absolute right-3 top-3 text-text-secondary">lbs</span>
                </div>
              </div>
            )}
            
            <div>
              <label htmlFor="yield-percentage" className="block text-sm font-medium mb-2 text-text-secondary">Yield Percentage</label>
              <div className="relative">
                <input
                  id="yield-percentage"
                  type="number"
                  value={yieldPercent}
                  onChange={(e) => { setYieldPercent(e.target.value); setUseRangeMin(false); setUseRangeMax(false); }}
                  className="w-full bg-surface border border-border rounded-lg p-3 pr-8 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
                  placeholder="e.g. 6.5"
                />
                <span className="absolute right-3 top-3 text-text-secondary">%</span>
              </div>
              {yieldRange && (
                <p className="mt-1 text-xs text-text-secondary font-mono">Range: {yieldRange[0]}% - {yieldRange[1]}%</p>
              )}
            </div>
          </div>

          {/* Additional Costs (Cost Mode Only) */}
          {mode === 'cost' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="processing-cost" className="block text-sm font-medium mb-2 text-text-secondary">Processing Cost</label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-text-secondary">$</span>
                  <input
                    id="processing-cost"
                    type="number"
                    value={processingCost}
                    onChange={(e) => setProcessingCost(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg p-3 pl-8 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
                    placeholder="0.00"
                  />
                </div>
              </div>
              
              <div>
                <label htmlFor="weight-type" className="block text-sm font-medium mb-2 text-text-secondary">Applied To</label>
                <select
                  id="weight-type"
                  value={weightType}
                  onChange={(e) => setWeightType(e.target.value)}
                  className="w-full bg-surface border border-border rounded-lg p-3 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
                >
                  <option value="incoming">Incoming Weight ({fromState || 'Whole'})</option>
                  <option value="outgoing">Outgoing Weight ({toState || 'Product'})</option>
                </select>
              </div>
            </div>
          )}

          {/* Time Tracking Section (Optional) */}
          {mode === 'cost' && (
            <div className="border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setShowTimeTracking(!showTimeTracking)}
                className="w-full flex items-center justify-between p-4 bg-surface hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-amber-500" />
                  <span className="font-medium text-text-secondary">Time Tracking</span>
                  <span className="text-xs text-text-secondary">(Optional)</span>
                </div>
                {showTimeTracking ? <ChevronUp size={20} className="text-text-secondary" /> : <ChevronDown size={20} className="text-text-secondary" />}
              </button>
              
              {showTimeTracking && (
                <div className="p-4 space-y-4 bg-amber-50/50 dark:bg-amber-900/10 border-t border-border">
                  <p className="text-sm text-text-secondary">
                    Track processing time per step to calculate labor costs. Time cost is added per pound processed.
                  </p>
                  
                  {processingSteps.map((step, idx) => (
                    <div key={step.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-surface-elevated rounded-lg border border-border">
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">Step Name</label>
                        <input
                          type="text"
                          value={step.name}
                          onChange={(e) => {
                            const updated = [...processingSteps];
                            updated[idx].name = e.target.value;
                            setProcessingSteps(updated);
                          }}
                          className="w-full bg-surface border border-border rounded p-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none text-navy dark:text-text-primary"
                          placeholder="e.g., Filleting"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">Time (minutes/lb)</label>
                        <input
                          type="number"
                          value={step.timeMinutes}
                          onChange={(e) => {
                            const updated = [...processingSteps];
                            updated[idx].timeMinutes = e.target.value;
                            setProcessingSteps(updated);
                          }}
                          className="w-full bg-surface border border-border rounded p-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none text-navy dark:text-text-primary"
                          placeholder="e.g., 2"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1 text-text-secondary">Labor Cost ($/hr)</label>
                        <div className="relative">
                          <span className="absolute left-2 top-2 text-text-secondary text-sm">$</span>
                          <input
                            type="number"
                            value={step.laborCostPerHour}
                            onChange={(e) => {
                              const updated = [...processingSteps];
                              updated[idx].laborCostPerHour = e.target.value;
                              setProcessingSteps(updated);
                            }}
                            className="w-full bg-surface border border-border rounded p-2 pl-6 text-sm focus:ring-2 focus:ring-amber-500 outline-none text-navy dark:text-text-primary"
                            placeholder="e.g., 25"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => setProcessingSteps([...processingSteps, { id: Date.now(), name: '', timeMinutes: '', laborCostPerHour: '' }])}
                      className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition"
                    >
                      <Plus size={16} /> Add Step
                    </button>
                    {processingSteps.length > 1 && (
                      <button
                        onClick={() => setProcessingSteps(processingSteps.slice(0, -1))}
                        className="flex items-center gap-1 text-sm text-red-500 hover:text-red-400 transition"
                      >
                        <X size={16} /> Remove Last
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Economy of Scale Section (Optional) */}
          {mode === 'cost' && (
            <div className="border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setShowEconomyOfScale(!showEconomyOfScale)}
                className="w-full flex items-center justify-between p-4 bg-surface hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <div className="flex items-center gap-3">
                  <TrendingDown className="h-5 w-5 text-green-500" />
                  <span className="font-medium text-text-secondary">Economy of Scale Pricing</span>
                  <span className="text-xs text-text-secondary">(Optional)</span>
                </div>
                {showEconomyOfScale ? <ChevronUp size={20} className="text-text-secondary" /> : <ChevronDown size={20} className="text-text-secondary" />}
              </button>
              
              {showEconomyOfScale && (
                <div className="p-4 space-y-4 bg-green-50/50 dark:bg-green-900/10 border-t border-border">
                  <p className="text-sm text-text-secondary">
                    Enter your quantity to see bulk pricing discounts. The more you order, the less you pay per unit.
                  </p>
                  
                  <div>
                    <label htmlFor="quantity" className="block text-sm font-medium mb-2 text-text-secondary">Quantity (lbs)</label>
                    <input
                      id="quantity"
                      type="number"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      className="w-full bg-surface border border-border rounded-lg p-3 focus:ring-2 focus:ring-green-500 outline-none text-navy dark:text-text-primary"
                      placeholder="Enter total pounds"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-text-secondary">Price Break Tiers</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {priceBreaks.map((pb, idx) => (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border-2 transition-all ${
                            quantity && parseFloat(quantity) >= pb.minQty
                              ? 'border-green-500 bg-green-100 dark:bg-green-900/30'
                              : 'border-border bg-surface-elevated'
                          }`}
                        >
                          <p className="font-semibold text-navy dark:text-text-primary">{pb.minQty}+ lbs</p>
                          <p className="text-green-600 dark:text-green-400 text-lg font-bold">{pb.discount}% off</p>
                        </div>
                      ))}
                    </div>
                    
                    <button
                      onClick={() => setPriceBreaks([...priceBreaks, { minQty: (priceBreaks[priceBreaks.length - 1]?.minQty || 0) + 500, discount: (priceBreaks[priceBreaks.length - 1]?.discount || 0) + 5 }])}
                      className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 transition mt-2"
                    >
                      <Plus size={16} /> Add Price Break
                    </button>
                  </div>
                  
                  {quantity && appliedDiscount > 0 && (
                    <div className="p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg text-center">
                      <p className="text-green-700 dark:text-green-300 font-medium">
                        🎉 You qualify for a <span className="text-lg font-bold">{appliedDiscount}%</span> bulk discount!
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* Calculate Button */}
          <button 
            onClick={calculate}
            disabled={!species || !toState}
            className="w-full bg-rust hover:bg-[#B8532A] dark:hover:bg-[#F07D4A] disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-4 rounded-lg transform transition hover:scale-[1.02] active:scale-[0.98]"
          >
            {mode === 'cost' ? 'Calculate Cost per Pound' : 'Calculate Required Input Weight'}
          </button>

          {/* Result */}
          {result !== null && (
            <div className="mt-8 p-6 bg-green-50 dark:bg-green-900/40 border border-green-200 dark:border-green-500/30 rounded-xl text-center animate-fade-in relative">
              <p className="text-text-secondary text-sm uppercase tracking-wide">
                {mode === 'cost' ? `Cost per Pound of ${toState}` : `Required ${fromState} Input`}
              </p>
              <p className="text-5xl font-bold font-mono text-green-600 dark:text-green-400 mt-2">
                {mode === 'cost' ? `$${result.toFixed(2)}` : `${result.toFixed(2)} lbs`}
              </p>
              <p className="text-sm text-text-secondary mt-2">
                {mode === 'cost'
                  ? `Based on ${yieldPercent}% yield from ${fromState} to ${toState}`
                  : `You need ${result.toFixed(2)} lbs of ${fromState} to get ${targetWeight} lbs of ${toState}`
                }
              </p>

              {/* Applied Discounts & Extras */}
              {mode === 'cost' && (appliedDiscount > 0 || showTimeTracking) && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {appliedDiscount > 0 && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 rounded-full text-xs font-medium">
                      <TrendingDown size={14} /> {appliedDiscount}% Bulk Discount Applied
                    </span>
                  )}
                  {showTimeTracking && processingSteps.some(s => s.timeMinutes && s.laborCostPerHour) && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 rounded-full text-xs font-medium">
                      <Clock size={14} /> Labor Costs Included
                    </span>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-col items-center gap-2">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-2 text-teal hover:text-teal/80 transition"
                    >
                      <Save size={20} /> Save Calculation
                    </button>
                    {user && (
                      <button
                        onClick={async () => {
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
                          } catch (error) {
                            console.error('Export failed:', error);
                          }
                        }}
                        className="flex items-center gap-2 text-text-secondary hover:text-navy dark:hover:text-text-primary transition text-sm"
                      >
                        <Download size={16} /> Export History
                      </button>
                    )}
                  </div>
                  {saveStatus && (
                    <p
                      className="text-sm mt-2 text-text-secondary"
                      role="status"
                      aria-live="polite"
                    >
                      {saveStatus}
                    </p>
                  )}
                </div>
            </div>
          )}
        </div>
      </div>

      {/* Acronym Reference */}
      <div className="bg-surface-elevated border border-border rounded-xl p-6 shadow-md dark:shadow-none">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-navy dark:text-text-primary">
          <HelpCircle size={18} className="text-teal" />
          Acronym Reference
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {Object.entries(ACRONYMS).slice(0, 9).map(([abbr, full]) => (
            <div key={abbr} className="bg-surface p-2 rounded">
              <span className="text-teal font-medium">{abbr}</span>
              <span className="text-text-secondary ml-2">{full.split(' - ')[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Public Calculation History - visible to all users including guests */}
      {publicHistory.length > 0 && (
        <div className="bg-surface-elevated border border-border rounded-xl p-6 shadow-md dark:shadow-none">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-navy dark:text-text-primary">
            <CalcIcon size={18} className="text-teal" />
            Recent Calculations
            <span className="text-xs font-normal text-text-secondary ml-2">
              (Community)
            </span>
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {publicHistory.slice(0, 10).map((calc) => (
              <div
                key={calc.id}
                className="flex justify-between items-center p-3 bg-surface rounded-lg text-sm"
              >
                <div>
                  <p className="font-medium text-navy dark:text-text-primary">{calc.name || calc.species}</p>
                  <p className="text-xs text-text-secondary">
                    {calc.product} • {calc.yield}% yield
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold font-mono text-green-600 dark:text-green-400">
                    ${parseFloat(calc.result).toFixed(2)}/lb
                  </p>
                  <p className="text-xs text-text-secondary">
                    {new Date(calc.date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {!user && (
            <p className="mt-4 text-xs text-center text-text-secondary">
              Sign in to sync your calculations across devices
            </p>
          )}
        </div>
      )}

      {/* Custom Species Modal */}
      {showCustomSpeciesModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-elevated rounded-2xl shadow-2xl border border-border w-full max-w-md p-6 relative animate-fade-in">
            <button
              onClick={() => setShowCustomSpeciesModal(false)}
              className="absolute top-4 right-4 text-text-secondary hover:text-navy dark:hover:text-text-primary transition"
            >
              <X size={24} />
            </button>
            
            <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-navy dark:text-text-primary">
              <Plus className="text-teal" size={24} />
              Add Custom Species
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-text-secondary">
                  Species Name
                </label>
                <input
                  type="text"
                  value={customSpeciesName}
                  onChange={(e) => setCustomSpeciesName(e.target.value)}
                  placeholder="e.g., Pacific Halibut"
                  className="w-full bg-surface border border-border rounded-lg p-3 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-secondary">
                    From State
                  </label>
                  <input
                    type="text"
                    value={customSpeciesFrom}
                    onChange={(e) => setCustomSpeciesFrom(e.target.value)}
                    placeholder="e.g., Round"
                    className="w-full bg-surface border border-border rounded-lg p-3 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2 text-text-secondary">
                    To Product
                  </label>
                  <input
                    type="text"
                    value={customSpeciesTo}
                    onChange={(e) => setCustomSpeciesTo(e.target.value)}
                    placeholder="e.g., Fillet"
                    className="w-full bg-surface border border-border rounded-lg p-3 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-text-secondary">
                  Yield Percentage
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={customSpeciesYield}
                    onChange={(e) => setCustomSpeciesYield(e.target.value)}
                    placeholder="e.g., 45"
                    min="1"
                    max="100"
                    className="w-full bg-surface border border-border rounded-lg p-3 pr-8 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary"
                  />
                  <span className="absolute right-3 top-3 text-text-secondary">%</span>
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  Expected yield when converting from {customSpeciesFrom || 'starting state'} to {customSpeciesTo || 'product'}
                </p>
              </div>
              
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCustomSpeciesModal(false)}
                  className="flex-1 py-3 px-4 border border-border text-text-secondary rounded-lg hover:bg-surface transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddCustomSpecies}
                  disabled={!customSpeciesName.trim() || !customSpeciesYield}
                  className="flex-1 py-3 px-4 bg-rust hover:bg-[#B8532A] dark:hover:bg-[#F07D4A] disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition"
                >
                  Add Species
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calculator;
