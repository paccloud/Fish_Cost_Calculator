import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRepository, accountScope, guestScope } from '../lib/localRepository';
import { getCustomSpecies, setCustomSpecies as setSpeciesLocal } from '../lib/localStore';
import { createSyncCoordinator } from '../lib/syncCoordinator';
import { hasAuthCredential } from '../lib/authHeaders';
import { useAuth } from './AuthContext';
import { detectGuestRecords, adoptGuestRecords } from '../lib/guestAdoption';
import { migrateLegacyRecords, getRecoveryCounts, assignRecoveryToAccount, discardRecovery } from '../lib/legacyMigration';
import GuestAdoptionModal from '../components/GuestAdoptionModal';
import SignOutGuardModal from '../components/SignOutGuardModal';
import ConflictResolutionModal from '../components/ConflictResolutionModal';
import PreviewPublishModal from '../components/PreviewPublishModal';
import RecoveryModal from '../components/RecoveryModal';
import { apiClient } from '../lib/apiClient';
import { trackGuestAdoption, trackPendingAge } from '../lib/lifecycleTelemetry';
import { isAppReadOnly, isMoveNoticeOn } from '../config/move';
import { buildUnsentChangesFile, countUnsentChanges, downloadUnsentChanges } from '../lib/unsentChanges';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user, logout, getAuthHeaders } = useAuth();
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
  // null | calc record — non-null while publish preview modal is shown
  const [publishPreviewCalc, setPublishPreviewCalc] = useState(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState(null);
  // null | { calcs: number, yields: number } — non-null while recovery modal is shown
  const [recoveryCounts, setRecoveryCounts] = useState(null);
  const [recoveryAssigning, setRecoveryAssigning] = useState(false);
  const recoveryCheckedRef = useRef(false);

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
    setConflictedYields([]);
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

  // One-time legacy migration + recovery check. Runs once per session.
  useEffect(() => {
    if (recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    async function checkMigration() {
      try {
        await migrateLegacyRecords();
        const counts = await getRecoveryCounts();
        if (counts.total > 0) setRecoveryCounts({ calcs: counts.calcs, yields: counts.yields });
      } catch {
        // Migration errors are non-fatal — log and continue.
      }
    }
    checkMigration();
  }, []);

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
    const [calcs, yields, conflicts, pending] = await Promise.all([
      repo.getCalcs(),
      repo.getYields(),
      repo.getConflictedYields(),
      repo.getPendingSync(),
    ]);
    setSavedCalcs(calcs);
    setCustomYields(yields);
    setConflictedYields(conflicts);
    const count = pending.calcs.length + pending.yields.length;
    setPendingCount(count);

    if (count > 0) {
      const now = Date.now();
      const allPending = [...pending.calcs, ...pending.yields];
      const oldest = allPending.reduce((min, r) => {
        const age = r.createdAt ? now - new Date(r.createdAt).getTime() : 0;
        return age > min ? age : min;
      }, 0);
      trackPendingAge(count, oldest);
    }

    return { conflictCount: conflicts.length };
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
      const { conflictCount } = await reloadFromRepo();
      // Re-check after the async reload — account may have switched during it.
      if (gen !== syncGenRef.current) return;
      if (stats.conflicts > 0 || conflictCount > 0) {
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
      if (guestAdoptionCounts) {
        trackGuestAdoption('accepted', guestAdoptionCounts.calcs, guestAdoptionCounts.yields);
      }
      setGuestAdoptionCounts(null);
      await reloadFromRepo();
      triggerSync();
    } finally {
      setAdoptionLoading(false);
    }
  }, [user, reloadFromRepo, triggerSync, guestAdoptionCounts]);

  const handleAdoptionDecline = useCallback(() => {
    if (guestAdoptionCounts) {
      trackGuestAdoption('declined', guestAdoptionCounts.calcs, guestAdoptionCounts.yields);
    }
    setGuestAdoptionCounts(null);
  }, [guestAdoptionCounts]);

  // ---- Recovery ----

  const handleRecoveryAssign = useCallback(async () => {
    if (!uid) return;
    setRecoveryAssigning(true);
    try {
      const accountRepo = createRepository(accountScope(uid));
      await assignRecoveryToAccount(accountRepo);
      setRecoveryCounts(null);
      await reloadFromRepo();
      triggerSync();
    } catch {
      // Leave modal open so the user can retry.
    } finally {
      setRecoveryAssigning(false);
    }
  }, [uid, reloadFromRepo, triggerSync]);

  const handleRecoveryDiscard = useCallback(async () => {
    try { await discardRecovery(); } catch { /* best-effort */ }
    setRecoveryCounts(null);
  }, []);

  const handleRecoveryLater = useCallback(() => {
    setRecoveryCounts(null);
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
    // Clear conflict status once all conflicts are resolved.
    if (conflicts.length === 0) setSyncStatus((s) => (s === 'conflict' ? 'synced' : s));
  }, [repo, coordinator]);

  const handleDeleteConflictDismiss = useCallback(async (id) => {
    await repo.dismissYieldDeleteConflict(id);
    // Use reloadFromRepo so customYields is refreshed too (dismissed record was still in getYields).
    const { conflictCount } = await reloadFromRepo();
    if (conflictCount === 0) setSyncStatus((s) => (s === 'conflict' ? 'synced' : s));
  }, [repo, reloadFromRepo]);

  const handleConflictKeepBoth = useCallback(async (id) => {
    await repo.resolveYieldConflict(id, 'keep-both');
    await reloadFromRepo();
    debouncedSync();
  }, [repo, reloadFromRepo, debouncedSync]);

  // ---- Saved Calculation Publication ----

  // Open the preview modal — no API call yet.
  const requestPublish = useCallback((calc) => {
    if (isAppReadOnly) return;
    setPublishError(null);
    setPublishPreviewCalc(calc);
  }, []);

  // Called when the user confirms publication in the preview modal.
  const confirmPublish = useCallback(async () => {
    if (!publishPreviewCalc?.serverId) return;
    setPublishLoading(true);
    try {
      let authHeaders;
      try {
        authHeaders = await getAuthHeaders();
      } catch {
        // Token refresh failed: the session is ending, so close this
        // account-scoped preview rather than leave it open.
        setPublishError(null);
        setPublishPreviewCalc(null);
        return;
      }
      let succeeded = false;
      let transientFailure = false;
      try {
        const res = await apiClient.publishCalcRaw(publishPreviewCalc.serverId, authHeaders);
        if (res.ok) {
          await repo.updateCalcPublicationState(publishPreviewCalc.id, false);
          setSavedCalcs((prev) =>
            prev.map((c) => (c.id === publishPreviewCalc.id ? { ...c, is_private: false, syncStatus: 'synced' } : c))
          );
          succeeded = true;
        } else {
          // Only retry on transient failures; permanent 4xx (e.g. 404 stale ID) should not be queued.
          transientFailure = res.status === 429 || res.status >= 500;
        }
      } catch {
        // Network error → transient
        transientFailure = true;
      }
      if (!succeeded && transientFailure) {
        await repo.queuePublish(publishPreviewCalc.id);
        setSavedCalcs((prev) =>
          prev.map((c) => (c.id === publishPreviewCalc.id ? { ...c, syncStatus: 'pending-publish' } : c))
        );
        debouncedSync();
      }
      if (!succeeded && !transientFailure) {
        // Permanent failure (e.g. 401/404): keep the modal open and say so.
        setPublishError('Could not publish this calculation. Sign in again and retry.');
        return;
      }
      setPublishPreviewCalc(null);
    } finally {
      setPublishLoading(false);
    }
  }, [publishPreviewCalc, getAuthHeaders, repo, debouncedSync]);

  const cancelPublish = useCallback(() => {
    setPublishError(null);
    setPublishPreviewCalc(null);
  }, []);

  // Called directly — no preview modal needed to make something private.
  const unpublishCalc = useCallback(async (calc) => {
    if (isAppReadOnly) return;
    if (!calc?.serverId) return;
    const queueForRetry = async ({ sync = true } = {}) => {
      await repo.queueUnpublish(calc.id);
      setSavedCalcs((prev) =>
        prev.map((c) => (c.id === calc.id ? { ...c, syncStatus: 'pending-unpublish' } : c))
      );
      if (sync) debouncedSync();
    };

    let authHeaders;
    try {
      authHeaders = await getAuthHeaders();
    } catch {
      // The session has ended, so nothing reached the server and the
      // calculation is still public. Say so, and queue the change for when
      // this account signs in again. Skip the sync, which would replace the
      // error badge with "pending" and cannot succeed without a session.
      await queueForRetry({ sync: false });
      setSyncError('auth');
      setSyncStatus('error');
      return;
    }

    try {
      const res = await apiClient.unpublishCalcRaw(calc.serverId, authHeaders);
      if (res.ok) {
        await repo.updateCalcPublicationState(calc.id, true);
        setSavedCalcs((prev) =>
          prev.map((c) => (c.id === calc.id ? { ...c, is_private: true, syncStatus: 'synced' } : c))
        );
      } else if (res.status === 429 || res.status >= 500) {
        await queueForRetry();
      }
    } catch {
      // Network error → transient
      await queueForRetry();
    }
  }, [getAuthHeaders, repo, debouncedSync]);

  // ---- Saved Calculations ----

  // While the app is read-only for the move (issue #130), new edits are refused;
  // changes already pending still sync.
  const saveCalc = useCallback(async (calc) => {
    if (isAppReadOnly) return null;
    const newCalc = await repo.addCalc(calc);
    setSavedCalcs((prev) => [...prev, newCalc]);
    debouncedSync();
    return newCalc;
  }, [repo, debouncedSync]);

  const removeCalc = useCallback(async (id) => {
    if (isAppReadOnly) return;
    await repo.removeCalc(id);
    setSavedCalcs((prev) => prev.filter((c) => c.id !== id));
    debouncedSync();
  }, [repo, debouncedSync]);

  // ---- Custom Yields ----

  const addYield = useCallback(async (data) => {
    if (isAppReadOnly) return null;
    const newYield = await repo.addYield(data);
    setCustomYields((prev) => [...prev, newYield]);
    debouncedSync();
    return newYield;
  }, [repo, debouncedSync]);

  const updateYield = useCallback(async (id, data) => {
    if (isAppReadOnly) return null;
    const updated = await repo.updateYield(id, data);
    if (updated) {
      setCustomYields((prev) => prev.map((y) => (y.id === id ? updated : y)));
    }
    debouncedSync();
    return updated;
  }, [repo, debouncedSync]);

  const removeYield = useCallback(async (id) => {
    if (isAppReadOnly) return;
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

  // ---- The move to Firebase (issue #130) ----

  // Everything on this device that never reached the server: the signed-in
  // user's pending changes plus anything saved here as a guest.
  const collectUnsentChanges = useCallback(async () => {
    const guestRepo = uid ? createRepository(guestScope()) : repo;
    const [pending, guestCalcs, guestYields] = await Promise.all([
      uid ? repo.getPendingSync() : { calcs: [], yields: [] },
      guestRepo.getCalcs(),
      guestRepo.getYields(),
    ]);
    return buildUnsentChangesFile({
      accountCalcs: pending.calcs,
      accountYields: pending.yields,
      guestCalcs,
      guestYields,
    });
  }, [uid, repo]);

  const [unsentCount, setUnsentCount] = useState(0);
  useEffect(() => {
    if (!isMoveNoticeOn || !dataLoaded) return;
    let cancelled = false;
    collectUnsentChanges()
      .then((file) => { if (!cancelled) setUnsentCount(countUnsentChanges(file)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [collectUnsentChanges, dataLoaded, pendingCount, savedCalcs, customYields]);

  const saveUnsentChanges = useCallback(async () => {
    downloadUnsentChanges(await collectUnsentChanges());
  }, [collectUnsentChanges]);

  // Warn before leaving while changes have not reached the server yet.
  useEffect(() => {
    if (!isMoveNoticeOn || !uid || pendingCount === 0) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uid, pendingCount]);

  // ---- Manual retry ----

  const retrySync = useCallback(() => {
    if (!user || !navigator.onLine) return;
    return triggerSync();
  }, [user, triggerSync]);

  // Gate account data so consumers never see the previous scope's records
  // during the render cycle between a uid change and the clearing effect.
  const scopeReady = loadedScopeRef.current === scope;

  const value = {
    savedCalcs: scopeReady ? savedCalcs : [],
    customYields: scopeReady ? customYields : [],
    customSpecies,
    conflictedYields: scopeReady ? conflictedYields : [],
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
    requestPublish,
    confirmPublish,
    cancelPublish,
    unpublishCalc,
    publishPreviewCalc,
    publishLoading,
    readOnly: isAppReadOnly,
    unsentCount,
    saveUnsentChanges,
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
          onDismissDelete={handleDeleteConflictDismiss}
        />
      )}
      {publishPreviewCalc && (
        <PreviewPublishModal
          calc={publishPreviewCalc}
          loading={publishLoading}
          error={publishError}
          onConfirm={confirmPublish}
          onCancel={cancelPublish}
        />
      )}
      {recoveryCounts && (
        <RecoveryModal
          calcs={recoveryCounts.calcs}
          yields={recoveryCounts.yields}
          isAuthenticated={!!uid}
          assigning={recoveryAssigning}
          onAssign={handleRecoveryAssign}
          onDiscard={handleRecoveryDiscard}
          onLater={handleRecoveryLater}
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
