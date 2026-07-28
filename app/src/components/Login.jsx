import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight } from 'lucide-react';

const Login = () => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, register, loginWithGoogle, completeGoogleSignIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);

  useEffect(() => {
    const pendingSessionId = globalThis.sessionStorage?.getItem('firebase_google_session_id');
    if (!pendingSessionId) return;

    completeGoogleSignIn()
      .then((user) => {
        if (user) navigate('/');
      })
      .catch((err) => {
        setError(err?.message || 'Google sign-in failed. Please try again.');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setVerificationSent(false);

    try {
      if (isRegister) {
        const result = await register(email, password);
        if (result?.verificationSent) {
          setVerificationSent(true);
        } else if (result === true) {
          navigate('/');
        }
      } else {
        const success = await login(email, password);
        if (success) {
          navigate('/');
        }
      }
    } catch (err) {
      if (err?.message) {
        setError(err.message);
      } else if (isRegister) {
        setError('Registration failed. Email may already be in use.');
      } else {
        setError('Invalid credentials.');
      }
    }
  };

  if (verificationSent) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="card w-full max-w-md p-8 text-center space-y-4">
          <h2 className="text-2xl font-bold text-brand-teal">Check your email</h2>
          <p className="text-text-secondary text-sm">
            We sent a verification link to <strong>{email}</strong>. Click it to activate your account, then sign in.
          </p>
          <button
            onClick={() => { setVerificationSent(false); setIsRegister(false); }}
            className="text-brand-terracotta hover:underline text-sm"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="card w-full max-w-md p-8">
        <h2 className="text-2xl font-bold mb-6 text-center text-brand-teal">
          {isRegister ? 'Create Account' : 'Welcome Back'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="form-label">
              {isRegister ? 'Email' : 'Email or Username'}
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 text-brand-terracotta w-4 h-4" />
              <input
                id="email"
                type={isRegister ? 'email' : 'text'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input pl-10"
                required
              />
            </div>
          </div>

          <div>
            <label className="form-label">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-brand-terracotta w-4 h-4" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input pl-10"
                required
              />
            </div>
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button type="submit" className="btn-primary w-full flex items-center justify-center gap-2">
            {isRegister ? 'Sign Up' : 'Sign In'} <ArrowRight size={18} />
          </button>
        </form>

        {!isRegister && (
          <>
            <div className="my-4 flex items-center gap-3">
              <hr className="flex-1 border-text-secondary/20" />
              <span className="text-text-secondary text-xs">or</span>
              <hr className="flex-1 border-text-secondary/20" />
            </div>

            <button
              type="button"
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-center gap-2 border border-text-secondary/30 rounded px-4 py-2 text-sm text-text-primary hover:bg-surface-alt transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </button>
          </>
        )}

        <div className="mt-5 text-center">
          <button
            onClick={() => { setIsRegister(!isRegister); setError(''); setVerificationSent(false); }}
            className="text-text-secondary hover:text-brand-terracotta text-sm transition"
          >
            {isRegister ? "Already have an account? Sign In" : "Need an account? Sign Up"}
          </button>
        </div>

        <div className="mt-3 text-center">
          <button onClick={() => navigate('/')} className="text-text-secondary hover:text-text-primary text-sm transition">
            Continue as Guest
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
