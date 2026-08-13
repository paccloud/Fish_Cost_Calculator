import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRepository, accountScope, guestScope } from '../lib/localRepository';
import { getCustomSpecies, setCustomSpecies as setSpeciesLocal } from '../lib/localStore';
import { createSyncCoordinator } from '../lib/syncCoordinator';
import { hasAuthCredential } from '../lib/authHeaders';
import { useAuth } from './AuthContext';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
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

  // Derive scope and repository from the current user.
  const uid = user?.uid ?? null;
  const scope = useMemo(
    () => (uid ? accountScope(uid) : guestScope()),
    [uid]
  );

  const repo = useMemo(() => createRepository(scope), [scope]);
  const coordinator = useMemo(() => createSyncCoordinator(repo), [repo]);

  // Load from IndexedDB when scope changes.
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setDataLoaded(false);
      const [calcs, yields, species] = await Promise.all([
        repo.getCalcs(),
        repo.getYields(),
        getCustomSpecies(),
      ]);
      if (!cancelled) {
        setSavedCalcs(calcs);
        setCustomYields(yields);
        setCustomSpeciesState(species);
        setDataLoaded(true);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [repo]);

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
    const [calcs, yields] = await Promise.all([repo.getCalcs(), repo.getYields()]);
    setSavedCalcs(calcs);
    setCustomYields(yields);
    const count = await coordinator.pendingCount();
    setPendingCount(count);
  }, [repo, coordinator]);

  const triggerSync = useCallback(async () => {
    if (!hasAuthCredential(user) || !navigator.onLine) return;
    setSyncStatus('syncing');
    try {
      const stats = await coordinator.sync(user);
      await reloadFromRepo();
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
      setSyncError('network');
      setSyncStatus('error');
    }
  }, [user, coordinator, reloadFromRepo]);

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

  const value = {
    savedCalcs,
    customYields,
    customSpecies,
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
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
