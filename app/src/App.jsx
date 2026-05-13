import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, NavLink, useLocation } from 'react-router-dom';
import { StackProvider, StackTheme, StackHandler } from "@stackframe/react";
import { Analytics } from "@vercel/analytics/react";
import Calculator from './components/Calculator';

const Login = lazy(() => import('./components/Login'));
const UploadData = lazy(() => import('./components/UploadData'));
const About = lazy(() => import('./components/About'));
const DataTransparency = lazy(() => import('./components/DataTransparency'));
const DataManagement = lazy(() => import('./components/DataManagement'));
const ContributorProfile = lazy(() => import('./components/ContributorProfile'));
const CommunityData = lazy(() => import('./components/CommunityData'));
import { Fish, UserCircle, Menu, X, Database, BookOpen, Sun, Moon, Users, Upload } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useTheme } from './context/ThemeContext';
import { stackClientApp } from './config/neonAuth';

const NavBar = () => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

    const navLinkClass = ({ isActive }) =>
        `text-sm font-medium transition-colors ${
            isActive
                ? 'text-brand-yellow'
                : 'text-white/75 hover:text-white'
        }`;

    return (
        <nav className="bg-brand-teal sticky top-0 z-50 border-b border-white/10">
            <div className="max-w-5xl mx-auto px-4 sm:px-6">
                <div className="flex items-center justify-between h-14">
                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-2.5 shrink-0">
                        <div className="w-7 h-7 bg-white/15 rounded flex items-center justify-center">
                            <Fish className="text-white h-4 w-4" />
                        </div>
                        <div className="leading-none">
                            <span className="font-semibold text-white text-sm tracking-tight">Local Catch</span>
                            <span className="hidden sm:inline text-white/50 text-xs ml-1.5">Fish Cost Calculator</span>
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
                        {user && (
                            <NavLink to="/manage-data" className={navLinkClass}>
                                <span className="flex items-center gap-1"><Database size={13} />My Data</span>
                            </NavLink>
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
                            className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                            aria-label="Toggle theme"
                        >
                            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                        </button>

                        {user ? (
                            <div className="hidden md:flex items-center gap-3">
                                <span className="text-white/60 text-xs">{user.username}</span>
                                <button
                                    onClick={logout}
                                    className="text-white/70 hover:text-white text-xs border border-white/25 px-2.5 py-1 rounded transition-colors"
                                >
                                    Sign out
                                </button>
                            </div>
                        ) : (
                            <Link
                                to="/login"
                                className="hidden md:flex items-center gap-1.5 text-white/75 hover:text-white transition-colors text-sm"
                            >
                                <UserCircle className="h-4 w-4" />
                                Sign in
                            </Link>
                        )}

                        <button
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            className="md:hidden p-1.5 text-white/75 hover:text-white transition-colors"
                            aria-label="Toggle mobile menu"
                        >
                            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile menu */}
            {mobileMenuOpen && (
                <div className="md:hidden border-t border-white/10 bg-brand-teal">
                    <div className="max-w-5xl mx-auto px-4 py-3 space-y-0.5">
                        {[
                            { to: '/', label: 'Calculator', end: true },
                            { to: '/data-sources', label: 'Data Sources' },
                            { to: '/community-data', label: 'Community Data' },
                            ...(user ? [{ to: '/manage-data', label: 'My Data' }] : []),
                            { to: '/upload', label: 'Upload Data' },
                            { to: '/about', label: 'About' },
                        ].map(({ to, label, end }) => (
                            <NavLink
                                key={to}
                                to={to}
                                end={end}
                                onClick={() => setMobileMenuOpen(false)}
                                className={({ isActive }) =>
                                    `block px-3 py-2 rounded text-sm font-medium transition-colors ${
                                        isActive
                                            ? 'bg-white/15 text-white'
                                            : 'text-white/75 hover:text-white hover:bg-white/10'
                                    }`
                                }
                            >
                                {label}
                            </NavLink>
                        ))}

                        <div className="pt-2 mt-2 border-t border-white/10">
                            {user ? (
                                <div className="flex items-center justify-between px-3 py-2">
                                    <span className="text-white/60 text-sm">{user.username}</span>
                                    <button
                                        onClick={() => { logout(); setMobileMenuOpen(false); }}
                                        className="text-white/70 hover:text-white text-sm"
                                    >
                                        Sign out
                                    </button>
                                </div>
                            ) : (
                                <NavLink
                                    to="/login"
                                    onClick={() => setMobileMenuOpen(false)}
                                    className="flex items-center gap-2 px-3 py-2 text-sm text-white/75 hover:text-white transition-colors"
                                >
                                    <UserCircle size={16} /> Sign in
                                </NavLink>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </nav>
    );
};

function StackHandlerRoutes() {
    const location = useLocation();
    return <StackHandler app={stackClientApp} location={location.pathname} fullPage />;
}

function AppContent() {
    return (
        <div className="min-h-screen bg-surface text-text-primary font-sans selection:bg-brand-terracotta/20 selection:text-brand-terracotta">
            <NavBar />
            <main className="py-8 px-4">
                <Analytics />
                <Suspense fallback={
                    <div className="flex items-center justify-center py-20 text-text-muted text-sm">Loading…</div>
                }>
                    <Routes>
                        <Route path="/handler/*" element={<StackHandlerRoutes />} />
                        <Route path="/" element={<Calculator />} />
                        <Route path="/login" element={<Login />} />
                        <Route path="/upload" element={<UploadData />} />
                        <Route path="/about" element={<About />} />
                        <Route path="/data-sources" element={<DataTransparency />} />
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
                                <p className="text-6xl font-bold text-brand-teal">404</p>
                                <p className="text-text-secondary">Page not found.</p>
                                <Link to="/" className="inline-block text-brand-terracotta hover:underline text-sm font-medium">
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
            <StackProvider app={stackClientApp}>
                <StackTheme>
                    <Router>
                        <AuthProvider>
                            <AppContent />
                        </AuthProvider>
                    </Router>
                </StackTheme>
            </StackProvider>
        </Suspense>
    );
}

export default App;
