import React, { useState, useEffect, useMemo } from 'react';
import { ACRONYMS } from '../data/fish_data_v3';
import { Info, Calculator as CalcIcon, Save, HelpCircle, Download } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../config/api';

// Tooltip component for acronyms
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
        <span className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white rounded-lg shadow-xl whitespace-nowrap border border-cyan-500/30">
          {text}
          <span className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-white dark:border-t-slate-800"></span>
        </span>
      )}
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
            <span className="border-b border-dashed border-cyan-500/50 dark:border-cyan-400/50 text-cyan-600 dark:text-cyan-300">{part.text}</span>
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
  
  // Fish data from API
  const [fishData, setFishData] = useState({});
  const [profilesData, setProfilesData] = useState({});
  const [dataLoading, setDataLoading] = useState(true);

  // Load fish data from API on mount
  useEffect(() => {
    fetch(apiUrl('/api/fish-data'))
      .then(res => res.json())
      .then(data => {
        if (data.fishData) {
          setFishData(data.fishData);
        }
        if (data.profiles) {
          setProfilesData(data.profiles);
        }
        setDataLoading(false);
      })
      .catch(err => {
        console.error("Failed to load fish data:", err);
        setDataLoading(false);
      });
  }, []);

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

  // Load user-specific data on login
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
      .catch(err => console.error("Failed to load custom data", err));

      fetch(apiUrl('/api/saved-calcs'), {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      })
      .then(res => res.json())
      .then(data => setHistory(data))
      .catch(err => console.error("Failed to load history", err));
    } else {
      setCustomData({});
      setHistory([]);
    }
  }, [user]);

  // Merge Data - combine API fish data with user custom data
  const combinedData = useMemo(() => {
    const merged = { ...fishData };
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
    return merged;
  }, [fishData, customData]);

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

    setResult(baseRes);
    setSaveStatus('');
  };

  const handleSave = async () => {
    if (!user || !result) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(apiUrl('/api/save-calc'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: `${species} - ${fromState} → ${toState}`,
          species,
          product: `${fromState} → ${toState}`,
          mode,
          cost: mode === 'cost' ? parseFloat(cost) : 0,
          target_weight: mode === 'weight' ? parseFloat(targetWeight) : 0,
          yield: parseFloat(yieldPercent),
          result
        })
      });
      
      if (res.ok) {
        setSaveStatus('Saved to History!');
      } else {
        setSaveStatus('Failed to save.');
      }
    } catch (e) {
      setSaveStatus('Error saving.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8 text-slate-800 dark:text-white">
      <div className="bg-white dark:bg-white/10 backdrop-blur-lg rounded-xl p-8 shadow-lg dark:shadow-xl border border-slate-200 dark:border-white/20">
        <h2 className="text-3xl font-bold mb-6 flex items-center gap-3">
          <CalcIcon className="w-8 h-8 text-cyan-400" />
          Fish Yield Calculator
        </h2>
        
        {/* Mode Toggle */}
        <div className="flex bg-slate-200 dark:bg-slate-800 p-1 rounded-lg mb-6">
          <button
            onClick={() => { setMode('cost'); setResult(null); }}
            className={`flex-1 py-2 rounded-md transition ${mode === 'cost' ? 'bg-cyan-600 text-white' : 'text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white'}`}
          >
            Calculate Cost
          </button>
          <button
            onClick={() => { setMode('weight'); setResult(null); }}
            className={`flex-1 py-2 rounded-md transition ${mode === 'weight' ? 'bg-cyan-600 text-white' : 'text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white'}`}
          >
            Calculate Input Weight
          </button>
        </div>
        
        <div className="space-y-6">
          {/* Species Selection */}
          <div>
            <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Species</label>
            <select
              value={species}
              onChange={handleSpeciesChange}
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
            >
              <option value="">Select Species</option>
              {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {scientificName && (
              <p className="mt-1 text-sm text-slate-600 dark:text-gray-400 italic">{scientificName}</p>
            )}
          </div>

          {/* From/To Conversion Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300 flex items-center gap-2">
                From State
                <Tooltip text="The starting form of the fish (e.g., Round = whole fish as caught)">
                  <HelpCircle size={14} className="text-slate-500 dark:text-gray-500" />
                </Tooltip>
              </label>
              <select
                value={fromState}
                onChange={handleFromChange}
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white disabled:opacity-50"
                disabled={!species}
              >
                <option value="">Select From State</option>
                {fromStates.map(f => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300 flex items-center gap-2">
                To Product
                <Tooltip text="The final form after processing">
                  <HelpCircle size={14} className="text-slate-500 dark:text-gray-500" />
                </Tooltip>
              </label>
              <select
                value={toState}
                onChange={handleToChange}
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white disabled:opacity-50"
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
            <div className="bg-cyan-50 dark:bg-cyan-900/30 p-4 rounded-lg border border-cyan-200 dark:border-cyan-800 space-y-3">
              <h3 className="font-semibold text-cyan-600 dark:text-cyan-400 flex items-center gap-2">
                <Info size={16} /> Conversion Details
              </h3>
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-slate-600 dark:text-gray-400">Converting:</span>{' '}
                  <TextWithTooltips text={currentConversion.from} /> → <TextWithTooltips text={currentConversion.to} />
                </p>
                <p>
                  <span className="text-slate-600 dark:text-gray-400">Average Yield:</span>{' '}
                  <span className="text-slate-800 dark:text-white font-medium">{currentConversion.yield}%</span>
                </p>
                {currentConversion.range && (
                  <p>
                    <span className="text-slate-600 dark:text-gray-400">Expected Range:</span>{' '}
                    <span className="text-slate-800 dark:text-white">{currentConversion.range[0]}% - {currentConversion.range[1]}%</span>
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
                    className={`px-3 py-1 text-xs rounded text-white ${!useRangeMin && !useRangeMax ? 'bg-cyan-600' : 'bg-slate-400 dark:bg-slate-700'} hover:bg-cyan-500 transition`}
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
            <div className="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-300 dark:border-slate-700 text-sm space-y-2">
              <h3 className="font-semibold text-cyan-600 dark:text-cyan-400 flex items-center gap-2">
                <Info size={16} /> Species Info
              </h3>
              {profile.description && <p><span className="text-slate-600 dark:text-gray-400">Description:</span> {profile.description}</p>}
              {profile.edible_portions && <p><span className="text-slate-600 dark:text-gray-400">Edible:</span> {profile.edible_portions}</p>}
              {profile.url && <a href={profile.url} target="_blank" rel="noreferrer" className="text-cyan-600 dark:text-cyan-400 hover:underline">Read more</a>}
            </div>
          )}

          {/* Cost/Weight Input */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {mode === 'cost' ? (
              <div>
                <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Cost per Pound ({fromState || 'Whole'})</label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-slate-500 dark:text-gray-500">$</span>
                  <input
                    type="number"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 pl-8 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                    placeholder="0.00"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Target Output (lbs of {toState || 'Product'})</label>
                <div className="relative">
                  <input
                    type="number"
                    value={targetWeight}
                    onChange={(e) => setTargetWeight(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 pr-8 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                    placeholder="e.g. 100"
                  />
                  <span className="absolute right-3 top-3 text-slate-500 dark:text-gray-500">lbs</span>
                </div>
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Yield Percentage</label>
              <div className="relative">
                <input
                  type="number"
                  value={yieldPercent}
                  onChange={(e) => { setYieldPercent(e.target.value); setUseRangeMin(false); setUseRangeMax(false); }}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 pr-8 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                  placeholder="0"
                />
                <span className="absolute right-3 top-3 text-slate-500 dark:text-gray-500">%</span>
              </div>
              {yieldRange && (
                <p className="mt-1 text-xs text-slate-600 dark:text-gray-500">Range: {yieldRange[0]}% - {yieldRange[1]}%</p>
              )}
            </div>
          </div>

          {/* Additional Costs (Cost Mode Only) */}
          {mode === 'cost' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Processing Cost</label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-slate-500 dark:text-gray-500">$</span>
                  <input
                    type="number"
                    value={processingCost}
                    onChange={(e) => setProcessingCost(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 pl-8 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                    placeholder="0.00"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Applied To</label>
                <select
                  value={weightType}
                  onChange={(e) => setWeightType(e.target.value)}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                >
                  <option value="incoming">Incoming Weight ({fromState || 'Whole'})</option>
                  <option value="outgoing">Outgoing Weight ({toState || 'Product'})</option>
                </select>
              </div>
            </div>
          )}
          
          {/* Calculate Button */}
          <button 
            onClick={calculate}
            disabled={!species || !toState}
            className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed text-white font-bold py-4 rounded-lg shadow-lg transform transition hover:scale-[1.02] active:scale-[0.98]"
          >
            {mode === 'cost' ? 'Calculate Cost per Pound' : 'Calculate Required Input Weight'}
          </button>

          {/* Result */}
          {result !== null && (
            <div className="mt-8 p-6 bg-green-50 dark:bg-green-900/40 border border-green-200 dark:border-green-500/30 rounded-xl text-center animate-fade-in relative">
              <p className="text-slate-600 dark:text-gray-400 text-sm uppercase tracking-wide">
                {mode === 'cost' ? `Cost per Pound of ${toState}` : `Required ${fromState} Input`}
              </p>
              <p className="text-5xl font-bold text-green-600 dark:text-green-400 mt-2">
                {mode === 'cost' ? `$${result.toFixed(2)}` : `${result.toFixed(2)} lbs`}
              </p>
              <p className="text-sm text-slate-600 dark:text-gray-400 mt-2">
                {mode === 'cost'
                  ? `Based on ${yieldPercent}% yield from ${fromState} to ${toState}`
                  : `You need ${result.toFixed(2)} lbs of ${fromState} to get ${targetWeight} lbs of ${toState}`
                }
              </p>

              {user ? (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 transition"
                    >
                      <Save size={20} /> Save Calculation
                    </button>
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
                      className="flex items-center gap-2 text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200 transition text-sm"
                    >
                      <Download size={16} /> Export History
                    </button>
                  </div>
                  {saveStatus && <p className="text-sm mt-2 text-slate-700 dark:text-gray-300">{saveStatus}</p>}
                </div>
              ) : (
                <p className="mt-4 text-xs text-slate-500 dark:text-gray-500">Log in to save this calculation</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Acronym Reference */}
      <div className="bg-white dark:bg-white/5 backdrop-blur-lg rounded-xl p-6 border border-slate-200 dark:border-white/10 shadow-md dark:shadow-none">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-slate-800 dark:text-white">
          <HelpCircle size={18} className="text-cyan-600 dark:text-cyan-400" />
          Acronym Reference
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          {Object.entries(ACRONYMS).slice(0, 9).map(([abbr, full]) => (
            <div key={abbr} className="bg-slate-100 dark:bg-slate-800/50 p-2 rounded">
              <span className="text-cyan-600 dark:text-cyan-400 font-medium">{abbr}</span>
              <span className="text-slate-600 dark:text-gray-400 ml-2">{full.split(' - ')[0]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Public Calculation History - visible to all users including guests */}
      {publicHistory.length > 0 && (
        <div className="bg-white dark:bg-white/5 backdrop-blur-lg rounded-xl p-6 border border-slate-200 dark:border-white/10 shadow-md dark:shadow-none">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-slate-800 dark:text-white">
            <CalcIcon size={18} className="text-cyan-600 dark:text-cyan-400" />
            Recent Calculations
            <span className="text-xs font-normal text-slate-500 dark:text-gray-500 ml-2">
              (Community)
            </span>
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {publicHistory.slice(0, 10).map((calc) => (
              <div
                key={calc.id}
                className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm"
              >
                <div>
                  <p className="font-medium text-slate-800 dark:text-white">{calc.name || calc.species}</p>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    {calc.product} • {calc.yield}% yield
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-green-600 dark:text-green-400">
                    ${parseFloat(calc.result).toFixed(2)}/lb
                  </p>
                  <p className="text-xs text-slate-500 dark:text-gray-400">
                    {new Date(calc.date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {!user && (
            <p className="mt-4 text-xs text-center text-slate-500 dark:text-gray-500">
              Sign in to save your own calculations
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default Calculator;
