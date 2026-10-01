import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, NavLink } from 'react-router-dom';
import { Analytics } from "@vercel/analytics/react";
import Calculator from './components/Calculator';

const Login = lazy(() => import('./components/Login'));
const UploadData = lazy(() => import('./components/UploadData'));
const About = lazy(() => import('./components/About'));
const DataTransparency = lazy(() => import('./components/DataTransparency'));
const DataManagement = lazy(() => import('./components/DataManagement'));
const ContributorProfile = lazy(() => import('./components/ContributorProfile'));
const CommunityData = lazy(() => import('./components/CommunityData'));
const MyData = lazy(() => import('./components/MyData'));
import { Fish, UserCircle, Menu, X, Database, BookOpen, Sun, Moon, Users, Upload } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FirebaseAuthProvider } from './context/FirebaseAuthContext';
import { DataProvider, useData } from './context/DataContext';
import { useTheme } from './context/ThemeContext';
import SyncStatusBadge from './components/SyncStatusBadge';
import SyncDetailsPanel from './components/SyncDetailsPanel';
import MoveNotice from './components/MoveNotice';

const NavBar = () => {
    const { user } = useAuth();
    const { signOut } = useData();
    const { theme, toggleTheme } = useTheme();
    const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
    const [syncPanelOpen, setSyncPanelOpen] = React.useState(false);

    const navLinkClass = ({ isActive }) =>
        `inline-flex min-h-[2.75rem] items-center text-sm font-medium transition-colors ${
            isActive
                ? 'text-brand-yellow underline decoration-2 underline-offset-8'
                : 'text-white/85 hover:text-white'
        }`;

    return (
        <nav aria-label="Main" className="focus-on-dark bg-brand-teal sticky top-0 z-50 border-b border-white/10">
            <div className="max-w-5xl mx-auto px-4 sm:px-6">
                <div className="flex items-center justify-between h-14">
                    {/* Logo */}
                    <Link to="/" className="flex min-h-[2.75rem] items-center gap-2.5 shrink-0">
                        <div className="w-7 h-7 bg-white/15 rounded flex items-center justify-center">
                            <Fish className="text-white h-4 w-4" />
                        </div>
                        <div className="leading-none">
                            <span className="font-semibold text-white text-sm tracking-tight">Local Catch</span>
                            <span className="hidden sm:inline text-white/75 text-xs ml-1.5">Fish Cost Calculator</span>
                        </div>
                    </Link>

                    {/* Desktop nav */}
                    <div className="hidden md:flex items-center gap-5">
                        <NavLink to="/" end className={navLinkClass}>Calculator</NavLink>
                        <NavLink to="/data-sources" className={navLinkClass}>
                            <span className="flex items-center gap-1"><BookOpen size={13} />Data</span>
                        </NavLink>
                        <NavLink to="/community-data" className={navLinkClass}>
                            <span className="flex items-center gap-1"><Users size={13} />Community</span>
                        </NavLink>
                        <NavLink to="/my-data" className={navLinkClass}>
                            <span className="flex items-center gap-1"><Database size={13} />My data</span>
                        </NavLink>
                        {user && (
                            <NavLink to="/manage-data" className={navLinkClass}>Manage data (old)</NavLink>
                        )}
                        <NavLink to="/upload" className={navLinkClass}>
                            <span className="flex items-center gap-1"><Upload size={13} />Upload</span>
                        </NavLink>
                        <NavLink to="/about" className={navLinkClass}>About</NavLink>
                    </div>

                    {/* Right controls */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleTheme}
                            className="flex h-11 w-11 items-center justify-center rounded-lg text-white/85 hover:text-white hover:bg-white/10 transition-colors"
                            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                        >
                            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                        </button>

                        {user && (
                            <div className="relative text-white">
                                <SyncStatusBadge onToggleDetails={() => setSyncPanelOpen((o) => !o)} />
                                {syncPanelOpen && (
                                    <SyncDetailsPanel onClose={() => setSyncPanelOpen(false)} />
                                )}
                            </div>
                        )}

                        {user ? (
                            <div className="hidden md:flex items-center gap-3">
                                <span className="max-w-[10rem] truncate text-white/80 text-sm">{user.username}</span>
                                <button
                                    onClick={signOut}
                                    className="min-h-[2.5rem] text-white/85 hover:text-white text-sm border border-white/40 px-3 rounded-lg transition-colors"
                                >
                                    Sign out
                                </button>
                            </div>
                        ) : (
                            <Link
                                to="/login"
                                className="hidden md:flex min-h-[2.75rem] items-center gap-1.5 text-white/85 hover:text-white transition-colors text-sm"
                            >
                                <UserCircle className="h-4 w-4" />
                                Sign in
                            </Link>
                        )}

                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="md:hidden flex h-11 w-11 items-center justify-center rounded-lg text-white/85 hover:text-white hover:bg-white/10 transition-colors"
                            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
                            aria-expanded={mobileMenuOpen}
                            aria-controls="mobile-menu"
                        >
                            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile menu */}
            {mobileMenuOpen && (
                <div id="mobile-menu" className="md:hidden border-t border-white/10 bg-brand-teal">
                    <div className="max-w-5xl mx-auto px-4 py-3 space-y-0.5">
                        {[
                            { to: '/', label: 'Calculator', end: true },
                            { to: '/data-sources', label: 'Data Sources' },
                            { to: '/community-data', label: 'Community Data' },
                            { to: '/my-data', label: 'My data' },
                            ...(user ? [{ to: '/manage-data', label: 'Manage data (old)' }] : []),
                            { to: '/upload', label: 'Upload Data' },
                            { to: '/about', label: 'About' },
                        ].map(({ to, label, end }) => (
                            <NavLink
                                key={to}
                                to={to}
                                end={end}
                                onClick={() => setMobileMenuOpen(false)}
                                className={({ isActive }) =>
                                    `block px-3 py-3 rounded-lg text-base font-medium transition-colors ${
                                        isActive
                                            ? 'bg-white/15 text-white'
                                            : 'text-white/85 hover:text-white hover:bg-white/10'
                                    }`
                                }
                            >
                                {label}
                            </NavLink>
                        ))}

                        <div className="pt-2 mt-2 border-t border-white/10">
                            {user ? (
                                <div className="flex items-center justify-between px-3 py-2">
                                    <span className="text-white/80 text-base">{user.username}</span>
                                    <button
                                        onClick={() => { signOut(); setMobileMenuOpen(false); }}
                                        className="min-h-[2.75rem] px-3 text-white/85 hover:text-white text-base"
                                    >
                                        Sign out
                                    </button>
                                </div>
                            ) : (
                                <NavLink
                                    to="/login"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="flex items-center gap-2 px-3 py-3 text-base text-white/85 hover:text-white transition-colors"
                                >
                                    <UserCircle size={18} /> Sign in
                                </NavLink>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
};

function AppContent() {
    return (
        <div className="min-h-screen bg-surface text-text-primary font-sans selection:bg-brand-terracotta/20 selection:text-link">
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface-raised focus:px-4 focus:py-2 focus:font-semibold focus:text-text-primary focus:shadow-lg"
            >
                Skip to main content
            </a>
            <NavBar />
            <MoveNotice />
            <main id="main" tabIndex={-1} className="py-6 sm:py-8 px-4 focus:outline-none">
                <Analytics />
                <Suspense fallback={
                    <div className="flex items-center justify-center py-20 text-text-muted text-sm">Loading…</div>
                }>
                    <Routes>
                        <Route path="/" element={<Calculator />} />
                        <Route path="/login" element={<Login />} />
                        <Route path="/upload" element={<UploadData />} />
                        <Route path="/about" element={<About />} />
                        <Route path="/data-sources" element={<DataTransparency />} />
                        <Route path="/my-data" element={<MyData />} />
                        <Route path="/manage-data" element={<DataManagement />} />
                        <Route path="/profile" element={<ContributorProfile />} />
                        <Route path="/community-data" element={<CommunityData />} />
                        <Route path="/inventory" element={
                            <div className="max-w-5xl mx-auto text-center mt-20 text-text-muted">
                                Inventory management coming soon
                            </div>
                        } />
                        <Route path="*" element={
                            <div className="max-w-2xl mx-auto text-center mt-20 space-y-4">
                                <p className="text-6xl font-bold text-accent">404</p>
                                <p className="text-text-secondary">Page not found.</p>
                                <Link to="/" className="inline-block text-link hover:underline text-sm font-medium">
                                    Back to calculator
                                </Link>
                            </div>
                        } />
                    </Routes>
                </Suspense>
            </main>
        </div>
    );
}

function App() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-surface">
                <div className="text-text-muted text-sm">Loading…</div>
            </div>
        }>
            <Router>
                {/* The Firebase SDK session (Firestore pages) sits next to the
                    REST session until the Neon-backed pages go (#133). */}
                <FirebaseAuthProvider>
                    <AuthProvider>
                        <DataProvider>
                            <AppContent />
                        </DataProvider>
                    </AuthProvider>
                </FirebaseAuthProvider>
            </Router>
        </Suspense>
    );
}

export default App;
