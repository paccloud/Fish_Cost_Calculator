import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, User, ArrowRight } from 'lucide-react';

// Simple SVG icon for Google OAuth
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const Login = () => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, register, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [oauthLoading, setOauthLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isRegister) {
      const success = await register(email, password, username);
      if (success) {
        navigate('/');
      } else {
        setError('Registration failed. Email may already be in use.');
      }
    } else {
      const success = await login(email, password);
      if (success) navigate('/');
      else setError('Invalid credentials.');
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setOauthLoading(true);
    try {
      await signInWithGoogle();
      // OAuth will redirect, so we don't need to navigate here
    } catch (e) {
      setError('Failed to sign in with Google');
      setOauthLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="w-full max-w-md bg-surface-elevated border border-border p-8 rounded-xl shadow-sm">
        <h2 className="font-heading text-2xl font-bold mb-6 text-center text-navy dark:text-text-primary">
          {isRegister ? 'Create Account' : 'Welcome Back'}
        </h2>

        {/* Google OAuth Button */}
        <div className="space-y-3 mb-6">
          <button
            onClick={handleGoogleSignIn}
            disabled={oauthLoading}
            className="w-full flex items-center justify-center gap-3 bg-surface-elevated border border-border text-text-primary font-medium py-3 rounded-lg hover:bg-surface transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GoogleIcon />
            {oauthLoading ? 'Connecting...' : 'Continue with Google'}
          </button>
        </div>

        {/* Divider */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-surface-elevated dark:bg-surface-elevated text-text-secondary">
              or continue with email
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-text-secondary text-sm font-medium mb-2">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 text-teal w-5 h-5" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface border border-border text-text-primary pl-10 p-3 rounded-lg focus:ring-2 focus:ring-teal outline-none"
                placeholder="you@example.com"
                required
              />
            </div>
          </div>

          {isRegister && (
            <div>
              <label htmlFor="username" className="block text-text-secondary text-sm font-medium mb-2">Display Name</label>
              <div className="relative">
                <User className="absolute left-3 top-3 text-teal w-5 h-5" />
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-surface border border-border text-text-primary pl-10 p-3 rounded-lg focus:ring-2 focus:ring-teal outline-none"
                  placeholder="Your name"
                  required
                />
              </div>
            </div>
          )}

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
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
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
