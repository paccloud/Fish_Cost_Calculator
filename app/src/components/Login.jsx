import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight } from 'lucide-react';

const Login = () => {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (isRegister) {
        const success = await register(username, password);
        if (success) {
            // Auto login or switch to login
            const loginSuccess = await login(username, password);
            if (loginSuccess) navigate('/');
        } else {
            setError('Registration failed. Username may be taken.');
        }
    } else {
        const success = await login(username, password);
        if (success) navigate('/');
        else setError('Invalid credentials.');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="w-full max-w-md bg-white dark:bg-white/10 backdrop-blur-lg p-8 rounded-xl border border-slate-200 dark:border-white/20 shadow-xl">
        <h2 className="text-3xl font-bold mb-6 text-center text-slate-800 dark:text-white">
            {isRegister ? 'Create Account' : 'Welcome Back'}
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-6">
            <div>
                <label className="block text-slate-600 dark:text-gray-400 text-sm mb-2">Username</label>
                <div className="relative">
                    <User className="absolute left-3 top-3 text-cyan-500 w-5 h-5" />
                    <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white pl-10 p-3 rounded-lg focus:ring-2 focus:ring-cyan-500 outline-none"
                        required
                    />
                </div>
            </div>
            
            <div>
                <label className="block text-slate-600 dark:text-gray-400 text-sm mb-2">Password</label>
                <div className="relative">
                    <Lock className="absolute left-3 top-3 text-cyan-500 w-5 h-5" />
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white pl-10 p-3 rounded-lg focus:ring-2 focus:ring-cyan-500 outline-none"
                        required
                    />
                </div>
            </div>

            {error && <p className="text-red-400 text-sm text-center">{error}</p>}

            <button type="submit" className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold py-3 rounded-lg hover:from-cyan-400 hover:to-blue-500 transition shadow-lg flex items-center justify-center gap-2">
                {isRegister ? 'Sign Up' : 'Sign In'} <ArrowRight size={20} />
            </button>
        </form>

        <div className="mt-6 text-center">
            <button
                onClick={() => setIsRegister(!isRegister)}
                className="text-slate-600 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white text-sm transition"
            >
                {isRegister ? "Already have an account? Sign In" : "Need an account? Sign Up"}
            </button>
        </div>

        <div className="mt-4 text-center">
            <button onClick={() => navigate('/')} className="text-slate-500 dark:text-gray-500 hover:text-slate-700 dark:hover:text-gray-300 text-sm transition">
                Continue as Guest
            </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
