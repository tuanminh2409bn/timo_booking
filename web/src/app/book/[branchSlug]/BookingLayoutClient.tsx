'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { BookingProvider, useBooking } from '@/lib/bookingContext';
import { useI18n, I18nProvider } from '@/lib/i18n';
import { demoBranch } from '@/lib/seedData';
import Stepper from '@/components/booking/Stepper';
import BookingSummary from '@/components/booking/BookingSummary';
import BottomBar from '@/components/booking/BottomBar';
import styles from './layout.module.css';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
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

  useEffect(() => {
    const slug = window.location.pathname.split('/')[2] || '';
    // Remove trailing slash from slug if present
    const cleanSlug = slug.replace(/\/$/, '');
    setBranchSlug(cleanSlug);
    if (cleanSlug) {
      dispatch({ type: 'SET_BRANCH_SLUG', slug: cleanSlug });
    }
  }, [dispatch]);

  // Set branch dynamically from Firestore
  useEffect(() => {
    if (!branchSlug) return;
    const docRef = doc(db, 'branches', branchSlug);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const branchData = { id: docSnap.id, ...docSnap.data() } as Branch;
        dispatch({ type: 'SET_BRANCH', branch: branchData });
      } else {
        // Use demo branch as template but override slug/id with the actual URL slug
        // to prevent bookings from being saved to the wrong branch
        const fallbackBranch = { ...demoBranch, id: branchSlug, slug: branchSlug };
        dispatch({ type: 'SET_BRANCH', branch: fallbackBranch });
      }
    }, (err) => {
      console.error("Error listening to branch:", err);
      const fallbackBranch = { ...demoBranch, id: branchSlug, slug: branchSlug };
      dispatch({ type: 'SET_BRANCH', branch: fallbackBranch });
    });

    return () => unsubscribe();
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
    router.push('/');
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
          {children}
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
