'use client';

import { useState, useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';
import { useBooking } from '@/lib/bookingContext';
import { useRouter } from 'next/navigation';
import { demoBranch } from '@/lib/seedData';
import styles from './page.module.css';

export default function SuccessPage() {
  const { t } = useI18n();
  const { getServiceName } = useServiceTranslation();
  const { state, dispatch, totals } = useBooking();
  const router = useRouter();
  const branchSlug = state.branchSlug;

  const [appointmentId, setAppointmentId] = useState('APT-......');

  useEffect(() => {
    setAppointmentId(`APT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
  }, []);

  const isRequestMode = state.bookingMode === 'request';

  // Build service display string from all selected services
  const serviceDisplayText = state.selectedServices
    .map((item) => {
      const name = getServiceName(item.mainService.id, item.mainService.name);
      const extras = item.extras
        .map((e) => getServiceName(e.id, e.name))
        .join(', ');
      return extras ? `${name} + ${extras}` : name;
    })
    .join(' | ') || '—';

  // Build iCal SUMMARY from all service names
  const icalSummary = state.selectedServices
    .map((item) => {
      const name = getServiceName(item.mainService.id, item.mainService.name);
      const extras = item.extras
        .map((e) => getServiceName(e.id, e.name))
        .join(', ');
      return extras ? `${name} + ${extras}` : name;
    })
    .join(', ');

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleBookAnother = () => {
    dispatch({ type: 'RESET' });
    router.push(`/book/${branchSlug}`);
  };

  const handleAddToCalendar = () => {
    if (!state.selectedDate || !state.selectedTime || state.selectedServices.length === 0) return;

    const [hours, mins] = state.selectedTime.split(':').map(Number);
    const startDate = new Date(state.selectedDate + 'T00:00:00');
    startDate.setHours(hours, mins);

    const endDate = new Date(startDate);
    endDate.setMinutes(endDate.getMinutes() + totals.totalDuration);

    const formatICS = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `DTSTART:${formatICS(startDate)}`,
      `DTEND:${formatICS(endDate)}`,
      `SUMMARY:${icalSummary} - ${demoBranch.name}`,
      `LOCATION:${demoBranch.address}`,
      `DESCRIPTION:Appointment ${appointmentId}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');

    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appointment-${appointmentId}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.page}>
      <div className={styles.successCard}>
        {/* Animated checkmark */}
        <div className={styles.checkmarkWrapper}>
          <div className={isRequestMode ? styles.checkCircleRequest : styles.checkCircle}>
            <svg
              className={isRequestMode ? styles.checkIconRequest : styles.checkIcon}
              viewBox="0 0 24 24"
            >
              <polyline points="6 12 10 16 18 8" />
            </svg>
          </div>
        </div>

        {/* Appointment ID */}
        <div className={styles.appointmentId}>
          {t.booking.success.id}: <span className={styles.appointmentIdCode}>{appointmentId}</span>
        </div>

        {/* Title — changes based on bookingMode */}
        <h1 className={styles.title}>
          {isRequestMode ? t.booking.success.requestTitle : t.booking.success.title}
        </h1>
        <p className={styles.subtitle}>
          {isRequestMode
            ? t.booking.success.requestSubtitle
            : t.booking.success.subtitle}
        </p>

        {/* Details */}
        <div className={styles.detailsCard}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t.booking.success.details.service}</span>
            <span className={styles.detailValue}>{serviceDisplayText}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t.booking.success.details.when}</span>
            <span className={styles.detailValue}>
              {state.selectedDate ? `${formatDate(state.selectedDate)} · ${state.selectedTime}` : '—'}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t.booking.success.details.professional}</span>
            <span className={styles.detailValue}>
              {state.selectedStaffType === 'any'
                ? t.booking.staff.anyStaff.title
                : state.selectedStaff?.name || '—'}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{t.booking.success.details.where}</span>
            <span className={styles.detailValue}>{demoBranch.name}</span>
          </div>
        </div>

        {/* Cancellation policy */}
        <div className={styles.cancellation}>
          ✓ {t.booking.success.details.cancellation}
        </div>

        {/* Action buttons */}
        <div className={styles.actions}>
          <button
            className={`${styles.actionButton} ${styles.outlineButton}`}
            onClick={handleAddToCalendar}
          >
            📅 {t.booking.success.actions.addCalendar}
          </button>
          <button
            className={`${styles.actionButton} ${styles.primaryButton}`}
            onClick={handleBookAnother}
          >
            {t.booking.success.actions.bookAnother}
          </button>
        </div>
      </div>
    </div>
  );
}
