'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';
import { useBooking } from '@/lib/bookingContext';
import { useRouter } from 'next/navigation';
import { createHrmBooking } from '@/lib/hrmApi';
import type {
  HrmBookingAddonInput,
  HrmBookingServiceInput,
} from '@/lib/hrmApi';
import styles from './page.module.css';

export default function ConfirmPage() {
  const { t, locale } = useI18n();
  const { getCategoryName, getServiceName } = useServiceTranslation();
  const { state, totals, dispatch } = useBooking();
  const router = useRouter();
  const branchSlug = state.branchSlug;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isReturning = state.customerInfo.isReturning;
  const isRequestMode = state.bookingMode === 'request';

  const handleTabSwitch = (returning: boolean) => {
    dispatch({
      type: 'SET_CUSTOMER_INFO',
      info: { isReturning: returning },
    });
  };

  const handleChange = (field: string, value: string) => {
    dispatch({
      type: 'SET_CUSTOMER_INFO',
      info: { [field]: value },
    });
  };

  const isFormValid =
    state.customerInfo.name.trim() !== '' && state.customerInfo.phone.trim() !== '';

  const handleConfirm = async () => {
    if (!isFormValid || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const [hours, mins] = (state.selectedTime || '09:00').split(':').map(Number);
      const startMin = hours * 60 + mins;

      if (!state.selectedDate || !state.selectedTime) {
        throw new Error('Please select a date and time.');
      }

      // ═══════════════════════════════════════════════
      // Sequential booking: Mỗi dịch vụ = 1 booking riêng, thời gian nối tiếp
      // VD: Làm tay 9:00–9:45 (thợ chính) → Làm chân 9:45–10:30 (thợ phụ)
      // Tiệm nail tại Đức không cho làm tay + chân đồng thời
      // ═══════════════════════════════════════════════

      // Helper: convert minutes since midnight to "HH:mm" string
      const minsToTimeStr = (totalMins: number): string => {
        const h = Math.floor(totalMins / 60);
        const m = totalMins % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };

      let currentOffsetMin = startMin;
      const hrmServices: HrmBookingServiceInput[] = [];
      const addOns: HrmBookingAddonInput[] = [];

      for (const serviceItem of state.selectedServices) {
        const selectedStaff = serviceItem.selectedStaffType === 'specific'
          ? serviceItem.selectedStaff
          : null;
        const svcDuration = serviceItem.mainService.durationMinutes;
        currentOffsetMin += svcDuration;
        hrmServices.push({
          sourceServiceId: serviceItem.mainService.id,
          staffSelectionType: serviceItem.selectedStaffType,
          name: serviceItem.mainService.name,
          category: 'nail',
          durationMinutes: svcDuration,
          price: serviceItem.mainService.price,
          employeeUserId: selectedStaff?.id,
          employeeName: selectedStaff?.name,
        });

        for (const extra of serviceItem.extras) {
          addOns.push({
            sourceServiceId: extra.id,
            name: extra.name,
            price: extra.price,
          });
        }
      }

      const bookingResult = await createHrmBooking({
        storeId: branchSlug,
        customerName: state.customerInfo.name,
        customerPhone: state.customerInfo.phone,
        customerEmail: state.customerInfo.email || undefined,
        appointmentDate: state.selectedDate,
        startTime: state.selectedTime,
        endTime: minsToTimeStr(currentOffsetMin),
        services: hrmServices,
        addOns,
        staffSelectionType: state.selectedServices.some(
          (service) => service.selectedStaffType === 'specific',
        ) ? 'specific' : 'any',
        bookingMode: state.bookingMode,
        notes: state.customerInfo.notes || undefined,
        source: 'online_booking',
      });

      if (bookingResult.item.attendanceCode) {
        dispatch({
          type: 'SET_BOOKING_RESULT',
          attendanceCode: bookingResult.item.attendanceCode,
        });
      }

      router.push(`/book/${branchSlug}/success`);
    } catch (error: unknown) {
      console.error('Error creating booking via HRM API:', error);
      setSubmitError(
        error instanceof Error ? error.message : 'Booking failed. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString(locale === 'de' ? 'de-DE' : 'vi-VN', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  const confirmButtonText = isRequestMode ? t.booking.confirm.summary.requestBooking : t.booking.confirm.summary.confirmBooking;

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{t.booking.confirm.title}</h1>

      {/* 🧾 Consolidated Booking Summary Card */}
      <div className={styles.summaryCard}>
        <h3 className={styles.summaryTitle}>{t.booking.services.summary.title}</h3>
        
        <div className={styles.summaryList}>
          {state.selectedServices.map((item, idx) => {
            const svcDuration = item.mainService.durationMinutes;
            const svcPrice = item.mainService.price
              + item.extras.reduce((sum, e) => sum + e.price, 0);
            const staffLabel = item.selectedStaffType === 'any'
              ? t.booking.staff.anyStaff.title
              : item.selectedStaff?.name || '';

            // Calculate sequential time for this service
            let segStartMin = 0;
            if (state.selectedTime) {
              const [h, m] = state.selectedTime.split(':').map(Number);
              segStartMin = h * 60 + m;
              for (let j = 0; j < idx; j++) {
                segStartMin += state.selectedServices[j].mainService.durationMinutes;
              }
            }
            const segEndMin = segStartMin + svcDuration;
            const segStartStr = state.selectedTime
              ? `${Math.floor(segStartMin / 60).toString().padStart(2, '0')}:${(segStartMin % 60).toString().padStart(2, '0')}`
              : '';
            const segEndStr = state.selectedTime
              ? `${Math.floor(segEndMin / 60).toString().padStart(2, '0')}:${(segEndMin % 60).toString().padStart(2, '0')}`
              : '';

            return (
              <div key={item.categoryId} className={styles.summaryServiceBlock}>
                {/* Service number badge for multi-service */}
                {state.selectedServices.length > 1 && (
                  <span className={styles.summaryServiceBadge}>
                    {idx + 1}
                  </span>
                )}

                <div className={styles.summaryServiceContent}>
                  {/* Category + Service name row */}
                  <div className={styles.summaryServiceHeader}>
                    <div className={styles.summaryServiceNames}>
                      <span className={styles.summaryItemCategory}>
                        {getCategoryName(item.categoryId, item.categoryName)}
                      </span>
                      <span className={styles.summaryItemName}>
                        {getServiceName(item.mainService.id, item.mainService.name)}
                      </span>
                    </div>
                    <span className={styles.summaryItemPrice}>€{svcPrice}</span>
                  </div>

                  {/* Extras */}
                  {item.extras.map((extra) => (
                    <div key={extra.id} className={styles.summaryItemExtra}>
                      <span>+ {getServiceName(extra.id, extra.name)}</span>
                      <span>€{extra.price}</span>
                    </div>
                  ))}

                  {/* Meta row: duration + staff + time */}
                  <div className={styles.summaryServiceMeta}>
                    <span className={styles.summaryMetaChip}>
                      🕐 {svcDuration} {t.common.minutes}
                    </span>
                    {staffLabel && (
                      <span className={styles.summaryMetaChip}>
                        👤 {staffLabel}
                      </span>
                    )}
                    {state.selectedTime && (
                      <span className={styles.summaryMetaChip}>
                        ⏰ {segStartStr} – {segEndStr}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer: date + total duration */}
        <div className={styles.summaryFooter}>
          {state.selectedDate && (
            <div className={styles.summaryFooterRow}>
              <span>📅 {t.booking.dateTime.summary.date}</span>
              <strong>{formatDate(state.selectedDate)}</strong>
            </div>
          )}
          <div className={styles.summaryFooterRow}>
            <span>⏱ {t.booking.services.summary.duration}</span>
            <strong>{totals.totalDuration} {t.common.minutes}</strong>
          </div>
        </div>
      </div>

      {/* Client type tabs */}
      <div className={styles.clientTabs}>
        <button
          className={`${styles.clientTab} ${!isReturning ? styles.clientTabActive : ''}`}
          onClick={() => handleTabSwitch(false)}
        >
          {t.booking.confirm.tabs.newClient}
        </button>
        <button
          className={`${styles.clientTab} ${isReturning ? styles.clientTabActive : ''}`}
          onClick={() => handleTabSwitch(true)}
        >
          {t.booking.confirm.tabs.returning}
        </button>
      </div>

      {/* Form */}
      <div className={styles.formCard}>
        <div className={styles.formGrid}>
          {/* Full Name */}
          <div className={styles.formGroup}>
            <label className={styles.label}>
              {t.booking.confirm.form.fullName}
              <span className={styles.requiredStar}>*</span>
            </label>
            <input
              type="text"
              className={styles.input}
              placeholder={t.booking.confirm.form.fullNamePlaceholder}
              value={state.customerInfo.name}
              onChange={(e) => handleChange('name', e.target.value)}
            />
          </div>

          {/* Phone */}
          <div className={styles.formGroup}>
            <label className={styles.label}>
              {t.booking.confirm.form.phone}
              <span className={styles.requiredStar}>*</span>
            </label>
            <input
              type="tel"
              className={styles.input}
              placeholder={t.booking.confirm.form.phonePlaceholder}
              value={state.customerInfo.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
            />
          </div>

          {/* Email */}
          <div className={styles.formGroup}>
            <label className={styles.label}>
              {t.booking.confirm.form.email}
            </label>
            <input
              type="email"
              className={styles.input}
              placeholder={t.booking.confirm.form.emailPlaceholder}
              value={state.customerInfo.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className={`${styles.formGroup} ${styles.formGroupFull}`}>
            <label className={styles.label}>
              {t.booking.confirm.form.notes}
            </label>
            <textarea
              className={styles.textarea}
              placeholder={t.booking.confirm.form.notesPlaceholder}
              value={state.customerInfo.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Confirm section (Visible on all screens) */}
      <div className={styles.confirmSection}>
        <button
          className={`${styles.confirmButton} ${isRequestMode ? styles.confirmButtonRequest : ''}`}
          onClick={handleConfirm}
          disabled={!isFormValid || isSubmitting}
        >
          {isSubmitting ? '...' : confirmButtonText}
        </button>
        {submitError && (
          <div style={{ color: '#e53e3e', fontSize: '14px', marginTop: '12px', textAlign: 'center', padding: '8px 16px', background: '#fff5f5', borderRadius: '8px', border: '1px solid #fed7d7' }}>
            ⚠️ {submitError}
          </div>
        )}
        {isRequestMode && (
          <div className={styles.requestNoteCard}>
            <svg
              className={styles.requestNoteIcon}
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <div className={styles.requestNoteText}>
              {t.booking.confirm.summary.requestNote}
            </div>
          </div>
        )}
        <p className={styles.policyText}>{t.booking.confirm.summary.policy}</p>
      </div>
    </div>
  );
}
