import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { StackProvider, StackTheme, StackHandler } from "@stackframe/react";
import Calculator from './components/Calculator';
import Login from './components/Login';
import UploadData from './components/UploadData';
import About from './components/About';
import DataTransparency from './components/DataTransparency';
import DataManagement from './components/DataManagement';
import ContributorProfile from './components/ContributorProfile';
import { Fish, UserCircle, Menu, Database, BookOpen, Sun, Moon } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useTheme } from './context/ThemeContext';
import { stackClientApp } from './config/neonAuth';

const NavBar = () => {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();

    return (
        <nav className="bg-stone-50/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-white/10 sticky top-0 z-50 transition-colors">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-tr from-cyan-500 to-blue-500 p-2 rounded-lg">
                  <Fish className="text-white h-6 w-6" />
                </div>
                <Link to="/" className="font-bold text-xl tracking-tight text-slate-800 dark:text-white hover:text-slate-900 dark:hover:text-white transition-colors">Local Catch</Link>
              </div>
              
              <div className="hidden md:flex items-center space-x-6">
                <Link to="/" className="text-slate-600 dark:text-gray-300 hover:text-cyan-500 dark:hover:text-cyan-400 transition">Calculator</Link>
                <Link to="/data-sources" className="text-slate-600 dark:text-gray-300 hover:text-cyan-500 dark:hover:text-cyan-400 transition flex items-center gap-1">
                    <BookOpen size={16} /> Data Sources
                </Link>
                {user && (
                    <Link to="/manage-data" className="text-slate-600 dark:text-gray-300 hover:text-cyan-500 dark:hover:text-cyan-400 transition flex items-center gap-1">
                        <Database size={16} /> My Data
                    </Link>
                )}
                <Link to="/upload" className="text-slate-600 dark:text-gray-300 hover:text-cyan-500 dark:hover:text-cyan-400 transition">Upload</Link>
                <Link to="/about" className="text-slate-600 dark:text-gray-300 hover:text-cyan-500 dark:hover:text-cyan-400 transition">About</Link>
              </div>

              <div className="flex items-center gap-4">
                <button
                    onClick={toggleTheme}
                    className="p-2 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-gray-300 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all duration-200"
                    aria-label="Toggle theme"
                >
                    {theme === 'dark' ? <Sun size={20} className="transition-transform duration-200" /> : <Moon size={20} className="transition-transform duration-200" />}
                </button>
                {user ? (
                    <div className="flex items-center gap-4">
                        <span className="text-slate-600 dark:text-gray-300 text-sm">Hi, {user.username}</span>
                        <button onClick={logout} className="text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white text-sm border border-slate-300 dark:border-gray-600 px-3 py-1 rounded transition-colors">Logout</button>
                    </div>
                ) : (
                    <Link to="/login" className="flex items-center gap-2 text-slate-600 dark:text-gray-300 hover:text-slate-800 dark:hover:text-white transition-colors">
                        <UserCircle className="h-6 w-6" />
                        <span>Login</span>
                    </Link>
                )}
                <button className="md:hidden text-slate-600 dark:text-gray-300">
                  <Menu className="h-6 w-6" />
                </button>
              </div>
            </div>
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
    <div className="min-h-screen bg-stone-50 dark:bg-slate-900 text-slate-800 dark:text-gray-100 font-sans selection:bg-cyan-500 selection:text-white transition-colors">
      <NavBar />
      <main className="py-10 px-4">
        <Routes>
          <Route path="/handler/*" element={<StackHandlerRoutes />} />
          <Route path="/" element={<Calculator />} />
          <Route path="/login" element={<Login />} />
          <Route path="/upload" element={<UploadData />} />
          <Route path="/about" element={<About />} />
          <Route path="/data-sources" element={<DataTransparency />} />
          <Route path="/manage-data" element={<DataManagement />} />
          <Route path="/profile" element={<ContributorProfile />} />
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

