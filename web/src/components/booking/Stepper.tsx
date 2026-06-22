'use client';

import { useI18n } from '@/lib/i18n';
import { useBooking } from '@/lib/bookingContext';
import { useRouter } from 'next/navigation';
import styles from './Stepper.module.css';

const STEPS = [
  { key: 'service', path: '' },
  { key: 'staff', path: '/staff' },
  { key: 'confirm', path: '/confirm' },
] as const;

export default function Stepper() {
  const { t } = useI18n();
  const { state } = useBooking();
  const router = useRouter();
  // Use branchSlug from booking context (set via window.location) instead of useParams()
  const branchSlug = state.branchSlug;

  const stepLabels: Record<string, string> = {
    service: t.booking.stepper.service,
    staff: `${t.booking.stepper.staff} & ${t.booking.stepper.dateTime}`,
    confirm: t.booking.stepper.confirm,
  };

  const handleStepClick = (stepIndex: number) => {
    if (stepIndex + 1 < state.currentStep) {
      const path = STEPS[stepIndex].path;
      router.push(`/book/${branchSlug}${path}`);
    }
  };

  return (
    <nav className={styles.stepper} aria-label="Booking progress">
      {STEPS.map((step, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === state.currentStep;
        const isCompleted = stepNumber < state.currentStep;
        const isPending = stepNumber > state.currentStep;

        return (
          <div key={step.key} className={styles.step}>
            <button
              className={styles.stepButton}
              onClick={() => handleStepClick(index)}
              disabled={!isCompleted}
              aria-current={isActive ? 'step' : undefined}
            >
              <span
                className={`${styles.circle} ${
                  isActive
                    ? styles.circleActive
                    : isCompleted
                    ? styles.circleCompleted
                    : styles.circlePending
                }`}
              >
                {isCompleted ? (
                  <svg className={styles.checkmark} viewBox="0 0 24 24">
                    <polyline points="6 12 10 16 18 8" />
                  </svg>
                ) : (
                  stepNumber
                )}
              </span>
              <span
                className={`${styles.label} ${
                  isActive
                    ? styles.labelActive
                    : isCompleted
                    ? styles.labelCompleted
                    : styles.labelPending
                }`}
              >
                {stepLabels[step.key]}
              </span>
            </button>

            {index < STEPS.length - 1 && (
              <div className={styles.connector}>
                <div
                  className={`${styles.connectorLine} ${
                    isCompleted ? styles.connectorCompleted : ''
                  }`}
                />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
