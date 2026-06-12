'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';
import { useBooking } from '@/lib/bookingContext';
import { useRouter, useParams } from 'next/navigation';
import { demoBranch } from '@/lib/seedData';
import styles from './BookingSummary.module.css';

const STEP_PATHS = ['', '/staff', '/datetime', '/confirm'];

export default function BookingSummary() {
  const { t } = useI18n();
  const { getServiceName } = useServiceTranslation();
  const { state, totals } = useBooking();
  const router = useRouter();
  const params = useParams();
  const branchSlug = params.branchSlug as string;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { selectedServices, selectedStaff, selectedStaffType, selectedDate, selectedTime, currentStep } = state;

  const canContinue = (() => {
    switch (currentStep) {
      case 1: return selectedServices.length > 0;
      case 2: return selectedStaffType === 'any' || !!selectedStaff;
      case 3: return !!selectedDate && !!selectedTime;
      case 4: return state.customerInfo.name.trim() !== '' && state.customerInfo.phone.trim() !== '';
      default: return false;
    }
  })();

  const handleContinue = async () => {
    if (!canContinue) return;
    if (currentStep < 4) {
      let nextStep = currentStep;
      // Skip staff selection if auto-assign
      if (currentStep === 1 && state.skipStaffSelection) {
        nextStep = 2; // jump to index 2 in STEP_PATHS → '/datetime'
      }
      const nextPath = STEP_PATHS[nextStep];
      router.push(`/book/${branchSlug}${nextPath}`);
    } else if (currentStep === 4) {
      setIsSubmitting(true);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      setIsSubmitting(false);
      router.push(`/book/${branchSlug}/success`);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  const isCoralButton = currentStep === 1;
  const isConfirmStep = currentStep === 4;

  const buttonLabel = isConfirmStep
    ? (isSubmitting ? '...' : t.booking.confirm.summary.confirmBooking)
    : t.booking.services.summary.continue;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h3 className={styles.title}>{t.booking.services.summary.title}</h3>
        </div>

        <div className={styles.content}>
          {selectedServices.length === 0 ? (
            <div className={styles.emptyState}>
              {t.booking.services.summary.selectService}
            </div>
          ) : (
            <>
              {/* Services grouped by category */}
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{t.booking.services.summary.services}</span>
                <div className={styles.serviceInfo}>
                  {selectedServices.map((item) => (
                    <div key={item.categoryId} className={styles.serviceGroup}>
                      <span className={styles.categoryLabel}>{item.categoryName}</span>
                      <div className={styles.serviceLineItem}>
                        <span className={styles.serviceName}>
                          {getServiceName(item.mainService.id, item.mainService.name)}
                        </span>
                        <span className={styles.servicePrice}>€{item.mainService.price}</span>
                      </div>
                      {item.extras.map((extra) => (
                        <div key={extra.id} className={styles.serviceLineItem}>
                          <span className={styles.serviceName}>
                            + {getServiceName(extra.id, extra.name)}
                          </span>
                          <span className={styles.servicePrice}>€{extra.price}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{t.booking.services.summary.duration}</span>
                <span className={styles.summaryValue}>{totals.totalDuration} {t.common.minutes}</span>
              </div>

              {/* Staff */}
              {currentStep >= 2 && (selectedStaff || selectedStaffType === 'any') && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>{t.booking.staff.summary.professional}</span>
                  <span className={styles.summaryValue}>
                    {selectedStaffType === 'any' ? t.booking.staff.anyStaff.title : selectedStaff?.name}
                  </span>
                </div>
              )}

              {/* Date & Time */}
              {selectedDate && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>{t.booking.dateTime.summary.date}</span>
                  <span className={styles.summaryValue}>{formatDate(selectedDate)}</span>
                </div>
              )}
              {selectedTime && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>{t.booking.dateTime.summary.time}</span>
                  <span className={styles.summaryValue}>{selectedTime}</span>
                </div>
              )}

              {/* Booking mode note */}
              {state.bookingMode === 'request' && (
                <div className={styles.bookingModeNote}>
                  Booking will be sent as a request
                </div>
              )}

              <div className={styles.divider} />

              {/* Total */}
              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>{t.booking.services.summary.total}</span>
                <span className={styles.totalValue}>€{totals.totalPrice}</span>
              </div>

              {/* Salon info */}
              <div className={styles.salonInfo}>
                <div className={styles.salonIcon}>T</div>
                <div className={styles.salonDetails}>
                  <span className={styles.salonName}>{demoBranch.name}</span>
                  <span className={styles.salonAddress}>{demoBranch.address}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Continue / Confirm button */}
        {currentStep <= 4 && (
          <div className={styles.footer}>
            <button
              className={`${styles.continueButton} ${isCoralButton ? styles.buttonCoral : styles.buttonPrimary}`}
              onClick={handleContinue}
              disabled={!canContinue || isSubmitting}
            >
              {buttonLabel}
              {!isConfirmStep && <span className={styles.buttonArrow}>→</span>}
            </button>
            {isConfirmStep && (
              <p className={styles.policyText}>{t.booking.confirm.summary.policy}</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
