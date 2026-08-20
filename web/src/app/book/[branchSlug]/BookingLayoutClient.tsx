'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { BookingProvider, useBooking } from '@/lib/bookingContext';
import { useI18n } from '@/lib/i18n';
import Stepper from '@/components/booking/Stepper';
import BottomBar from '@/components/booking/BottomBar';
import styles from './layout.module.css';
import { fetchHrmStore } from '@/lib/hrmApi';
import { Branch } from '@/lib/types';

function BookingLayoutInner({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { state, dispatch } = useBooking();
  const router = useRouter();
  const pathname = usePathname();

  // Extract branchSlug from window.location.pathname (NOT usePathname/useParams)
  // because Firebase rewrite serves glamour-nails-berlin HTML for all slugs,
  // and Next.js hooks return the pre-rendered slug instead of the real URL slug.
  const [branchSlug, setBranchSlug] = useState('');
  const [storeLoadError, setStoreLoadError] = useState(false);

  useEffect(() => {
    const slug = window.location.pathname.split('/')[2] || '';
    // Remove trailing slash from slug if present
    const cleanSlug = slug.replace(/\/$/, '');
    setBranchSlug(cleanSlug);
    if (cleanSlug) {
      dispatch({ type: 'SET_BRANCH_SLUG', slug: cleanSlug });
    }
  }, [dispatch]);

  // Fetch store info from HRM API and map to local Branch type
  useEffect(() => {
    if (!branchSlug) return;

    setStoreLoadError(false);

    fetchHrmStore(branchSlug)
      .then((store) => {
        const branchData: Branch = {
          id: store.id,
          businessId: '',
          name: store.name,
          // Keep the public Hosting slug in navigation. The canonical store ID
          // (for example S-3) is data identity, not a statically exported route.
          slug: branchSlug,
          address: store.addressText || '',
          phone: store.phone || '',
          currency: 'EUR',
          publicStaffSelection: store.publicStaffSelection,
          minimumNoticeHours: store.minimumNoticeHours,
          bookingWindowDays: store.bookingWindowDays,
          graceTimeMinutes: 15,
          slotIntervalMinutes: store.slotIntervalMinutes,
          cancellationNoticeHours: store.cancellationNoticeHours,
          openTime: store.openTime,
          closeTime: store.closeTime,
          absenceDeadlineTime: '18:00',
          isActive: true,
          createdAt: '',
        };
        dispatch({ type: 'SET_BRANCH', branch: branchData });
      })
      .catch((err) => {
        console.error('Error fetching store from HRM:', err);
        setStoreLoadError(true);
      });
  }, [branchSlug, dispatch]);

  // Sync currentStep based on pathname
  useEffect(() => {
    const cleanPath = pathname.replace(/\/$/, '');
    let step = 1;
    if (cleanPath.endsWith('/staff')) step = 2;
    else if (cleanPath.endsWith('/confirm')) step = 3;
    else if (cleanPath.endsWith('/success')) step = 4;

    if (state.currentStep !== step) {
      dispatch({ type: 'SET_STEP', step });
    }
  }, [pathname, dispatch, state.currentStep]);

  const handleBack = () => {
    const cleanPath = pathname.replace(/\/$/, '');
    if (cleanPath.endsWith('/staff')) {
      router.push(`/book/${branchSlug}`);
    } else if (cleanPath.endsWith('/confirm')) {
      router.push(`/book/${branchSlug}/staff`);
    } else {
      router.back();
    }
  };

  const handleClose = () => {
    dispatch({ type: 'RESET' });
    sessionStorage.removeItem('timmo_booking_state');
    window.location.href = '/';
  };

  const isSuccessPage = pathname.endsWith('/success');

  return (
    <div className={styles.layoutWrapper}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerContent}>
          {!isSuccessPage ? (
            <button className={styles.headerButton} onClick={handleBack} aria-label={t.common.back}>
              ←
            </button>
          ) : (
            <div style={{ width: 40 }} />
          )}
          <span className={styles.headerTitle}>{state.branch?.name || t.common.loading}</span>
          <button className={styles.headerButton} onClick={handleClose} aria-label={t.common.close}>
            ×
          </button>
        </div>
      </header>

      {/* Stepper - hidden on success page */}
      {!isSuccessPage && (
        <div className={styles.stepperWrapper}>
          <div className={styles.stepperInner}>
            <Stepper />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className={styles.mainArea}>
        <main className={styles.contentColumn}>
          {storeLoadError ? (
            <div role="alert" style={{ padding: '32px 20px', textAlign: 'center' }}>
              <h1 style={{ marginBottom: 12, fontSize: 22 }}>Không thể tải thông tin cửa hàng</h1>
              <p>Vui lòng kiểm tra đường dẫn hoặc thử lại sau. Chưa có lịch hẹn nào được tạo.</p>
            </div>
          ) : children}
        </main>
      </div>

      {/* Mobile bottom bar */}
      {!isSuccessPage && <BottomBar />}
    </div>
  );
}

export default function BookingLayoutClient({ children }: { children: ReactNode }) {
  return (
    <BookingProvider>
      <BookingLayoutInner>{children}</BookingLayoutInner>
    </BookingProvider>
  );
}
