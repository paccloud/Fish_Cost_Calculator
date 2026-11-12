import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Download, HelpCircle, Minus, Plus, X } from 'lucide-react';
import { ACRONYMS, FISH_DATA_V3, PROFILES_DATA } from '../data/fish_data_v3';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { apiUrl } from '../config/api';
import { backendEnabled, isNativeApp, thisDevice } from '../config/platform';
import { parseAmount } from '../lib/numberInput';
import { withConversionStates, hasUsableConversions } from '../lib/fishDataShape';
import { mergeFishData } from '../lib/fishDataMerge';
import { readRecentSpecies, pushRecentSpecies, RECENT_SPECIES_LIMIT } from '../lib/recentSpecies';
import Notice from './Notice';
import Stamp from './Stamp';
import ChoiceTile from './calculator/ChoiceTile';
import ExtraCost from './calculator/ExtraCost';
import FieldError from './calculator/FieldError';
import HelpTip from './calculator/HelpTip';
import Segmented from './calculator/Segmented';
import Stepper from './calculator/Stepper';
import Ticket from './calculator/Ticket';
import { tapHaptic } from './calculator/haptics';
import { nameInSentence, tileName, REFERENCE_SOURCE, YOUR_YIELDS_FROM } from './calculator/names';
import { priceCardFor, savedPriceRecord, savePrice } from './calculator/priceActions';
import { readTicketOpen, readWhatToCharge, writeTicketOpen, writeWhatToCharge } from './calculator/remembered';
import { sharePriceCard } from './calculator/sharePrice';
import { buildTicketModel, marginProblem, portionProblem, yieldProblem, yieldSource } from './calculator/ticketModel';

const money = (n) => n.toFixed(2);
const plainNumber = (n) => String(Number(n.toFixed(2)));

const MODES = [
  { id: 'cost', label: 'Cost per lb' },
  { id: 'weight', label: 'Pounds to buy' },
];

const TO_LIMIT = 6;
const NO_YIELDS = [];
const NO_INITIAL = {};
// How long "Saved." and "Copied." stay up. A failure stays until the numbers change.
const NOTICE_MS = 8000;

const fieldLabel = 'block text-base font-bold text-text-primary';
// A small choice that is on or off. Pressed, its edge doubles in weight and turns teal with the
// words; the fill stays paper, because a teal fill is kept for the mode and the chosen tiles.
const chip =
  'rounded-lg border-2 border-line-strong bg-surface-raised text-text-primary transition-colors hover:border-accent aria-pressed:border-accent aria-pressed:text-accent aria-pressed:shadow-[inset_0_0_0_2px_var(--color-accent)]';

const StepHeading = ({ number, children, id }) => (
  <div className="flex items-center gap-3">
    <span
      aria-hidden="true"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-text-primary text-sm font-bold leading-none text-text-primary"
    >
      {number}
    </span>
    <h2 id={id} className="type-heading">{children}</h2>
  </div>
);

/**
 * The calculator screen: two numbered steps, and the answer on the ticket the whole time.
 *
 * `initial` is typed text to start from (species, fromState, toState, cost, yieldPercent, margin,
 * portion, …). The app starts blank; tests start from a worked example.
 */
const Calculator = ({ initial = NO_INITIAL }) => {
  const { user, getAuthHeaders } = useAuth();
  // Yields and saved prices are kept on this device first, and synced when there is signal
  const data = useData();
  const { customYields, refreshCustomYields, readOnly } = data;

  const [mode, setMode] = useState(initial.mode ?? 'cost');
  const [targetWeight, setTargetWeight] = useState(initial.targetWeight ?? '');
  const [species, setSpecies] = useState(initial.species ?? '');
  const [fromState, setFromState] = useState(initial.fromState ?? '');
  const [toState, setToState] = useState(initial.toState ?? '');
  const [showAllTo, setShowAllTo] = useState(false);
  const [cost, setCost] = useState(initial.cost ?? '');
  const [yieldPercent, setYieldPercent] = useState(initial.yieldPercent ?? '');
  const [processingCost, setProcessingCost] = useState(initial.processingCost ?? '');
  const [weightType, setWeightType] = useState(initial.weightType ?? 'incoming');
  const [shipping, setShipping] = useState(initial.shipping ?? '');
  const [shippingWeightType, setShippingWeightType] = useState(initial.shippingWeightType ?? 'outgoing');
  const [extrasOpen, setExtrasOpen] = useState(Boolean(initial.processingCost || initial.shipping));
  // Margin and portion size are remembered on this device; blank the first time
  const [charge, setCharge] = useState(() => {
    const remembered = readWhatToCharge();
    return { margin: initial.margin ?? remembered.margin, portion: initial.portion ?? remembered.portion };
  });
  const [recent, setRecent] = useState(() => readRecentSpecies());
  const [ticketOpen, setTicketOpen] = useState(() => readTicketOpen());
  // "Include what I paid" is a yes for one price. It holds the key of the price it was given for.
  const [paidOptIn, setPaidOptIn] = useState(null);
  // Which price the last save and the last notice were for, so both go as soon as a number changes
  const [savedKey, setSavedKey] = useState(null);
  const [notice, setNotice] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const containerRef = useRef(null);
  const dockRef = useRef(null);
  const savingRef = useRef(false);

  const [publicHistory, setPublicHistory] = useState([]);
  const [fishData, setFishData] = useState(() => withConversionStates(FISH_DATA_V3));
  const [profilesData, setProfilesData] = useState(PROFILES_DATA);

  useEffect(() => {
    fetch(apiUrl('/api/fish-data'))
      .then(res => res.json())
      .then(fresh => {
        // Keep the bundled reference yields unless the API sends usable conversions.
        const apiData = fresh.fishData ? withConversionStates(fresh.fishData) : null;
        if (hasUsableConversions(apiData)) setFishData(apiData);
        if (fresh.profiles && Object.keys(fresh.profiles).length > 0) setProfilesData(fresh.profiles);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!backendEnabled) return;
    fetch(apiUrl('/api/public-calcs'))
      .then(res => res.json())
      .then(rows => { if (Array.isArray(rows)) setPublicHistory(rows); })
      .catch(() => {});
  }, []);

  // The provider pulls once when it loads; opening the calculator again pulls too, so a yield
  // edited on another device shows up here as it did when this page fetched its own copy
  useEffect(() => {
    refreshCustomYields();
  }, [refreshCustomYields]);

  // Only a signed-in person's own yields: the guest scope can hold records no one here owns
  const myYields = user ? customYields : NO_YIELDS;
  const combinedData = useMemo(() => mergeFishData(fishData, myYields), [fishData, myYields]);

  const speciesList = Object.keys(combinedData).sort();
  const recentSpecies = recent.filter(name => combinedData[name]);

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
    ) ?? null;
  }, [species, fromState, toState, combinedData]);

  // When a sync changes the chosen conversion (edited or deleted on another device), follow it,
  // unless the yield was typed in by hand
  const conversionYield = currentConversion ? String(currentConversion.yield) : null;
  const [followedYield, setFollowedYield] = useState(conversionYield);
  if (conversionYield !== followedYield) {
    setFollowedYield(conversionYield);
    if (conversionYield === null && toState) {
      setToState(''); setYieldPercent('');
    } else if (conversionYield !== null && yieldPercent === followedYield) {
      setYieldPercent(conversionYield);
    }
  }

  const profile = species ? profilesData[species] : null;
  const scientificName = species && combinedData[species] ? combinedData[species].scientific_name : null;
  const yieldRange = currentConversion?.range || null;
  const speciesConversions = species ? conversionsFor(species) : [];
  const onlyYourYields = speciesConversions.length > 0 && speciesConversions.every(c => c.from === YOUR_YIELDS_FROM);

  const chooseFrom = (from) => {
    setFromState(from);
    setToState(''); setYieldPercent(''); setShowAllTo(false);
  };

  const chooseSpecies = (sp) => {
    setSpecies(sp);
    // Most people start from the whole fish, so pick it for them (or the only choice there is)
    const froms = [...new Set(conversionsFor(sp).map(c => c.from).filter(Boolean))];
    chooseFrom(froms.includes('Round') ? 'Round' : froms.length === 1 ? froms[0] : '');
    if (!sp) return;
    pushRecentSpecies(sp);
    // A species already in the row keeps its place, so the row does not shuffle under a thumb
    setRecent(shown => (shown.includes(sp) ? shown : [sp, ...shown].slice(0, RECENT_SPECIES_LIMIT)));
  };

  const chooseTo = (to) => {
    setToState(to);
    const conv = toStates.find(t => t.to === to);
    setYieldPercent(conv ? String(conv.yield) : '');
  };

  const { margin, portion } = charge;
  const marginError = marginProblem(margin);
  const portionError = portionProblem(portion);
  const changeCharge = (patch) => {
    const next = { ...charge, ...patch };
    setCharge(next);
    // Only what can be used is remembered: a slip of the thumb should not come back next visit
    writeWhatToCharge({
      margin: marginProblem(next.margin) ? '' : next.margin,
      portion: portionProblem(next.portion) ? '' : next.portion,
    });
  };

  // The answer is worked out live from what is on screen, so it can never describe different numbers
  const model = useMemo(() => buildTicketModel({
    mode, species, fromState, toState, cost, targetWeight, yieldPercent,
    processingCost, weightType, shipping, shippingWeightType,
    margin, portion, conversion: currentConversion,
  }), [
    mode, species, fromState, toState, cost, targetWeight, yieldPercent,
    processingCost, weightType, shipping, shippingWeightType, margin, portion, currentConversion,
  ]);

  const yieldError = yieldProblem(yieldPercent, currentConversion);
  const source = yieldSource(currentConversion, yieldPercent);

  // Everything a saved price is made of. Margin and portion are not part of it.
  const priceKey = JSON.stringify([
    mode, species, fromState, toState, cost, targetWeight, yieldPercent,
    processingCost, weightType, shipping, shippingWeightType,
  ]);
  const saved = savedKey === priceKey;
  // What someone paid is theirs to give away, one price at a time: a different fish, form or cost
  // needs a new yes. On a phone the checkbox can be folded away while Share is still in reach.
  const paidKey = JSON.stringify([species, fromState, toState, cost]);
  const includePaid = paidOptIn === paidKey;
  // What a shared card says. Margin, portion and the paid line are on it, so "Copied" goes as soon
  // as any of them changes: the clipboard no longer matches the ticket.
  const cardKey = JSON.stringify([priceKey, margin, portion, includePaid]);
  const noticeKey = notice && (notice.kind === 'copied' || notice.kind === 'share-failed') ? cardKey : priceKey;
  const shownNotice = notice && notice.key === noticeKey ? notice.kind : null;

  // Screen readers hear the answer once typing pauses, not on every keystroke
  const { sentence } = model;
  useEffect(() => {
    const timer = setTimeout(() => setAnnouncement(sentence), 900);
    return () => clearTimeout(timer);
  }, [sentence]);

  useEffect(() => {
    if (!notice || notice.kind.endsWith('failed')) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Tabbing or scrolling a field into view must not leave it under the pinned ticket (WCAG 2.4.11).
  // The dock's height is everything it covers: the ticket, any notice above it and the tab bar.
  useEffect(() => {
    const dock = dockRef.current;
    const container = containerRef.current;
    if (!dock || typeof ResizeObserver === 'undefined') return undefined;
    const root = document.documentElement;
    const apply = () => {
      root.style.scrollPaddingBottom = `${dock.offsetHeight + 16}px`;
      // <main> already clears the tab bar, so the screen only has to clear the rest of the dock
      if (container) container.style.paddingBottom = `calc(${dock.offsetHeight}px - var(--tabbar-height))`;
      // The ticket grows when a choice gives it more to say (a longer product name, a notice).
      // If that put it over the control in use, bring the control back above it.
      const focused = document.activeElement;
      if (focused && container?.contains(focused) && !dock.contains(focused)
        && focused.getBoundingClientRect().bottom > dock.getBoundingClientRect().top) {
        focused.scrollIntoView({ block: 'nearest' });
      }
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingBottom = '';
      if (container) container.style.paddingBottom = '';
    };
  }, []);

  const toggleTicket = () => {
    writeTicketOpen(!ticketOpen);
    setTicketOpen(!ticketOpen);
  };

  // Saved on this device first, for a guest and for someone signed in alike; the data layer
  // then syncs a signed-in person's record to their account
  const handleSave = async () => {
    if (saved || savingRef.current) return;
    const record = savedPriceRecord({ mode, species, fromState, toState, targetWeight: parseAmount(targetWeight) }, model);
    if (!record) return;
    const key = priceKey;
    savingRef.current = true;
    const outcome = await savePrice(data, record);
    savingRef.current = false;
    if (outcome === 'saved') {
      setSavedKey(key);
      setNotice({ key, kind: 'saved' });
      tapHaptic();
    } else if (outcome === 'failed') {
      setNotice({ key, kind: 'save-failed' });
    }
  };

  const handleShare = async () => {
    const key = cardKey;
    const outcome = await sharePriceCard(priceCardFor({ species, fromState, toState }, model, { includePaid }));
    if (outcome === 'copied') setNotice({ key, kind: 'copied' });
    else if (outcome === 'failed') setNotice({ key, kind: 'share-failed' });
    else if (outcome === 'shared') setNotice(null);
    // 'cancelled': the person closed the share sheet, which is not an error
  };

  const download = async (query, filename) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(apiUrl(`/api/export?${query}`), { headers });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
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

  const fromWords = nameInSentence(fromState, 'whole fish');
  const productWords = nameInSentence(toState, 'finished product');

  let yieldHint = 'Choose what you’re making to fill this in.';
  if (currentConversion?.from === YOUR_YIELDS_FROM) {
    yieldHint = 'Your own yield for this cut.';
  } else if (currentConversion && source?.tone === 'yours') {
    yieldHint = `Reference yield ${currentConversion.yield}%${yieldRange ? `, typical ${yieldRange[0]}–${yieldRange[1]}%` : ''}.`;
  } else if (currentConversion) {
    yieldHint = yieldRange
      ? 'How much is left after cutting. It changes with fish size and cutting skill.'
      : 'How much is left after cutting. No typical range is reported for this cut.';
  }

  // Processing and shipping are folded away until wanted, and open whenever either has a value
  const extrasHaveValue = processingCost.trim() !== '' || shipping.trim() !== '';
  const extrasShown = extrasOpen || extrasHaveValue;
  const toggleExtras = () => {
    if (extrasShown) { setProcessingCost(''); setShipping(''); }
    setExtrasOpen(!extrasShown);
  };
  let ExtrasIcon = Plus;
  let extrasLabel = 'Add processing or shipping';
  if (extrasHaveValue) { ExtrasIcon = X; extrasLabel = 'Remove processing and shipping'; }
  else if (extrasShown) { ExtrasIcon = Minus; extrasLabel = 'Hide processing and shipping'; }

  const notices = {
    saved: (
      <Notice title="Saved.">
        {user ? 'It’s in My yields, and goes to your account when there is signal.' : `It’s on ${thisDevice}, in My yields.`}
      </Notice>
    ),
    'save-failed': (
      <Notice tone="error" title="Not saved.">
        Nothing could be stored on {thisDevice}. Check that storage is allowed for this app, then save again.
      </Notice>
    ),
    copied: <Notice title="Copied.">Paste the price into a message or a note.</Notice>,
    'share-failed': (
      <Notice tone="error" title="Not shared.">
        This phone would not share or copy the price. Allow the clipboard for this app, then share again.
      </Notice>
    ),
  };

  return (
    <div ref={containerRef} className="mx-auto max-w-content space-y-4 pb-48">
      <h1 className="type-title">What does it really cost?</h1>

      <Segmented label="What to work out" options={MODES} value={mode} onChange={setMode} />

      {/* Step 1: the fish */}
      <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="step-fish">
        <StepHeading number="1" id="step-fish">Your fish</StepHeading>

        <div>
          <label htmlFor="calc-species" className={`mb-2 ${fieldLabel}`}>Species</label>
          {recentSpecies.length > 0 && (
            <div role="group" aria-label="Recent species" className="mb-2 flex flex-wrap items-center gap-2">
              <span aria-hidden="true" className="text-sm text-text-secondary">Recent</span>
              {recentSpecies.map(name => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={species === name}
                  onClick={() => chooseSpecies(name)}
                  className={`${chip} min-h-target px-3 text-sm font-semibold`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <select
            id="calc-species"
            value={species}
            onChange={(e) => chooseSpecies(e.target.value)}
            className="form-select min-h-tile border-2 bg-surface-raised text-lg font-semibold"
          >
            <option value="">Choose a species</option>
            {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {species && (
            <div className="mt-4 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
              <div className="min-w-0">
                <p className="type-species">{species}</p>
                {scientificName && <p className="type-latin">{scientificName}</p>}
              </div>
              {onlyYourYields ? <Stamp tone="yours">Your yields</Stamp> : <Stamp>{REFERENCE_SOURCE}</Stamp>}
            </div>
          )}
        </div>

        <fieldset disabled={!species} className="min-w-0">
          <legend className={`mb-2 flex items-center gap-2.5 ${fieldLabel}`}>
            What you have
            <HelpTip label="Help: what you have" text="The form of the fish you’re starting with. Round means the whole fish, as caught.">
              <HelpCircle size={18} className="text-text-secondary" aria-hidden="true" />
            </HelpTip>
          </legend>
          {species ? (
            fromStates.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {fromStates.map(f => {
                  const { name, code } = tileName(f);
                  return (
                    <ChoiceTile key={f} name="calc-from" value={f} checked={fromState === f} onChange={() => chooseFrom(f)} label={name} sub={code} />
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">There are no yields for this species yet.</p>
            )
          ) : (
            <p className="text-sm text-text-secondary">Choose a species first.</p>
          )}
        </fieldset>

        <fieldset disabled={!fromState} className="min-w-0">
          <legend className={`mb-2 flex items-center gap-2.5 ${fieldLabel}`}>
            What you’re making
            <HelpTip label="Help: what you’re making" text="The finished cut or product you’ll sell, such as a skinless fillet.">
              <HelpCircle size={18} className="text-text-secondary" aria-hidden="true" />
            </HelpTip>
          </legend>
          {fromState ? (
            <>
              <div id="calc-to-list" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {shownTo.map(t => {
                  const { name, code } = tileName(t.to);
                  return (
                    <ChoiceTile
                      key={t.to}
                      name="calc-to"
                      value={t.to}
                      checked={toState === t.to}
                      onChange={() => chooseTo(t.to)}
                      label={name}
                      sub={`${t.yield}% yield`}
                      code={code}
                    />
                  );
                })}
              </div>
              {toStates.length > TO_LIMIT && (
                <button
                  type="button"
                  aria-controls="calc-to-list"
                  aria-expanded={showAllTo}
                  onClick={() => setShowAllTo(s => !s)}
                  className="mt-2 min-h-control rounded px-1 text-base font-bold text-link underline underline-offset-4"
                >
                  {showAllTo ? 'Show fewer products' : `Show all ${toStates.length} products`}
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-text-secondary">Choose what you have first.</p>
          )}
        </fieldset>

        {/* The trade codes on the tiles, spelled out beside the tiles they explain */}
        <details className="group">
          <summary className="flex min-h-target cursor-pointer list-none items-center gap-2 rounded text-sm font-semibold text-accent [&::-webkit-details-marker]:hidden">
            <HelpCircle size={18} className="shrink-0" aria-hidden="true" />
            What do D/H-On, S/B and Round mean?
            <ChevronDown size={18} className="shrink-0 group-open:rotate-180" aria-hidden="true" />
          </summary>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 pb-1 pt-2 sm:grid-cols-2">
            {Object.entries(ACRONYMS).map(([abbr, full]) => (
              <div key={abbr}>
                <dt className="text-sm font-bold text-text-primary">{abbr}</dt>
                <dd className="text-sm text-text-secondary">{full.split(' - ')[0]}</dd>
              </div>
            ))}
          </dl>
        </details>

        {profile && (
          <div className="max-w-measure space-y-1 text-sm text-text-secondary">
            {profile.description && <p>{profile.description}</p>}
            {profile.edible_portions && (
              <p><span className="font-semibold">Edible portions: </span>{profile.edible_portions}</p>
            )}
            {/* The store app has no links that open a browser */}
            {profile.url && !isNativeApp && (
              <a
                href={profile.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-target items-center rounded font-semibold text-link underline underline-offset-4"
              >
                Read more about {species}
              </a>
            )}
          </div>
        )}
      </section>

      {/* Step 2: the numbers */}
      <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="step-numbers">
        <StepHeading number="2" id="step-numbers">Your numbers</StepHeading>

        {mode === 'cost' ? (
          <div className="space-y-2">
            <label htmlFor="calc-cost" className={fieldLabel}>
              What you pay per lb <span className="font-normal text-text-secondary">{fromWords}</span>
            </label>
            <Stepper
              id="calc-cost"
              value={cost}
              onChange={setCost}
              step={0.25}
              format={money}
              prefix="$"
              placeholder="0.00"
              lessLabel="Lower the price by 25 cents"
              moreLabel="Raise the price by 25 cents"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="calc-target" className={fieldLabel}>
              How much you need <span className="font-normal text-text-secondary">lbs of {productWords}</span>
            </label>
            <Stepper
              id="calc-target"
              value={targetWeight}
              onChange={setTargetWeight}
              step={10}
              format={plainNumber}
              suffix="lbs"
              placeholder="0"
              lessLabel="Lower the weight by 10 lbs"
              moreLabel="Raise the weight by 10 lbs"
            />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <label htmlFor="calc-yield" className={fieldLabel}>Yield</label>
            {source && <span id="calc-yield-source" className="inline-flex"><Stamp tone={source.tone}>{source.text}</Stamp></span>}
          </div>
          <Stepper
            id="calc-yield"
            value={yieldPercent}
            onChange={setYieldPercent}
            step={1}
            format={plainNumber}
            suffix="%"
            placeholder="0"
            lessLabel="Lower the yield by 1 point"
            moreLabel="Raise the yield by 1 point"
            describedBy={[yieldError && 'calc-yield-error', source && 'calc-yield-source', 'calc-yield-hint'].filter(Boolean).join(' ')}
            invalid={Boolean(yieldError)}
          />
          {yieldError && <FieldError id="calc-yield-error">{yieldError}</FieldError>}
          <p id="calc-yield-hint" className="text-sm text-text-secondary">{yieldHint}</p>
          {presets.length > 0 && (
            <div role="group" aria-label="Typical yields" className="grid grid-cols-3 gap-2">
              {presets.map(([name, value]) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={parseAmount(yieldPercent) === value}
                  onClick={() => setYieldPercent(String(value))}
                  className={`${chip} min-h-control px-2 text-sm font-bold leading-tight`}
                >
                  {name}<br /><span className="tabular-nums">{value}%</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === 'cost' && (
          <>
            <div className="space-y-5">
              <button
                type="button"
                aria-expanded={extrasShown}
                aria-controls="calc-extras"
                onClick={toggleExtras}
                className="btn-ghost -ml-3 text-left text-base"
              >
                <ExtrasIcon size={20} className="shrink-0" aria-hidden="true" />
                {extrasLabel}
              </button>
              <div id="calc-extras" hidden={!extrasShown} className="space-y-6">
                {extrasShown && (
                  <>
                    <ExtraCost
                      id="calc-processing"
                      title="Processing"
                      amount={processingCost}
                      onAmount={setProcessingCost}
                      basis={weightType}
                      onBasis={setWeightType}
                      basisLegend="Your processor charges on"
                      fromWords={fromWords}
                      productWords={productWords}
                      perFinishedLb={model.breakdown?.processing ?? 0}
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
                      fromWords={fromWords}
                      productWords={productWords}
                      perFinishedLb={model.breakdown?.shipping ?? 0}
                      yieldPercent={yieldPercent}
                    />
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4 border-t border-line-subtle pt-5">
              <h3 className={fieldLabel}>
                What to charge <span className="font-normal text-text-secondary">optional</span>
              </h3>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="calc-margin" className="block text-sm font-semibold text-text-primary">Your margin</label>
                  <Stepper
                    id="calc-margin"
                    value={margin}
                    onChange={(value) => changeCharge({ margin: value })}
                    step={1}
                    format={plainNumber}
                    suffix="%"
                    placeholder="0"
                    lessLabel="Lower the margin by 1 point"
                    moreLabel="Raise the margin by 1 point"
                    describedBy={marginError ? 'calc-margin-error calc-margin-hint' : 'calc-margin-hint'}
                    invalid={Boolean(marginError)}
                  />
                  {marginError && <FieldError id="calc-margin-error">{marginError}</FieldError>}
                  <p id="calc-margin-hint" className="text-sm text-text-secondary">The share of the sell price you keep.</p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="calc-portion" className="block text-sm font-semibold text-text-primary">Portion size</label>
                  <Stepper
                    id="calc-portion"
                    value={portion}
                    onChange={(value) => changeCharge({ portion: value })}
                    step={1}
                    format={plainNumber}
                    suffix="oz"
                    placeholder="0"
                    lessLabel="Lower the portion by 1 oz"
                    moreLabel="Raise the portion by 1 oz"
                    describedBy={portionError ? 'calc-portion-error calc-portion-hint' : 'calc-portion-hint'}
                    invalid={Boolean(portionError)}
                  />
                  {portionError && <FieldError id="calc-portion-error">{portionError}</FieldError>}
                  <p id="calc-portion-hint" className="text-sm text-text-secondary">One serving, in ounces.</p>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Where saved prices live. With no accounts (the store app) there is nothing to say. */}
      {backendEnabled && !user && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-text-secondary">
            Saved prices stay on {thisDevice}. Signing in keeps them across your devices.
          </p>
          <Link to="/login" className="btn-ghost shrink-0">Sign in</Link>
        </div>
      )}
      {backendEnabled && user && (
        <div role="group" aria-label="Download your saved prices" className="flex flex-wrap items-center gap-x-1 text-sm text-text-secondary">
          <span className="mr-2">Your saved prices:</span>
          <button type="button" onClick={() => download('type=calcs', 'calculations.csv')} className="btn-ghost">
            <Download size={16} aria-hidden="true" /> Download CSV
          </button>
          <button type="button" onClick={() => download('type=calcs&format=xlsx', 'calculations.xlsx')} className="btn-ghost">
            <Download size={16} aria-hidden="true" /> Download Excel
          </button>
        </div>
      )}

      {/* Prices other people chose to publish */}
      {publicHistory.length > 0 && (
        <section className="card p-5 sm:p-6" aria-labelledby="community-prices">
          <h2 id="community-prices" className="type-heading mb-3">Recent community prices</h2>
          <ul className="divide-y divide-line-subtle">
            {publicHistory.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="break-words text-base font-medium text-text-primary">{c.name || c.species}</p>
                  <p className="mt-0.5 text-sm text-text-secondary">{c.product} · {c.yield}% yield</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold tabular-nums text-text-primary">
                    ${parseFloat(c.result).toFixed(2)}/lb
                  </p>
                  <p className="text-sm text-text-secondary">
                    {new Date(c.date).toLocaleDateString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The answer, pinned to the bottom of the screen so it is always in view while numbers change */}
      <Ticket
        dockRef={dockRef}
        model={model}
        notice={shownNotice ? notices[shownNotice] : null}
        open={ticketOpen}
        onToggle={toggleTicket}
        onSave={handleSave}
        saved={saved}
        saveDisabled={readOnly}
        onShare={handleShare}
        includePaid={includePaid}
        onIncludePaid={(on) => setPaidOptIn(on ? paidKey : null)}
      />
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
};

export default Calculator;
