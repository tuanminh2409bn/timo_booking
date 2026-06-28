'use client';

import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';
import { useBooking } from '@/lib/bookingContext';
import { useRouter } from 'next/navigation';
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';

export default function ConfirmPage() {
  const { t, locale } = useI18n();
  const { getCategoryName, getServiceName } = useServiceTranslation();
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

      // NOTE: isFirstFiveBlockService / isPedicureService removed.
      // Staff priority is now data-driven via service.staffPriority field.

      // Fetch all staff members for this branch
      const staffSnap = await getDocs(collection(db, 'branches', branchSlug, 'staff'));
      const allStaff = staffSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as any));
      
      // Filter active staff who can perform the selected services
      const mainServiceIds = state.selectedServices.map((s) => s.mainService.id);
      const activeStaff = allStaff.filter((s) => s.status === 'active');

      // Fetch working hours and absences for ALL active staff
      // (needed because resolveStaffForService checks per-service, not all-services)
      const staffWorkingHours: Record<string, any[]> = {};
      const staffAbsences: Record<string, any[]> = {};

      for (const staff of activeStaff) {
        const hoursSnap = await getDocs(collection(db, 'branches', branchSlug, 'staff', staff.id, 'workingHours'));
        staffWorkingHours[staff.id] = hoursSnap.docs.map(d => d.data());

        const absencesSnap = await getDocs(collection(db, 'branches', branchSlug, 'staff', staff.id, 'absences'));
        staffAbsences[staff.id] = absencesSnap.docs.map(d => d.data());
      }

      // Fetch active bookings for this date to check conflicts
      const bookingsSnap = await getDocs(collection(db, 'branches', branchSlug, 'bookings'));
      const activeBookings = bookingsSnap.docs
        .map(docSnap => docSnap.data() as any)
        .filter(b => b.appointmentDate === state.selectedDate && b.status !== 'cancelled');

      // Load-balancing: count existing bookings per staff on this date
      const bookingCountByStaff: Record<string, number> = {};
      for (const b of activeBookings) {
        if (b.staffId) {
          bookingCountByStaff[b.staffId] = (bookingCountByStaff[b.staffId] || 0) + 1;
        }
      }

      // Helper to check if staff is available
      const isStaffAvailable = (staffId: string, dateStr: string, timeStr: string, durationMin: number) => {
        const dateObj = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = (dateObj.getDay() + 6) % 7; // Mon = 0, Sun = 6
        
        // 1. Check weekly working hours
        const hoursList = staffWorkingHours[staffId] || [];
        const schedule = hoursList.find(h => h.dayOfWeek === dayOfWeek);
        
        const [slotH, slotM] = timeStr.split(':').map(Number);
        const slotStart = slotH * 60 + slotM;
        const slotEnd = slotStart + durationMin;

        let isWorking = false;
        let workStart = 9 * 60;
        let workEnd = (dayOfWeek === 5 ? 16 : 18) * 60; // defaults

        if (schedule) {
          if (!schedule.isWorking) return false;
          isWorking = true;
          const [sh, sm] = schedule.startTime.split(':').map(Number);
          const [eh, em] = schedule.endTime.split(':').map(Number);
          workStart = sh * 60 + sm;
          workEnd = eh * 60 + em;
        } else {
          isWorking = dayOfWeek !== 6; // Closed on Sunday by default
        }

        if (!isWorking || slotStart < workStart || slotEnd > workEnd) {
          return false;
        }

        // 2. Check absences
        const absencesList = staffAbsences[staffId] || [];
        const isAbsent = absencesList.some(abs => {
          if (abs.absenceDate !== dateStr) return false;
          if (abs.isFullDay) return true;
          
          if (abs.startTime && abs.endTime) {
            const [sh, sm] = abs.startTime.split(':').map(Number);
            const [eh, em] = abs.endTime.split(':').map(Number);
            const absStart = sh * 60 + sm;
            const absEnd = eh * 60 + em;
            return slotStart < absEnd && slotEnd > absStart;
          }
          return false;
        });

        if (isAbsent) return false;

        // 3. Check overlapping bookings
        const hasOverlap = activeBookings.some(b => {
          if (b.staffId !== staffId) return false;
          const [bh, bm] = b.startTime.split(':').map(Number);
          const bStart = bh * 60 + bm;
          const bEnd = bStart + (b.totalDurationMinutes || 30);
          return slotStart < bEnd && slotEnd > bStart;
        });

        return !hasOverlap;
      };

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

      const resolveStaffForService = (
        serviceItem: typeof state.selectedServices[0],
        segmentStartTimeStr: string,  // thời gian bắt đầu thực tế của dịch vụ này
      ) => {
        const servicePriority = serviceItem.mainService.staffPriority || 'none';
        const serviceStaffType = serviceItem.selectedStaffType || 'any';
        const serviceStaff = serviceItem.selectedStaff;

        // If customer chose a specific staff for this service, use it
        if (serviceStaffType === 'specific' && serviceStaff) {
          return {
            staffId: serviceStaff.id,
            staffName: serviceStaff.name,
            staffType: serviceStaffType,
          };
        }

        // Auto-assign based on staffPriority for this service
        const serviceEligible = allStaff.filter(
          (s) => s.status === 'active' && (s.serviceIds || []).includes(serviceItem.mainService.id)
        );

        let candidates = [...serviceEligible];

        // Filter by service.staffType (loại thợ phục vụ) from Firestore
        const svcStaffType = (serviceItem.mainService as any).staffType || 'any';
        if (svcStaffType === 'main') {
          const mainOnly = candidates.filter(s => s.staffType === 'main');
          if (mainOnly.length > 0) candidates = mainOnly;
        } else if (svcStaffType === 'junior') {
          const juniorOnly = candidates.filter(s => s.staffType === 'junior');
          if (juniorOnly.length > 0) candidates = juniorOnly;
        }

        // Sort by staffPriority (ưu tiên thợ) + load-balancing (ít lịch hơn ưu tiên hơn)
        candidates.sort((a, b) => {
          const aType = a.staffType || 'main';
          const bType = b.staffType || 'main';

          // Primary sort: by staff type based on service priority
          if (servicePriority === 'main_staff') {
            if (aType === 'main' && bType === 'junior') return -1;
            if (aType === 'junior' && bType === 'main') return 1;
          } else {
            // assistant_staff, conditional_assistant, none → junior first
            if (aType === 'junior' && bType === 'main') return -1;
            if (aType === 'main' && bType === 'junior') return 1;
          }

          // Tie-breaker: load-balancing — prefer staff with fewer bookings today
          const aCount = bookingCountByStaff[a.id] || 0;
          const bCount = bookingCountByStaff[b.id] || 0;
          return aCount - bCount;
        });

        // For main_staff priority, filter out junior staff (additional check)
        if (servicePriority === 'main_staff') {
          const mainOnly = candidates.filter(s => s.staffType === 'main');
          if (mainOnly.length > 0) candidates = mainOnly;
        }

        // Find available staff — check at the sequential start time of THIS segment
        let foundStaff = null;
        for (const staff of candidates) {
          if (isStaffAvailable(staff.id, state.selectedDate as string, segmentStartTimeStr, serviceItem.mainService.durationMinutes)) {
            foundStaff = staff;
            break;
          }
        }

        if (foundStaff) {
          return {
            staffId: foundStaff.id,
            staffName: foundStaff.name,
            staffType: 'any' as const,
          };
        }

        // Fallback: assign first candidate even if busy
        if (candidates.length > 0) {
          return {
            staffId: candidates[0].id,
            staffName: candidates[0].name,
            staffType: 'any' as const,
          };
        }

        return {
          staffId: '',
          staffName: locale === 'de' ? 'Nicht zugewiesen' : locale === 'vi' ? 'Chưa gán thợ' : 'Unassigned',
          staffType: 'any' as const,
        };
      };

      // ── Sequential booking creation ──
      // Each service gets its own booking with sequential start times
      const isMultiService = state.selectedServices.length > 1;
      let currentOffsetMin = startMin; // starts at the customer's selected time

      for (let i = 0; i < state.selectedServices.length; i++) {
        const serviceItem = state.selectedServices[i];
        const segmentStartTimeStr = minsToTimeStr(currentOffsetMin);

        // Resolve staff at the correct sequential time
        const staffAssignment = resolveStaffForService(serviceItem, segmentStartTimeStr);

        // Calculate duration and price for this service
        const svcDuration = serviceItem.mainService.durationMinutes
          + serviceItem.extras.reduce((sum, e) => sum + e.durationMinutes, 0);
        const svcPrice = serviceItem.mainService.price
          + serviceItem.extras.reduce((sum, e) => sum + e.price, 0);

        // Calculate end time for this service segment
        const segmentEndMin = currentOffsetMin + svcDuration;
        const segmentEndTimeStr = minsToTimeStr(segmentEndMin);

        // Sub-booking ID: BK-1234 for single, BK-1234-A / BK-1234-B for multi
        const subBookingId = isMultiService
          ? `${bookingId}-${String.fromCharCode(65 + i)}`
          : bookingId;

        // Determine status
        let segmentStatus = state.bookingMode === 'request' ? 'pending_approval' : 'confirmed';
        if (staffAssignment.staffType === 'specific' && staffAssignment.staffId) {
          const available = isStaffAvailable(
            staffAssignment.staffId,
            state.selectedDate as string,
            segmentStartTimeStr,
            svcDuration,
          );
          if (!available) segmentStatus = 'pending_approval';
        }
        if (!staffAssignment.staffId) segmentStatus = 'pending_approval';

        const bookingDoc = {
          id: subBookingId,
          parentBookingId: isMultiService ? bookingId : null,
          branchId: branchSlug,
          businessId: state.branch?.businessId || '',
          staffId: staffAssignment.staffId,
          staffName: staffAssignment.staffName,
          staffSelectionType: staffAssignment.staffType,
          customerId: null,
          customerName: state.customerInfo.name,
          customerPhone: state.customerInfo.phone,
          customerEmail: state.customerInfo.email || null,
          services: [{
            serviceId: serviceItem.mainService.id,
            categoryId: serviceItem.categoryId,
            serviceName: serviceItem.mainService.name,
            categoryName: serviceItem.categoryName,
            extras: serviceItem.extras.map(e => ({
              serviceId: e.id,
              name: e.name,
              durationMinutes: e.durationMinutes,
              price: e.price,
            })),
            durationMinutes: serviceItem.mainService.durationMinutes,
            price: serviceItem.mainService.price,
          }],
          serviceIds: [serviceItem.mainService.id],
          appointmentDate: state.selectedDate,
          startTime: segmentStartTimeStr,
          endTime: segmentEndTimeStr,
          totalDurationMinutes: svcDuration,
          totalPrice: svcPrice,
          status: segmentStatus,
          source: 'online',
          notes: i === 0 ? (state.customerInfo.notes || '') : '', // notes only on first booking
          sequenceIndex: i,                    // thứ tự trong chuỗi dịch vụ
          totalSequenceServices: state.selectedServices.length,
          createdAt: new Date().toISOString(),
        };

        await setDoc(doc(db, 'branches', branchSlug, 'bookings', subBookingId), bookingDoc);

        // Advance offset for next service
        currentOffsetMin = segmentEndMin;
      }
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

      {/* 🧾 Consolidated Booking Summary Card */}
      <div className={styles.summaryCard}>
        <h3 className={styles.summaryTitle}>{t.booking.services.summary.title}</h3>
        
        <div className={styles.summaryList}>
          {state.selectedServices.map((item, idx) => {
            const svcDuration = item.mainService.durationMinutes
              + item.extras.reduce((sum, e) => sum + e.durationMinutes, 0);
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
