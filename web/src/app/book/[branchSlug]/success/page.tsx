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
  const { getCategoryName, getServiceName } = useServiceTranslation();
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

        {/* Details — services with category + name + staff + time */}
        <div className={styles.detailsCard}>
          {/* Service blocks */}
          {state.selectedServices.map((item, idx) => {
            const svcDuration = item.mainService.durationMinutes
              + item.extras.reduce((sum, e) => sum + e.durationMinutes, 0);
            const staffLabel = item.selectedStaffType === 'any'
              ? t.booking.staff.anyStaff.title
              : item.selectedStaff?.name || '—';

            // Calculate sequential time for this service
            let segStartMin = 0;
            if (state.selectedTime) {
              const [h, m] = state.selectedTime.split(':').map(Number);
              segStartMin = h * 60 + m;
              for (let j = 0; j < idx; j++) {
                segStartMin += state.selectedServices[j].mainService.durationMinutes
                  + state.selectedServices[j].extras.reduce((sum, e) => sum + e.durationMinutes, 0);
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
              <div key={item.categoryId} className={styles.serviceBlock}>
                {state.selectedServices.length > 1 && (
                  <span className={styles.serviceBadge}>{idx + 1}</span>
                )}
                <div className={styles.serviceBlockContent}>
                  <span className={styles.serviceCategoryLabel}>
                    {getCategoryName(item.categoryId, item.categoryName)}
                  </span>
                  <span className={styles.serviceNameLabel}>
                    {getServiceName(item.mainService.id, item.mainService.name)}
                  </span>
                  {item.extras.length > 0 && (
                    <span className={styles.serviceExtrasLabel}>
                      + {item.extras.map(e => getServiceName(e.id, e.name)).join(', ')}
                    </span>
                  )}
                  <div className={styles.serviceMetaRow}>
                    <span className={styles.serviceMetaChip}>🕐 {svcDuration} {t.common.minutes}</span>
                    <span className={styles.serviceMetaChip}>👤 {staffLabel}</span>
                    {state.selectedTime && (
                      <span className={styles.serviceMetaChip}>⏰ {segStartStr} – {segEndStr}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Date & Location */}
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>📅 {t.booking.dateTime.summary.date}</span>
            <span className={styles.detailValue}>
              {state.selectedDate ? formatDate(state.selectedDate) : '—'}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>📍 {t.booking.success.details.where}</span>
            <span className={styles.detailValue}>{state.branch?.name || demoBranch.name}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>⏱ {t.booking.services.summary.duration}</span>
            <span className={styles.detailValue}>{totals.totalDuration} {t.common.minutes}</span>
          </div>
        </div>

        {/* Cancellation policy */}
        <div className={isRequestMode ? `${styles.cancellation} ${styles.cancellationRequest}` : styles.cancellation}>
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
