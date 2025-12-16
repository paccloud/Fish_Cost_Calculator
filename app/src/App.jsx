import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Calculator from './components/Calculator';
import Login from './components/Login';
import UploadData from './components/UploadData';
import About from './components/About';
import DataTransparency from './components/DataTransparency';
import DataManagement from './components/DataManagement';
import { Fish, UserCircle, Menu, Database, BookOpen } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';

const NavBar = () => {
    const { user, logout } = useAuth();
    
    return (
        <nav className="bg-slate-900/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-tr from-cyan-500 to-blue-500 p-2 rounded-lg">
                  <Fish className="text-white h-6 w-6" />
                </div>
                <Link to="/" className="font-bold text-xl tracking-tight text-white hover:text-white">Scale & Cost</Link>
              </div>
              
              <div className="hidden md:flex items-center space-x-6">
                <Link to="/" className="text-gray-300 hover:text-cyan-400 transition">Calculator</Link>
                <Link to="/data-sources" className="text-gray-300 hover:text-cyan-400 transition flex items-center gap-1">
                    <BookOpen size={16} /> Data Sources
                </Link>
                {user && (
                    <Link to="/manage-data" className="text-gray-300 hover:text-cyan-400 transition flex items-center gap-1">
                        <Database size={16} /> My Data
                    </Link>
                )}
                <Link to="/upload" className="text-gray-300 hover:text-cyan-400 transition">Upload</Link>
                <Link to="/about" className="text-gray-300 hover:text-cyan-400 transition">About</Link>
              </div>

              <div className="flex items-center gap-4">
                {user ? (
                    <div className="flex items-center gap-4">
                        <span className="text-gray-300 text-sm">Hi, {user.username}</span>
                        <button onClick={logout} className="text-gray-400 hover:text-white text-sm border border-gray-600 px-3 py-1 rounded">Logout</button>
                    </div>
                ) : (
                    <Link to="/login" className="flex items-center gap-2 text-gray-300 hover:text-white transition">
                        <UserCircle className="h-6 w-6" />
                        <span>Login</span>
                    </Link>
                )}
                <button className="md:hidden text-gray-300">
                  <Menu className="h-6 w-6" />
                </button>
              </div>
            </div>
          </div>
        </nav>
    );
};

function App() {
  return (
    <AuthProvider>
        <Router>
        <div className="min-h-screen bg-slate-900 text-gray-100 font-sans selection:bg-cyan-500 selection:text-white">
            <NavBar />
            <main className="py-10 px-4">
            <Routes>
                <Route path="/" element={<Calculator />} />
                <Route path="/login" element={<Login />} />
                <Route path="/upload" element={<UploadData />} />
                <Route path="/about" element={<About />} />
                <Route path="/data-sources" element={<DataTransparency />} />
                <Route path="/manage-data" element={<DataManagement />} />
                <Route path="/inventory" element={<div className="text-center mt-20 text-gray-400">Inventory Management Coming Soon</div>} />
            </Routes>
            </main>
        </div>
        </Router>
    </AuthProvider>
  );
}

export default App;

