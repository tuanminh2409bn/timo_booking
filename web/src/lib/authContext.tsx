'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserProfile, UserRole } from './types';
import { auth } from './firebase/config';
import { 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut, 
  onAuthStateChanged,
  User as FirebaseUser,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { authenticatedHrmFetch, clearHrmSession, establishHrmSession, type HrmSessionIdentity } from './hrmSession';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  activeBranch: string | null;
  setActiveBranch: (branchId: string) => void;
  login: (email: string, password: string) => Promise<UserProfile>;
  loginWithGoogle: () => Promise<UserProfile>;
  logout: () => Promise<void>;
  updateProfile: (name: string, phone: string) => Promise<void>;
  refreshProfile: (uid: string) => Promise<UserProfile | null>;
  setRegistrationInProgress: (value: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const PROFILE_CACHE_KEY = 'timmo_admin_user';
const PROFILE_CACHE_TIME_KEY = 'timmo_admin_user_cached_at';
const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;

// Helper to set client cookies so middleware can read it
const setSessionCookies = (role: UserRole | null) => {
  if (role) {
    document.cookie = `timmo_user_role=${role}; path=/; max-age=86400; SameSite=Lax`;
    document.cookie = `timmo_is_logged_in=true; path=/; max-age=86400; SameSite=Lax`;
  } else {
    document.cookie = 'timmo_user_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax';
    document.cookie = 'timmo_is_logged_in=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax';
  }
};

const mapHrmProfile = (data: HrmSessionIdentity): UserProfile => {
  const role =
    data.role === 'employee'
      ? 'staff'
      : data.role === 'admin'
        ? 'superadmin'
        : data.role;
  const assignedBranches = typeof data.storeId === 'string'
      ? [data.storeId]
      : [];
  return {
    uid: data.uid,
    email: data.email,
    name: data.name,
    role,
    assignedBranches,
    businessId: data.ownerId ?? null,
    staffId: role === 'staff' ? data.uid : null,
    phone: '',
    createdAt: new Date(0).toISOString(),
  };
};

const enrichProfileStores = async (profile: UserProfile): Promise<UserProfile> => {
  if (profile.role === 'superadmin' || profile.assignedBranches.length > 0) return profile;
  const response = await authenticatedHrmFetch('/api/v1/stores');
  if (!response.ok) return profile;
  const data = await response.json() as { stores?: Array<{ id: string }> };
  return {
    ...profile,
    assignedBranches: (data.stores ?? []).map((store) => store.id),
  };
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeBranch, setActiveBranchState] = useState<string | null>(null);
  const registrationInProgress = React.useRef(false);
  const sessionHydration = React.useRef<Promise<UserProfile> | null>(null);

  const setRegistrationInProgress = React.useCallback((value: boolean) => {
    registrationInProgress.current = value;
  }, []);

  const setActiveBranch = React.useCallback((branchId: string) => {
    setActiveBranchState(branchId);
  }, []);

  // Firebase emits `onAuthStateChanged` immediately after a password/Google
  // sign-in. Reuse the same backend session request for that event and the
  // explicit login action so one user action cannot consume two rate-limit
  // slots or race custom-claim synchronization.
  const hydrateAuthenticatedUser = React.useCallback(async (firebaseUser: FirebaseUser): Promise<UserProfile> => {
    if (!sessionHydration.current) {
      sessionHydration.current = (async () => {
        // A browser reload must not consume another strict auth-session slot.
        // Reuse the recently verified profile for the same Firebase uid; all
        // protected data requests are still authorized by the current ID token.
        try {
          const cached = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null') as UserProfile | null;
          const cachedAt = Number(localStorage.getItem(PROFILE_CACHE_TIME_KEY) || 0);
          if (cached?.uid === firebaseUser.uid && Date.now() - cachedAt < PROFILE_CACHE_TTL_MS) {
            setUser(cached);
            setActiveBranchState(cached.assignedBranches?.[0] || null);
            setSessionCookies(cached.role);
            return cached;
          }
        } catch {
          localStorage.removeItem(PROFILE_CACHE_KEY);
          localStorage.removeItem(PROFILE_CACHE_TIME_KEY);
        }

        const session = await establishHrmSession(firebaseUser);
        let profile = mapHrmProfile(session.user);
        profile = await enrichProfileStores(profile);
        setUser(profile);
        setActiveBranchState(profile.assignedBranches?.[0] || null);
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
        localStorage.setItem(PROFILE_CACHE_TIME_KEY, String(Date.now()));
        setSessionCookies(profile.role);
        return profile;
      })();
    }

    try {
      return await sessionHydration.current;
    } finally {
      sessionHydration.current = null;
    }
  }, []);

  // Sync auth state with Firebase Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      // Skip auth state processing during registration to prevent race conditions
      if (registrationInProgress.current) {
        return;
      }
      
      setLoading(true);
      if (firebaseUser) {
        try {
          await hydrateAuthenticatedUser(firebaseUser);
        } catch (e) {
          console.error('Error fetching user profile', e);
          setUser(null);
          setSessionCookies(null);
        }
      } else {
        setUser(null);
        setActiveBranchState(null);
        localStorage.removeItem(PROFILE_CACHE_KEY);
        localStorage.removeItem(PROFILE_CACHE_TIME_KEY);
        setSessionCookies(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [hydrateAuthenticatedUser]);

  const login = async (email: string, password: string): Promise<UserProfile> => {
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const profile = await hydrateAuthenticatedUser(userCredential.user);
      setLoading(false);
      return profile;
    } catch (e) {
      setLoading(false);
      throw e;
    }
  };

  const loginWithGoogle = async (): Promise<UserProfile> => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      const profile = await hydrateAuthenticatedUser(userCredential.user);
      setLoading(false);
      return profile;
    } catch (e) {
      setLoading(false);
      throw e;
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await firebaseSignOut(auth);
      clearHrmSession();
      setUser(null);
      setActiveBranchState(null);
      localStorage.removeItem(PROFILE_CACHE_KEY);
      localStorage.removeItem(PROFILE_CACHE_TIME_KEY);
      setSessionCookies(null);
    } catch (e) {
      console.error('Logout error', e);
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (name: string, phone: string) => {
    if (!user) return;
    try {
      const response = await authenticatedHrmFetch('/api/v1/account/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name, phone }),
      });
      if (!response.ok) throw new Error(`Could not update profile (${response.status})`);
      const updated = { ...user, name, phone };
      setUser(updated);
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(updated));
      localStorage.setItem(PROFILE_CACHE_TIME_KEY, String(Date.now()));
    } catch (e) {
      console.error('Failed to update Firestore profile', e);
      throw e;
    }
  };

  const refreshProfile = async (uid: string): Promise<UserProfile | null> => {
    try {
      if (!auth.currentUser || auth.currentUser.uid !== uid) return null;
      const session = await establishHrmSession(auth.currentUser);
      let profile = mapHrmProfile(session.user);
      profile = await enrichProfileStores(profile);
      setUser(profile);
      setActiveBranchState(profile.assignedBranches?.[0] || null);
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
      localStorage.setItem(PROFILE_CACHE_TIME_KEY, String(Date.now()));
      setSessionCookies(profile.role);
      return profile;
    } catch (e) {
      console.error('Error refreshing profile:', e);
    }
    return null;
  };

  return (
    <AuthContext.Provider value={{ user, loading, activeBranch, setActiveBranch, login, loginWithGoogle, logout, updateProfile, refreshProfile, setRegistrationInProgress }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
