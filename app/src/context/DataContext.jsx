import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [savedCalcs, setSavedCalcs] = useState([]);
  const [customYields, setCustomYields] = useState([]);
  const [customSpecies, setCustomSpeciesState] = useState({});
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [dataLoaded, setDataLoaded] = useState(false);

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
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const saveCalc = useCallback(async (calc) => {
    const newCalc = await addCalcLocal(calc);
    setSavedCalcs((prev) => [...prev, newCalc]);
    return newCalc;
  }, []);

  const removeCalc = useCallback(async (id) => {
    await deleteCalcLocal(id);
    setSavedCalcs((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const addYield = useCallback(async (yieldData) => {
    const newYield = await addYieldLocal(yieldData);
    setCustomYields((prev) => [...prev, newYield]);
    return newYield;
  }, []);

  const updateYield = useCallback(async (id, data) => {
    const updated = await updateYieldLocal(id, data);
    if (updated) {
      setCustomYields((prev) => prev.map((y) => (y.id === id ? updated : y)));
    }
    return updated;
  }, []);

  const removeYield = useCallback(async (id) => {
    await deleteYieldLocal(id);
    setCustomYields((prev) => prev.filter((y) => y.id !== id));
  }, []);

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
