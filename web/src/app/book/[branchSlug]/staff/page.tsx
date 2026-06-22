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
          setStaffList(staffSnap.docs.map(doc => doc.data() as Staff));
        }
      } catch (e) {
        console.error('Error fetching Firestore resources, using local seed fallback', e);
      }
    };
    
    fetchDbData();
  }, [branchSlug]);

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
  const [showAddService, setShowAddService] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

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
    
    const hasFirstFiveBlock = state.selectedServices.some(s => 
      isFirstFiveBlockService(s.mainService.name) || 
      ((s.mainService as any).nameLocalized && Object.values((s.mainService as any).nameLocalized).some(val => isFirstFiveBlockService(val as string)))
    );

    const mainServiceIds = state.selectedServices.map((s) => s.mainService.id);
    return staffList.filter(
      (s) =>
        s.status === 'active' && 
        (!hasFirstFiveBlock || s.staffType === 'main') &&
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

  // ── Inline Service Selector Logic ──
  const filteredServices = useMemo(() => {
    if (!searchQuery.trim()) return services;
    const q = searchQuery.toLowerCase();
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [services, searchQuery]);

  const categoriesWithServices = useMemo(() => {
    return categories
      .filter((cat) => cat.isActive)
      .map((cat) => ({
        ...cat,
        services: filteredServices.filter((s) => s.categoryId === cat.id && s.isActive),
      }))
      .filter((cat) => cat.services.length > 0);
  }, [categories, filteredServices]);

  const isMainSelected = useCallback(
    (categoryId: string, serviceId: string) => {
      const item = state.selectedServices.find((s) => s.categoryId === categoryId);
      return item?.mainService.id === serviceId;
    },
    [state.selectedServices]
  );

  const getCategoryDisableReason = useCallback(
    (category: ServiceCategory): 'conflict' | 'max' | null => {
      if (state.selectedServices.some((s) => s.categoryId === category.id)) {
        return null;
      }
      if (hasConflict(state.selectedServices, category.conflictGroup)) {
        return 'conflict';
      }
      if (state.selectedServices.length >= MAX_MAIN_SERVICES) {
        return 'max';
      }
      return null;
    },
    [state.selectedServices]
  );

  const handleSelectMain = (category: ServiceCategory, service: Service) => {
    if (isMainSelected(category.id, service.id)) {
      dispatch({ type: 'REMOVE_CATEGORY', categoryId: category.id });
    } else {
      dispatch({ type: 'ADD_MAIN_SERVICE', category, service });
    }
  };

  const handleToggleExtra = (categoryId: string, extra: Service) => {
    dispatch({ type: 'TOGGLE_EXTRA', categoryId, extra });
  };

  const getConflictGroupLabel = (category: ServiceCategory): string => {
    if (!category.conflictGroup) return '';
    const oppositeGroup = category.conflictGroup === 'gel' ? 'acryl' : 'gel';
    return oppositeGroup === 'gel' ? 'Gel' : 'Acryl';
  };

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  // Spec V1: Per-service staff selection handlers
  const handleSelectAnyForService = (categoryId: string) => {
    dispatch({ type: 'SELECT_STAFF_FOR_SERVICE', categoryId, staff: null, staffType: 'any' });
  };

  const handleSelectStaffForService = (categoryId: string, staff: Staff) => {
    dispatch({ type: 'SELECT_STAFF_FOR_SERVICE', categoryId, staff, staffType: 'specific' });
  };

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

  // Helper to check if a staff has any overlapping booking
  const checkStaffOverlap = useCallback((staffId: string, dateStr: string, slotStartMins: number, durationMins: number): boolean => {
    const slotEndMins = slotStartMins + durationMins;
    
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
  }, [realBookings]);

  // ── 7-Day Time Table Logic (Spec V1: 2-segment availability) ──
  const getSlotsForDate = useCallback((dateStr: string) => {
    type SlotItem = { time: string; available: boolean; status: 'available' | 'held' | 'booked' | 'request_only' };
    const slots: SlotItem[] = [];
    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = (dateObj.getDay() + 6) % 7; // Convert to Mon=0 (0-6)
    
    if (dayOfWeek === 6) return [] as SlotItem[]; // Sunday is closed
    const endHour = dayOfWeek === 5 ? 16 : 18; // Saturday closes at 16:00

    // Spec V1: Each service segment has its own duration & staff
    const segments = state.selectedServices.map(item => ({
      duration: item.mainService.durationMinutes || 30,
      staffId: item.selectedStaffType === 'specific' ? item.selectedStaff?.id : undefined,
      staffType: item.selectedStaffType,
      serviceId: item.mainService.id,
    }));

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
      <h1 className={styles.pageTitle}>{t.booking.staff.title} & {t.booking.dateTime.title}</h1>

      {/* 📦 SECTION 1: Selected Services & Accordion Adder */}
      <section className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>1. {t.booking.services.summary.services}</h2>
        
        {state.selectedServices.length === 0 ? (
          <div className={styles.emptyServices}>
            <p>{t.booking.services.summary.selectService}</p>
          </div>
        ) : (
          <div className={styles.selectedServicesList}>
            {state.selectedServices.map((item) => (
              <div key={item.categoryId} className={styles.selectedServiceItem}>
                <div className={styles.selectedServiceHeader}>
                  <div className={styles.selectedServiceHeaderInfo}>
                    <span className={styles.categoryLabel}>{item.categoryName}</span>
                    <h4 className={styles.selectedServiceName}>
                      {getServiceName(item.mainService.id, item.mainService.name)}
                    </h4>
                  </div>
                  <div className={styles.selectedServiceActions}>
                    <span className={styles.selectedServicePrice}>€{item.mainService.price}</span>
                    <button
                      className={styles.removeServiceButton}
                      onClick={() => dispatch({ type: 'REMOVE_CATEGORY', categoryId: item.categoryId })}
                      aria-label="Remove category"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className={styles.selectedServiceMeta}>
                  <span className={styles.selectedServiceDuration}>
                    {t.booking.services.item.duration.replace('{duration}', String(item.mainService.durationMinutes))}
                  </span>
                </div>

                {/* Extras/Addons within this selected service */}
                {services.filter(s => s.categoryId === item.categoryId && s.isAddon).length > 0 && (
                  <div className={styles.extraOptions}>
                    <span className={styles.extrasTitle}>Extras:</span>
                    <div className={styles.extrasGrid}>
                      {services
                        .filter(s => s.categoryId === item.categoryId && s.isAddon)
                        .map(extra => {
                          const isSelected = item.extras.some(e => e.id === extra.id);
                          return (
                            <button
                              key={extra.id}
                              className={`${styles.extraOptionItem} ${isSelected ? styles.extraOptionItemSelected : ''}`}
                              onClick={() => handleToggleExtra(item.categoryId, extra)}
                            >
                              <span className={styles.extraCheck}>{isSelected ? '✓' : '+'}</span>
                              <span className={styles.extraName}>{getServiceName(extra.id, extra.name)}</span>
                              <span className={styles.extraPrice}>(+€{extra.price})</span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Planity style black pill button */}
        <div className={styles.serviceAdderWrapper}>
          <button
            className={styles.addServiceBtn}
            onClick={() => setShowAddService(!showAddService)}
          >
            {showAddService
              ? (locale === 'de' ? '✕ Dienstleistungen schließen' : locale === 'vi' ? '✕ Đóng danh mục dịch vụ' : '✕ Close services list')
              : (locale === 'de' ? '+ Service hinzufügen' : locale === 'vi' ? '+ Thêm dịch vụ khác' : '+ Add another service')}
          </button>

          {showAddService && (
            <div className={styles.collapsedServiceList}>
              <div className={styles.searchWrapper}>
                <span className={styles.searchIcon}>🔍</span>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder={t.booking.services.searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className={styles.categories}>
                {categoriesWithServices.map((category) => {
                  const isExpanded = expandedCategories.has(category.id);
                  const disableReason = getCategoryDisableReason(category);
                  const isDisabled = disableReason !== null;
                  const hasMain = state.selectedServices.some(s => s.categoryId === category.id);

                  const mainServices = category.services.filter((s) => !s.isAddon);
                  const extraServices = category.services.filter((s) => s.isAddon);

                  const selectedLabel = locale === 'de' ? '✓ Ausgewählt' : locale === 'vi' ? '✓ Đang chọn' : '✓ Selected';
                  const maxBadgeLabel = locale === 'de' ? `Max ${MAX_MAIN_SERVICES} Kategorien` : locale === 'vi' ? `Tối đa ${MAX_MAIN_SERVICES} nhóm` : `Max ${MAX_MAIN_SERVICES} categories`;
                  const conflictLabel = locale === 'de' 
                    ? `⚠ Konflikt mit ${getConflictGroupLabel(category)}` 
                    : locale === 'vi' 
                    ? `⚠ Trùng lặp với ${getConflictGroupLabel(category)}` 
                    : `⚠ Conflict with ${getConflictGroupLabel(category)}`;

                  return (
                    <div
                      key={category.id}
                      className={`${styles.categoryCard} ${isDisabled ? styles.categoryDisabled : ''} ${hasMain ? styles.categoryCardSelected : ''}`}
                    >
                      <div
                        className={styles.categoryHeader}
                        onClick={() => !isDisabled && toggleCategory(category.id)}
                      >
                        <div className={styles.categoryInfo}>
                          <span className={styles.categoryName}>
                            {getCategoryName(category.id, category.name)}
                          </span>
                          <span className={styles.categoryDescription}>
                            {getCategoryDescription(category.id, category.description)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {hasMain && (
                            <span className={styles.categoryBadge}>
                              {selectedLabel}
                            </span>
                          )}
                          {disableReason === 'conflict' && (
                            <span className={styles.categoryConflictBadge}>
                              {conflictLabel}
                            </span>
                          )}
                          {disableReason === 'max' && (
                            <span className={styles.categoryMaxBadge}>
                              {maxBadgeLabel}
                            </span>
                          )}
                          <span className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}>
                            ▾
                          </span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className={styles.serviceList}>
                          {/* Main services */}
                          {mainServices.map((service) => {
                            const selected = isMainSelected(category.id, service.id);

                            return (
                              <div key={service.id} className={styles.serviceItem}>
                                <div className={styles.serviceDetails}>
                                  <div className={styles.serviceName}>
                                    {getServiceName(service.id, service.name)}
                                  </div>
                                  <div className={styles.serviceDescription}>
                                    {getServiceDescription(service.id, service.description)}
                                  </div>
                                  <div className={styles.serviceMeta}>
                                    <span className={styles.serviceDuration}>
                                      {t.booking.services.item.duration.replace(
                                        '{duration}',
                                        String(service.durationMinutes)
                                      )}
                                    </span>
                                    <span className={styles.metaDot} />
                                    <span className={styles.servicePrice}>
                                      €{service.price}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  className={`${styles.selectButton} ${
                                    selected ? styles.selectedButton : ''
                                  }`}
                                  onClick={() => handleSelectMain(category, service)}
                                >
                                  {selected
                                    ? t.booking.services.item.selected
                                    : t.booking.services.item.add}
                                </button>
                              </div>
                            );
                          })}

                          {/* Extra services (addons) */}
                          {extraServices.map((service) => {
                            const selected = state.selectedServices
                              .find((s) => s.categoryId === category.id)
                              ?.extras.some((e) => e.id === service.id) ?? false;
                            const addonDisabled = !hasMain;

                            return (
                              <div
                                key={service.id}
                                className={`${styles.serviceItem} ${addonDisabled ? styles.addonDisabled : ''}`}
                              >
                                <div className={styles.serviceDetails}>
                                  <div className={styles.serviceName}>
                                    {getServiceName(service.id, service.name)}
                                  </div>
                                  <div className={styles.serviceDescription}>
                                    {getServiceDescription(service.id, service.description)}
                                  </div>
                                  <div className={styles.serviceMeta}>
                                    <span className={styles.serviceDuration}>
                                      +{t.booking.services.item.duration.replace(
                                        '{duration}',
                                        String(service.durationMinutes)
                                      )}
                                    </span>
                                    <span className={styles.metaDot} />
                                    <span className={styles.servicePrice}>
                                      €{service.price}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  className={`${styles.extraButton} ${
                                    selected ? styles.extraButtonSelected : ''
                                  }`}
                                  disabled={addonDisabled}
                                  onClick={() => handleToggleExtra(category.id, service)}
                                >
                                  {selected ? '✓ Extra' : t.booking.services.item.add}
                                </button>
                              </div>
                            );
                          })}

                          {/* Spec V1: Add-on note */}
                          {extraServices.length > 0 && (
                            <div className={styles.addonNote}>
                              <span className={styles.addonNoteIcon}>ℹ️</span>
                              <span>{t.booking.services.addonNote}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 👤 SECTION 2: Per-Service Staff Selection (Spec V1) */}
      {!skipStaffSelection && state.selectedServices.length > 0 && (
        <section className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>
            {locale === 'de' ? '2. Mitarbeiter auswählen' : locale === 'vi' ? '2. Chọn nhân viên' : '2. Choose your professional'}
          </h2>
          
          {state.selectedServices.map((item) => {
            const serviceStaffList = staffList.filter(
              (s) => s.status === 'active' && (s.serviceIds || []).includes(item.mainService.id)
            );
            const isItemAnySelected = item.selectedStaffType === 'any' && !item.selectedStaff;
            const isItemStaffSelected = (staffId: string) =>
              item.selectedStaffType === 'specific' && item.selectedStaff?.id === staffId;

            return (
              <div key={item.categoryId} className={styles.perServiceStaffBlock}>
                <div className={styles.perServiceStaffLabel}>
                  <span className={styles.perServiceStaffServiceName}>
                    {getServiceName(item.mainService.id, item.mainService.name)}
                  </span>
                  <span className={styles.perServiceStaffDuration}>
                    {item.mainService.durationMinutes} {locale === 'de' ? 'Min' : locale === 'vi' ? 'phút' : 'min'}
                  </span>
                </div>

                <div className={styles.staffGrid}>
                  {/* Any staff option */}
                  <div
                    className={`${styles.staffCard} ${isItemAnySelected ? styles.staffCardSelected : ''}`}
                    onClick={() => handleSelectAnyForService(item.categoryId)}
                  >
                    <div className={styles.staffCardLeft}>
                      <div className={styles.anyStaffIcon}>👥</div>
                      <div className={styles.staffCardInfo}>
                        <div className={styles.staffCardName}>{localLabels.noPreference}</div>
                      </div>
                    </div>
                    <div className={styles.radioWrapper}>
                      <div className={`${styles.radioCircle} ${isItemAnySelected ? styles.radioCircleChecked : ''}`}>
                        {isItemAnySelected && <div className={styles.radioInnerDot} />}
                      </div>
                    </div>
                  </div>

                  {/* Individual staff for this service */}
                  {serviceStaffList.map((staff) => {
                    const selected = isItemStaffSelected(staff.id);
                    return (
                      <div
                        key={staff.id}
                        className={`${styles.staffCard} ${selected ? styles.staffCardSelected : ''}`}
                        onClick={() => handleSelectStaffForService(item.categoryId, staff)}
                      >
                        <div className={styles.staffCardLeft}>
                          <div className={styles.staffAvatarCircle}>{staff.initials}</div>
                          <div className={styles.staffCardInfo}>
                            <div className={styles.staffCardName}>{staff.name}</div>
                            {staff.rating && (
                              <div className={styles.ratingInline}>
                                <span className={styles.ratingStar}>★</span>
                                {staff.rating}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className={styles.radioWrapper}>
                          <div className={`${styles.radioCircle} ${selected ? styles.radioCircleChecked : ''}`}>
                            {selected && <div className={styles.radioInnerDot} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* 📅 SECTION 3: Date & Time Calendar & Time Grid (Planity Style 2.png) */}
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
