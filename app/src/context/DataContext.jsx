import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRepository, accountScope, guestScope } from '../lib/localRepository';
import { getCustomSpecies, setCustomSpecies as setSpeciesLocal } from '../lib/localStore';
import { createSyncCoordinator } from '../lib/syncCoordinator';
import { hasAuthCredential } from '../lib/authHeaders';
import { useAuth } from './AuthContext';
import { detectGuestRecords, adoptGuestRecords } from '../lib/guestAdoption';
import GuestAdoptionModal from '../components/GuestAdoptionModal';
import SignOutGuardModal from '../components/SignOutGuardModal';
import ConflictResolutionModal from '../components/ConflictResolutionModal';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user, logout } = useAuth();
  const [savedCalcs, setSavedCalcs] = useState([]);
  const [customYields, setCustomYields] = useState([]);
  const [customSpecies, setCustomSpeciesState] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [dataLoaded, setDataLoaded] = useState(false);
  // 'idle' | 'syncing' | 'synced' | 'offline' | 'pending' | 'error' | 'conflict'
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncError, setSyncError] = useState(null); // null | 'auth' | 'network'
  const [pendingCount, setPendingCount] = useState(0);
  const syncTimeoutRef = useRef(null);
  const [guestAdoptionCounts, setGuestAdoptionCounts] = useState(null);
  const [adoptionLoading, setAdoptionLoading] = useState(false);
  const prevUserRef = useRef(user);
  // null | { calcs: number, yields: number } — non-null while sign-out guard is shown
  const [signOutGuardState, setSignOutGuardState] = useState(null);
  const [conflictedYields, setConflictedYields] = useState([]);

  // Derive scope and repository from the current user.
  // Treat legacy password/JWT sessions (user.id but no user.uid) as authenticated.
  const uid = user?.uid ?? user?.id ?? null;
  const prevUidRef = useRef(uid);
  // Incremented on every uid change to invalidate in-flight sync callbacks.
  const syncGenRef = useRef(0);
  // Tracks the active coordinator.sync() promise for discard coordination.
  const activeSyncRef = useRef(null);
  // Set to true while a sign-out (keep or discard) is in progress so new syncs don't race.
  const signingOutRef = useRef(false);
  // Tracks which scope's data is currently loaded; null means no data loaded yet.
  const loadedScopeRef = useRef(null);

  // When uid changes (sign-out or account switch), clear React state immediately so
  // the previous account's records are never visible under the new identity.
  useEffect(() => {
    if (prevUidRef.current === uid) return;
    prevUidRef.current = uid;
    syncGenRef.current += 1;
    setSavedCalcs([]);
    setCustomYields([]);
    setSyncStatus('idle');
    setSyncError(null);
    setPendingCount(0);
    setDataLoaded(false);
    setSignOutGuardState(null);
    loadedScopeRef.current = null;
    clearTimeout(syncTimeoutRef.current);
  }, [uid]);

  const scope = useMemo(
    () => (uid ? accountScope(uid) : guestScope()),
    [uid]
  );

  const repo = useMemo(() => createRepository(scope), [scope]);
  const coordinator = useMemo(() => createSyncCoordinator(repo), [repo]);

  // Load from IndexedDB when scope changes.
  useEffect(() => {
    let cancelled = false;
    const loadingScope = scope;
    loadedScopeRef.current = null;
    async function loadData() {
      setDataLoaded(false);
      const [calcs, yields, species, conflicts] = await Promise.all([
        repo.getCalcs(),
        repo.getYields(),
        getCustomSpecies(),
        repo.getConflictedYields(),
      ]);
      if (!cancelled) {
        setSavedCalcs(calcs);
        setCustomYields(yields);
        setCustomSpeciesState(species);
        setConflictedYields(conflicts);
        setDataLoaded(true);
        loadedScopeRef.current = loadingScope;
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [repo, scope]);

  // Online/offline listeners.
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => { setIsOnline(false); setSyncStatus('offline'); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => () => clearTimeout(syncTimeoutRef.current), []);

  const reloadFromRepo = useCallback(async () => {
    const [calcs, yields, conflicts] = await Promise.all([
      repo.getCalcs(),
      repo.getYields(),
      repo.getConflictedYields(),
    ]);
    setSavedCalcs(calcs);
    setCustomYields(yields);
    setConflictedYields(conflicts);
    const count = await coordinator.pendingCount();
    setPendingCount(count);
  }, [repo, coordinator]);

  // Detect guest records when user transitions from null → authenticated.
  useEffect(() => {
    const prevUser = prevUserRef.current;
    prevUserRef.current = user;
    if (prevUser !== null || user === null) return;
    const guestRepo = createRepository(guestScope());
    detectGuestRecords(guestRepo).then((counts) => {
      if (counts.total > 0) setGuestAdoptionCounts(counts);
    });
  }, [user]);

  const triggerSync = useCallback(async () => {
    if (!hasAuthCredential(user) || !navigator.onLine) return;
    if (signingOutRef.current) return;
    const gen = syncGenRef.current;
    setSyncStatus('syncing');
    const syncPromise = coordinator.sync(user);
    activeSyncRef.current = syncPromise;
    try {
      const stats = await syncPromise;
      // Discard stale results if the account changed while the sync was in flight.
      if (gen !== syncGenRef.current) return;
      await reloadFromRepo();
      // Re-check after the async reload — account may have switched during it.
      if (gen !== syncGenRef.current) return;
      if (stats.conflicts > 0) {
        setSyncError(null);
        setSyncStatus('conflict');
      } else if (stats.errors > 0) {
        const hasAuth = stats.errorDetails?.some((e) => e.isAuthError);
        setSyncError(hasAuth ? 'auth' : 'network');
        setSyncStatus('error');
      } else {
        setSyncError(null);
        setSyncStatus('synced');
      }
    } catch {
      if (gen !== syncGenRef.current) return;
      setSyncError('network');
      setSyncStatus('error');
    } finally {
      if (activeSyncRef.current === syncPromise) activeSyncRef.current = null;
    }
  }, [user, coordinator, reloadFromRepo]);

  const handleAdoptionConfirm = useCallback(async () => {
    const currentUid = user?.uid ?? user?.id;
    if (!currentUid) return;
    setAdoptionLoading(true);
    try {
      const guestRepo = createRepository(guestScope());
      const accountRepo = createRepository(accountScope(currentUid));
      await adoptGuestRecords(guestRepo, accountRepo);
      setGuestAdoptionCounts(null);
      await reloadFromRepo();
      triggerSync();
    } finally {
      setAdoptionLoading(false);
    }
  }, [user, reloadFromRepo, triggerSync]);

  const handleAdoptionDecline = useCallback(() => {
    setGuestAdoptionCounts(null);
  }, []);

  // ---- Sign-out guard ----

  // Intercept sign-out: clear synced cache, and if there is unsynchronized work
  // show a modal offering keep/discard/cancel before calling auth logout.
  const signOut = useCallback(async () => {
    if (!uid) { await logout(); return; }
    let pending;
    try {
      pending = await repo.getPendingSync();
    } catch {
      // IndexedDB unavailable — sign out directly rather than leaving the user stuck.
      await logout();
      return;
    }
    const { calcs, yields } = pending;
    if (calcs.length === 0 && yields.length === 0) {
      try { await repo.clearSyncedCache(); } catch { /* best-effort */ }
      await logout();
    } else {
      setSignOutGuardState({ calcs: calcs.length, yields: yields.length });
    }
  }, [uid, repo, logout]);

  const handleSignOutKeep = useCallback(async () => {
    signingOutRef.current = true;
    clearTimeout(syncTimeoutRef.current);
    try {
      // Keep pending mutations in account scope; only discard synced cache.
      if (activeSyncRef.current) await activeSyncRef.current.catch(() => {});
      await repo.clearSyncedCache();
      setSignOutGuardState(null);
      await logout();
    } finally {
      signingOutRef.current = false;
    }
  }, [repo, logout]);

  const handleSignOutDiscard = useCallback(async () => {
    signingOutRef.current = true;
    clearTimeout(syncTimeoutRef.current);
    try {
      // Wait for any in-flight sync before discarding — prevents discarded records
      // from being committed to the server by a concurrent push.
      if (activeSyncRef.current) await activeSyncRef.current.catch(() => {});
      await repo.discardUnsynchronized();
      await repo.clearSyncedCache();
      setSignOutGuardState(null);
      await logout();
    } finally {
      signingOutRef.current = false;
    }
  }, [repo, logout]);

  const handleSignOutCancel = useCallback(() => {
    setSignOutGuardState(null);
  }, []);

  // Debounced sync: immediately show 'pending', then fire after 2 s idle.
  const debouncedSync = useCallback(() => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    setSyncStatus('pending');
    syncTimeoutRef.current = setTimeout(() => {
      if (user && navigator.onLine) triggerSync();
    }, 2000);
  }, [user, triggerSync]);

  // Sync on first load when authenticated and online.
  useEffect(() => {
    if (dataLoaded && user && navigator.onLine) {
      const id = setTimeout(triggerSync, 0);
      return () => clearTimeout(id);
    }
  }, [dataLoaded, user, triggerSync]);

  // Sync when connectivity is restored.
  useEffect(() => {
    if (isOnline && user && dataLoaded) {
      const id = setTimeout(triggerSync, 0);
      return () => clearTimeout(id);
    }
  }, [isOnline, user, dataLoaded, triggerSync]);

  // ---- Conflict resolution ----

  const handleConflictUseLocal = useCallback(async (id) => {
    await repo.resolveYieldConflict(id, 'use-local');
    await reloadFromRepo();
    debouncedSync();
  }, [repo, reloadFromRepo, debouncedSync]);

  const handleConflictUseServer = useCallback(async (id) => {
    await repo.resolveYieldConflict(id, 'use-server');
    await reloadFromRepo();
  }, [repo, reloadFromRepo]);

  const handleConflictKeepBoth = useCallback(async (id) => {
    await repo.resolveYieldConflict(id, 'keep-both');
    await reloadFromRepo();
    debouncedSync();
  }, [repo, reloadFromRepo, debouncedSync]);

  // ---- Saved Calculations ----

  const saveCalc = useCallback(async (calc) => {
    const newCalc = await repo.addCalc(calc);
    setSavedCalcs((prev) => [...prev, newCalc]);
    debouncedSync();
    return newCalc;
  }, [repo, debouncedSync]);

  const removeCalc = useCallback(async (id) => {
    await repo.removeCalc(id);
    setSavedCalcs((prev) => prev.filter((c) => c.id !== id));
    debouncedSync();
  }, [repo, debouncedSync]);

  // ---- Custom Yields ----

  const addYield = useCallback(async (data) => {
    const newYield = await repo.addYield(data);
    setCustomYields((prev) => [...prev, newYield]);
    debouncedSync();
    return newYield;
  }, [repo, debouncedSync]);

  const updateYield = useCallback(async (id, data) => {
    const updated = await repo.updateYield(id, data);
    if (updated) {
      setCustomYields((prev) => prev.map((y) => (y.id === id ? updated : y)));
    }
    debouncedSync();
    return updated;
  }, [repo, debouncedSync]);

  const removeYield = useCallback(async (id) => {
    await repo.removeYield(id);
    setCustomYields((prev) => prev.filter((y) => y.id !== id));
    debouncedSync();
  }, [repo, debouncedSync]);

  // Updates React state only — no IDB write, no sync.
  // Use for server-side fields patched directly via API (e.g. is_shared).
  const updateYieldLocalOnly = useCallback((id, updates) => {
    setCustomYields((prev) => prev.map((y) => (y.id === id ? { ...y, ...updates } : y)));
  }, []);

  // ---- Custom Species ----

  const updateCustomSpecies = useCallback(async (data) => {
    await setSpeciesLocal(data);
    setCustomSpeciesState(data);
  }, []);

  // ---- Manual retry ----

  const retrySync = useCallback(() => {
    if (!user || !navigator.onLine) return;
    triggerSync();
  }, [user, triggerSync]);

  // Gate account data so consumers never see the previous scope's records
  // during the render cycle between a uid change and the clearing effect.
  const scopeReady = loadedScopeRef.current === scope;

  const value = {
    savedCalcs: scopeReady ? savedCalcs : [],
    customYields: scopeReady ? customYields : [],
    customSpecies,
    conflictedYields,
    isOnline,
    dataLoaded,
    syncStatus,
    syncError,
    pendingCount,
    saveCalc,
    removeCalc,
    addYield,
    updateYield,
    updateYieldLocalOnly,
    removeYield,
    updateCustomSpecies,
    retrySync,
    signOut,
  };

  return (
    <DataContext.Provider value={value}>
      {children}
      {guestAdoptionCounts && (
        <GuestAdoptionModal
          calcs={guestAdoptionCounts.calcs}
          yields={guestAdoptionCounts.yields}
          loading={adoptionLoading}
          onConfirm={handleAdoptionConfirm}
          onDecline={handleAdoptionDecline}
        />
      )}
      {signOutGuardState && (
        <SignOutGuardModal
          calcs={signOutGuardState.calcs}
          yields={signOutGuardState.yields}
          onKeep={handleSignOutKeep}
          onDiscard={handleSignOutDiscard}
          onCancel={handleSignOutCancel}
        />
      )}
      {conflictedYields.length > 0 && (
        <ConflictResolutionModal
          conflicts={conflictedYields}
          onUseLocal={handleConflictUseLocal}
          onUseServer={handleConflictUseServer}
          onKeepBoth={handleConflictKeepBoth}
        />
      )}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
