import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  getSavedCalcs,
  addSavedCalc as addCalcLocal,
  deleteSavedCalc as deleteCalcLocal,
  getCustomYields,
  addCustomYield as addYieldLocal,
  updateCustomYield as updateYieldLocal,
  deleteCustomYield as deleteYieldLocal,
  getCustomSpecies,
  setCustomSpecies as setSpeciesLocal,
} from '../lib/localStore';
import { syncAll } from '../lib/syncEngine';
import { useAuth } from './AuthContext';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
  const [savedCalcs, setSavedCalcs] = useState([]);
  const [customYields, setCustomYields] = useState([]);
  const [customSpecies, setCustomSpeciesState] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'synced' | 'offline' | 'pending' | 'error'
  const [syncError, setSyncError] = useState(null); // null | 'auth' | 'network'
  const syncTimeoutRef = useRef(null);

  // Load from IndexedDB on mount
  useEffect(() => {
    async function loadData() {
      const [calcs, yields, species] = await Promise.all([
        getSavedCalcs(),
        getCustomYields(),
        getCustomSpecies(),
      ]);
      setSavedCalcs(calcs.filter((c) => c.syncStatus !== 'pending-delete'));
      setCustomYields(yields.filter((y) => y.syncStatus !== 'pending-delete'));
      setCustomSpeciesState(species);
      setDataLoaded(true);
    }
    loadData();
  }, []);

  // Online/offline listeners
  useEffect(() => {
    const goOnline = () => { setIsOnline(true); };
    const goOffline = () => { setIsOnline(false); setSyncStatus('offline'); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Clean up debounced sync timeout on unmount
  useEffect(() => {
    return () => clearTimeout(syncTimeoutRef.current);
  }, []);

  const triggerSync = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !navigator.onLine) return;

    setSyncStatus('syncing');
    try {
      const stats = await syncAll(token);
      // Reload data from IndexedDB after sync to pick up merged server data
      const [calcs, yields] = await Promise.all([
        getSavedCalcs(),
        getCustomYields(),
      ]);
      setSavedCalcs(calcs.filter((c) => c.syncStatus !== 'pending-delete'));
      setCustomYields(yields.filter((y) => y.syncStatus !== 'pending-delete'));

      if (stats.errors > 0) {
        const hasAuthError = stats.errorDetails?.some((e) => e.isAuthError);
        setSyncError(hasAuthError ? 'auth' : 'network');
        setSyncStatus('error');
      } else {
        setSyncError(null);
        setSyncStatus('synced');
      }
    } catch {
      setSyncError('network');
      setSyncStatus('error');
    }
  }, []);

  const debouncedSync = useCallback(() => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    setSyncStatus('pending');
    syncTimeoutRef.current = setTimeout(() => {
      if (user && navigator.onLine) triggerSync();
    }, 2000);
  }, [user, triggerSync]);

  // Sync on mount if online + logged in
  useEffect(() => {
    if (dataLoaded && user && navigator.onLine) {
      triggerSync();
    }
  }, [dataLoaded, user, triggerSync]);

  // Sync when coming back online
  useEffect(() => {
    if (isOnline && user && dataLoaded) {
      triggerSync();
    }
  }, [isOnline, user, dataLoaded, triggerSync]);

  const saveCalc = useCallback(async (calc) => {
    const newCalc = await addCalcLocal(calc);
    setSavedCalcs((prev) => [...prev, newCalc]);
    debouncedSync();
    return newCalc;
  }, [debouncedSync]);

  const removeCalc = useCallback(async (id) => {
    await deleteCalcLocal(id);
    setSavedCalcs((prev) => prev.filter((c) => c.id !== id));
    debouncedSync();
  }, [debouncedSync]);

  const addYield = useCallback(async (yieldData) => {
    const newYield = await addYieldLocal(yieldData);
    setCustomYields((prev) => [...prev, newYield]);
    debouncedSync();
    return newYield;
  }, [debouncedSync]);

  const updateYield = useCallback(async (id, data) => {
    const updated = await updateYieldLocal(id, data);
    if (updated) {
      setCustomYields((prev) => prev.map((y) => (y.id === id ? updated : y)));
    }
    debouncedSync();
    return updated;
  }, [debouncedSync]);

  const removeYield = useCallback(async (id) => {
    await deleteYieldLocal(id);
    setCustomYields((prev) => prev.filter((y) => y.id !== id));
    debouncedSync();
  }, [debouncedSync]);

  const updateCustomSpecies = useCallback(async (data) => {
    await setSpeciesLocal(data);
    setCustomSpeciesState(data);
  }, []);

  const value = {
    savedCalcs,
    customYields,
    customSpecies,
    isOnline,
    dataLoaded,
    syncStatus,
    syncError,
    saveCalc,
    removeCalc,
    addYield,
    updateYield,
    removeYield,
    updateCustomSpecies,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
