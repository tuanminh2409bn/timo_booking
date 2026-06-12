'use client';

import { useState, useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import { useBooking } from '@/lib/bookingContext';
import { generateDemoTimeSlots } from '@/lib/seedData';
import styles from './page.module.css';

type TimeFilter = 'all' | 'morning' | 'afternoon' | 'evening';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DateTimePage() {
  const router = useRouter();
  const { state } = useBooking();
  const branchSlug = state.branchSlug;

  useEffect(() => {
    if (branchSlug) {
      router.replace(`/book/${branchSlug}/staff`);
    }
  }, [router, branchSlug]);

  return null;
}

function DateTimePageOld() {
  const { t } = useI18n();
  const { state, dispatch, totals } = useBooking();

  const today = new Date();
  const todayStr = formatDateISO(today.getFullYear(), today.getMonth(), today.getDate());

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

  const selectedDate = state.selectedDate;
  const selectedTime = state.selectedTime;

  // Total duration from all selected services (used for slot checking)
  const _totalDuration = totals.totalDuration;

  // Calendar data
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const monthName = new Date(viewYear, viewMonth).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // Generate next 14 days for mobile strip
  const next14Days = useMemo(() => {
    const days = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0) {
        // Skip Sunday
        days.push({
          date: formatDateISO(d.getFullYear(), d.getMonth(), d.getDate()),
          dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }),
          dateNum: d.getDate(),
        });
      }
    }
    return days;
  }, []);

  // Time slots
  const timeSlots = useMemo(() => {
    if (!selectedDate) return [];
    const staffId = state.selectedStaffType === 'specific' ? state.selectedStaff?.id : undefined;
    return generateDemoTimeSlots(selectedDate, staffId);
  }, [selectedDate, state.selectedStaff, state.selectedStaffType]);

  const filteredSlots = useMemo(() => {
    if (timeFilter === 'all') return timeSlots;
    return timeSlots.filter((slot) => {
      const hour = parseInt(slot.time.split(':')[0]);
      if (timeFilter === 'morning') return hour < 12;
      if (timeFilter === 'afternoon') return hour >= 12 && hour < 17;
      if (timeFilter === 'evening') return hour >= 17;
      return true;
    });
  }, [timeSlots, timeFilter]);

  const availableCount = filteredSlots.filter((s) => s.available).length;

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

  const handleSelectDate = (dateStr: string) => {
    dispatch({ type: 'SELECT_DATE', date: dateStr });
  };

  const handleSelectTime = (time: string, status: 'available' | 'request_only') => {
    dispatch({
      type: 'SELECT_TIME',
      time,
      bookingMode: status === 'request_only' ? 'request' : 'instant',
    });
  };

  const isDayPast = (year: number, month: number, day: number) => {
    const d = new Date(year, month, day);
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return d < t;
  };

  const isDaySunday = (year: number, month: number, day: number) => {
    return new Date(year, month, day).getDay() === 0;
  };

  const isPrevMonthDisabled = viewYear === today.getFullYear() && viewMonth <= today.getMonth();

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{t.booking.dateTime.title}</h1>

      <div className={styles.dateTimeLayout}>
        {/* Calendar - Desktop */}
        <div className={styles.calendarSection}>
          <div className={styles.calendarCard}>
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
              {WEEKDAY_LABELS.map((d) => (
                <div key={d} className={styles.weekDay}>
                  {d}
                </div>
              ))}
            </div>

            <div className={styles.daysGrid}>
              {/* Empty cells for first week offset */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className={`${styles.dayCell} ${styles.dayEmpty}`} />
              ))}

              {/* Day cells */}
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
                    onClick={() => !isDisabled && handleSelectDate(dateStr)}
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

        {/* Mobile date strip */}
        <div className={styles.mobileStrip}>
          <div className={styles.dateStrip}>
            {next14Days.map((d) => (
              <button
                key={d.date}
                className={`${styles.dateStripItem} ${
                  d.date === selectedDate ? styles.dateStripItemSelected : ''
                }`}
                onClick={() => handleSelectDate(d.date)}
              >
                <span className={styles.dateStripDay}>{d.dayLabel}</span>
                <span className={styles.dateStripDate}>{d.dateNum}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Time slots */}
        <div className={styles.slotsSection}>
          <div className={styles.slotsCard}>
            {!selectedDate ? (
              <div className={styles.noDateSelected}>
                <div className={styles.noDateIcon}>📅</div>
                <div className={styles.noDateText}>Select a date to view time slots</div>
              </div>
            ) : (
              <>
                <div className={styles.slotsHeader}>
                  <span className={styles.slotsTitle}>
                    {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                  <span className={styles.slotsCount}>
                    {t.booking.dateTime.slots.available.replace(
                      '{count}',
                      String(availableCount)
                    )}
                  </span>
                </div>

                {/* Filter tabs */}
                <div className={styles.filterTabs}>
                  {(['all', 'morning', 'afternoon', 'evening'] as const).map((filter) => (
                    <button
                      key={filter}
                      className={`${styles.filterTab} ${
                        timeFilter === filter ? styles.filterTabActive : ''
                      }`}
                      onClick={() => setTimeFilter(filter)}
                    >
                      {filter === 'all'
                        ? 'All'
                        : filter === 'morning'
                        ? t.booking.dateTime.slots.morning
                        : filter === 'afternoon'
                        ? t.booking.dateTime.slots.afternoon
                        : t.booking.dateTime.slots.evening}
                    </button>
                  ))}
                </div>

                {/* Slot type legend */}
                <div className={styles.legend}>
                  <span className={styles.legendItem}>
                    <span className={styles.legendDotAvailable} />
                    Available
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.legendDotRequest} />
                    Request
                  </span>
                  <span className={styles.legendItem}>
                    <span className={styles.legendDotBooked} />
                    Booked
                  </span>
                </div>

                {/* Slots grid */}
                {filteredSlots.length > 0 ? (
                  <div className={styles.slotsGrid}>
                    {filteredSlots.map((slot) => {
                      const isSelected = slot.time === selectedTime;
                      const isHeld = slot.status === 'held';
                      const isBooked = slot.status === 'booked';
                      const isRequestOnly = slot.status === 'request_only';
                      const isDisabled = !slot.available;

                      return (
                        <button
                          key={slot.time}
                          className={`${styles.slotButton} ${
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
                            handleSelectTime(
                              slot.time,
                              isRequestOnly ? 'request_only' : 'available'
                            )
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
                    })}
                  </div>
                ) : (
                  <div className={styles.noSlots}>{t.booking.dateTime.slots.noSlots}</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
