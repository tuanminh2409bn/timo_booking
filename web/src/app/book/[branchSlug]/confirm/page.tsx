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

      // Helper functions for service checks
      const isFirstFiveBlockService = (name: string) => {
        const n = name.toLowerCase();
        return (
          n.includes('neumodellage mit gel') ||
          n.includes('auffüllen mit gel') ||
          n.includes('neumodellage mit acryl') ||
          n.includes('auffüllen mit acryl') ||
          n.includes('wimpern')
        );
      };

      const isPedicureService = (name: string) => {
        const n = name.toLowerCase();
        return n.includes('pediküre') || n.includes('zehenmodellage');
      };

      // Fetch all staff members for this branch
      const staffSnap = await getDocs(collection(db, 'branches', branchSlug, 'staff'));
      const allStaff = staffSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as any));
      
      // Filter active staff who can perform the selected services
      const mainServiceIds = state.selectedServices.map((s) => s.mainService.id);
      const eligibleStaff = allStaff.filter(
        (s) =>
          s.status === 'active' && mainServiceIds.every((id) => (s.serviceIds || []).includes(id))
      );

      // Fetch working hours and absences for eligible staff
      const staffWorkingHours: Record<string, any[]> = {};
      const staffAbsences: Record<string, any[]> = {};

      for (const staff of eligibleStaff) {
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

      // Check if any selected service belongs to the first 5 blocks
      const hasFirstFiveBlock = state.selectedServices.some(s => 
        isFirstFiveBlockService(s.mainService.name) || 
        ((s.mainService as any).nameLocalized && Object.values((s.mainService as any).nameLocalized).some(val => isFirstFiveBlockService(val as string)))
      );

      let assignedStaffId = '';
      let assignedStaffName = '';
      let finalStatus = state.bookingMode === 'request' ? 'pending_approval' : 'confirmed';

      // Spec V1: Use per-service staff selection from selectedServices
      // For the primary service (first segment), check its staff
      const primaryService = state.selectedServices[0];
      const primaryStaffType = primaryService?.selectedStaffType || state.selectedStaffType;
      const primaryStaff = primaryService?.selectedStaff || state.selectedStaff;

      if (primaryStaffType === 'specific' && primaryStaff) {
        assignedStaffId = primaryStaff.id;
        assignedStaffName = primaryStaff.name;
        const available = isStaffAvailable(primaryStaff.id, state.selectedDate as string, state.selectedTime as string, totals.totalDuration);
        if (!available || state.bookingMode === 'request') {
          finalStatus = 'pending_approval';
        }
      } else {
        // Any staff selection logic
        // 1. Filter out Junior staff if it contains a first-5-block service (Rule 8)
        let candidates = eligibleStaff;
        if (hasFirstFiveBlock) {
          candidates = eligibleStaff.filter(s => s.staffType === 'main');
        }

        // 2. Sort candidates: Junior first, Main second (Rules 9 & 10)
        const sortedStaff = [...candidates].sort((a, b) => {
          const aType = a.staffType || 'main';
          const bType = b.staffType || 'main';
          if (aType === 'junior' && bType === 'main') return -1;
          if (aType === 'main' && bType === 'junior') return 1;
          return 0;
        });

        // 3. Find the first available staff
        let foundStaff = null;
        for (const staff of sortedStaff) {
          if (isStaffAvailable(staff.id, state.selectedDate as string, state.selectedTime as string, totals.totalDuration)) {
            foundStaff = staff;
            break;
          }
        }

        if (foundStaff) {
          assignedStaffId = foundStaff.id;
          assignedStaffName = foundStaff.name;
          if (state.bookingMode === 'request') {
            finalStatus = 'pending_approval';
          }
        } else {
          // Store fully booked (tolerant mode)
          if (sortedStaff.length > 0) {
            assignedStaffId = sortedStaff[0].id;
            assignedStaffName = sortedStaff[0].name;
          } else {
            assignedStaffId = '';
            assignedStaffName = locale === 'de' ? 'Nicht zugewiesen' : locale === 'vi' ? 'Chưa gán thợ' : 'Unassigned';
          }
          finalStatus = 'pending_approval';
        }
      }

      const bookingDoc = {
        id: bookingId,
        branchId: branchSlug,
        businessId: state.branch?.businessId || '',
        staffId: assignedStaffId,
        staffName: assignedStaffName,
        staffSelectionType: primaryStaffType, // Save selection type!
        customerId: null,
        customerName: state.customerInfo.name,
        customerPhone: state.customerInfo.phone,
        customerEmail: state.customerInfo.email || null,
        services: state.selectedServices.map(item => ({
          serviceId: item.mainService.id,
          categoryId: item.categoryId,
          serviceName: item.mainService.name,
          categoryName: item.categoryName,
          extras: item.extras.map(e => ({
            serviceId: e.id,
            name: e.name,
            durationMinutes: e.durationMinutes,
            price: e.price,
          })),
          durationMinutes: item.mainService.durationMinutes,
          price: item.mainService.price,
        })),
        serviceIds: state.selectedServices.map(s => s.mainService.id),
        appointmentDate: state.selectedDate,
        startTime: state.selectedTime,
        endTime: endTimeStr,
        totalDurationMinutes: totals.totalDuration,
        totalPrice: totals.totalPrice,
        status: finalStatus,
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
          
          {state.selectedServices.map((item) => (
            (item.selectedStaff || item.selectedStaffType === 'any') && (
              <div key={`staff-${item.categoryId}`} className={styles.summaryDetailRow}>
                <span>{getServiceName(item.mainService.id, item.mainService.name)}:</span>
                <strong>
                  {item.selectedStaffType === 'any' ? t.booking.staff.anyStaff.title : item.selectedStaff?.name}
                </strong>
              </div>
            )
          ))}

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

        {/* Spec V1: Hide total price — no payment required */}
        {/* 
        <div className={styles.summaryDivider} />
        <div className={styles.summaryTotalRow}>
          <span>{t.booking.services.summary.total}:</span>
          <span className={styles.summaryTotalValue}>€{totals.totalPrice}</span>
        </div>
        */}
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
