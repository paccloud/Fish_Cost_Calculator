import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight } from 'lucide-react';

const Login = () => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isRegister) {
      const success = await register(email, password);
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



  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="card w-full max-w-md p-8">
        <h2 className="text-2xl font-bold mb-6 text-center text-brand-teal">
          {isRegister ? 'Create Account' : 'Welcome Back'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="form-label">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 text-brand-terracotta w-4 h-4" />
              <input
                id="email"
                type="email"
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

        <div className="mt-5 text-center">
          <button
            onClick={() => setIsRegister(!isRegister)}
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
