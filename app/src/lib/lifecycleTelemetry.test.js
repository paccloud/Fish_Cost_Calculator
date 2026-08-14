import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  track,
  trackSyncAttempt,
  trackSyncSuccess,
  trackSyncFailure,
  trackGuestAdoption,
  trackMigration,
  getSyncHealth,
} from './lifecycleTelemetry';

describe('lifecycleTelemetry', () => {
  let vaTrack;

  beforeEach(() => {
    vaTrack = vi.fn();
    globalThis.va = { track: vaTrack };
  });

  afterEach(() => {
    delete globalThis.va;
    vi.restoreAllMocks();
  });

  describe('track — basic emission', () => {
    it('does not throw when Vercel Analytics is absent', () => {
      delete globalThis.va;
      expect(() => track('lifecycle:test:event', { count: 1 })).not.toThrow();
    });

    it('calls va.track when present', () => {
      track('lifecycle:sync:attempt');
      expect(vaTrack).toHaveBeenCalledWith('lifecycle:sync:attempt', {});
    });
  });

  describe('track — privacy guard (no PII in emitted properties)', () => {
    it('trackSyncSuccess emits only numeric properties', () => {
      trackSyncSuccess({ pushed: 2, pulled: 1, conflicts: 0 });
      const [, props] = vaTrack.mock.calls[0];
      Object.values(props).forEach((v) => {
        expect(typeof v).toMatch(/number|boolean/);
      });
    });

    it('trackGuestAdoption has no uid or email in emitted props', () => {
      trackGuestAdoption('accepted', 5, 2);
      const [, props] = vaTrack.mock.calls[0];
      expect(props).not.toHaveProperty('uid');
      expect(props).not.toHaveProperty('email');
    });
  });

  describe('trackSyncAttempt', () => {
    it('emits lifecycle:sync:attempt with no properties', () => {
      trackSyncAttempt();
      expect(vaTrack).toHaveBeenCalledWith('lifecycle:sync:attempt', {});
    });
  });

  describe('trackSyncSuccess', () => {
    it('emits pushed/pulled/conflicts counts', () => {
      trackSyncSuccess({ pushed: 3, pulled: 2, conflicts: 1 });
      expect(vaTrack).toHaveBeenCalledWith('lifecycle:sync:success', {
        pushed: 3, pulled: 2, conflicts: 1,
      });
    });

    it('defaults missing stats to 0', () => {
      trackSyncSuccess({});
      const [, props] = vaTrack.mock.calls[0];
      expect(props.pushed).toBe(0);
      expect(props.pulled).toBe(0);
      expect(props.conflicts).toBe(0);
    });
  });

  describe('trackSyncFailure', () => {
    it('emits category and consecutive count', () => {
      trackSyncFailure('network', 3);
      expect(vaTrack).toHaveBeenCalledWith('lifecycle:sync:failure', {
        category: 'network', consecutiveCount: 3,
      });
    });

    it('defaults consecutiveCount to 1', () => {
      trackSyncFailure('auth');
      const [, props] = vaTrack.mock.calls[0];
      expect(props.consecutiveCount).toBe(1);
    });
  });

  describe('trackGuestAdoption', () => {
    it('emits decision and record counts', () => {
      trackGuestAdoption('accepted', 5, 2);
      const [name, props] = vaTrack.mock.calls[0];
      expect(name).toBe('lifecycle:adoption:guest');
      expect(props.decision).toBe('accepted');
      expect(props.calcsCount).toBe(5);
      expect(props.yieldsCount).toBe(2);
    });
  });

  describe('trackMigration', () => {
    it('emits outcome and record count', () => {
      trackMigration('success', 12);
      expect(vaTrack).toHaveBeenCalledWith('lifecycle:migration:legacy', {
        outcome: 'success', recordCount: 12,
      });
    });

    it('defaults recordCount to 0', () => {
      trackMigration('skipped');
      const [, props] = vaTrack.mock.calls[0];
      expect(props.recordCount).toBe(0);
    });
  });

  describe('getSyncHealth', () => {
    it('reports healthy when all metrics are in range', () => {
      const result = getSyncHealth({
        consecutiveFailures: 2,
        oldestPendingAgeMs: 3600000,
        migrationFailed: false,
      });
      expect(result.healthy).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('reports sustained_sync_failure when threshold is reached', () => {
      const result = getSyncHealth({
        consecutiveFailures: 5,
        oldestPendingAgeMs: 0,
        migrationFailed: false,
      });
      expect(result.healthy).toBe(false);
      expect(result.issues.some((i) => i.startsWith('sustained_sync_failure'))).toBe(true);
    });

    it('reports pending_age_exceeded when pending items are stale', () => {
      const result = getSyncHealth({
        consecutiveFailures: 0,
        oldestPendingAgeMs: 25 * 3600 * 1000,
        migrationFailed: false,
      });
      expect(result.healthy).toBe(false);
      expect(result.issues.some((i) => i.startsWith('pending_age_exceeded'))).toBe(true);
    });

    it('reports migration_failed', () => {
      const result = getSyncHealth({
        consecutiveFailures: 0,
        oldestPendingAgeMs: 0,
        migrationFailed: true,
      });
      expect(result.healthy).toBe(false);
      expect(result.issues).toContain('migration_failed');
    });

    it('can accumulate multiple issues', () => {
      const result = getSyncHealth({
        consecutiveFailures: 10,
        oldestPendingAgeMs: 48 * 3600 * 1000,
        migrationFailed: true,
      });
      expect(result.issues).toHaveLength(3);
    });

    it('does not flag pending_age when oldestPendingAgeMs is 0', () => {
      const result = getSyncHealth({
        consecutiveFailures: 0,
        oldestPendingAgeMs: 0,
        migrationFailed: false,
      });
      expect(result.healthy).toBe(true);
    });
  });
});
