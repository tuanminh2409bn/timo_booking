'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '@/lib/i18n';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';
import { useBooking } from '@/lib/bookingContext';
import { demoCategories, demoServices, demoStaff, generateDemoTimeSlots } from '@/lib/seedData';
import { hasConflict, shouldSkipStaffSelection, MAX_MAIN_SERVICES } from '@/lib/types';
import type { Staff, Service, ServiceCategory } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';

type TimeFilter = 'all' | 'morning' | 'afternoon' | 'evening';

const WEEKDAY_LABELS = {
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  vi: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Convert to Monday = 0
}

function formatDateISO(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function StaffSelectionPage() {
  const { t, locale } = useI18n();
  const { getCategoryName, getCategoryDescription, getServiceName, getServiceDescription } = useServiceTranslation();
  const { state, dispatch, totals } = useBooking();
  const router = useRouter();
  const branchSlug = state.branchSlug;

  // ── Firestore State Hydration ──
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [realBookings, setRealBookings] = useState<any[]>([]);
  const [staffAbsences, setStaffAbsences] = useState<Record<string, any[]>>({});
  const [staffWorkingHours, setStaffWorkingHours] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (!branchSlug) return;
    const fetchDbData = async () => {
      try {
        const catSnap = await getDocs(collection(db, 'branches', branchSlug, 'categories'));
        if (!catSnap.empty) {
          setCategories(catSnap.docs.map(doc => doc.data() as ServiceCategory));
        }

        const svcSnap = await getDocs(collection(db, 'branches', branchSlug, 'services'));
        if (!svcSnap.empty) {
          setServices(svcSnap.docs.map(doc => doc.data() as Service));
        }

        const staffSnap = await getDocs(collection(db, 'branches', branchSlug, 'staff'));
        if (!staffSnap.empty) {
          const staffData = staffSnap.docs.map(doc => doc.data() as Staff);
          setStaffList(staffData);
        }
      } catch (e) {
        console.error('Error fetching Firestore resources, using local seed fallback', e);
      }
    };
    
    fetchDbData();
  }, [branchSlug]);

  // Real-time listener for staff absences — updates slots immediately when admin sets absence
  useEffect(() => {
    if (!branchSlug || staffList.length === 0) return;

    const unsubscribes: (() => void)[] = [];

    for (const staff of staffList) {
      if (staff.status !== 'active') continue;
      const absRef = collection(db, 'branches', branchSlug, 'staff', staff.id, 'absences');
      const unsubAbs = onSnapshot(absRef, (snap) => {
        const absList = snap.docs.map(d => d.data());
        setStaffAbsences(prev => ({
          ...prev,
          [staff.id]: absList,
        }));
      }, (e) => {
        console.error(`Error listening to absences for ${staff.id}:`, e);
      });
      unsubscribes.push(unsubAbs);

      const whRef = collection(db, 'branches', branchSlug, 'staff', staff.id, 'workingHours');
      const unsubWh = onSnapshot(whRef, (snap) => {
        const whList = snap.docs.map(d => d.data());
        setStaffWorkingHours(prev => ({
          ...prev,
          [staff.id]: whList,
        }));
      }, (e) => {
        console.error(`Error listening to working hours for ${staff.id}:`, e);
      });
      unsubscribes.push(unsubWh);
    }

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [branchSlug, staffList]);

  useEffect(() => {
    if (!branchSlug) return;
    const bookingsRef = collection(db, 'branches', branchSlug, 'bookings');
    const unsubscribe = onSnapshot(bookingsRef, (snap) => {
      const list: any[] = [];
      snap.forEach(doc => {
        list.push(doc.data());
      });
      setRealBookings(list);
    }, (e) => {
      console.error('Error listening to bookings', e);
    });
    return () => unsubscribe();
  }, [branchSlug]);

  // ── Local Labels ──
  const localLabels = useMemo(() => ({
    noPreference: {
      de: 'Beliebiger Mitarbeiter',
      en: 'No preference',
      vi: 'Bất kỳ ai',
    }[locale] || 'No preference',
    chooseDate: {
      de: 'Datum auswählen',
      en: 'Choose a date',
      vi: 'Chọn ngày',
    }[locale] || 'Choose a date',
    chooseTime: {
      de: '2. Datum & Uhrzeit auswählen',
      en: '2. Choose Date & Time',
      vi: '2. Chọn ngày & giờ',
    }[locale] || '2. Choose Date & Time',
  }), [locale]);

  // ── Service addition state ──

  // ── Date/Time states matching screenshot 2.png ──
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDateISO(today.getFullYear(), today.getMonth(), today.getDate());

  const [weekStartDate, setWeekStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [showCalendarDropdown, setShowCalendarDropdown] = useState(false);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

  const calendarRef = useRef<HTMLDivElement>(null);
  const calendarBtnRef = useRef<HTMLButtonElement>(null);

  // Close calendar dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        showCalendarDropdown &&
        calendarRef.current &&
        !calendarRef.current.contains(event.target as Node) &&
        calendarBtnRef.current &&
        !calendarBtnRef.current.contains(event.target as Node)
      ) {
        setShowCalendarDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCalendarDropdown]);

  const selectedDate = state.selectedDate;
  const selectedTime = state.selectedTime;

  // ── Auto-compute skipStaffSelection ──
  const skipStaffSelection = useMemo(() => {
    return shouldSkipStaffSelection(state.selectedServices, categories);
  }, [state.selectedServices, categories]);

  // Sync skipStaffSelection with context state
  useEffect(() => {
    if (state.skipStaffSelection !== skipStaffSelection) {
      dispatch({ type: 'SET_SKIP_STAFF', skip: skipStaffSelection });
    }
  }, [skipStaffSelection, state.skipStaffSelection, dispatch]);

  // ── Filter staff who can perform ALL selected main services ──
  const availableStaff = useMemo(() => {
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

    if (state.selectedServices.length === 0) return staffList.filter((s) => s.status === 'active');
    
    // Check service.staffType from Firestore (data-driven)
    const requiredStaffTypes = state.selectedServices
      .map(s => (s.mainService as any).staffType || 'any')
      .filter((t: string) => t !== 'any');

    // Determine required staff type: if any service requires 'main', require main
    // If any requires 'junior', require junior. Mixed = 'any' (can't satisfy both)
    let requiredType: 'main' | 'junior' | 'any' = 'any';
    if (requiredStaffTypes.includes('main')) {
      requiredType = 'main';
    } else if (requiredStaffTypes.includes('junior')) {
      requiredType = 'junior';
    }

    // Fallback: hardcoded first-five-block check for services without staffType
    if (requiredType === 'any') {
      const hasFirstFiveBlock = state.selectedServices.some(s => 
        isFirstFiveBlockService(s.mainService.name) || 
        ((s.mainService as any).nameLocalized && Object.values((s.mainService as any).nameLocalized).some(val => isFirstFiveBlockService(val as string)))
      );
      if (hasFirstFiveBlock) requiredType = 'main';
    }

    const mainServiceIds = state.selectedServices.map((s) => s.mainService.id);
    return staffList.filter(
      (s) =>
        s.status === 'active' && 
        (requiredType === 'any' || s.staffType === requiredType) &&
        mainServiceIds.every((id) => (s.serviceIds || []).includes(id))
    );
  }, [state.selectedServices, staffList]);

  // If selected staff is no longer available, fallback to 'any'
  useEffect(() => {
    if (state.selectedStaff && state.selectedStaffType === 'specific') {
      const isStillAvailable = availableStaff.some((s) => s.id === state.selectedStaff?.id);
      if (!isStillAvailable) {
        dispatch({ type: 'SELECT_STAFF', staff: null, staffType: 'any' });
      }
    }
    // If skipping staff selection, force 'any'
    if (skipStaffSelection && (state.selectedStaff || state.selectedStaffType !== 'any')) {
      dispatch({ type: 'SELECT_STAFF', staff: null, staffType: 'any' });
    }
  }, [availableStaff, state.selectedStaff, state.selectedStaffType, skipStaffSelection, dispatch]);

  // Align calendar viewMonth/viewYear to weekStartDate
  useEffect(() => {
    setViewMonth(weekStartDate.getMonth());
    setViewYear(weekStartDate.getFullYear());
  }, [weekStartDate]);


  // Legacy global handlers (kept for backward compat)
  const handleSelectAny = () => {
    dispatch({ type: 'SELECT_STAFF', staff: null, staffType: 'any' });
  };

  const handleSelectStaff = (staff: Staff) => {
    dispatch({ type: 'SELECT_STAFF', staff, staffType: 'specific' });
  };

  const isAnySelected = state.selectedStaffType === 'any' && !state.selectedStaff;
  const isStaffSelected = (staffId: string) =>
    state.selectedStaffType === 'specific' && state.selectedStaff?.id === staffId;

  // Helper to check if a staff is on leave/absence for a given date+time
  const checkStaffAbsence = useCallback((staffId: string, dateStr: string, slotStartMins: number, durationMins: number): boolean => {
    const absences = staffAbsences[staffId];
    if (!absences || absences.length === 0) return false;

    const slotEndMins = slotStartMins + durationMins;

    return absences.some(abs => {
      if (abs.absenceDate !== dateStr) return false;
      if (abs.isFullDay) return true; // Full day leave = always blocked

      // Partial day leave — check time overlap
      if (abs.startTime && abs.endTime) {
        const [sh, sm] = abs.startTime.split(':').map(Number);
        const [eh, em] = abs.endTime.split(':').map(Number);
        const absStart = sh * 60 + sm;
        const absEnd = eh * 60 + em;
        return slotStartMins < absEnd && slotEndMins > absStart;
      }
      return false;
    });
  }, [staffAbsences]);

  // Helper to check if a staff has any overlapping booking OR is on leave
  const checkStaffOverlap = useCallback((staffId: string, dateStr: string, slotStartMins: number, durationMins: number): boolean => {
    // 1. Check working hours first
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = (dateObj.getDay() + 6) % 7; // Mon = 0, Sun = 6
    const hoursList = staffWorkingHours[staffId] || [];
    const schedule = hoursList.find(h => h.dayOfWeek === dayOfWeek);
    
    let isWorking = false;
    let workStart = 9 * 60;
    let workEnd = (dayOfWeek === 5 ? 16 : 18) * 60; // defaults

    if (schedule) {
      if (!schedule.isWorking) return true; // not working = busy
      isWorking = true;
      const [sh, sm] = schedule.startTime.split(':').map(Number);
      const [eh, em] = schedule.endTime.split(':').map(Number);
      workStart = sh * 60 + sm;
      workEnd = eh * 60 + em;
    } else {
      isWorking = dayOfWeek !== 6; // Closed on Sunday by default
    }

    const slotEndMins = slotStartMins + durationMins;

    if (!isWorking || slotStartMins < workStart || slotEndMins > workEnd) {
      return true; // outside working hours = busy
    }

    // 2. Check absences (most important override)
    if (checkStaffAbsence(staffId, dateStr, slotStartMins, durationMins)) {
      return true; // Staff is on leave
    }

    // 3. Check booking overlaps
    
    return realBookings.some(booking => {
      if (booking.appointmentDate !== dateStr) return false;
      if (booking.status === 'cancelled') return false;
      if (booking.staffId !== staffId) return false;
      
      const [startH, startM] = booking.startTime.split(':').map(Number);
      const duration = booking.totalDurationMinutes || 30;
      const startVal = startH * 60 + startM;
      const endVal = startVal + duration;
      
      // Overlap formula: slotStart < bookingEnd && slotEnd > bookingStart
      return slotStartMins < endVal && slotEndMins > startVal;
    });
  }, [realBookings, checkStaffAbsence, staffWorkingHours]);

  // ── 7-Day Time Table Logic (Spec V1: 2-segment availability) ──
  const getSlotsForDate = useCallback((dateStr: string) => {
    type SlotItem = { time: string; available: boolean; status: 'available' | 'held' | 'booked' | 'request_only' };
    const slots: SlotItem[] = [];
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = (dateObj.getDay() + 6) % 7; // Convert to Mon=0 (0-6)
    
    if (dayOfWeek === 6) return [] as SlotItem[]; // Sunday is closed
    const endHour = dayOfWeek === 5 ? 16 : 18; // Saturday closes at 16:00

    // Spec V1: Each service segment has its own duration & staff
    const segments = state.selectedServices.map(item => {
      const extraDuration = item.extras ? item.extras.reduce((sum, e) => sum + (e.durationMinutes || 0), 0) : 0;
      return {
        duration: (item.mainService.durationMinutes || 30) + extraDuration,
        staffId: item.selectedStaffType === 'specific' ? item.selectedStaff?.id : undefined,
        staffType: item.selectedStaffType,
        serviceId: item.mainService.id,
      };
    });

    // Fallback: If no services selected, use total duration with legacy staff
    const totalDuration = totals.totalDuration || 30;

    for (let hour = 9; hour < endHour; hour++) {
      for (const min of [0, 30]) {
        const time = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
        const slotStartMins = hour * 60 + min;

        // Check if the entire booking (all segments) fits within working hours
        const totalEnd = slotStartMins + totalDuration;
        if (totalEnd > endHour * 60) {
          // Slot would overflow working hours, skip
          continue;
        }

        let slotStatus: 'available' | 'held' | 'booked' | 'request_only' = 'available';
        let isHidden = false;

        if (segments.length === 0) {
          // No services selected yet, show all slots as available
          slotStatus = 'available';
        } else {
          // Spec V1: Check each segment sequentially
          let currentOffset = slotStartMins;

          for (const seg of segments) {
            if (isHidden) break;

            if (seg.staffId) {
              // Specific staff: must be free for this segment
              const overlap = checkStaffOverlap(seg.staffId, dateStr, currentOffset, seg.duration);
              if (overlap) {
                // Spec V1: Specific staff busy = hide slot entirely (no request allowed)
                isHidden = true;
              }
            } else {
              // Any staff: check if at least one eligible staff is free
              const eligibleStaff = staffList.filter(
                (s) => s.status === 'active' && (s.serviceIds || []).includes(seg.serviceId)
              );

              if (eligibleStaff.length === 0) {
                isHidden = true;
              } else {
                const allBusy = eligibleStaff.every(staff =>
                  checkStaffOverlap(staff.id, dateStr, currentOffset, seg.duration)
                );
                if (allBusy) {
                  slotStatus = 'request_only';
                }
              }
            }

            currentOffset += seg.duration;
          }
        }

        if (!isHidden) {
          slots.push({
            time,
            available: true,
            status: slotStatus,
          });
        }
      }
    }
    return slots;
  }, [totals.totalDuration, state.selectedServices, staffList, checkStaffOverlap]);

  const columnsList = useMemo(() => {
    const list = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStartDate);
      d.setDate(weekStartDate.getDate() + i);
      const isoStr = formatDateISO(d.getFullYear(), d.getMonth(), d.getDate());
      
      // Localized labels
      const weekdayLabel = d.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', {
        weekday: 'long'
      });
      const dateLabel = d.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', {
        day: 'numeric',
        month: 'short'
      });

      // Spec V1: per-service staff is now inside selectedServices, no longer global
      const rawSlots = getSlotsForDate(isoStr);
      
      const filtered = rawSlots.filter((slot) => {
        if (timeFilter === 'all') return true;
        const hour = parseInt(slot.time.split(':')[0]);
        if (timeFilter === 'morning') return hour < 12;
        if (timeFilter === 'afternoon') return hour >= 12 && hour < 17;
        if (timeFilter === 'evening') return hour >= 17;
        return true;
      });

      list.push({
        date: isoStr,
        weekdayLabel,
        dateLabel,
        isSunday: d.getDay() === 0,
        slots: filtered
      });
    }
    return list;
  }, [weekStartDate, locale, state.selectedServices, timeFilter, getSlotsForDate]);

  const handlePrevWeek = () => {
    setWeekStartDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - 7);
      if (next < today) return today;
      return next;
    });
  };

  const handleNextWeek = () => {
    setWeekStartDate((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + 7);
      return next;
    });
  };

  const isPrevWeekDisabled = weekStartDate <= today;

  // ── Month Calendar popover/dropdown logic ──
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth).toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', {
    month: 'long',
    year: 'numeric',
  });

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const handleSelectDateFromCalendar = (dateStr: string) => {
    const selectedD = new Date(dateStr + 'T00:00:00');
    setWeekStartDate(selectedD);
    dispatch({ type: 'SELECT_DATE', date: dateStr });
    setShowCalendarDropdown(false);
  };

  const handleSelectTime = (dateStr: string, time: string, status: 'available' | 'request_only') => {
    dispatch({ type: 'SELECT_DATE', date: dateStr });
    dispatch({
      type: 'SELECT_TIME',
      time,
      bookingMode: status === 'request_only' ? 'request' : 'instant',
    });
  };

  const isDayPast = (year: number, month: number, day: number) => {
    const d = new Date(year, month, day);
    return d < today;
  };

  const isDaySunday = (year: number, month: number, day: number) => {
    return new Date(year, month, day).getDay() === 0;
  };

  const isPrevMonthDisabled = viewYear === today.getFullYear() && viewMonth <= today.getMonth();

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{t.booking.dateTime.title}</h1>

      {/* 📅 Date & Time Calendar & Time Grid */}
      <section className={styles.sectionCard}>
        <div className={styles.dateTimeHeader}>
          <h2 className={styles.sectionTitle}>{localLabels.chooseTime}</h2>
          <button
            ref={calendarBtnRef}
            className={styles.chooseDateBtn}
            onClick={() => setShowCalendarDropdown(!showCalendarDropdown)}
          >
            <svg className={styles.calendarIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            {localLabels.chooseDate}
          </button>

          {/* Collapsible Month Calendar Popover */}
          {showCalendarDropdown && (
            <div ref={calendarRef} className={styles.calendarDropdown}>
              <div className={styles.calendarInner}>
                <div className={styles.calendarNav}>
                  <button
                    className={styles.calendarNavButton}
                    onClick={handlePrevMonth}
                    disabled={isPrevMonthDisabled}
                  >
                    ‹
                  </button>
                  <span className={styles.calendarMonth}>{monthName}</span>
                  <button className={styles.calendarNavButton} onClick={handleNextMonth}>
                    ›
                  </button>
                </div>

                <div className={styles.weekDays}>
                  {(WEEKDAY_LABELS[locale as keyof typeof WEEKDAY_LABELS] || WEEKDAY_LABELS.de).map((d) => (
                    <div key={d} className={styles.weekDay}>
                      {d}
                    </div>
                  ))}
                </div>

                <div className={styles.daysGrid}>
                  {Array.from({ length: firstDay }).map((_, i) => (
                    <div key={`empty-${i}`} className={`${styles.dayCell} ${styles.dayEmpty}`} />
                  ))}

                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1;
                    const dateStr = formatDateISO(viewYear, viewMonth, day);
                    const isPast = isDayPast(viewYear, viewMonth, day);
                    const isSunday = isDaySunday(viewYear, viewMonth, day);
                    const isDisabled = isPast || isSunday;
                    const isToday = dateStr === todayStr;
                    const isSelected = dateStr === selectedDate;

                    return (
                      <button
                        key={day}
                        className={`${styles.dayCell} ${isSelected ? styles.dayCellSelected : ''} ${
                          isToday && !isSelected ? styles.dayCellToday : ''
                        } ${isDisabled ? styles.dayDisabled : ''}`}
                        onClick={() => !isDisabled && handleSelectDateFromCalendar(dateStr)}
                        disabled={isDisabled}
                      >
                        {day}
                        {isToday && (
                          <span className={styles.todayLabel}>{t.booking.dateTime.calendar.today}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 7-Day Columns Time Grid with Side navigation arrows */}
        <div className={styles.weekGridContainer}>
          <button
            className={styles.weekNavBtn}
            onClick={handlePrevWeek}
            disabled={isPrevWeekDisabled}
            aria-label="Previous week"
          >
            ‹
          </button>

          <div className={styles.columnsGridWrapper}>
            <div className={styles.columnsGrid}>
              {columnsList.map((col) => (
                <div key={col.date} className={styles.columnDay}>
                  {/* Column Header */}
                  <div className={styles.columnHeader}>
                    <span className={styles.columnWeekday}>{col.weekdayLabel}</span>
                    <span className={styles.columnDate}>{col.dateLabel}</span>
                  </div>

                  {/* Column slots */}
                  <div className={styles.columnSlots}>
                    {col.isSunday ? (
                      <div className={styles.closedDayLabel}>
                        {locale === 'de' ? 'Geschlossen' : locale === 'vi' ? 'Đóng cửa' : 'Closed'}
                      </div>
                    ) : col.slots.length === 0 ? (
                      <div className={styles.noSlotsLabel}>
                        -
                      </div>
                    ) : (
                      col.slots.map((slot) => {
                        const isSelected = selectedDate === col.date && slot.time === selectedTime;
                        const isHeld = slot.status === 'held';
                        const isBooked = slot.status === 'booked';
                        const isRequestOnly = slot.status === 'request_only';
                        const isDisabled = !slot.available;

                        return (
                          <button
                            key={slot.time}
                            className={`${styles.slotGridButton} ${
                              isSelected && !isRequestOnly ? styles.slotSelected : ''
                            } ${
                              isSelected && isRequestOnly ? styles.slotRequestSelected : ''
                            } ${
                              isRequestOnly && !isSelected ? styles.slotRequest : ''
                            } ${isHeld ? styles.slotHeld : ''} ${
                              isBooked ? styles.slotBooked : ''
                            } ${isDisabled && !isHeld && !isBooked ? styles.slotDisabled : ''}`}
                            onClick={() =>
                              slot.available &&
                              handleSelectTime(col.date, slot.time, isRequestOnly ? 'request_only' : 'available')
                            }
                            disabled={isDisabled}
                          >
                            {isHeld
                              ? t.booking.dateTime.slots.held
                              : isBooked
                              ? t.booking.dateTime.slots.booked
                              : slot.time}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            className={styles.weekNavBtn}
            onClick={handleNextWeek}
            aria-label="Next week"
          >
            ›
          </button>
        </div>

        {/* Legend */}
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendDotAvailable} />
            {t.booking.dateTime.slots.legendAvailable}
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDotRequest} />
            {t.booking.dateTime.slots.legendRequest}
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDotBooked} />
            {t.booking.dateTime.slots.legendBooked}
          </span>
        </div>
      </section>
    </div>
  );
}
