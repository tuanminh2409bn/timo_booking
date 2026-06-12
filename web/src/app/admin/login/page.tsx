'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase/config';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import GoogleRegisterModal from '@/components/GoogleRegisterModal';
import styles from './page.module.css';

export default function AdminLoginPage() {
  const { login, refreshProfile } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleUserForModal, setGoogleUserForModal] = useState<any>(null);
  const [showGoogleRegisterModal, setShowGoogleRegisterModal] = useState(false);
  const [success, setSuccess] = useState('');

  const handleCustomLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError('');
    setLoading(true);
    
    try {
      await login(email, password);
      router.push('/admin/dashboard/');
    } catch (e: any) {
      console.error(e);
      if (e.message === 'pending_superadmin' || e.message === 'pending_owner') {
        setError(locale === 'vi' ? 'Tài khoản của bạn đang chờ duyệt. Vui lòng liên hệ quản trị viên.' : 'Your account is pending approval. Please contact the administrator.');
      } else if (e.message === 'rejected') {
        setError(locale === 'vi' ? 'Tài khoản của bạn đã bị từ chối.' : 'Your account has been rejected.');
      } else {
        setError(t.admin.login.errorLogin);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setSuccess('');
    setLoading(true);
    
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      const firebaseUser = userCredential.user;

      // Check if user exists in Firestore
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        const profile = userDoc.data() as any;
        if (profile.approvalStatus && profile.approvalStatus !== 'approved') {
          await auth.signOut();
          if (profile.approvalStatus === 'rejected') {
            setError(locale === 'vi' ? 'Tài khoản của bạn đã bị từ chối.' : 'Your account has been rejected.');
          } else {
            setError(locale === 'vi' ? 'Tài khoản của bạn đang chờ duyệt. Vui lòng liên hệ quản trị viên.' : 'Your account is pending approval. Please contact the administrator.');
          }
          setLoading(false);
          return;
        }

        // Approved, log in
        await refreshProfile(firebaseUser.uid);
        router.push('/admin/dashboard/');
      } else {
        // Trigger register modal for first-time Google user on login page
        setGoogleUserForModal(firebaseUser);
        setShowGoogleRegisterModal(true);
        setLoading(false);
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || t.admin.login.errorLogin);
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <GoogleRegisterModal
        isOpen={showGoogleRegisterModal}
        onClose={() => setShowGoogleRegisterModal(false)}
        firebaseUser={googleUserForModal}
        onSuccess={(msg) => setSuccess(msg)}
        onError={(msg) => setError(msg)}
      />
      <div className={styles.loginCard}>
        <div className={styles.header}>
          <div className={styles.langWrapper}>
            <LanguageSwitcher variant="light" />
          </div>
          <div className={styles.logo}>Timmo Booking</div>
          <h1 className={styles.title}>{t.admin.login.title}</h1>
        </div>

        {success && (
          <div className={styles.successBanner} style={{ backgroundColor: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '14px', fontWeight: 500 }}>
            <span>✓ {success}</span>
          </div>
        )}

        {error && (
          <div className={styles.errorBanner}>
            <span>⚠️ {error}</span>
          </div>
        )}

        {/* Custom Credential Login Form */}
        <form onSubmit={handleCustomLogin} className={styles.loginForm}>
          <div className={styles.formGroup}>
            <input
              type="email"
              className={styles.formInput}
              placeholder={t.admin.login.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <div className={styles.formGroup}>
            <input
              type="password"
              className={styles.formInput}
              placeholder={t.admin.login.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>
          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? t.common.loading : t.admin.login.submitBtn}
          </button>

          <div className={styles.divider}>{t.common.or}</div>

          <button 
            type="button" 
            className={styles.googleBtn} 
            onClick={handleGoogleLogin} 
            disabled={loading}
          >
            <svg className={styles.googleIcon} viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
            {t.admin.register.googleSignInBtn}
          </button>

          <div className={styles.registerLinkWrapper}>
            <span>{t.admin.register.loginLink.includes('Đăng nhập') ? 'Chưa có tài khoản?' : t.admin.register.loginLink.includes('Log in') ? "Don't have an account?" : "Noch kein Konto?"}</span>
            <Link href="/admin/register" className={styles.registerLink}>
              {t.admin.register.title.replace('Đăng ký hệ thống', 'Đăng ký ngay').replace('Portal Registration', 'Register now').replace('Portal Registrierung', 'Jetzt registrieren')}
            </Link>
          </div>
        </form>

        <div className={styles.footer}>
          <p>© 2026 Timmo Booking Commercial Platform. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
