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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeBranch, setActiveBranchState] = useState<string | null>(null);
  const registrationInProgress = React.useRef(false);

  const setRegistrationInProgress = React.useCallback((value: boolean) => {
    registrationInProgress.current = value;
  }, []);

  const setActiveBranch = React.useCallback((branchId: string) => {
    setActiveBranchState(branchId);
  }, []);

  const mapProfile = (data: HrmSessionIdentity): UserProfile => {
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
          const session = await establishHrmSession(firebaseUser);
          let profile = mapProfile(session.user);
          profile = await enrichProfileStores(profile);
          setUser(profile);
          setActiveBranchState(profile.assignedBranches?.[0] || null);
          localStorage.setItem('timmo_admin_user', JSON.stringify(profile));
          setSessionCookies(profile.role);
        } catch (e) {
          console.error('Error fetching user profile', e);
          setUser(null);
          setSessionCookies(null);
        }
      } else {
        setUser(null);
        setActiveBranchState(null);
        localStorage.removeItem('timmo_admin_user');
        setSessionCookies(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email: string, password: string): Promise<UserProfile> => {
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;
      
      const session = await establishHrmSession(firebaseUser);
      let profile = mapProfile(session.user);
      profile = await enrichProfileStores(profile);
      setUser(profile);
      setActiveBranchState(profile.assignedBranches?.[0] || null);
      localStorage.setItem('timmo_admin_user', JSON.stringify(profile));
      setSessionCookies(profile.role);
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
      const firebaseUser = userCredential.user;
      
      const session = await establishHrmSession(firebaseUser);
      let profile = mapProfile(session.user);
      profile = await enrichProfileStores(profile);
      setUser(profile);
      setActiveBranchState(profile.assignedBranches?.[0] || null);
      localStorage.setItem('timmo_admin_user', JSON.stringify(profile));
      setSessionCookies(profile.role);
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
      localStorage.removeItem('timmo_admin_user');
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
      localStorage.setItem('timmo_admin_user', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to update Firestore profile', e);
      throw e;
    }
  };

  const refreshProfile = async (uid: string): Promise<UserProfile | null> => {
    try {
      if (!auth.currentUser || auth.currentUser.uid !== uid) return null;
      const session = await establishHrmSession(auth.currentUser);
      let profile = mapProfile(session.user);
      profile = await enrichProfileStores(profile);
      setUser(profile);
      setActiveBranchState(profile.assignedBranches?.[0] || null);
      localStorage.setItem('timmo_admin_user', JSON.stringify(profile));
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
