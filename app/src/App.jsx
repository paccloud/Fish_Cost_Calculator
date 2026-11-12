import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigationType } from 'react-router-dom';
import { Analytics } from "@vercel/analytics/react";
import { Fish } from 'lucide-react';
import Calculator from './components/Calculator';
import { AuthProvider } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { backendEnabled, isNativeApp } from './config/platform';
import TabBar from './components/TabBar';
import MoveNotice from './components/MoveNotice';

const Login = lazy(() => import('./components/Login'));
const UploadData = lazy(() => import('./components/UploadData'));
const About = lazy(() => import('./components/About'));
const DataTransparency = lazy(() => import('./components/DataTransparency'));
const DataManagement = lazy(() => import('./components/DataManagement'));
const ContributorProfile = lazy(() => import('./components/ContributorProfile'));
const CommunityData = lazy(() => import('./components/CommunityData'));
const Account = lazy(() => import('./components/Account'));
const AppSettings = lazy(() => import('./components/Account').then((module) => ({ default: module.AppSettings })));

// Side gutters: 16px (24px from 640px), or the device's inset when a notch is wider than that
const GUTTERS =
    'pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] ' +
    'sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]';

/**
 * The wordmark row. On a phone that is all it is: the tabs are pinned to the bottom edge
 * (TabBar draws itself there). From 768px the same tabs sit in this row as text, and the
 * row sticks to the top. It is paper, not teal: teal means "chosen" or "go".
 */
const Header = () => (
    <header className="bg-surface pt-[env(safe-area-inset-top)] md:sticky md:top-0 md:z-40 md:border-b md:border-line">
        <div className={`mx-auto flex h-14 max-w-5xl items-center justify-between gap-6 ${GUTTERS}`}>
            {/* There is no logo yet: the name in the display face beside a teal tile (style guide, "Icons and imagery") */}
            <Link to="/" className="flex min-h-target shrink-0 items-center gap-2 rounded">
                <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded bg-brand-teal text-on-primary">
                    <Fish size={18} />
                </span>
                <span className="font-display text-xl font-semibold leading-6 text-text-primary">Local Catch</span>
            </Link>
            <TabBar />
        </div>
    </header>
);

// A new screen starts at its top. Going back keeps the place the browser remembers.
function ScrollToTop() {
    const { pathname } = useLocation();
    const navigationType = useNavigationType();

    useEffect(() => {
        if (navigationType !== 'POP') window.scrollTo(0, 0);
    }, [pathname, navigationType]);

    return null;
}

// With no API (the store build) there is nothing to sign in to and no community yields to show
const needsBackend = (element) => (backendEnabled ? element : <Navigate to="/" replace />);

function AppContent() {
    return (
        <div className="min-h-screen bg-surface text-text-primary font-sans selection:bg-brand-terracotta/20 selection:text-link">
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-[calc(env(safe-area-inset-top)+0.75rem)] focus:z-[60] focus:inline-flex focus:min-h-target focus:items-center focus:rounded-lg focus:bg-surface-raised focus:px-4 focus:py-2 focus:font-semibold focus:text-text-primary focus:shadow-lg"
            >
                Skip to main content
            </a>
            {/* In the store app the page scrolls under the status bar; this keeps paper behind the clock */}
            <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-[env(safe-area-inset-top)] bg-surface" />
            <ScrollToTop />
            <Header />
            <MoveNotice />
            {/* The bottom padding clears the phone tab bar; --tabbar-height is 0 from 768px */}
            <main
                id="main"
                tabIndex={-1}
                className={`pb-[calc(var(--tabbar-height)+2rem)] pt-2 focus:outline-none md:pt-8 ${GUTTERS}`}
            >
                {!isNativeApp && <Analytics />}
                <Suspense fallback={
                    <div className="flex items-center justify-center py-20 text-text-muted text-sm">Loading…</div>
                }>
                    <Routes>
                        <Route path="/" element={<Calculator />} />
                        <Route path="/login" element={needsBackend(<Login />)} />
                        <Route path="/upload" element={<UploadData />} />
                        <Route path="/about" element={backendEnabled ? <About /> : (
                            // About is the third tab here and there is no Account tab,
                            // so the theme switch and the other screens are reached from it
                            <>
                                <About />
                                <div className="mx-auto mt-4 max-w-content">
                                    <AppSettings aboutLink={false} />
                                </div>
                            </>
                        )} />
                        <Route path="/data-sources" element={<DataTransparency />} />
                        <Route path="/manage-data" element={<DataManagement />} />
                        <Route path="/profile" element={needsBackend(<ContributorProfile />)} />
                        <Route path="/community-data" element={needsBackend(<CommunityData />)} />
                        <Route path="/account" element={<Account />} />
                        <Route path="*" element={
                            <div className="mx-auto mt-16 max-w-content space-y-4">
                                <h1 className="type-title">Page not found</h1>
                                <p className="text-base text-text-secondary">There is nothing at this address.</p>
                                <Link to="/" className="btn-secondary">Back to the calculator</Link>
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
                <AuthProvider>
                    <DataProvider>
                        <AppContent />
                    </DataProvider>
                </AuthProvider>
            </Router>
        </Suspense>
    );
}

export default App;
