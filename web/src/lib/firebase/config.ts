import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';
import {
  getToken as getAppCheckToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';

// Firebase configuration using environment variables
// Connected to HRM Google Cloud project: aqueous-thought-498514-m3
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDSIwALWq_Cye6_1NpcB1rxRj7Z8Z2BuhA',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'aqueous-thought-498514-m3.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'aqueous-thought-498514-m3',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'aqueous-thought-498514-m3.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '129680657771',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:129680657771:web:5d4c266ee742d0f9f8d02e',
};

// HRM uses a named Firestore database, not the default one
const FIRESTORE_DATABASE_ID = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'timmo-hrm-prod';

// Firebase App Check site keys are public client configuration, like the
// Firebase web API key. Keep the production key as a fallback so clean
// release builds (for example a rollback built from git without an ignored
// .env file) cannot silently ship without App Check and make every protected
// API appear to have no data.
const FIREBASE_APP_CHECK_SITE_KEY =
  process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY ||
  '6LfLnGUtAAAAAAqg4WAC8rESC9dI5yCflpa8T4QT';

// HRM Backend API base URL for public booking endpoints
export const HRM_API_BASE_URL = process.env.NEXT_PUBLIC_HRM_API_BASE_URL || '';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = (() => {
  try {
    return initializeFirestore(app, {}, FIRESTORE_DATABASE_ID);
  } catch {
    return getFirestore(app, FIRESTORE_DATABASE_ID);
  }
})();

let appCheck: AppCheck | undefined;
let forceAppCheckRefresh = false;

if (typeof window !== 'undefined') {
  const isLocalDevelopment =
    process.env.NODE_ENV !== 'production' &&
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);

  // Firebase App Check's debug provider is the supported way to test from
  // localhost. Keep this strictly development-only so production continues to
  // use reCAPTCHA Enterprise and App Check enforcement normally.
  if (isLocalDevelopment) {
    forceAppCheckRefresh = true;
    const configuredDebugToken =
      process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN?.trim();
    const debugGlobal = globalThis as typeof globalThis & {
      FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
    };
    debugGlobal.FIREBASE_APPCHECK_DEBUG_TOKEN = configuredDebugToken || true;
  }

  const siteKey = FIREBASE_APP_CHECK_SITE_KEY.trim();
  if (siteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

export const getFirebaseAppCheckToken = async (): Promise<string | undefined> => {
  if (!appCheck) return undefined;
  return (await getAppCheckToken(appCheck, forceAppCheckRefresh)).token;
};
