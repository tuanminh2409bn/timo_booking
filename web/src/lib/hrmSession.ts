'use client';

import type { User } from 'firebase/auth';
import { auth, getFirebaseAppCheckToken, HRM_API_BASE_URL } from '@/lib/firebase/config';

const HRM_SESSION_KEY = 'timmo_hrm_session_token';

export const clearHrmSession = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(HRM_SESSION_KEY);
  }
};

export type HrmSessionIdentity = {
  uid: string;
  email: string;
  ownerId: string;
  role: 'admin' | 'owner' | 'manager' | 'employee';
  storeId?: string;
  name: string;
};

export const establishHrmSession = async (
  firebaseUser: User,
  isPlatformAdmin = false,
): Promise<{ token: string; user: HrmSessionIdentity }> => {
  const idToken = await firebaseUser.getIdToken();
  const appCheckToken = await getFirebaseAppCheckToken();
  const signin = (admin: boolean) => fetch(
    `${HRM_API_BASE_URL}${admin ? '/api/v1/auth/admin-sessions' : '/api/v1/auth/signin'}`,
    {
      method: 'POST',
      headers: admin
        ? {
            Authorization: `Bearer ${idToken}`,
            ...(appCheckToken && { 'X-Firebase-AppCheck': appCheckToken }),
          }
        : { 'Content-Type': 'application/json' },
      ...(admin ? {} : { body: JSON.stringify({ idToken }) }),
    },
  );
  let response = await signin(isPlatformAdmin);
  if (!isPlatformAdmin && response.status === 403) {
    response = await signin(true);
  }
  if (!response.ok) {
    clearHrmSession();
    const error = await response.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(error?.message || `HRM session could not be established (${response.status})`);
  }
  const data = await response.json() as { user: HrmSessionIdentity };
  if (!data.user?.uid) throw new Error('HRM session response did not include a user');

  // HRM authenticates protected APIs with the Firebase ID token. The signin
  // endpoint synchronizes the role/store custom claims; force-refresh before
  // persisting so subsequent API calls do not use the stale pre-signin token.
  const sessionToken = await firebaseUser.getIdToken(true);
  window.localStorage.setItem(HRM_SESSION_KEY, sessionToken);
  return { token: sessionToken, user: data.user };
};

export const getHrmSessionToken = (): string | null =>
  typeof window === 'undefined'
    ? null
    : window.localStorage.getItem(HRM_SESSION_KEY);

export const authenticatedHrmFetch = async (
  input: string,
  init: RequestInit = {},
): Promise<Response> => {
  const token = auth.currentUser
    ? await auth.currentUser.getIdToken()
    : getHrmSessionToken();
  if (!token) {
    throw new Error('HRM session is not available');
  }

  const appCheckToken = await getFirebaseAppCheckToken();

  return fetch(`${HRM_API_BASE_URL}${input}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      ...(appCheckToken && { 'X-Firebase-AppCheck': appCheckToken }),
      ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
    },
  });
};

export const registerHrmOwner = async (payload: {
  email: string;
  password: string;
  name: string;
  phone?: string;
  salonName: string;
  address?: string;
}): Promise<void> => {
  const appCheckToken = await getFirebaseAppCheckToken();
  const response = await fetch(`${HRM_API_BASE_URL}/api/v1/auth/register-owner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(appCheckToken && { 'X-Firebase-AppCheck': appCheckToken }),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as
      | { message?: string; type?: string }
      | undefined;
    const failure = new Error(error?.message || `Registration failed (${response.status})`);
    failure.name = error?.type || 'RegistrationError';
    throw failure;
  }
};
