'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase/config';
import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import styles from './page.module.css';
import GoogleRegisterModal from '@/components/GoogleRegisterModal';
import { demoCategories, demoServices } from '@/lib/seedData';
import { categoryTranslations, serviceTranslations } from '@/lib/i18n/serviceTranslations';

// Slugify helper
const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars
    .replace(/\-\-+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start
    .replace(/-+$/, ''); // Trim - from end
};

// Get initials helper
const getInitials = (name: string) => {
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);
};

export default function RegisterPage() {
  const { refreshProfile, setRegistrationInProgress } = useAuth();
  const { t, locale } = useI18n();
  const router = useRouter();

  const [registerType, setRegisterType] = useState<'owner' | 'staff'>('owner');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [googleUserForModal, setGoogleUserForModal] = useState<any>(null);
  const [showGoogleRegisterModal, setShowGoogleRegisterModal] = useState(false);

  // Form states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  
  // Salon Owner fields
  const [salonName, setSalonName] = useState('');
  const [address, setAddress] = useState('');

  // Staff fields
  const [invitationCode, setInvitationCode] = useState('');

  const initializeNewSalon = async (
    uid: string,
    emailStr: string,
    nameStr: string,
    phoneStr: string,
    salonNameStr: string,
    addressStr: string
  ) => {
    const businessId = `biz-${Date.now()}`;
    const branchSlug = slugify(salonNameStr) || `salon-${Date.now()}`;
    
    // Write everything in a single atomic batch since rules support getAfter()
    const batch = writeBatch(db);
    const userRef = doc(db, 'users', uid);
    batch.set(userRef, {
      uid,
      email: emailStr,
      role: 'owner',
      businessId,
      assignedBranches: [branchSlug],
      staffId: null,
      name: nameStr,
      phone: phoneStr || '',
      approvalStatus: 'pending_superadmin',
      createdAt: new Date().toISOString()
    });

    const businessRef = doc(db, 'businesses', businessId);
    batch.set(businessRef, {
      id: businessId,
      ownerUid: uid,
      companyName: salonNameStr,
      status: 'trial',
      subscriptionPlan: 'starter',
      createdAt: new Date().toISOString()
    });

    const branchRef = doc(db, 'branches', branchSlug);
    batch.set(branchRef, {
      id: branchSlug,
      businessId,
      name: salonNameStr,
      slug: branchSlug,
      address: addressStr || '',
      phone: phoneStr || '',
      currency: '€',
      publicStaffSelection: true,
      minimumNoticeHours: 2,
      bookingWindowDays: 30,
      graceTimeMinutes: 15,
      slotIntervalMinutes: 30,
      absenceDeadlineTime: '08:00',
      isActive: false, // Inactive pending Super Admin approval
      createdAt: new Date().toISOString()
    });

    // Default Categories từ Timo Nails Berlin (Glamour Nails Berlin)
    demoCategories.forEach((cat) => {
      const catRef = doc(db, 'branches', branchSlug, 'categories', cat.id);
      const viName = categoryTranslations['vi']?.[cat.id]?.name || cat.name;
      const enName = categoryTranslations['en']?.[cat.id]?.name || cat.name;
      const deName = categoryTranslations['de']?.[cat.id]?.name || cat.name;

      batch.set(catRef, {
        ...cat,
        branchId: branchSlug,
        businessId,
        nameLocalized: { vi: viName, en: enName, de: deName }
      });
    });

    // Default Services từ Timo Nails Berlin
    demoServices.forEach((svc) => {
      const svcRef = doc(db, 'branches', branchSlug, 'services', svc.id);
      const viName = serviceTranslations['vi']?.[svc.id]?.name || svc.name;
      const enName = serviceTranslations['en']?.[svc.id]?.name || svc.name;
      const deName = serviceTranslations['de']?.[svc.id]?.name || svc.name;

      batch.set(svcRef, {
        ...svc,
        branchId: branchSlug,
        businessId,
        currency: '€',
        nameLocalized: { vi: viName, en: enName, de: deName },
        createdAt: new Date().toISOString()
      });
    });

    await batch.commit();
  };

  const registerAsStaff = async (uid: string, emailStr: string, nameStr: string, phoneStr: string, invitationCodeStr: string) => {
    // 1. Fetch invitation
    const cleanCode = invitationCodeStr.trim();
    const inviteDocRef = doc(db, 'invitations', cleanCode);
    const inviteDoc = await getDoc(inviteDocRef);

    if (!inviteDoc.exists() || !inviteDoc.data().isActive) {
      throw new Error('invalid-code');
    }

    const invitation = inviteDoc.data();
    const batch = writeBatch(db);

    // 2. User profile
    const userRef = doc(db, 'users', uid);
    const staffId = `staff-${uid}`;
    batch.set(userRef, {
      uid,
      email: emailStr,
      role: invitation.role,
      businessId: invitation.businessId,
      assignedBranches: [invitation.branchId],
      staffId: staffId,
      name: nameStr,
      phone: phoneStr || '',
      approvalStatus: 'pending_owner',
      createdAt: new Date().toISOString()
    });

    // 3. Staff doc for both staff and manager roles
    const staffRef = doc(db, 'branches', invitation.branchId, 'staff', staffId);
    batch.set(staffRef, {
      id: staffId,
      branchId: invitation.branchId,
      businessId: invitation.businessId,
      userUid: uid,
      name: nameStr,
      initials: getInitials(nameStr),
      role: invitation.role, // 'staff' or 'manager'
      staffType: invitation.staffType || 'main',
      serviceIds: [],
      displayOrder: 2,
      status: 'inactive', // Inactive pending Owner approval
      hasAppointments: false,
      rating: 5.0,
      languages: ['German', 'Vietnamese'],
      createdAt: new Date().toISOString()
    });

    // 4. Mark invitation as used
    batch.update(inviteDocRef, {
      isActive: false,
      usedBy: uid,
      usedAt: new Date().toISOString()
    });

    await batch.commit();
  };

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Field validation
    if (!fullName || !email || !password) {
      setError(t.admin.register.errorEmpty);
      return;
    }
    if (registerType === 'owner' && !salonName) {
      setError(t.admin.register.errorEmpty);
      return;
    }
    if (registerType === 'staff' && !invitationCode) {
      setError(t.admin.register.errorEmpty);
      return;
    }

    setLoading(true);

    try {
      // Prevent onAuthStateChanged from interfering during registration
      setRegistrationInProgress(true);

      // Create account in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const firebaseUser = userCredential.user;

      // Force token propagation to ensure Firestore SDK is authenticated before we write
      await firebaseUser.getIdToken(true);
      await new Promise((resolve) => setTimeout(resolve, 200));

      if (registerType === 'owner') {
        // Initialize Owner Documents
        await initializeNewSalon(firebaseUser.uid, email, fullName, phone, salonName, address);
      } else {
        // Initialize Staff Documents
        await registerAsStaff(firebaseUser.uid, email, fullName, phone, invitationCode);
      }

      await auth.signOut();

      // Wait a bit for auth state to propagate sign-out before resetting the flag
      await new Promise((resolve) => setTimeout(resolve, 200));
      setRegistrationInProgress(false);

      setSuccess(
        registerType === 'owner'
          ? (t?.admin?.register?.success?.owner || 'Owner registration successful!')
          : (t?.admin?.register?.success?.staff || 'Staff registration successful!')
      );
      
      setTimeout(() => {
        router.push('/admin/login/');
      }, 3000);

    } catch (e: any) {
      console.error(e);
      try {
        await auth.signOut();
      } catch (signOutErr) {
        console.error('Error signing out after registration failure:', signOutErr);
      }
      setTimeout(() => {
        setRegistrationInProgress(false);
      }, 200);

      if (e.message === 'invalid-code') {
        setError(t.admin.register.errorCodeInvalid);
      } else {
        const msg = (e.message || '').toLowerCase();
        const code = (e.code || '').toLowerCase();
        
        const regErrors = t?.admin?.register?.errors;
        let friendlyError = '';
        
        if (code === 'auth/email-already-in-use' || msg.includes('email-already-in-use') || msg.includes('already in use') || msg.includes('already-in-use')) {
          friendlyError = regErrors?.emailInUse || 'Email already in use.';
        } else if (code === 'auth/weak-password' || msg.includes('weak-password') || msg.includes('weak password')) {
          friendlyError = regErrors?.weakPassword || 'Password is too weak.';
        } else if (code === 'auth/invalid-email' || msg.includes('invalid-email') || msg.includes('invalid email')) {
          friendlyError = regErrors?.invalidEmail || 'Invalid email format.';
        } else if (code.includes('permission') || msg.includes('permission') || msg.includes('insufficient')) {
          friendlyError = regErrors?.permissionDenied || 'Permission denied.';
        } else {
          friendlyError = regErrors?.['default'] || e.message || t?.admin?.register?.errorRegister || 'Registration failed.';
        }
        setError(friendlyError);
      }
      setLoading(false);
    }
  };

  const handleGoogleRegister = async () => {
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      const firebaseUser = userCredential.user;

      // Check if user already exists in Firestore
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

        // Log in approved user
        await refreshProfile(firebaseUser.uid);
        setSuccess(t.admin.register.successRegister);
        setTimeout(() => {
          router.push('/admin/dashboard/');
        }, 1500);
      } else {
        // Trigger the Google registration modal
        setGoogleUserForModal(firebaseUser);
        setShowGoogleRegisterModal(true);
        setLoading(false);
      }
    } catch (e: any) {
      console.error(e);
      const msg = (e.message || '').toLowerCase();
      const code = (e.code || '').toLowerCase();
      
      const regErrors = t?.admin?.register?.errors;
      let friendlyError = '';
      
      if (code === 'auth/email-already-in-use' || msg.includes('email-already-in-use') || msg.includes('already in use') || msg.includes('already-in-use')) {
        friendlyError = regErrors?.emailInUse || 'Email already in use.';
      } else if (code === 'auth/weak-password' || msg.includes('weak-password') || msg.includes('weak password')) {
        friendlyError = regErrors?.weakPassword || 'Password is too weak.';
      } else if (code === 'auth/invalid-email' || msg.includes('invalid-email') || msg.includes('invalid email')) {
        friendlyError = regErrors?.invalidEmail || 'Invalid email format.';
      } else if (code.includes('permission') || msg.includes('permission') || msg.includes('insufficient')) {
        friendlyError = regErrors?.permissionDenied || 'Permission denied.';
      } else {
        friendlyError = regErrors?.['default'] || e.message || t?.admin?.register?.errorRegister || 'Registration failed.';
      }
      setError(friendlyError);
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <GoogleRegisterModal
        isOpen={showGoogleRegisterModal}
        onClose={() => setShowGoogleRegisterModal(false)}
        firebaseUser={googleUserForModal}
        onSuccess={(msg) => {
          setSuccess(msg);
          setTimeout(() => {
            router.push('/admin/login/');
          }, 3000);
        }}
        onError={(msg) => setError(msg)}
      />
      <div className={styles.registerCard}>
        <div className={styles.header}>
          <div className={styles.langWrapper}>
            <LanguageSwitcher variant="light" />
          </div>
          <div className={styles.logo}>Timmo Booking</div>
          <h1 className={styles.title}>{t.admin.register.title}</h1>
        </div>

        {error && (
          <div className={styles.errorBanner}>
            <span>⚠️ {error}</span>
          </div>
        )}

        {success && (
          <div className={styles.successBanner}>
            <span>{success}</span>
          </div>
        )}

        {/* Tab Switching */}
        <div className={styles.tabsContainer}>
          <button
            type="button"
            className={`${styles.tab} ${registerType === 'owner' ? styles.activeTab : ''}`}
            onClick={() => {
              setRegisterType('owner');
              setError('');
            }}
            disabled={loading}
          >
            {t.admin.register.tabOwner}
          </button>
          <button
            type="button"
            className={`${styles.tab} ${registerType === 'staff' ? styles.activeTab : ''}`}
            onClick={() => {
              setRegisterType('staff');
              setError('');
            }}
            disabled={loading}
          >
            {t.admin.register.tabStaff}
          </button>
        </div>

        <form onSubmit={handleEmailRegister} className={styles.registerForm}>
          {/* Section title */}
          <h2 style={{ fontSize: '15px', fontWeight: '700', marginBottom: '16px', color: '#111827' }}>
            {registerType === 'owner' ? t.admin.register.titleOwner : t.admin.register.titleStaff}
          </h2>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.booking.confirm.form.fullName} *</label>
            <input
              type="text"
              className={styles.formInput}
              placeholder={t.admin.register.fullNamePlaceholder}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.booking.confirm.form.email} *</label>
            <input
              type="email"
              className={styles.formInput}
              placeholder={t.admin.register.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.booking.confirm.form.password} *</label>
            <input
              type="password"
              className={styles.formInput}
              placeholder={t.admin.register.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t.booking.confirm.form.phone}</label>
            <input
              type="tel"
              className={styles.formInput}
              placeholder={t.admin.register.phonePlaceholder}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={loading}
            />
          </div>

          {/* Owner-specific fields */}
          {registerType === 'owner' && (
            <>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t.admin.register.businessNamePlaceholder} *</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder={t.admin.register.businessNamePlaceholder}
                  value={salonName}
                  onChange={(e) => setSalonName(e.target.value)}
                  required={registerType === 'owner'}
                  disabled={loading}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t.admin.register.addressPlaceholder}</label>
                <input
                  type="text"
                  className={styles.formInput}
                  placeholder={t.admin.register.addressPlaceholder}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  disabled={loading}
                />
              </div>
            </>
          )}

          {/* Staff-specific fields */}
          {registerType === 'staff' && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>{t.admin.register.invitationCodePlaceholder} *</label>
              <input
                type="text"
                className={styles.formInput}
                placeholder={t.admin.register.invitationCodePlaceholder}
                value={invitationCode}
                onChange={(e) => setInvitationCode(e.target.value)}
                required={registerType === 'staff'}
                disabled={loading}
              />
            </div>
          )}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? t.common.loading : t.admin.register.submitBtn}
          </button>

          <div className={styles.divider}>{t.common.or}</div>

          <button
            type="button"
            className={styles.googleBtn}
            onClick={handleGoogleRegister}
            disabled={loading}
          >
            <svg className={styles.googleIcon} viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
            {t.admin.register.googleBtn}
          </button>

          <div className={styles.loginLinkWrapper}>
            <Link href="/admin/login" className={styles.loginLink}>
              {t.admin.register.loginLink}
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
