import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudOff, LogIn, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFirebaseAuth } from '../context/FirebaseAuthContext';
import { useCustomYields } from '../hooks/useCustomYields';
import { conversionLabel, hasStartingForm, validateCustomYield } from '../lib/customYield';
import PendingWritesModal from './PendingWritesModal';

// My data (ADR 0003, issue #123): the person's custom yields in Firestore.
// This is the first page on the new data layer; the Neon-backed pages stay
// alongside it until #133.

const EMPTY_FORM = { species: '', from: '', to: '', yield: '', source: '' };

function describeError(error) {
  if (!error) return '';
  if (error.code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return '';
  if (error.code === 'permission-denied') return "This record can't be changed with the account you're signed in with.";
  return error.message || 'Something went wrong. Please try again.';
}

export default function MyData() {
  const { user, status, signInWithGoogle, signOut } = useFirebaseAuth();
  const { customYields, loaded, error: loadError, addYield, updateYield, removeYield } = useCustomYields();

  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [signOutPrompt, setSignOutPrompt] = useState(null); // null | 'ask' | 'waiting'
  const promptRef = useRef(null);
  const speciesInputRef = useRef(null);

  useEffect(() => {
    if (showForm) speciesInputRef.current?.focus();
  }, [showForm]);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    if (fieldErrors[name]) setFieldErrors((current) => ({ ...current, [name]: undefined }));
  }

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setMessage('');
    setShowForm(true);
  }

  function startEdit(record) {
    setEditingId(record.id);
    setForm({ species: record.species, from: record.from, to: record.to, yield: String(record.yield), source: record.source });
    setFieldErrors({});
    setMessage('');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
  }

  function handleSubmit(e) {
    e.preventDefault();
    const result = validateCustomYield(form);
    if (!result.ok) {
      setFieldErrors(result.errors);
      return;
    }
    // Not awaited: the snapshot listener shows the record at once, and when
    // offline the promise only settles after the connection returns.
    const existing = editingId ? customYields.find((y) => y.id === editingId) : null;
    const write = editingId ? updateYield(editingId, result.value, existing) : addYield(result.value);
    write.catch((err) => setMessage(describeError(err)));
    setMessage(editingId ? 'Custom yield updated.' : 'Custom yield added.');
    closeForm();
  }

  function handleDelete(id) {
    setConfirmDeleteId(null);
    removeYield(id).catch((err) => setMessage(describeError(err)));
    setMessage('Custom yield deleted.');
  }

  async function handleSignIn() {
    setMessage('');
    try {
      await signInWithGoogle();
    } catch (err) {
      setMessage(describeError(err));
    }
  }

  // The sign-out flow asks what to do when changes have not reached the
  // cloud; the modal answers through promptRef (see lib/firebaseSignOut.js).
  function askWhatToDo() {
    return new Promise((resolve) => {
      let giveUp;
      const cancelled = new Promise((res) => { giveUp = res; });
      promptRef.current = {
        wait: () => { setSignOutPrompt('waiting'); resolve({ choice: 'wait', cancelled }); },
        discard: () => resolve('discard'),
        cancel: () => { giveUp(); resolve('cancel'); },
      };
      setSignOutPrompt('ask');
    });
  }

  async function handleSignOut() {
    setMessage('');
    try {
      const result = await signOut({ askWhatToDo });
      if (result.done && !result.cacheCleared) {
        setMessage("You're signed out, but this browser still holds a copy of your data because the app is open in another tab. Close the other tabs and sign in and out again to clear it.");
      } else if (result.done && result.discarded) {
        setMessage('Signed out. The changes that had not reached the cloud were discarded.');
      }
    } catch (err) {
      setMessage(describeError(err));
    } finally {
      setSignOutPrompt(null);
      promptRef.current = null;
    }
  }

  const title = (
    <h1 className="text-2xl sm:text-3xl font-bold text-text-primary">My data</h1>
  );

  if (status === 'loading') {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {title}
        <p className="text-sm text-text-muted">Loading…</p>
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {title}
        <div className="card p-6 text-sm text-text-secondary">
          Cloud storage isn't set up for this copy of the app, so custom yields can't be kept here yet.
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        {title}
        <div className="card p-6 space-y-4">
          <p className="text-sm text-text-secondary">
            Sign in to keep the yields you measure yourself and use them in the calculator on any device.
          </p>
          <button onClick={handleSignIn} className="btn-primary inline-flex items-center gap-2">
            <LogIn size={16} /> Continue with Google
          </button>
          {message && <p role="alert" className="text-sm text-danger">{message}</p>}
          <p className="text-xs text-text-muted">
            Looking for the data you added before? It's still under <Link to="/manage-data" className="text-link hover:underline">Manage data (old)</Link> after signing in there.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title}
        <div className="flex items-center gap-3">
          <span className="max-w-[14rem] truncate text-sm text-text-secondary">{user.email || user.displayName}</span>
          <button
            onClick={handleSignOut}
            className="min-h-[2.5rem] text-sm font-medium px-3 rounded-lg border border-border text-text-secondary hover:text-text-primary transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {message && (
        <p role="status" className="text-sm text-text-secondary">{message}</p>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-danger">{describeError(loadError)}</p>
      )}

      <div className="card p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text-primary">Custom yields</h2>
          {!showForm && (
            <button onClick={startAdd} className="btn-primary inline-flex items-center gap-1.5 text-sm">
              <Plus size={16} /> Add a yield
            </button>
          )}
        </div>
        <p className="text-sm text-text-muted">
          A custom yield is a conversion you measured yourself: a species, the starting form, the finished product and the share of weight kept. Only you can see it.
        </p>

        {showForm && (
          <form onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2 border-t border-border pt-4">
            <div className="sm:col-span-2">
              <label htmlFor="cy-species" className="form-label">Species</label>
              <input id="cy-species" ref={speciesInputRef} className="form-input" value={form.species} onChange={(e) => setField('species', e.target.value)} aria-invalid={Boolean(fieldErrors.species)} aria-describedby={fieldErrors.species ? 'cy-species-error' : undefined} />
              {fieldErrors.species && <p id="cy-species-error" className="mt-1 text-xs text-danger">{fieldErrors.species}</p>}
            </div>
            <div>
              <label htmlFor="cy-from" className="form-label">Starting form <span className="text-text-muted font-normal">(e.g. Round)</span></label>
              <input id="cy-from" className="form-input" value={form.from} onChange={(e) => setField('from', e.target.value)} aria-invalid={Boolean(fieldErrors.from)} aria-describedby={fieldErrors.from ? 'cy-from-error' : undefined} />
              {fieldErrors.from && <p id="cy-from-error" className="mt-1 text-xs text-danger">{fieldErrors.from}</p>}
            </div>
            <div>
              <label htmlFor="cy-to" className="form-label">Finished product <span className="text-text-muted font-normal">(e.g. Skinless Fillet)</span></label>
              <input id="cy-to" className="form-input" value={form.to} onChange={(e) => setField('to', e.target.value)} aria-invalid={Boolean(fieldErrors.to)} aria-describedby={fieldErrors.to ? 'cy-to-error' : undefined} />
              {fieldErrors.to && <p id="cy-to-error" className="mt-1 text-xs text-danger">{fieldErrors.to}</p>}
            </div>
            <div>
              <label htmlFor="cy-yield" className="form-label">Yield (%)</label>
              <input id="cy-yield" className="form-input" inputMode="decimal" value={form.yield} onChange={(e) => setField('yield', e.target.value)} aria-invalid={Boolean(fieldErrors.yield)} aria-describedby={fieldErrors.yield ? 'cy-yield-error' : undefined} />
              {fieldErrors.yield && <p id="cy-yield-error" className="mt-1 text-xs text-danger">{fieldErrors.yield}</p>}
            </div>
            <div>
              <label htmlFor="cy-source" className="form-label">Source note <span className="text-text-muted font-normal">(private, optional)</span></label>
              <input id="cy-source" className="form-input" value={form.source} onChange={(e) => setField('source', e.target.value)} aria-invalid={Boolean(fieldErrors.source)} aria-describedby={fieldErrors.source ? 'cy-source-error' : undefined} />
              {fieldErrors.source && <p id="cy-source-error" className="mt-1 text-xs text-danger">{fieldErrors.source}</p>}
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button type="submit" className="btn-primary text-sm">{editingId ? 'Save changes' : 'Add yield'}</button>
              <button type="button" onClick={closeForm} className="btn-secondary text-sm">Cancel</button>
            </div>
          </form>
        )}

        {!loaded && !loadError && <p className="text-sm text-text-muted">Loading your yields…</p>}
        {loaded && customYields.length === 0 && (
          <p className="text-sm text-text-muted">No custom yields yet.</p>
        )}
        {customYields.length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            {customYields.map((record) => (
              <li key={record.id} className="py-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">
                    {record.species}
                    <span className="text-text-secondary font-normal"> · {conversionLabel(record)} · {record.yield}%</span>
                  </p>
                  {record.source && <p className="text-xs text-text-muted truncate">{record.source}</p>}
                  <p className="text-xs text-text-muted flex flex-wrap gap-2 mt-0.5">
                    {!hasStartingForm(record) && <span className="text-accent">Needs a starting form before the calculator can use it</span>}
                    {record.pending && <span className="inline-flex items-center gap-1"><CloudOff size={12} /> Not yet saved to the cloud</span>}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {confirmDeleteId === record.id ? (
                    <>
                      <span className="text-xs text-text-secondary mr-1">Delete this yield?</span>
                      <button onClick={() => handleDelete(record.id)} className="text-xs font-medium text-danger px-2 py-1.5 rounded hover:underline">Delete</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-text-muted px-2 py-1.5 rounded hover:text-text-primary">Keep</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(record)} aria-label={`Edit ${record.species} ${conversionLabel(record)}`} className="p-2 rounded text-text-secondary hover:text-text-primary"><Pencil size={16} /></button>
                      <button onClick={() => setConfirmDeleteId(record.id)} aria-label={`Delete ${record.species} ${conversionLabel(record)}`} className="p-2 rounded text-text-secondary hover:text-danger"><Trash2 size={16} /></button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {signOutPrompt && (
        <PendingWritesModal
          waiting={signOutPrompt === 'waiting'}
          onWait={() => promptRef.current?.wait()}
          onDiscard={() => promptRef.current?.discard()}
          onCancel={() => promptRef.current?.cancel()}
        />
      )}
    </div>
  );
}
