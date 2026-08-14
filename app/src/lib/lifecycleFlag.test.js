import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Provide a localStorage stub before importing the module.
const lsStore = {};
const localStorageMock = {
  getItem: vi.fn((k) => lsStore[k] ?? null),
  setItem: vi.fn((k, v) => { lsStore[k] = String(v); }),
  removeItem: vi.fn((k) => { delete lsStore[k]; }),
  clear: vi.fn(() => { Object.keys(lsStore).forEach((k) => delete lsStore[k]); }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });

// Import after stubbing so the module's try/catch sees the stub.
const { isLifecycleEnabled, enableLifecycleForSession, disableLifecycleForSession } =
  await import('./lifecycleFlag');

describe('lifecycleFlag', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isLifecycleEnabled', () => {
    it('defaults to true when no flag or override is set', () => {
      expect(isLifecycleEnabled()).toBe(true);
    });

    it('returns true when VITE_LIFECYCLE_ENABLED=true', () => {
      vi.stubEnv('VITE_LIFECYCLE_ENABLED', 'true');
      expect(isLifecycleEnabled()).toBe(true);
    });

    it('returns false when VITE_LIFECYCLE_ENABLED=false', () => {
      vi.stubEnv('VITE_LIFECYCLE_ENABLED', 'false');
      expect(isLifecycleEnabled()).toBe(false);
    });

    it('localStorage override=true beats env flag=false', () => {
      vi.stubEnv('VITE_LIFECYCLE_ENABLED', 'false');
      localStorageMock.setItem('lifecycle_override', 'true');
      expect(isLifecycleEnabled()).toBe(true);
    });

    it('localStorage override=false beats env flag=true', () => {
      vi.stubEnv('VITE_LIFECYCLE_ENABLED', 'true');
      localStorageMock.setItem('lifecycle_override', 'false');
      expect(isLifecycleEnabled()).toBe(false);
    });

    it('localStorage override=false beats default true', () => {
      localStorageMock.setItem('lifecycle_override', 'false');
      expect(isLifecycleEnabled()).toBe(false);
    });
  });

  describe('enableLifecycleForSession', () => {
    it('sets override to true', () => {
      enableLifecycleForSession();
      expect(localStorageMock.setItem).toHaveBeenCalledWith('lifecycle_override', 'true');
    });

    it('does NOT override a deliberate rollback (false)', () => {
      localStorageMock.setItem('lifecycle_override', 'false');
      vi.clearAllMocks();
      enableLifecycleForSession();
      // setItem should NOT have been called again after the guard
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });
  });

  describe('disableLifecycleForSession', () => {
    it('sets override to false', () => {
      disableLifecycleForSession();
      expect(localStorageMock.setItem).toHaveBeenCalledWith('lifecycle_override', 'false');
    });

    it('overrides a previous enable', () => {
      enableLifecycleForSession();
      disableLifecycleForSession();
      // Last call is the disable
      const calls = localStorageMock.setItem.mock.calls;
      expect(calls[calls.length - 1]).toEqual(['lifecycle_override', 'false']);
    });
  });
});
