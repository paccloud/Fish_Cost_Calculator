import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { StackProvider, StackTheme, StackHandler } from "@stackframe/react";
import { Analytics } from "@vercel/analytics/react";
import Calculator from './components/Calculator';
import Login from './components/Login';
import UploadData from './components/UploadData';
import About from './components/About';
import SubmitRequest from './components/SubmitRequest';
import DataTransparency from './components/DataTransparency';
import DataManagement from './components/DataManagement';
import ContributorProfile from './components/ContributorProfile';
import FeaturesRoadmap from './components/FeaturesRoadmap';
import Footer from './components/Footer';
import { Fish, UserCircle, Menu, Database, BookOpen, Sun, Moon, MessageSquarePlus, Target } from 'lucide-react';
import { AuthProvider } from './context/AuthContext.jsx';
import { useAuth } from './context/useAuth';
import { useTheme } from './context/ThemeContext';
import { stackClientApp } from './config/neonAuth';

const NavBar = () => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

    return (
        <nav className="bg-navy border-b border-white/10 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <div className="bg-teal p-2 rounded-lg">
                  <Fish className="text-white h-6 w-6" />
                </div>
                <Link to="/" className="font-heading font-bold text-lg text-white hover:text-white transition-colors">Fish Cost Calculator</Link>
              </div>

              <div className="hidden md:flex items-center space-x-6">
                <Link to="/data-sources" className="text-white/70 hover:text-rust transition flex items-center gap-1.5">
                    <BookOpen size={16} /> Data
                </Link>
                {user && (
                    <Link to="/manage-data" className="text-white/70 hover:text-rust transition flex items-center gap-1.5">
                        <Database size={16} /> My Data
                    </Link>
                )}
                <Link to="/roadmap" className="text-white/70 hover:text-rust transition flex items-center gap-1.5">
                    <Target size={16} /> Roadmap
                </Link>
                <Link to="/about" className="text-white/70 hover:text-rust transition">About</Link>
              </div>

              <div className="flex items-center gap-4">
                <button
                    onClick={toggleTheme}
                    className="p-2 rounded-lg text-white/70 hover:text-white bg-white/10 hover:bg-white/15 transition-all duration-200"
                    aria-label="Toggle theme"
                >
                    {theme === 'dark' ? <Sun size={20} className="transition-transform duration-200" /> : <Moon size={20} className="transition-transform duration-200" />}
                </button>
                {user ? (
                    <div className="flex items-center gap-4">
                        <span className="text-white/70 text-sm">Hi, {user.username}</span>
                        <button onClick={logout} className="text-white/70 hover:text-white text-sm border border-white/20 px-3 py-1 rounded transition-colors">Logout</button>
                    </div>
                ) : (
                    <Link to="/login" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
                        <UserCircle className="h-6 w-6" />
                        <span>Login</span>
                    </Link>
                )}
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="md:hidden text-white/70 hover:text-white transition-colors"
                  aria-label="Toggle mobile menu"
                >
                  <Menu className="h-6 w-6" />
                </button>
              </div>
            </div>

            {/* Mobile menu */}
            {mobileMenuOpen && (
              <div className="md:hidden border-t border-white/10">
                <div className="px-2 pt-2 pb-3 space-y-1">
                  <Link
                    to="/data-sources"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md text-base font-medium text-white/70 hover:text-white hover:bg-white/10 transition flex items-center gap-2"
                  >
                    <BookOpen size={16} /> Data Sources
                  </Link>
                  {user && (
                    <Link
                      to="/manage-data"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-3 py-2 rounded-md text-base font-medium text-white/70 hover:text-white hover:bg-white/10 transition flex items-center gap-2"
                    >
                      <Database size={16} /> My Data
                    </Link>
                  )}
                  <Link
                    to="/roadmap"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md text-base font-medium text-white/70 hover:text-white hover:bg-white/10 transition flex items-center gap-2"
                  >
                    <Target size={16} /> Roadmap
                  </Link>
                  <Link
                    to="/about"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded-md text-base font-medium text-white/70 hover:text-white hover:bg-white/10 transition"
                  >
                    About
                  </Link>
                </div>
              </div>
            )}
          </div>
        </nav>
    );
};

function StackHandlerRoutes() {
  const location = useLocation();
  return <StackHandler app={stackClientApp} location={location.pathname} fullPage />;
}

function AppContent() {
  return (
    <div className="min-h-screen flex flex-col bg-surface text-text-primary font-body selection:bg-teal selection:text-white transition-colors">
      <NavBar />
      <main className="flex-1">
        <Analytics />
        <Routes>
          <Route path="/handler/*" element={<StackHandlerRoutes />} />
          <Route path="/" element={<div className="py-10 px-4"><Calculator /></div>} />
          <Route path="/calculator" element={<div className="py-10 px-4"><Calculator /></div>} />
          <Route path="/login" element={<div className="py-10 px-4"><Login /></div>} />
          <Route path="/upload" element={<div className="py-10 px-4"><UploadData /></div>} />
          <Route path="/about" element={<div className="py-10 px-4"><About /></div>} />
          <Route path="/submit-request" element={<div className="py-10 px-4"><SubmitRequest /></div>} />
          <Route path="/data-sources" element={<div className="py-10 px-4"><DataTransparency /></div>} />
          <Route path="/manage-data" element={<div className="py-10 px-4"><DataManagement /></div>} />
          <Route path="/profile" element={<div className="py-10 px-4"><ContributorProfile /></div>} />
          <Route path="/roadmap" element={<div className="py-10 px-4"><FeaturesRoadmap /></div>} />
          <Route path="/inventory" element={<div className="py-10 px-4 text-center mt-20 text-gray-400">Inventory Management Coming Soon</div>} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
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

