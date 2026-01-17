import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import { ACRONYMS } from '../data/fish_data_v3';
import { Info, Calculator as CalcIcon, Save, HelpCircle, Download, Plus, X, ChevronDown, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../config/api';

// Creatable Combobox Component - allows selecting from options or typing custom values
const CreatableCombobox = ({
  id,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  allowCustom = true,
  renderOption,
  getOptionLabel = (opt) => opt,
  getOptionValue = (opt) => opt,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listboxId = useId();

  // Filter options based on input
  const filteredOptions = useMemo(() => {
    if (!inputValue.trim()) return options;
    const searchTerm = inputValue.toLowerCase();
    return options.filter(opt => 
      getOptionLabel(opt).toLowerCase().includes(searchTerm)
    );
  }, [options, inputValue, getOptionLabel]);

  // Check if input matches any existing option
  const inputMatchesOption = useMemo(() => {
    const searchTerm = inputValue.trim().toLowerCase();
    return options.some(opt => getOptionLabel(opt).toLowerCase() === searchTerm);
  }, [options, inputValue, getOptionLabel]);

  // Should show "Add custom" option
  const showAddCustom = allowCustom && inputValue.trim() && !inputMatchesOption;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        // Reset input to current value when closing
        setInputValue(value ? (typeof value === 'object' ? getOptionLabel(value) : value) : '');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value, getOptionLabel]);

  // Sync input value with external value
  useEffect(() => {
    if (!isOpen) {
      setInputValue(value ? (typeof value === 'object' ? getOptionLabel(value) : value) : '');
    }
  }, [value, isOpen, getOptionLabel]);

  const handleInputChange = (e) => {
    setInputValue(e.target.value);
    setHighlightedIndex(-1);
    if (!isOpen) setIsOpen(true);
  };

  const handleSelect = (option) => {
    const selectedValue = typeof option === 'object' ? getOptionValue(option) : option;
    onChange({ target: { value: selectedValue } });
    setInputValue(getOptionLabel(option));
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleAddCustom = () => {
    const customValue = inputValue.trim();
    if (customValue) {
      onChange({ target: { value: customValue, isCustom: true } });
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const handleKeyDown = (e) => {
    const totalOptions = filteredOptions.length + (showAddCustom ? 1 : 0);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setHighlightedIndex(prev => 
            prev < totalOptions - 1 ? prev + 1 : 0
          );
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          setHighlightedIndex(prev => 
            prev > 0 ? prev - 1 : totalOptions - 1
          );
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (isOpen) {
          if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
            handleSelect(filteredOptions[highlightedIndex]);
          } else if (showAddCustom && highlightedIndex === filteredOptions.length) {
            handleAddCustom();
          } else if (showAddCustom) {
            handleAddCustom();
          }
        } else {
          setIsOpen(true);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setInputValue(value ? (typeof value === 'object' ? getOptionLabel(value) : value) : '');
        break;
      case 'Tab':
        if (isOpen && showAddCustom && filteredOptions.length === 0) {
          handleAddCustom();
        }
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 pr-10 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white disabled:opacity-50"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            if (!disabled) {
              setIsOpen(!isOpen);
              inputRef.current?.focus();
            }
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-300 disabled:opacity-50"
          disabled={disabled}
          aria-label="Toggle dropdown"
        >
          <ChevronDown size={20} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && !disabled && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg max-h-60 overflow-auto"
        >
          {filteredOptions.length === 0 && !showAddCustom && (
            <li className="px-4 py-3 text-slate-500 dark:text-gray-400 text-sm">
              No options found
            </li>
          )}
          {filteredOptions.map((option, index) => {
            const optionValue = getOptionValue(option);
            const isSelected = value === optionValue;
            const isHighlighted = highlightedIndex === index;
            
            return (
              <li
                key={optionValue}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(option)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`px-4 py-3 cursor-pointer flex items-center justify-between transition-colors ${
                  isHighlighted 
                    ? 'bg-cyan-100 dark:bg-cyan-900/50' 
                    : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                } ${isSelected ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-800 dark:text-white'}`}
              >
                {renderOption ? renderOption(option) : getOptionLabel(option)}
                {isSelected && <Check size={16} className="text-cyan-600 dark:text-cyan-400" />}
              </li>
            );
          })}
          {showAddCustom && (
            <li
              role="option"
              aria-selected={false}
              onClick={handleAddCustom}
              onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
              className={`px-4 py-3 cursor-pointer flex items-center gap-2 border-t border-slate-200 dark:border-slate-700 transition-colors ${
                highlightedIndex === filteredOptions.length 
                  ? 'bg-cyan-100 dark:bg-cyan-900/50' 
                  : 'hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <Plus size={16} className="text-cyan-600 dark:text-cyan-400" />
              <span className="text-cyan-600 dark:text-cyan-400">
                Add "{inputValue.trim()}"
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

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
        className={`absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white rounded-lg shadow-xl whitespace-nowrap border border-cyan-500/30 ${show ? '' : 'hidden'}`}
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
        className="inline-flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 rounded-full"
      >
        <HelpCircle size={14} className="text-slate-500 dark:text-gray-500" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        aria-hidden={!show}
        className={`absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-white rounded-lg shadow-xl whitespace-nowrap border border-cyan-500/30 ${show ? '' : 'hidden'}`}
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

  // Custom entries state (persisted in localStorage)
  const [customSpecies, setCustomSpecies] = useState(() => {
    const saved = localStorage.getItem('customFishSpecies');
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse customFishSpecies from localStorage:', e);
      localStorage.removeItem('customFishSpecies');
      return [];
    }
  });
  const [customFromStates, setCustomFromStates] = useState(() => {
    const saved = localStorage.getItem('customFromStates');
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse customFromStates from localStorage:', e);
      localStorage.removeItem('customFromStates');
      return [];
    }
  });
  const [customToStates, setCustomToStates] = useState(() => {
    const saved = localStorage.getItem('customToStates');
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse customToStates from localStorage:', e);
      localStorage.removeItem('customToStates');
      return [];
    }
  });

  // Persist custom entries to localStorage
  useEffect(() => {
    localStorage.setItem('customFishSpecies', JSON.stringify(customSpecies));
  }, [customSpecies]);
  useEffect(() => {
    localStorage.setItem('customFromStates', JSON.stringify(customFromStates));
  }, [customFromStates]);
  useEffect(() => {
    localStorage.setItem('customToStates', JSON.stringify(customToStates));
  }, [customToStates]);

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

  // Combined species list - database species + custom species
  const speciesList = useMemo(() => {
    const dbSpecies = Object.keys(combinedData);
    const allSpecies = [...new Set([...dbSpecies, ...customSpecies])];
    return allSpecies.sort();
  }, [combinedData, customSpecies]);
  
  // Get available "from" states for selected species - includes database + custom states
  const fromStates = useMemo(() => {
    const states = new Set(customFromStates);
    if (species && combinedData[species]) {
      Object.values(combinedData[species].conversions || {}).forEach(conv => {
        if (conv.from) states.add(conv.from);
      });
    }
    return Array.from(states).sort();
  }, [species, combinedData, customFromStates]);

  // Get available "to" states based on selected "from" - includes database + custom states
  const toStates = useMemo(() => {
    const states = [];
    // Add database conversions
    if (species && fromState && combinedData[species]) {
      Object.values(combinedData[species].conversions || {}).forEach(conv => {
        if (conv.from === fromState && conv.to) {
          states.push({ to: conv.to, yield: conv.yield, range: conv.range });
        }
      });
    }
    // Add custom to states (without yield info since they're custom)
    customToStates.forEach(customTo => {
      if (!states.some(s => s.to === customTo)) {
        states.push({ to: customTo, yield: null, range: null, isCustom: true });
      }
    });
    return states.sort((a, b) => a.to.localeCompare(b.to));
  }, [species, fromState, combinedData, customToStates]);

  const currentConversion = useMemo(() => {
    if (!species || !fromState || !toState || !combinedData[species]) return null;
    return Object.values(combinedData[species].conversions || {}).find(
      conv => conv.from === fromState && conv.to === toState
    );
  }, [species, fromState, toState, combinedData]);

  const profile = species ? profilesData[species] : null;
  const scientificName = species && combinedData[species] ? combinedData[species].scientific_name : null;

  // Check if current selection uses custom values
  const isUsingCustomValues = useMemo(() => {
    const isCustomSpecies = customSpecies.includes(species);
    const isCustomFrom = customFromStates.includes(fromState);
    const isCustomTo = customToStates.includes(toState);
    return isCustomSpecies || isCustomFrom || isCustomTo;
  }, [species, fromState, toState, customSpecies, customFromStates, customToStates]);

  // Handle species change
  const handleSpeciesChange = (e) => {
    const s = e.target.value;
    const isCustom = e.target.isCustom;
    
    if (isCustom && s && !customSpecies.includes(s)) {
      setCustomSpecies(prev => [...prev, s]);
    }
    
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
    const isCustom = e.target.isCustom;
    
    if (isCustom && f && !customFromStates.includes(f)) {
      setCustomFromStates(prev => [...prev, f]);
    }
    
    setFromState(f);
    setToState('');
    setYieldPercent('');
    setYieldRange(null);
    setResult(null);
  };

  // Handle to state change
  const handleToChange = (e) => {
    const t = e.target.value;
    const isCustom = e.target.isCustom;
    
    if (isCustom && t && !customToStates.includes(t)) {
      setCustomToStates(prev => [...prev, t]);
    }
    
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
            <label htmlFor="species-select" className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">
              Species
              <span className="ml-2 text-xs text-slate-500 dark:text-gray-500">(type to add custom)</span>
            </label>
            <CreatableCombobox
              id="species-select"
              value={species}
              onChange={handleSpeciesChange}
              options={speciesList}
              placeholder="Select or type species..."
              allowCustom={true}
            />
            {scientificName && (
              <p className="mt-1 text-sm text-slate-600 dark:text-gray-400 italic">{scientificName}</p>
            )}
            {species && customSpecies.includes(species) && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Plus size={12} /> Custom species
              </p>
            )}
          </div>

          {/* From/To Conversion Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="from-state" className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300 flex items-center gap-2">
                From State
                <HelpTooltip
                  text="The starting form of the fish (e.g., Round = whole fish as caught)"
                  ariaLabel="Help: Information about From State"
                />
              </label>
              <CreatableCombobox
                id="from-state"
                value={fromState}
                onChange={handleFromChange}
                options={fromStates}
                placeholder="Select or type from state..."
                disabled={!species}
                allowCustom={true}
              />
              {fromState && customFromStates.includes(fromState) && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <Plus size={12} /> Custom state
                </p>
              )}
            </div>
            
            <div>
              <label htmlFor="to-product" className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300 flex items-center gap-2">
                To Product
                <HelpTooltip
                  text="The final form after processing"
                  ariaLabel="Help: Information about To Product"
                />
              </label>
              <CreatableCombobox
                id="to-product"
                value={toState}
                onChange={handleToChange}
                options={toStates.map(t => t.to)}
                placeholder="Select or type to product..."
                disabled={!fromState}
                allowCustom={true}
                renderOption={(opt) => {
                  const stateInfo = toStates.find(t => t.to === opt);
                  if (stateInfo && stateInfo.yield !== null) {
                    return (
                      <span>
                        {opt} <span className="text-slate-500 dark:text-gray-400">({stateInfo.yield}%{stateInfo.range ? `, ${stateInfo.range[0]}-${stateInfo.range[1]}%` : ''})</span>
                      </span>
                    );
                  }
                  return opt;
                }}
              />
              {toState && customToStates.includes(toState) && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <Plus size={12} /> Custom product
                </p>
              )}
            </div>
          </div>

          {/* Custom Values Notice */}
          {isUsingCustomValues && (
            <div className="bg-amber-50 dark:bg-amber-900/30 p-3 rounded-lg border border-amber-200 dark:border-amber-800 text-sm">
              <p className="text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <Info size={16} />
                You're using custom values. Please enter yield percentage manually.
              </p>
            </div>
          )}

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
                <label htmlFor="cost-per-pound" className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Cost per Pound ({fromState || 'Whole'})</label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-slate-500 dark:text-gray-500">$</span>
                  <input
                    id="cost-per-pound"
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
                <label htmlFor="target-output" className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Target Output (lbs of {toState || 'Product'})</label>
                <div className="relative">
                  <input
                    id="target-output"
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
              <label htmlFor="yield-percentage" className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Yield Percentage</label>
              <div className="relative">
                <input
                  id="yield-percentage"
                  type="number"
                  value={yieldPercent}
                  onChange={(e) => { setYieldPercent(e.target.value); setUseRangeMin(false); setUseRangeMax(false); }}
                  className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 pr-8 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                  placeholder="e.g. 45"
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
                <label htmlFor="processing-cost" className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Processing Cost</label>
                <div className="relative">
                  <span className="absolute left-3 top-3 text-slate-500 dark:text-gray-500">$</span>
                  <input
                    id="processing-cost"
                    type="number"
                    value={processingCost}
                    onChange={(e) => setProcessingCost(e.target.value)}
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg p-3 pl-8 focus:ring-2 focus:ring-cyan-500 outline-none text-slate-800 dark:text-white"
                    placeholder="0.00"
                  />
                </div>
              </div>
              
              <div>
                <label htmlFor="weight-type" className="block text-sm font-medium mb-2 text-slate-700 dark:text-gray-300">Applied To</label>
                <select
                  id="weight-type"
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
            disabled={!species || !toState || !yieldPercent}
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
                  {saveStatus && (
                    <p
                      className="text-sm mt-2 text-slate-700 dark:text-gray-300"
                      role="status"
                      aria-live="polite"
                    >
                      {saveStatus}
                    </p>
                  )}
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
