import React, { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Save, X, AlertCircle, CheckCircle, Download, Share2, EyeOff, Globe, Lock, RefreshCw, Smartphone, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { createYieldShareFlow } from '../lib/yieldSharing';
import ShareYieldModal from './ShareYieldModal';
import { yieldsToCSV, downloadText } from '../lib/dataExport';

const TITLE = 'font-display text-3xl font-semibold text-text-primary';
const HEADING = 'font-display text-xl font-semibold text-text-primary';
const INLINE_LINK = 'font-semibold text-link underline underline-offset-2';
const ROW_ACTION = 'btn-ghost disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:no-underline';
const ROW_STATUS = 'inline-flex items-center gap-1.5 text-sm text-text-secondary';
// What the form and the server fill in when no source was given; not worth showing.
const DEFAULT_SOURCE = 'User Input';

// "48.00" from the server reads as 48; a typed decimal (45.5) is kept.
function formatPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : String(value ?? '');
}

// A saved price is a cost per lb, unless it was saved from "Pounds to buy".
function describeResult(calc) {
  const n = Number(calc.result);
  if (!Number.isFinite(n)) return '';
  if (calc.mode === 'weight') return `${Number(n.toFixed(2))} lb to buy`;
  return `$${n.toFixed(2)}/lb`;
}

function calcLabel(calc) {
  return [calc.species, calc.product].filter(Boolean).join(', ') || calc.name || 'saved price';
}

const StatusNotice = ({ status, onDismiss }) => {
  const ok = status.type === 'success';
  return (
    <div
      role={ok ? 'status' : 'alert'}
      className={`mb-6 flex items-start gap-3 rounded-lg border bg-surface-raised p-4 ${ok ? 'border-success' : 'border-danger'}`}
    >
      {ok
        ? <CheckCircle size={20} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        : <AlertCircle size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />}
      <p className="min-w-0 flex-1 break-words text-base text-text-primary">{status.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:text-text-primary"
      >
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
};

const SavedPriceList = ({ calcs, signedIn, readOnly, onDelete, onPublish, onUnpublish }) => (
  <ul className="divide-y divide-line-subtle">
    {calcs.map((calc) => {
      const label = calcLabel(calc);
      const autoName = `${calc.species} - ${calc.product}`;
      const yieldText = Number(calc.yield) > 0 ? `${formatPercent(calc.yield)}% yield` : '';
      return (
        <li key={calc.id} className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="break-words font-display text-xl font-semibold text-text-primary">
                {calc.species || calc.name || 'Saved price'}
              </p>
              <p className="break-words text-base text-text-secondary">
                {[calc.product, yieldText].filter(Boolean).join(' · ')}
              </p>
              {calc.species && calc.name && calc.name !== autoName && (
                <p className="break-words text-sm text-text-secondary">Saved as “{calc.name}”</p>
              )}
              {signedIn && (
                <p className="mt-1">
                  {calc.is_private === false ? (
                    <span className={ROW_STATUS}><Globe size={16} aria-hidden="true" />Public</span>
                  ) : (
                    <span className={ROW_STATUS}><Lock size={16} aria-hidden="true" />Private</span>
                  )}
                </p>
              )}
            </div>
            <p className="shrink-0 text-right text-lg font-bold tabular-nums text-text-primary">
              {describeResult(calc)}
            </p>
          </div>
          <div className="-mx-3 mt-1 flex flex-wrap gap-x-1">
            {signedIn && calc.serverId && (
              calc.is_private === false ? (
                <button
                  type="button"
                  onClick={() => onUnpublish(calc)}
                  disabled={readOnly}
                  className={ROW_ACTION}
                  aria-label={`Unpublish ${label}`}
                  title="Make private"
                >
                  <EyeOff size={18} aria-hidden="true" />
                  Unpublish
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onPublish(calc)}
                  disabled={readOnly}
                  className={ROW_ACTION}
                  aria-label={`Publish ${label}`}
                  title="Publish to community feed"
                >
                  <Globe size={18} aria-hidden="true" />
                  Publish
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => onDelete(calc)}
              disabled={readOnly}
              className={`${ROW_ACTION} text-danger`}
              aria-label={`Delete ${label}`}
            >
              <Trash2 size={18} aria-hidden="true" />
              Delete
            </button>
          </div>
        </li>
      );
    })}
  </ul>
);

const YieldList = ({ yields, signedIn, readOnly, onToggleShare, onEdit, onDelete }) => (
  <ul className="divide-y divide-line-subtle">
    {yields.map((item) => {
      const label = [item.species, item.product].filter(Boolean).join(', ');
      return (
        <li key={item.id} className="px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="break-words font-display text-xl font-semibold text-text-primary">{item.species}</p>
              <p className="break-words text-base text-text-secondary">{item.product}</p>
              {item.source && item.source !== DEFAULT_SOURCE && (
                <p className="break-words text-sm text-text-secondary">Source: {item.source}</p>
              )}
              {signedIn && (item.is_shared || item.syncStatus === 'local' || item.syncStatus === 'pending-delete') && (
                <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {item.is_shared ? (
                    <span className={ROW_STATUS}><Users size={16} aria-hidden="true" />Shared with the community</span>
                  ) : null}
                  {item.syncStatus === 'local' || item.syncStatus === 'pending-delete' ? (
                    <span className={ROW_STATUS}>
                      <RefreshCw size={16} aria-hidden="true" />
                      {item.syncStatus === 'pending-delete' ? 'Deleting…' : 'Waiting to sync'}
                    </span>
                  ) : null}
                </p>
              )}
            </div>
            <p className="shrink-0 text-right text-lg font-bold tabular-nums text-text-primary">
              {formatPercent(item.yield)}%
              <span className="block text-sm font-normal text-text-secondary">yield</span>
            </p>
          </div>
          <div className="-mx-3 mt-1 flex flex-wrap gap-x-1">
            {signedIn && item.serverId && (
              <button
                type="button"
                onClick={() => onToggleShare(item)}
                disabled={readOnly}
                className={ROW_ACTION}
                aria-label={`${item.is_shared ? 'Stop sharing' : 'Share'} ${label}`}
                title={item.is_shared ? 'Remove from community' : 'Share with community'}
              >
                {item.is_shared ? <EyeOff size={18} aria-hidden="true" /> : <Share2 size={18} aria-hidden="true" />}
                {item.is_shared ? 'Stop sharing' : 'Share'}
              </button>
            )}
            {signedIn && (
              <button
                type="button"
                onClick={() => onEdit(item)}
                disabled={readOnly}
                className={ROW_ACTION}
                aria-label={`Edit ${label}`}
              >
                <Pencil size={18} aria-hidden="true" />
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(item)}
              disabled={readOnly}
              className={`${ROW_ACTION} text-danger`}
              aria-label={`Delete ${label}`}
            >
              <Trash2 size={18} aria-hidden="true" />
              Delete
            </button>
          </div>
        </li>
      );
    })}
  </ul>
);

const DataManagement = () => {
  const { user, getAuthHeaders } = useAuth();
  const { customYields, savedCalcs, dataLoaded, addYield, updateYield, removeYield, removeCalc, updateYieldLocalOnly, requestPublish, unpublishCalc, readOnly } = useData();
  const [status, setStatus] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [formData, setFormData] = useState({
    species: '',
    product: '',
    yield: '',
    source: DEFAULT_SOURCE,
  });

  // Share-with-community confirmation (issue #26): sharing opens a preview of
  // the public fields + attribution; only confirming calls the share API.
  const [sharePending, setSharePending] = useState(null);
  const [shareFlow] = useState(() => createYieldShareFlow({
    client: apiClient,
    onPendingChange: setSharePending,
  }));
  useEffect(() => {
    shareFlow.configure({
      getHeaders: () => getAuthHeaders(),
      onSharingChanged: (item, isShared) => updateYieldLocalOnly(item.id, { is_shared: isShared }),
    });
  }, [shareFlow, getAuthHeaders, updateYieldLocalOnly]);

  // "Add a yield" is replaced by the form while it is open; when the form
  // closes, hand focus back to the button instead of dropping it.
  const formOpen = showForm && !readOnly;
  const addButtonRef = useRef(null);
  const formWasOpen = useRef(false);
  useEffect(() => {
    if (formWasOpen.current && !formOpen) addButtonRef.current?.focus();
    formWasOpen.current = formOpen;
  }, [formOpen]);

  const reportShareResult = (result) => {
    if (result.ok && result.action === 'share') {
      setStatus({ type: 'success', message: 'Shared with the community.' });
    } else if (result.ok && result.action === 'unshare') {
      setStatus({ type: 'success', message: 'No longer shared with the community.' });
    } else if (!result.ok && result.error) {
      setStatus({ type: 'error', message: result.error });
    }
  };

  const handleToggleShare = async (item) => {
    reportShareResult(await shareFlow.toggle(item));
  };

  const handleConfirmShare = async () => {
    const result = await shareFlow.confirm();
    // A failure with the dialog still open is shown inside the dialog; a
    // page-level banner would render behind it.
    if (result.ok || !shareFlow.getPending()) reportShareResult(result);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        const updated = await updateYield(editingId, {
          species: formData.species,
          product: formData.product,
          yield: parseFloat(formData.yield),
          source: formData.source,
        });
        if (!updated) {
          // Deleted on another device while open here: keep what was typed and let them add it back
          setEditingId(null);
          setStatus({ type: 'error', message: 'This yield was deleted on another device. Save to add it back.' });
          return;
        }
        setStatus({ type: 'success', message: 'Yield updated.' });
      } else {
        await addYield({
          species: formData.species,
          product: formData.product,
          yield: parseFloat(formData.yield),
          source: formData.source,
        });
        setStatus({ type: 'success', message: 'Yield added.' });
      }
      resetForm();
    } catch {
      setStatus({ type: 'error', message: 'That yield wasn’t saved. Check the species, product and yield, then save again.' });
    }
  };

  const handleEdit = (item) => {
    setFormData({
      species: item.species,
      product: item.product,
      yield: String(item.yield),
      source: item.source || DEFAULT_SOURCE,
    });
    setEditingId(item.id);
    setShowForm(true);
  };

  const handleDelete = async (item) => {
    const where = user ? '' : ' from this phone';
    if (!window.confirm(`Delete your yield for ${[item.species, item.product].filter(Boolean).join(', ')}${where}?`)) return;
    try {
      await removeYield(item.id);
      setStatus({ type: 'success', message: 'Yield deleted.' });
    } catch {
      setStatus({ type: 'error', message: 'That yield wasn’t deleted. Try again.' });
    }
  };

  const handleDeleteCalc = async (calc) => {
    const where = user ? '' : ' from this phone';
    if (!window.confirm(`Delete the saved price for ${calcLabel(calc)}${where}?`)) return;
    try {
      await removeCalc(calc.id);
      setStatus({ type: 'success', message: 'Saved price deleted.' });
    } catch {
      setStatus({ type: 'error', message: 'That saved price wasn’t deleted. Try again.' });
    }
  };

  const resetForm = () => {
    setFormData({ species: '', product: '', yield: '', source: DEFAULT_SOURCE });
    setEditingId(null);
    setShowForm(false);
  };

  // A guest sees what is saved on this phone. Nothing here needs an account.
  if (!user) {
    const hasSaved = savedCalcs.length > 0 || customYields.length > 0;
    return (
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className={TITLE}>My yields</h1>
          <p className="mt-2 text-base text-text-secondary">
            Your saved prices and the yields you measured yourself.
          </p>
        </header>

        {status && <StatusNotice status={status} onDismiss={() => setStatus(null)} />}

        {!dataLoaded ? (
          <p role="status" className="text-base text-text-secondary">Loading what’s saved on this phone…</p>
        ) : !hasSaved ? (
          <section className="card p-5 sm:p-6">
            <h2 className={HEADING}>Nothing saved on this phone yet</h2>
            <p className="mt-2 text-base text-text-secondary">
              Prices you save from the calculator show up here. They stay on this phone until you sign in.
              Already have an account? <Link to="/login" className={INLINE_LINK}>Sign in</Link> to see your yields.
            </p>
            <Link to="/" className="btn-primary mt-5">Go to the calculator</Link>
          </section>
        ) : (
          <div className="space-y-6">
            <section className="card flex flex-wrap items-center justify-between gap-4 p-5" aria-label="Where this is saved">
              <p className="flex min-w-0 flex-1 basis-64 items-start gap-3 text-base text-text-primary">
                <Smartphone size={20} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
                <span>Saved on this phone until you sign in. Sign in to keep it on every device.</span>
              </p>
              <Link to="/login" className="btn-primary">Sign in</Link>
            </section>

            {savedCalcs.length > 0 && (
              <section className="card overflow-hidden" aria-labelledby="saved-prices-heading">
                <div className="border-b border-line p-5">
                  <h2 id="saved-prices-heading" className={HEADING}>Saved prices</h2>
                </div>
                <SavedPriceList calcs={savedCalcs} signedIn={false} readOnly={readOnly} onDelete={handleDeleteCalc} />
              </section>
            )}

            {customYields.length > 0 && (
              <section className="card overflow-hidden" aria-labelledby="your-yields-heading">
                <div className="border-b border-line p-5">
                  <h2 id="your-yields-heading" className={HEADING}>Your yields</h2>
                </div>
                <YieldList yields={customYields} signedIn={false} readOnly={readOnly} onDelete={handleDelete} />
              </section>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-8">
        <h1 className={TITLE}>My yields</h1>
        <p className="mt-2 text-base text-text-secondary">
          The yields you measured yourself, and the prices you saved.
        </p>
        <Link to="/profile" className="btn-ghost -mx-3 mt-1 text-base">
          Change how your name appears
        </Link>
      </header>

      {status && <StatusNotice status={status} onDismiss={() => setStatus(null)} />}

      <div className="space-y-6">
        {/* Your yields */}
        <section className="card overflow-hidden" aria-labelledby="your-yields-heading">
          <div className="border-b border-line p-5">
            <h2 id="your-yields-heading" className={HEADING}>Your yields</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              {!formOpen && (
                <button
                  ref={addButtonRef}
                  type="button"
                  onClick={() => setShowForm(true)}
                  disabled={readOnly}
                  className="btn-primary flex-1 whitespace-nowrap px-4 sm:flex-none sm:px-5"
                >
                  <Plus size={20} aria-hidden="true" />
                  Add a yield
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const csv = yieldsToCSV(customYields.filter(y => y.syncStatus !== 'pending-delete'));
                  downloadText(csv, 'custom-yield-data.csv');
                }}
                className="btn-secondary flex-1 whitespace-nowrap px-4 sm:flex-none sm:px-5"
                disabled={customYields.length === 0}
                title="Download your yields as a CSV (works offline)"
              >
                <Download size={20} aria-hidden="true" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Add/Edit Form */}
          {formOpen && (
            <div className="border-b border-line p-5">
              <h3 className="text-lg font-semibold text-text-primary">
                {editingId ? 'Edit this yield' : 'Add a yield'}
              </h3>

              <form key={editingId || 'new'} onSubmit={handleSubmit} className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="yield-species" className="form-label">Species</label>
                    <input
                      id="yield-species"
                      type="text"
                      value={formData.species}
                      onChange={(e) => setFormData({ ...formData, species: e.target.value })}
                      className="form-input"
                      placeholder="e.g. Atlantic Salmon"
                      autoFocus
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="yield-product" className="form-label">Product</label>
                    <input
                      id="yield-product"
                      type="text"
                      value={formData.product}
                      onChange={(e) => setFormData({ ...formData, product: e.target.value })}
                      className="form-input"
                      placeholder="e.g. Skinless Fillet"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="yield-percent" className="form-label">Yield (%)</label>
                    <input
                      id="yield-percent"
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      max="100"
                      value={formData.yield}
                      onChange={(e) => setFormData({ ...formData, yield: e.target.value })}
                      className="form-input"
                      placeholder="e.g. 45"
                      aria-describedby="yield-percent-help"
                      required
                    />
                    <p id="yield-percent-help" className="mt-1.5 text-sm text-text-muted">
                      The share of the weight you keep, up to 100.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="yield-source" className="form-label">Source or notes</label>
                    <input
                      id="yield-source"
                      type="text"
                      value={formData.source}
                      onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                      className="form-input"
                      placeholder="e.g. Personal experience"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button type="submit" className="btn-primary flex-1 sm:flex-none">
                    <Save size={20} aria-hidden="true" />
                    {editingId ? 'Save changes' : 'Save yield'}
                  </button>
                  <button type="button" onClick={resetForm} className="btn-secondary flex-1 sm:flex-none">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {!dataLoaded ? (
            <p role="status" className="p-5 text-base text-text-secondary">Loading your yields…</p>
          ) : customYields.length === 0 ? (
            <p className="p-5 text-base text-text-secondary">
              No yields of your own yet. Weigh a fish before and after you cut it, then use Add a yield to keep the number.
            </p>
          ) : (
            <YieldList
              yields={customYields}
              signedIn
              readOnly={readOnly}
              onToggleShare={handleToggleShare}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          )}
        </section>

        {/* Saved prices */}
        <section className="card overflow-hidden" aria-labelledby="saved-prices-heading">
          <div className="border-b border-line p-5">
            <h2 id="saved-prices-heading" className={HEADING}>Saved prices</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Publish a saved price to share it anonymously on the community feed.
            </p>
          </div>

          {!dataLoaded ? (
            <p role="status" className="p-5 text-base text-text-secondary">Loading your saved prices…</p>
          ) : savedCalcs.length === 0 ? (
            <div className="p-5">
              <p className="text-base text-text-secondary">
                No saved prices yet. Save one from the calculator and it shows up here.
              </p>
              <Link to="/" className="btn-secondary mt-4">Go to the calculator</Link>
            </div>
          ) : (
            <SavedPriceList
              calcs={savedCalcs}
              signedIn
              readOnly={readOnly}
              onDelete={handleDeleteCalc}
              onPublish={requestPublish}
              onUnpublish={unpublishCalc}
            />
          )}
        </section>
      </div>

      {sharePending && (
        <ShareYieldModal
          pending={sharePending}
          onConfirm={handleConfirmShare}
          onCancel={shareFlow.cancel}
        />
      )}
    </div>
  );
};

export default DataManagement;
