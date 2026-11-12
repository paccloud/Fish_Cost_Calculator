import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle } from 'lucide-react';

const GOOGLE_FAILED = 'Google sign-in didn’t finish. Try again, or use your email and password.';

const ErrorNotice = ({ children }) => (
  <p role="alert" className="flex items-start gap-2 text-base font-semibold text-danger">
    <AlertCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
    <span className="min-w-0 break-words">{children}</span>
  </p>
);

const Login = () => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, register, resendVerificationEmail, loginWithGoogle, completeGoogleSignIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    const pendingSessionId = globalThis.sessionStorage?.getItem('firebase_google_session_id');
    if (!pendingSessionId) return;

    // Only exchange when the URL has OAuth callback parameters. Without a `code`
    // or `state` param the user cancelled or hit Back — clear the stale session
    // instead of firing a doomed exchange request on every mount.
    const search = new URLSearchParams(globalThis.location?.search ?? '');
    if (!search.has('code') && !search.has('state')) {
      globalThis.sessionStorage?.removeItem('firebase_google_session_id');
      return;
    }

    completeGoogleSignIn()
      .then((user) => {
        if (user) navigate('/');
      })
      .catch((err) => {
        setError(err?.message || GOOGLE_FAILED);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setVerificationSent(false);
    setResent(false);

    try {
      if (isRegister) {
        const result = await register(email, password);
        if (result?.verificationSent) {
          setVerificationSent(true);
        } else if (result?.verificationFailed) {
          setVerificationFailed(true);
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
      if (isRegister) {
        // Surface the specific message for registration (password strength, etc.)
        setError(err?.message || 'The account wasn’t created. Check your connection and try again.');
      } else {
        // Pass through the verification-required error so the user knows to check
        // their email; use a generic message for all other failures to prevent
        // email enumeration (this path is reached only after Firebase accepted the password).
        const msg = err?.message || '';
        if (msg === 'Please verify your email before signing in.') {
          // Transition to the verification screen so the user can resend the
          // link — identical UX to post-registration, just without the welcome copy.
          setVerificationSent(true);
        } else {
          setError('That email or password isn’t right. Check both and try again.');
        }
      }
    }
  };

  if (verificationSent) {
    const handleResend = async () => {
      setError('');
      setResent(false);
      try {
        await resendVerificationEmail(email, password);
        setVerificationFailed(false);
        setError('');
        setResent(true);
      } catch (err) {
        setError(err?.message || 'The verification email didn’t send. Check your connection and try again.');
      }
    };

    return (
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-semibold text-text-primary">Check your email</h1>
        </header>
        <div className="card space-y-5 p-5 sm:p-6">
          {verificationFailed ? (
            <ErrorNotice>
              Your account was created, but the verification email to <strong>{email}</strong> didn&apos;t send. Use the button below to send it again.
            </ErrorNotice>
          ) : (
            <p className="break-words text-base text-text-secondary">
              We sent a verification link to <strong className="text-text-primary">{email}</strong>. Open it to activate your account, then sign in.
            </p>
          )}
          {error && <ErrorNotice>{error}</ErrorNotice>}
          {resent && !error && (
            <p role="status" className="flex items-start gap-2 text-base font-semibold text-success">
              <CheckCircle size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Sent. Check your inbox.</span>
            </p>
          )}
          <button
            type="button"
            onClick={handleResend}
            className="btn-primary w-full"
          >
            Resend verification email
          </button>
          <button
            type="button"
            onClick={() => { setVerificationSent(false); setVerificationFailed(false); setIsRegister(false); setError(''); setResent(false); }}
            className="btn-ghost -mx-3 text-base"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-text-primary">
          {isRegister ? 'Create account' : 'Sign in'}
        </h1>
        <p className="mt-2 text-base text-text-secondary">
          {isRegister
            ? 'An account keeps your yields and saved prices on every device, and lets you share yields with the community.'
            : 'Keep your yields and saved prices on every device.'}
        </p>
      </header>

      <div className="card p-5 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="form-label">
              {isRegister ? 'Email' : 'Email or username'}
            </label>
            <input
              id="email"
              type={isRegister ? 'email' : 'text'}
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete={isRegister ? 'email' : 'username'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="form-input"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="form-label">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="form-input"
              required
            />
          </div>

          {error && <ErrorNotice>{error}</ErrorNotice>}

          <button type="submit" className="btn-primary w-full">
            {isRegister ? 'Create account' : 'Sign in'} <ArrowRight size={20} aria-hidden="true" />
          </button>
        </form>

        {!isRegister && (
          <button
            type="button"
            onClick={() => loginWithGoogle().catch((err) => setError(err?.message || GOOGLE_FAILED))}
            className="btn-secondary mt-3 w-full"
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>
        )}

        <div className="mt-5 flex flex-col items-start">
          <button
            type="button"
            onClick={() => { setIsRegister(!isRegister); setError(''); setVerificationSent(false); setVerificationFailed(false); }}
            className="btn-ghost -mx-3 text-base"
          >
            {isRegister ? 'Have an account? Sign in' : 'New here? Create account'}
          </button>
          <Link to="/" className="btn-ghost -mx-3 text-base">
            Continue without an account
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
