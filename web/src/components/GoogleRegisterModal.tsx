'use client';

import React, { useState, useEffect } from 'react';
import { User as FirebaseUser, signOut } from 'firebase/auth';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase/config';
import { useI18n } from '@/lib/i18n';
import styles from './GoogleRegisterModal.module.css';

interface GoogleRegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
  firebaseUser: FirebaseUser | null;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\s+/g, '-') // replace spaces with -
    .replace(/[^\w\-]+/g, '') // remove all non-word chars
    .replace(/\-\-+/g, '-') // replace multiple - with single -
    .replace(/^-+/, '') // trim - from start of text
    .replace(/-+$/, ''); // trim - from end of text
};

const getInitials = (name: string) => {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
};

export default function GoogleRegisterModal({
  isOpen,
  onClose,
  firebaseUser,
  onSuccess,
  onError
}: GoogleRegisterModalProps) {
  const { t, locale } = useI18n();
  const [registerType, setRegisterType] = useState<'owner' | 'staff'>('owner');
  
  // Fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [salonName, setSalonName] = useState('');
  const [address, setAddress] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (firebaseUser) {
      setFullName(firebaseUser.displayName || '');
    }
  }, [firebaseUser]);

  if (!isOpen || !firebaseUser) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setLoading(true);

    if (!fullName) {
      setLocalError(t.admin.register.errorEmpty);
      setLoading(false);
      return;
    }

    if (registerType === 'owner' && (!salonName || !address)) {
      setLocalError(t.admin.register.errorEmpty);
      setLoading(false);
      return;
    }

    if (registerType === 'staff' && !invitationCode) {
      setLocalError(t.admin.register.errorEmpty);
      setLoading(false);
      return;
    }

    try {
      const batch = writeBatch(db);

      if (registerType === 'owner') {
        const businessId = `biz-${Date.now()}`;
        const branchSlug = slugify(salonName) || `salon-${Date.now()}`;

        const userRef = doc(db, 'users', firebaseUser.uid);
        batch.set(userRef, {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          role: 'owner',
          businessId,
          assignedBranches: [branchSlug],
          staffId: null,
          name: fullName,
          phone: phone || '',
          approvalStatus: 'pending_superadmin',
          createdAt: new Date().toISOString()
        });

        const businessRef = doc(db, 'businesses', businessId);
        batch.set(businessRef, {
          id: businessId,
          ownerUid: firebaseUser.uid,
          companyName: salonName,
          status: 'trial',
          subscriptionPlan: 'starter',
          createdAt: new Date().toISOString()
        });

        const branchRef = doc(db, 'branches', branchSlug);
        batch.set(branchRef, {
          id: branchSlug,
          businessId,
          name: salonName,
          slug: branchSlug,
          address: address || '',
          phone: phone || '',
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

        // Default Categories
        const catManiId = 'cat-manicure';
        const catRefMani = doc(db, 'branches', branchSlug, 'categories', catManiId);
        batch.set(catRefMani, {
          id: catManiId,
          branchId: branchSlug,
          businessId,
          name: 'Manicure',
          description: 'Hand care & nail styling',
          displayOrder: 1,
          isActive: true
        });

        const catPediId = 'cat-pedicure';
        const catRefPedi = doc(db, 'branches', branchSlug, 'categories', catPediId);
        batch.set(catRefPedi, {
          id: catPediId,
          branchId: branchSlug,
          businessId,
          name: 'Pedicure',
          description: 'Foot care & massage',
          displayOrder: 2,
          isActive: true,
          requiresStaffAutoAssign: true
        });

        // Default Services
        const svcClassicManiId = 'svc-classic-manicure';
        const svcClassicManiRef = doc(db, 'branches', branchSlug, 'services', svcClassicManiId);
        batch.set(svcClassicManiRef, {
          id: svcClassicManiId,
          branchId: branchSlug,
          businessId,
          categoryId: catManiId,
          name: 'Classic Manicure',
          description: 'Nail shaping, cuticle care, and regular polish',
          durationMinutes: 30,
          price: 25,
          currency: '€',
          displayOrder: 1,
          isActive: true,
          hasAppointments: false,
          type: 'standard',
          createdAt: new Date().toISOString()
        });

        const svcGelNailsId = 'svc-gel-nails';
        const svcGelNailsRef = doc(db, 'branches', branchSlug, 'services', svcGelNailsId);
        batch.set(svcGelNailsRef, {
          id: svcGelNailsId,
          branchId: branchSlug,
          businessId,
          categoryId: catManiId,
          name: 'Gel Nails',
          description: 'Full set of acrylic/gel nail extensions',
          durationMinutes: 60,
          price: 50,
          currency: '€',
          displayOrder: 2,
          isActive: true,
          hasAppointments: false,
          type: 'standard',
          createdAt: new Date().toISOString()
        });

        const svcClassicPediId = 'svc-classic-pedicure';
        const svcClassicPediRef = doc(db, 'branches', branchSlug, 'services', svcClassicPediId);
        batch.set(svcClassicPediRef, {
          id: svcClassicPediId,
          branchId: branchSlug,
          businessId,
          categoryId: catPediId,
          name: 'Classic Pedicure',
          description: 'Relaxing foot bath, scrub, and massage',
          durationMinutes: 45,
          price: 35,
          currency: '€',
          displayOrder: 1,
          isActive: true,
          hasAppointments: false,
          type: 'standard',
          createdAt: new Date().toISOString()
        });

        // Default Staff member linked to Owner
        const staffId = `staff-${firebaseUser.uid}`;
        const staffRef = doc(db, 'branches', branchSlug, 'staff', staffId);
        batch.set(staffRef, {
          id: staffId,
          branchId: branchSlug,
          businessId,
          userUid: firebaseUser.uid,
          name: fullName,
          initials: getInitials(fullName),
          role: 'staff',
          staffType: 'main',
          serviceIds: [svcClassicManiId, svcGelNailsId, svcClassicPediId],
          displayOrder: 1,
          status: 'active', // Active immediately for owner's own staff entry
          hasAppointments: false,
          rating: 5.0,
          languages: ['German', 'Vietnamese'],
          createdAt: new Date().toISOString()
        });

        await batch.commit();

      } else {
        // Staff Registration
        const cleanCode = invitationCode.trim();
        const inviteDocRef = doc(db, 'invitations', cleanCode);
        const inviteDoc = await getDoc(inviteDocRef);

        if (!inviteDoc.exists() || !inviteDoc.data().isActive) {
          setLocalError(t.admin.register.errorCodeInvalid);
          setLoading(false);
          return;
        }

        const invitation = inviteDoc.data();
        const staffId = `staff-${firebaseUser.uid}`;

        // 1. User profile (pending Owner approval)
        const userRef = doc(db, 'users', firebaseUser.uid);
        batch.set(userRef, {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          role: invitation.role,
          businessId: invitation.businessId,
          assignedBranches: [invitation.branchId],
          staffId: staffId,
          name: fullName,
          phone: phone || '',
          approvalStatus: 'pending_owner',
          createdAt: new Date().toISOString()
        });

        // 2. Staff doc for both staff and manager roles
        const staffRef = doc(db, 'branches', invitation.branchId, 'staff', staffId);
        batch.set(staffRef, {
          id: staffId,
          branchId: invitation.branchId,
          businessId: invitation.businessId,
          userUid: firebaseUser.uid,
          name: fullName,
          initials: getInitials(fullName),
          role: invitation.role, // 'staff' or 'manager'
          staffType: invitation.staffType || 'main',
          serviceIds: [],
          displayOrder: 2,
          status: 'inactive', // Inactive pending owner approval
          hasAppointments: false,
          rating: 5.0,
          languages: ['German', 'Vietnamese'],
          createdAt: new Date().toISOString()
        });

        // 3. Mark invitation as used
        batch.update(inviteDocRef, {
          isActive: false,
          usedBy: firebaseUser.uid,
          usedAt: new Date().toISOString()
        });

        await batch.commit();
      }

      // Explicitly sign out from Firebase Auth because their profile is pending approval
      await signOut(auth);
      
      onSuccess(
        registerType === 'owner'
          ? (t?.admin?.register?.success?.owner || 'Owner registration successful!')
          : (t?.admin?.register?.success?.staff || 'Staff registration successful!')
      );
      
      onClose();
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
      
      onError(friendlyError);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            {locale === 'vi' ? 'Hoàn tất Đăng ký tài khoản' : 'Complete Registration'}
          </h2>
          <p className={styles.subtitle}>
            {locale === 'vi' 
              ? 'Vui lòng cung cấp thêm thông tin để tiếp tục.' 
              : 'Please provide additional details to get started.'}
          </p>
        </div>

        {localError && <div className={styles.errorText}>⚠️ {localError}</div>}

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${registerType === 'owner' ? styles.tabActive : ''}`}
            onClick={() => setRegisterType('owner')}
            disabled={loading}
          >
            {locale === 'vi' ? 'Chủ tiệm (Owner)' : 'Salon Owner'}
          </button>
          <button
            type="button"
            className={`${styles.tab} ${registerType === 'staff' ? styles.tabActive : ''}`}
            onClick={() => setRegisterType('staff')}
            disabled={loading}
          >
            {locale === 'vi' ? 'Nhân sự (Staff)' : 'Staff Member'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.label}>
              {locale === 'vi' ? 'Họ và tên' : 'Full Name'}
            </label>
            <input
              type="text"
              className={styles.input}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>
              {locale === 'vi' ? 'Số điện thoại' : 'Phone Number'}
            </label>
            <input
              type="tel"
              className={styles.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+49 123 456 789"
              disabled={loading}
            />
          </div>

          {registerType === 'owner' ? (
            <>
              <div className={styles.formGroup}>
                <label className={styles.label}>
                  {locale === 'vi' ? 'Tên cửa hàng' : 'Salon Name'}
                </label>
                <input
                  type="text"
                  className={styles.input}
                  value={salonName}
                  onChange={(e) => setSalonName(e.target.value)}
                  placeholder="Glamour Nails"
                  required
                  disabled={loading}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>
                  {locale === 'vi' ? 'Địa chỉ' : 'Salon Address'}
                </label>
                <input
                  type="text"
                  className={styles.input}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Alexanderplatz 1, Berlin"
                  required
                  disabled={loading}
                />
              </div>
            </>
          ) : (
            <div className={styles.formGroup}>
              <label className={styles.label}>
                {locale === 'vi' ? 'Mã mời nhân viên' : 'Invitation Code'}
              </label>
              <input
                type="text"
                className={styles.input}
                value={invitationCode}
                onChange={(e) => setInvitationCode(e.target.value)}
                placeholder="TIMMO-INV-XXXXXX"
                required
                disabled={loading}
              />
            </div>
          )}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? t.common.loading : (locale === 'vi' ? 'Gửi đăng ký' : 'Complete Registration')}
          </button>
        </form>
      </div>
    </div>
  );
}
