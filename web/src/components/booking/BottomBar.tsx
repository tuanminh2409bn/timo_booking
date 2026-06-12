'use client';

import { useI18n } from '@/lib/i18n';
import { useBooking } from '@/lib/bookingContext';
import { useRouter, useParams } from 'next/navigation';
import styles from './BottomBar.module.css';

const STEP_PATHS = ['', '/staff', '/confirm'];

export default function BottomBar() {
  const { t } = useI18n();
  const { state, totals } = useBooking();
  const router = useRouter();
  const params = useParams();
  const branchSlug = params.branchSlug as string;

  const { selectedServices, selectedStaff, selectedStaffType, selectedDate, selectedTime, currentStep } = state;

  const canContinue = (() => {
    switch (currentStep) {
      case 1: return selectedServices.length > 0;
      case 2: return selectedServices.length > 0 && (selectedStaffType === 'any' || !!selectedStaff) && !!selectedDate && !!selectedTime;
      case 3: return true;
      default: return false;
    }
  })();

  const handleContinue = () => {
    if (!canContinue) return;
    if (currentStep < 3) {
      const nextPath = STEP_PATHS[currentStep]; // If step is 1, index 1 is '/staff'. If step is 2, index 2 is '/confirm'.
      router.push(`/book/${branchSlug}${nextPath}`);
    }
  };

  // Hide when no services selected or past step 2
  if (selectedServices.length === 0 || currentStep > 2) return null;

  const isCoralButton = currentStep === 1;

  const buttonLabel = t.booking.services.summary.continue;

  const serviceCountLabel = totals.serviceCount === 1
    ? t.booking.services.bottomBar.service.replace('{count}', '1')
    : t.booking.services.bottomBar.services.replace('{count}', String(totals.serviceCount));

  return (
    <div className={styles.bottomBar}>
      <div className={styles.barContent}>
        <div className={styles.summaryInfo}>
          <div className={styles.summaryTop}>
            <span className={styles.serviceCount}>
              {serviceCountLabel}
            </span>
            <span className={styles.dot} />
            <span className={styles.duration}>
              {totals.totalDuration} {t.common.minutes}
            </span>
          </div>
          <span className={styles.price}>€{totals.totalPrice}</span>
        </div>

        <button
          className={`${styles.continueButton} ${isCoralButton ? styles.buttonCoral : styles.buttonPrimary}`}
          onClick={handleContinue}
          disabled={!canContinue}
        >
          {buttonLabel} →
        </button>
      </div>
    </div>
  );
}
