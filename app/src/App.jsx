import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { StackProvider, StackTheme, StackHandler } from "@stackframe/react";
import { Analytics } from "@vercel/analytics/react";
import Calculator from './components/Calculator';
import Login from './components/Login';
import UploadData from './components/UploadData';
import About from './components/About';
import DataTransparency from './components/DataTransparency';
import DataManagement from './components/DataManagement';
import ContributorProfile from './components/ContributorProfile';
import CommunityData from './components/CommunityData';
import { Fish, UserCircle, Menu, Database, BookOpen, Sun, Moon, Users } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useTheme } from './context/ThemeContext';
import { stackClientApp } from './config/neonAuth';

const NavBar = () => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

    return (
        <nav className="bg-brand-teal sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <div className="bg-white/15 p-2 rounded">
                  <Fish className="text-white h-5 w-5" />
                </div>
                <Link to="/" className="font-semibold text-lg tracking-tight text-white hover:text-brand-yellow transition-colors">Local Catch</Link>
              </div>

              <div className="hidden md:flex items-center space-x-6">
                <Link to="/" className="text-white/80 hover:text-brand-yellow transition text-sm font-medium">Calculator</Link>
                <Link to="/data-sources" className="text-white/80 hover:text-brand-yellow transition text-sm font-medium flex items-center gap-1">
                    <BookOpen size={14} /> Data Sources
                </Link>
                <Link to="/community-data" className="text-white/80 hover:text-brand-yellow transition text-sm font-medium flex items-center gap-1">
                    <Users size={14} /> Community
                </Link>
                {user && (
                    <Link to="/manage-data" className="text-white/80 hover:text-brand-yellow transition text-sm font-medium flex items-center gap-1">
                        <Database size={14} /> My Data
                    </Link>
                )}
                <Link to="/upload" className="text-white/80 hover:text-brand-yellow transition text-sm font-medium">Upload</Link>
                <Link to="/about" className="text-white/80 hover:text-brand-yellow transition text-sm font-medium">About</Link>
              </div>

              <div className="flex items-center gap-3">
                <button
                    onClick={toggleTheme}
                    className="p-2 rounded text-white/70 hover:text-white hover:bg-white/10 transition"
                    aria-label="Toggle theme"
                >
                    {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                </button>
                {user ? (
                    <div className="flex items-center gap-3">
                        <span className="text-white/70 text-sm">Hi, {user.username}</span>
                        <button onClick={logout} className="text-white/70 hover:text-white text-sm border border-white/30 px-3 py-1 rounded transition-colors">Logout</button>
                    </div>
                ) : (
                    <Link to="/login" className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-sm">
                        <UserCircle className="h-5 w-5" />
                        <span>Login</span>
                    </Link>
                )}
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="md:hidden text-white/80 hover:text-white transition-colors"
                  aria-label="Toggle mobile menu"
                >
                  <Menu className="h-6 w-6" />
                </button>
              </div>
            </div>

            {/* Mobile menu */}
            {mobileMenuOpen && (
              <div className="md:hidden border-t border-white/15">
                <div className="px-2 pt-2 pb-3 space-y-1">
                  <Link
                    to="/"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition"
                  >
                    Calculator
                  </Link>
                  <Link
                    to="/data-sources"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition"
                  >
                    <BookOpen size={14} /> Data Sources
                  </Link>
                  <Link
                    to="/community-data"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 rounded text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition"
                  >
                    <Users size={14} /> Community
                  </Link>
                  {user && (
                    <Link
                      to="/manage-data"
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 rounded text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition"
                    >
                      <Database size={14} /> My Data
                    </Link>
                  )}
                  <Link
                    to="/upload"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition"
                  >
                    Upload
                  </Link>
                  <Link
                    to="/about"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block px-3 py-2 rounded text-sm font-medium text-white/80 hover:text-white hover:bg-white/10 transition"
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
    <div className="min-h-screen bg-[#f5f0eb] dark:bg-[#0d1f26] text-[#1a2e35] dark:text-[#e8ddd4] font-sans selection:bg-brand-terracotta selection:text-white transition-colors">
      <NavBar />
      <main className="py-10 px-4">
        <Analytics />
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
          <Route path="/inventory" element={<div className="text-center mt-20 text-gray-400">Inventory Management Coming Soon</div>} />
        </Routes>
      </main>
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

