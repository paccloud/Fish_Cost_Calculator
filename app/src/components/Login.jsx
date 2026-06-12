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
      <div className="w-full max-w-md bg-surface-elevated border border-border p-8 rounded-xl shadow-sm">
        <h2 className="font-heading text-2xl font-bold mb-6 text-center text-navy dark:text-text-primary">
          {isRegister ? 'Create Account' : 'Welcome Back'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="username" className="block text-text-secondary text-sm font-medium mb-2">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-3 text-teal w-5 h-5" />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-surface border border-border text-text-primary pl-10 p-3 rounded-lg focus:ring-2 focus:ring-teal outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-text-secondary text-sm font-medium mb-2">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-teal w-5 h-5" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface border border-border text-text-primary pl-10 p-3 rounded-lg focus:ring-2 focus:ring-teal outline-none"
                required
              />
            </div>
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center" role="alert" aria-live="assertive">
              {error}
            </p>
          )}

          <button type="submit" className="w-full bg-rust hover:bg-[#B8532A] dark:hover:bg-[#F07D4A] text-white font-semibold py-3 rounded-lg transition active:scale-[0.98] flex items-center justify-center gap-2">
            {isRegister ? 'Sign Up' : 'Sign In'} <ArrowRight size={20} />
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-text-secondary hover:text-teal text-sm transition"
          >
            {isRegister ? "Already have an account? Sign In" : "Need an account? Sign Up"}
          </button>
        </div>

        <div className="mt-4 text-center">
          <button onClick={() => navigate('/')} className="text-text-secondary hover:text-text-primary text-sm transition">
            Continue as Guest
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
