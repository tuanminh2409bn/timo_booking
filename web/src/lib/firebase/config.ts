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

if (typeof window !== 'undefined') {
  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY?.trim();
  if (siteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

export const getFirebaseAppCheckToken = async (): Promise<string | undefined> => {
  if (!appCheck) return undefined;
  return (await getAppCheckToken(appCheck, false)).token;
};
