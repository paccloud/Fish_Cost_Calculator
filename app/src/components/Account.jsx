import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronRight, Info, LogOut, Moon, Sun, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useTheme } from '../context/ThemeContext';
import { backendEnabled, thisDevice } from '../config/platform';
import Stamp from './Stamp';
import SyncStatusBadge from './SyncStatusBadge';
import SyncDetailsPanel from './SyncDetailsPanel';

const THEMES = [
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
];

const LINKS = [
  { to: '/upload', label: 'Import yields', Icon: Upload },
  { to: '/data-sources', label: 'Where the reference yields come from', Icon: BookOpen },
  { to: '/about', label: 'About', Icon: Info },
];

function ThemeSwitch() {
  const { theme, toggleTheme } = useTheme();

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="settings-theme">
      <h2 id="settings-theme" className="type-heading">Theme</h2>
      <div
        role="group"
        aria-labelledby="settings-theme"
        className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-line-strong bg-surface-raised p-1"
      >
        {THEMES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={theme === option.id}
            onClick={() => { if (theme !== option.id) toggleTheme(); }}
            className={`flex min-h-control items-center justify-center gap-2 rounded-lg px-2 text-base font-bold transition-colors ${
              theme === option.id ? 'bg-primary text-on-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <option.Icon size={20} aria-hidden="true" />
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-text-muted">
        Light is easier to read outdoors. Dark is easier in a dim kitchen or wheelhouse.
      </p>
    </section>
  );
}

/**
 * The parts of the Account screen that need no account: the theme switch and the way to the
 * screens that have no tab of their own. The shell also puts this under About in a build with
 * no backend, where About is the third tab and there is no Account tab.
 */
export function AppSettings({ aboutLink = true }) {
  const links = aboutLink ? LINKS : LINKS.filter(({ to }) => to !== '/about');

  return (
    <div className="space-y-4">
      <ThemeSwitch />
      <section className="card" aria-labelledby="settings-more">
        <h2 id="settings-more" className="sr-only">More</h2>
        <ul className="divide-y divide-line-subtle">
          {links.map((item) => (
            <li key={item.to}>
              <Link
                to={item.to}
                className="flex min-h-tile items-center gap-3 px-5 py-3 text-base font-semibold text-text-primary transition-colors hover:text-accent focus-visible:[outline-offset:-3px] sm:px-6"
              >
                <item.Icon size={20} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 flex-1">{item.label}</span>
                <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-text-secondary" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SignedIn({ user }) {
  const { signOut } = useData();
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);

  return (
    <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="account-who">
      <div>
        <p className="text-sm font-semibold text-text-secondary">Signed in as</p>
        <h2 id="account-who" className="type-heading break-words">{user.username}</h2>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-5">
        <div className="min-w-0">
          <p className="text-base font-semibold text-text-primary">Sync</p>
          <p className="text-sm text-text-secondary">Your yields and saved prices are kept on your account.</p>
        </div>
        <div className="relative shrink-0">
          <SyncStatusBadge onToggleDetails={() => setSyncPanelOpen((open) => !open)} />
          {syncPanelOpen && <SyncDetailsPanel onClose={() => setSyncPanelOpen(false)} />}
        </div>
      </div>

      <button type="button" onClick={signOut} className="btn-secondary w-full sm:w-auto">
        <LogOut size={20} aria-hidden="true" />
        Sign out
      </button>
    </section>
  );
}

function Guest() {
  return (
    <section className="card space-y-4 p-5 sm:p-6" aria-label="Where your work is saved">
      <Stamp>Saved on {thisDevice}</Stamp>
      {backendEnabled ? (
        <>
          <p className="text-base text-text-primary">What you save stays on {thisDevice} until you sign in.</p>
          <Link to="/login" className="btn-primary w-full sm:w-auto">Sign in</Link>
        </>
      ) : (
        <p className="text-base text-text-primary">What you save stays on {thisDevice}.</p>
      )}
    </section>
  );
}

const Account = () => {
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-content">
      <h1 className="type-title mb-8">Account</h1>
      <div className="space-y-4">
        {backendEnabled && user ? <SignedIn user={user} /> : <Guest />}
        <AppSettings />
      </div>
    </div>
  );
};

export default Account;
