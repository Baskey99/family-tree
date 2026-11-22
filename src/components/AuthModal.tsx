import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  User as UserIcon,
  UserPlus,
  X,
} from 'lucide-react';
import { normalizeUsernameKey } from '../lib/firebase';

export type AuthModalMode = 'login' | 'register' | 'reset';

interface AuthModalProps {
  open: boolean;
  initialMode: AuthModalMode;
  onClose: () => void;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onRegister: (params: {
    name: string;
    username?: string;
    email: string;
    password: string;
  }) => Promise<void>;
  onResetPassword: (identifier: string) => Promise<string>;
  onGoogleSignIn: () => Promise<void>;
}

export function AuthModal({
  open,
  initialMode,
  onClose,
  onLogin,
  onRegister,
  onResetPassword,
  onGoogleSignIn,
}: AuthModalProps) {
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<AuthModalMode>(initialMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSentEmail, setResetSentEmail] = useState<string | null>(null);

  // Login fields
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Reset password field
  const [resetIdentifier, setResetIdentifier] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setError(null);
    setResetSentEmail(null);
    setSubmitting(false);
    setShowPassword(false);
    setShowConfirmPassword(false);
    window.setTimeout(() => firstInputRef.current?.focus(), 40);
  }, [open, initialMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const suggestedUsername = normalizeUsernameKey(regUsername || regName);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!loginIdentifier.trim()) {
      setError('Please enter your username or email.');
      return;
    }
    if (!loginPassword) {
      setError('Please enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      await onLogin(loginIdentifier, loginPassword);
      setLoginPassword('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetSentEmail(null);
    if (!resetIdentifier.trim()) {
      setError('Please enter your username or email address.');
      return;
    }

    setSubmitting(true);
    try {
      const sentTo = await onResetPassword(resetIdentifier);
      setResetSentEmail(sentTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send password reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!regName.trim()) {
      setError('Full Name is required.');
      return;
    }
    if (!regEmail.trim() || !regEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (regPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setError('Password and Confirm Password do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await onRegister({
        name: regName,
        username: regUsername.trim() || undefined,
        email: regEmail,
        password: regPassword,
      });
      setRegPassword('');
      setRegConfirmPassword('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onGoogleSignIn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 dark:bg-black/70 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[92dvh] bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-2.5 pb-0.5 sm:hidden shrink-0" aria-hidden="true">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
          <div>
            <h2
              id="auth-modal-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {mode === 'login'
                ? 'Sign in to Kinship'
                : mode === 'reset'
                  ? 'Reset your password'
                  : 'Create your account'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {mode === 'login'
                ? 'Access and sync your family trees across devices.'
                : mode === 'reset'
                  ? 'Enter your username or email to receive a reset link.'
                  : 'Register to save your family tree securely in Firebase.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Mode Switcher (Login / Register) */}
        {mode !== 'reset' && (
          <div className="px-5 sm:px-6 pt-4 shrink-0">
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                  setResetSentEmail(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-md transition-colors ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                  setResetSentEmail(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-md transition-colors ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                Register
              </button>
            </div>
          </div>
        )}

        <div className="px-5 sm:px-6 py-5 pb-safe space-y-4 overflow-y-auto">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs leading-relaxed"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'reset' ? (
            <div className="space-y-4">
              {resetSentEmail ? (
                <div
                  role="status"
                  className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200 space-y-2.5"
                >
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <div className="text-xs leading-relaxed space-y-1">
                      <p className="font-semibold">Reset link sent</p>
                      <p>
                        We sent a password reset link to{' '}
                        <span className="font-mono font-medium">{resetSentEmail}</span>. Check your
                        inbox and spam folder, then sign in with your new password.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleResetSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="reset-identifier"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Username or Email
                    </label>
                    <div className="relative">
                      <KeyRound
                        className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        ref={firstInputRef}
                        id="reset-identifier"
                        type="text"
                        autoComplete="username"
                        required
                        value={resetIdentifier}
                        onChange={(e) => setResetIdentifier(e.target.value)}
                        placeholder="e.g., aarav_sharma or you@example.com"
                        className="w-full pl-9 pr-3.5 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-slate-900 dark:focus:border-slate-400"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 text-sm font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Sending reset link...' : 'Send Reset Link'}
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                  setResetSentEmail(null);
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                Back to Login
              </button>
            </div>
          ) : mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="login-username"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Username or Email
                </label>
                <div className="relative">
                  <UserIcon
                    className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    ref={firstInputRef}
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    required
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder="e.g., aarav_sharma or you@example.com"
                    className="w-full pl-9 pr-3.5 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-slate-900 dark:focus:border-slate-400"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetIdentifier(loginIdentifier);
                      setError(null);
                      setResetSentEmail(null);
                      setMode('reset');
                    }}
                    className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-9 pr-10 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-slate-900 dark:focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 text-sm font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors disabled:opacity-50"
              >
                {submitting ? 'Signing in...' : 'Login'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div>
                <label
                  htmlFor="reg-name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Full Name <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <div className="relative">
                  <UserIcon
                    className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    ref={firstInputRef}
                    id="reg-name"
                    type="text"
                    autoComplete="name"
                    required
                    maxLength={100}
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="e.g., Aarav Sharma"
                    className="w-full pl-9 pr-3.5 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-slate-900 dark:focus:border-slate-400"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-username"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Username{' '}
                  <span className="font-normal text-slate-400 dark:text-slate-500">
                    (Optional — used for login)
                  </span>
                </label>
                <input
                  id="reg-username"
                  type="text"
                  autoComplete="username"
                  maxLength={40}
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  placeholder={suggestedUsername || 'e.g., aarav_sharma'}
                  className="w-full px-3.5 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg font-mono focus:border-slate-900 dark:focus:border-slate-400"
                />
                {suggestedUsername && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Login username will be:{' '}
                    <span className="font-mono font-medium text-slate-700 dark:text-slate-200">
                      {suggestedUsername}
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="reg-email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Email <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Mail
                    className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-9 pr-3.5 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-slate-900 dark:focus:border-slate-400"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Password <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full pl-9 pr-10 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-slate-900 dark:focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-confirm"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Confirm Password <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    id="reg-confirm"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className={`w-full pl-9 pr-10 py-2 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border rounded-lg focus:border-slate-900 dark:focus:border-slate-400 ${
                      regConfirmPassword && regPassword !== regConfirmPassword
                        ? 'border-rose-400 bg-rose-50/40 dark:bg-rose-950/30'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((s) => !s)}
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {regConfirmPassword && regPassword !== regConfirmPassword && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">
                    Passwords do not match.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 text-sm font-medium text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors disabled:opacity-50"
              >
                {submitting ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          )}

          {mode !== 'reset' && (
            <>
              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="shrink mx-3 text-[11px] text-slate-400 dark:text-slate-500">or</span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleGoogle()}
                className="w-full py-2.5 px-4 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                Continue with Google
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
