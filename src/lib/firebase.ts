import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
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
} from 'firebase/firestore';

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
export const db = getFirestore(app);
export const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
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

export function formatFirebaseAuthError(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code || '')
      : '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid username/email or password. Please check your credentials and try again.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a moment and try again.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled yet in Firebase Console (Authentication → Sign-in method → Email/Password).';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before completing.';
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
  const cleanName = params.name.trim().slice(0, 100);
  const cleanEmail = params.email.trim().toLowerCase();
  const chosenUsername = normalizeUsernameKey(
    params.username?.trim() || cleanName || cleanEmail.split('@')[0]
  );

  if (!cleanName) throw new Error('Full Name is required.');
  if (!cleanEmail) throw new Error('Email is required.');
  if (chosenUsername.length < 2) {
    throw new Error('Username must contain at least 2 letters or numbers.');
  }

  // Check if chosen username is already claimed
  try {
    const existingLookup = await getDoc(doc(db, 'usernames', chosenUsername));
    if (existingLookup.exists()) {
      throw new Error(
        `The username "${chosenUsername}" is already taken. Please choose another username.`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('already taken')) {
      throw err;
    }
    // If rules haven't been published yet or offline, let Auth creation proceed and handle below
  }

  let user: User;
  try {
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
    user = cred.user;
    await updateProfile(user, { displayName: cleanName });
  } catch (error) {
    throw new Error(formatFirebaseAuthError(error));
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
  const trimmed = identifier.trim();
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
      throw new Error('No account found with that username. Try your email address or register.');
    }
    const data = snap.data();
    if (!data?.email || typeof data.email !== 'string') {
      throw new Error('Account lookup is incomplete. Please sign in with your email address.');
    }
    emailToSignIn = data.email;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, emailToSignIn, password);
    return cred.user;
  } catch (error) {
    throw new Error(formatFirebaseAuthError(error));
  }
}

export async function signInWithGoogle(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    throw new Error(formatFirebaseAuthError(error));
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
