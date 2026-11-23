import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  checkRateLimit,
  evaluatePasswordStrength,
  recordRateLimitAttempt,
  resetRateLimit,
  sanitizeSingleLine,
} from './security';

// User's configured Firebase project (family-tree-8b9de)
const firebaseConfig = {
  apiKey: 'AIzaSyAu8B9DxyIrL_ZQbFJvXAOM48UvbLHyQuM',
  authDomain: 'family-tree-8b9de.firebaseapp.com',
  projectId: 'family-tree-8b9de',
  storageBucket: 'family-tree-8b9de.firebasestorage.app',
  messagingSenderId: '946257262867',
  appId: '1:946257262867:web:cbb6c4647febd77bce02e6',
};

const app = initializeApp(firebaseConfig);

// Firebase App Check (reCAPTCHA v3) — automatically activates when VITE_RECAPTCHA_SITE_KEY is set
const recaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY || '').trim();
if (typeof window !== 'undefined' && recaptchaSiteKey) {
  try {
    const debugToken = (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || '').trim();
    if (debugToken) {
      (window as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
        debugToken === 'true' ? true : debugToken;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('Firebase App Check initialization skipped:', err);
  }
}

export const db = getFirestore(app);
export const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('profile');
googleProvider.addScope('email');
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Normalizes a username or name into a valid Firestore document ID key (lowercase a-z, 0-9, _, -).
 */
export function normalizeUsernameKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
}

export class AuthFlowError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthFlowError';
    this.code = code;
  }
}

export function getAuthErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code?: string }).code || '');
  }
  return '';
}

export function formatFirebaseAuthError(error: unknown, email?: string): string {
  const code = getAuthErrorCode(error);
  switch (code) {
    case 'auth/email-already-in-use':
      return email
        ? `An account with "${email}" is already registered. Please sign in or reset your password instead.`
        : 'This email address is already registered. Please sign in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 8 characters with letters and numbers.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid username/email or password. Please check your credentials and try again.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a moment and try again.';
    case 'auth/app-check-token-is-invalid':
    case 'auth/firebase-app-check-token-is-invalid':
      return 'Security verification failed. Please refresh the page and try again.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled yet in Firebase Console (Authentication → Sign-in method → enable Google and Email/Password).';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in window was closed before completing.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
    case 'auth/cancelled-popup-request':
      return 'Sign-in popup request was cancelled. Please try again.';
    case 'auth/unauthorized-domain': {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      return `Domain "${host}" is not authorized for Google Sign-In. Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains.`;
    }
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method. Please sign in with your email and password.';
    case 'auth/missing-email':
      return 'Please enter your email address.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection and try again.';
    default:
      return error instanceof Error ? error.message : 'Authentication failed. Please try again.';
  }
}

export async function registerWithEmailPassword(params: {
  name: string;
  username?: string;
  email: string;
  password: string;
}): Promise<User> {
  const rateCheck = checkRateLimit('register');
  if (!rateCheck.allowed) {
    throw new AuthFlowError('auth/too-many-requests', rateCheck.message || 'Please wait before trying again.');
  }

  const cleanName = sanitizeSingleLine(params.name, 100);
  const cleanEmail = sanitizeSingleLine(params.email, 254).toLowerCase();
  const hasExplicitUsername = Boolean(params.username?.trim());
  let chosenUsername = normalizeUsernameKey(
    params.username?.trim() || cleanName || cleanEmail.split('@')[0]
  );

  if (!cleanName) throw new Error('Full Name is required.');
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new AuthFlowError('auth/invalid-email', 'Please enter a valid email address.');
  }
  if (chosenUsername.length < 2) {
    throw new Error('Username must contain at least 2 letters or numbers.');
  }

  const strength = evaluatePasswordStrength(params.password);
  if (!strength.isAcceptable) {
    throw new AuthFlowError('auth/weak-password', strength.reason || 'Please choose a stronger password.');
  }

  let autoUsernameTaken = false;

  // Check username lookup before creating Auth account so we surface duplicate emails
  // or taken custom usernames cleanly without creating orphaned Auth records.
  try {
    const existingLookup = await getDoc(doc(db, 'usernames', chosenUsername));
    if (existingLookup.exists()) {
      const existingEmail = String(existingLookup.data()?.email || '')
        .trim()
        .toLowerCase();
      if (existingEmail && existingEmail === cleanEmail) {
        recordRateLimitAttempt('register');
        throw new AuthFlowError(
          'auth/email-already-in-use',
          formatFirebaseAuthError({ code: 'auth/email-already-in-use' }, cleanEmail)
        );
      }
      if (hasExplicitUsername) {
        throw new AuthFlowError(
          'auth/username-already-in-use',
          `The username "${chosenUsername}" is already taken. Please choose another username.`
        );
      }
      autoUsernameTaken = true;
    }
  } catch (err) {
    if (err instanceof AuthFlowError) {
      throw err;
    }
    // If rules haven't been published yet or offline, let Auth creation proceed and handle below
  }

  let user: User;
  try {
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
    user = cred.user;
    await updateProfile(user, { displayName: cleanName });
    recordRateLimitAttempt('register');
  } catch (error) {
    recordRateLimitAttempt('register');
    const code = getAuthErrorCode(error) || 'auth/registration-failed';
    throw new AuthFlowError(code, formatFirebaseAuthError(error, cleanEmail));
  }

  // If the auto-derived username collided with another user, assign a unique suffix
  if (autoUsernameTaken) {
    const uidSuffix = user.uid.slice(0, 5).toLowerCase().replace(/[^a-z0-9]/g, 'x');
    chosenUsername = `${chosenUsername.slice(0, 34)}_${uidSuffix}`;
  }

  // Persist user profile and username lookup index in Firestore
  try {
    await setDoc(doc(db, 'users', user.uid), {
      ownerId: user.uid,
      displayName: cleanName,
      username: chosenUsername,
      email: cleanEmail,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
  }

  try {
    await setDoc(doc(db, 'usernames', chosenUsername), {
      ownerId: user.uid,
      email: cleanEmail,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `usernames/${chosenUsername}`);
  }

  return user;
}

export async function loginWithUsernameOrEmail(
  identifier: string,
  password: string
): Promise<User> {
  const rateCheck = checkRateLimit('login');
  if (!rateCheck.allowed) {
    throw new AuthFlowError('auth/too-many-requests', rateCheck.message || 'Too many failed login attempts.');
  }

  const trimmed = sanitizeSingleLine(identifier, 254);
  if (!trimmed) throw new Error('Username or Email is required.');
  if (!password) throw new Error('Password is required.');

  let emailToSignIn = trimmed;

  if (!trimmed.includes('@')) {
    const usernameKey = normalizeUsernameKey(trimmed);
    if (!usernameKey) {
      throw new Error('Please enter a valid username or email address.');
    }
    let snap;
    try {
      snap = await getDoc(doc(db, 'usernames', usernameKey));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `usernames/${usernameKey}`);
    }
    if (!snap.exists()) {
      recordRateLimitAttempt('login');
      throw new AuthFlowError(
        'auth/invalid-credential',
        'Invalid username/email or password. Please check your credentials and try again.'
      );
    }
    const data = snap.data();
    if (!data?.email || typeof data.email !== 'string') {
      throw new Error('Account lookup is incomplete. Please sign in with your email address.');
    }
    emailToSignIn = data.email;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, emailToSignIn, password);
    resetRateLimit('login');
    return cred.user;
  } catch (error) {
    recordRateLimitAttempt('login');
    const code = getAuthErrorCode(error) || 'auth/login-failed';
    throw new AuthFlowError(code, formatFirebaseAuthError(error));
  }
}

export async function sendPasswordResetForIdentifier(identifier: string): Promise<string> {
  const rateCheck = checkRateLimit('reset_password');
  if (!rateCheck.allowed) {
    throw new AuthFlowError('auth/too-many-requests', rateCheck.message || 'Please wait before requesting another reset email.');
  }

  const trimmed = sanitizeSingleLine(identifier, 254);
  if (!trimmed) {
    throw new Error('Please enter your username or email address.');
  }

  let emailToReset = trimmed.toLowerCase();

  if (!trimmed.includes('@')) {
    const usernameKey = normalizeUsernameKey(trimmed);
    if (usernameKey.length < 2) {
      throw new Error('Please enter a valid username or email address.');
    }
    let snap;
    try {
      snap = await getDoc(doc(db, 'usernames', usernameKey));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `usernames/${usernameKey}`);
    }
    if (!snap.exists()) {
      recordRateLimitAttempt('reset_password');
      throw new Error('No account found with that username. Try entering your email address.');
    }
    const data = snap.data();
    if (!data?.email || typeof data.email !== 'string') {
      throw new Error('Account lookup is incomplete. Please enter your email address directly.');
    }
    emailToReset = data.email.trim().toLowerCase();
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToReset)) {
    throw new Error('Please enter a valid email address.');
  }

  try {
    await sendPasswordResetEmail(auth, emailToReset);
    recordRateLimitAttempt('reset_password');
    return emailToReset;
  } catch (error) {
    recordRateLimitAttempt('reset_password');
    const code = getAuthErrorCode(error) || 'auth/reset-failed';
    throw new AuthFlowError(code, formatFirebaseAuthError(error));
  }
}

/**
 * Ensures a Google-authenticated user has a private /users/{uid} profile
 * and a /usernames/{usernameKey} lookup record so family members can invite them
 * by username as well as by email.
 */
async function ensureGoogleUserProfile(user: User): Promise<void> {
  const cleanEmail = (user.email || '').trim().toLowerCase().slice(0, 254);
  if (cleanEmail.length < 3) return;

  const cleanName = (
    user.displayName?.trim() ||
    cleanEmail.split('@')[0] ||
    'Family Member'
  ).slice(0, 100);

  try {
    const userRef = doc(db, 'users', user.uid);
    const existingProfile = await getDoc(userRef);

    if (existingProfile.exists()) {
      const data = existingProfile.data();
      if (data?.displayName !== cleanName) {
        await updateDoc(userRef, {
          displayName: cleanName,
          updatedAt: serverTimestamp(),
        });
      }
      return;
    }

    // Derive an available username key (2–40 chars, lowercase a-z0-9_-)
    const baseCandidate = normalizeUsernameKey(cleanName || cleanEmail.split('@')[0]);
    const baseKey = baseCandidate.length >= 2 ? baseCandidate : `user_${user.uid.slice(0, 6).toLowerCase()}`;
    const uidSuffix = user.uid.slice(0, 5).toLowerCase().replace(/[^a-z0-9]/g, 'x');
    const fallbackKey = `${baseKey.slice(0, 34)}_${uidSuffix}`;

    let chosenUsername = baseKey;
    try {
      const usernameSnap = await getDoc(doc(db, 'usernames', baseKey));
      if (usernameSnap.exists() && usernameSnap.data()?.ownerId !== user.uid) {
        chosenUsername = fallbackKey;
      }
    } catch {
      chosenUsername = fallbackKey;
    }

    await setDoc(userRef, {
      ownerId: user.uid,
      displayName: cleanName,
      username: chosenUsername,
      email: cleanEmail,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const lookupRef = doc(db, 'usernames', chosenUsername);
    const lookupSnap = await getDoc(lookupRef).catch(() => null);
    if (!lookupSnap || !lookupSnap.exists()) {
      await setDoc(lookupRef, {
        ownerId: user.uid,
        email: cleanEmail,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    // Do not block Google sign-in if profile sync is denied or offline
    console.warn('Could not sync Google user profile to Firestore:', err);
  }
}

export async function signInWithGoogle(): Promise<User> {
  const rateCheck = checkRateLimit('google_auth');
  if (!rateCheck.allowed) {
    throw new AuthFlowError('auth/too-many-requests', rateCheck.message || 'Please wait before trying Google Sign-In again.');
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    resetRateLimit('google_auth');
    void ensureGoogleUserProfile(result.user);
    return result.user;
  } catch (error) {
    recordRateLimitAttempt('google_auth');
    const code = getAuthErrorCode(error) || 'auth/google-failed';
    throw new AuthFlowError(code, formatFirebaseAuthError(error));
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration: client is offline.');
    }
  }
}

void testConnection();
