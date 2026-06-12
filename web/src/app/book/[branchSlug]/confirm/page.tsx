'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';
import { useBooking } from '@/lib/bookingContext';
import { useRouter } from 'next/navigation';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';

export default function ConfirmPage() {
  const { t, locale } = useI18n();
  const { getServiceName } = useServiceTranslation();
  const { state, totals, dispatch } = useBooking();
  const router = useRouter();
  const branchSlug = state.branchSlug;

  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const bookingId = `BK-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const [hours, mins] = (state.selectedTime || '09:00').split(':').map(Number);
      const startMin = hours * 60 + mins;
      const endMin = startMin + totals.totalDuration;
      
      const endHours = Math.floor(endMin / 60);
      const endMins = endMin % 60;
      const endTimeStr = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;

      const bookingDoc = {
        id: bookingId,
        branchId: branchSlug,
        businessId: state.branch?.businessId || '',
        staffId: state.selectedStaff?.id || '',
        staffName: state.selectedStaffType === 'any' 
          ? (locale === 'de' ? 'Beliebiger Mitarbeiter' : locale === 'vi' ? 'Bất kỳ ai' : 'Any practitioner') 
          : (state.selectedStaff?.name || ''),
        customerId: null,
        customerName: state.customerInfo.name,
        customerPhone: state.customerInfo.phone,
        customerEmail: state.customerInfo.email || null,
        services: state.selectedServices.map(item => {
          const serviceName = item.mainService.name;
          const extras = item.extras.map(e => e.name).join(', ');
          return extras ? `${serviceName} + ${extras}` : serviceName;
        }),
        appointmentDate: state.selectedDate,
        startTime: state.selectedTime,
        endTime: endTimeStr,
        totalDurationMinutes: totals.totalDuration,
        totalPrice: totals.totalPrice,
        status: state.bookingMode === 'request' ? 'pending_approval' : 'confirmed',
        source: 'online',
        notes: state.customerInfo.notes || '',
        createdAt: new Date().toISOString(),
      };
      
      await setDoc(doc(db, 'branches', branchSlug, 'bookings', bookingId), bookingDoc);
    } catch (e) {
      console.error('Error saving booking to Firestore:', e);
    }

    setIsSubmitting(false);
    router.push(`/book/${branchSlug}/success`);
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

      {/* 🧾 Inline Booking Summary Card */}
      <div className={styles.summaryCard}>
        <h3 className={styles.summaryTitle}>{t.booking.services.summary.title}</h3>
        
        <div className={styles.summaryList}>
          {state.selectedServices.map((item) => (
            <div key={item.categoryId} className={styles.summaryItem}>
              <div className={styles.summaryItemMain}>
                <span className={styles.summaryItemName}>
                  {getServiceName(item.mainService.id, item.mainService.name)}
                </span>
                <span className={styles.summaryItemPrice}>€{item.mainService.price}</span>
              </div>
              {item.extras.map((extra) => (
                <div key={extra.id} className={styles.summaryItemExtra}>
                  <span>+ {getServiceName(extra.id, extra.name)}</span>
                  <span>€{extra.price}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className={styles.summaryDetails}>
          <div className={styles.summaryDetailRow}>
            <span>{t.booking.services.summary.duration}:</span>
            <strong>{totals.totalDuration} {t.common.minutes}</strong>
          </div>
          
          {(state.selectedStaff || state.selectedStaffType === 'any') && (
            <div className={styles.summaryDetailRow}>
              <span>{t.booking.staff.summary.professional}:</span>
              <strong>
                {state.selectedStaffType === 'any' ? t.booking.staff.anyStaff.title : state.selectedStaff?.name}
              </strong>
            </div>
          )}

          {state.selectedDate && (
            <div className={styles.summaryDetailRow}>
              <span>{t.booking.dateTime.summary.date}:</span>
              <strong>{formatDate(state.selectedDate)}</strong>
            </div>
          )}

          {state.selectedTime && (
            <div className={styles.summaryDetailRow}>
              <span>{t.booking.dateTime.summary.time}:</span>
              <strong>{state.selectedTime}</strong>
            </div>
          )}
        </div>

        <div className={styles.summaryDivider} />

        <div className={styles.summaryTotalRow}>
          <span>{t.booking.services.summary.total}:</span>
          <span className={styles.summaryTotalValue}>€{totals.totalPrice}</span>
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

          {/* Password - only for new clients */}
          {!isReturning && (
            <div className={styles.formGroup}>
              <label className={styles.label}>
                {t.booking.confirm.form.password}
              </label>
              <input
                type="password"
                className={styles.input}
                placeholder={t.booking.confirm.form.passwordPlaceholder}
                value={state.customerInfo.password}
                onChange={(e) => handleChange('password', e.target.value)}
              />
            </div>
          )}

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
