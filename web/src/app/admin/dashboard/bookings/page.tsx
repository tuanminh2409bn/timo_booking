'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { collection, onSnapshot, doc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import styles from './page.module.css';

interface FirestoreBooking {
  id: string;
  customerName: string;
  customerPhone: string;
  services: any[];
  staffId: string;
  staffName: string;
  appointmentDate: string;
  startTime: string;
  totalPrice: number;
  totalDurationMinutes: number;
  status: 'pending_approval' | 'confirmed' | 'cancelled';
  createdAt: string;
}

type ViewMode = 'list' | 'calendar';
type FilterStatus = 'all' | 'pending_approval' | 'confirmed' | 'cancelled';

// ===== Helpers =====

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDateShort(date: Date, locale: string): string {
  return date.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
  });
}

function formatDateGroupLabel(dateStr: string, locale: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);

  const dateOnly = new Date(d);
  dateOnly.setHours(0, 0, 0, 0);

  let prefix = '';
  if (dateOnly.getTime() === today.getTime()) {
    prefix = locale === 'de' ? 'Heute' : locale === 'vi' ? 'Hôm nay' : 'Today';
  } else if (dateOnly.getTime() === tomorrow.getTime()) {
    prefix = locale === 'de' ? 'Morgen' : locale === 'vi' ? 'Ngày mai' : 'Tomorrow';
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    prefix = locale === 'de' ? 'Gestern' : locale === 'vi' ? 'Hôm qua' : 'Yesterday';
  }

  const formatted = d.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return prefix ? `${prefix}, ${formatted}` : formatted;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(':').map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

function formatEndTime(startTime: string, durationMinutes: number): string {
  const { hours, minutes } = parseTime(startTime);
  const totalMinutes = hours * 60 + minutes + durationMinutes;
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

const CALENDAR_START_HOUR = 8;
const CALENDAR_END_HOUR = 20;
const HOUR_HEIGHT = 48; // px per hour row

const DAY_LABELS: Record<string, string[]> = {
  vi: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
};

// ===== SVG Icons =====

function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ===== Component =====

export default function BookingsManagementPage() {
  const { user } = useAuth();
  const { t, locale } = useI18n();
  const [bookings, setBookings] = useState<FirestoreBooking[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [weekStart, setWeekStart] = useState(() => getStartOfWeek(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return now.toISOString().split('T')[0];
  });
  const [popover, setPopover] = useState<{ booking: FirestoreBooking; x: number; y: number } | null>(null);

  // Detect desktop on mount for default view
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 769) {
      setViewMode('calendar');
    }
  }, []);

  // ===== Firestore real-time sync (UNCHANGED) =====
  useEffect(() => {
    if (!user) return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    const bookingsRef = collection(db, 'branches', branchId, 'bookings');

    // Staff can only read their own bookings (Firestore rules enforce this)
    const bookingsQuery = user.role === 'staff' && user.staffId
      ? query(bookingsRef, where('staffId', '==', user.staffId))
      : bookingsRef;

    const unsubscribe = onSnapshot(bookingsQuery, (snap) => {
      const list: FirestoreBooking[] = [];
      snap.forEach(doc => {
        list.push(doc.data() as FirestoreBooking);
      });
      // Sort bookings by creation date descending
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setBookings(list);
      setLoading(false);
    }, (e) => {
      console.error('Error listening to bookings:', e);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // ===== Handlers (UNCHANGED) =====
  const handleApprove = async (id: string) => {
    if (!user) return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    try {
      const bookingDocRef = doc(db, 'branches', branchId, 'bookings', id);
      await updateDoc(bookingDocRef, { status: 'confirmed' });
    } catch (e) {
      console.error('Error approving booking:', e);
    }
  };

  const handleReject = async (id: string) => {
    if (!user) return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    try {
      const bookingDocRef = doc(db, 'branches', branchId, 'bookings', id);
      await updateDoc(bookingDocRef, { status: 'cancelled' });
    } catch (e) {
      console.error('Error rejecting/cancelling booking:', e);
    }
  };

  // ===== Derived data =====
  const bookingsForRole = useMemo(() => bookings.filter(b => {
    if (user?.role === 'staff') {
      return b.staffId === user.staffId;
    }
    return true;
  }), [bookings, user]);

  const filteredBookings = useMemo(() => {
    let list = bookingsForRole.filter(b => filter === 'all' || b.status === filter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b =>
        b.customerName.toLowerCase().includes(q) ||
        b.customerPhone.includes(q) ||
        b.staffName.toLowerCase().includes(q) ||
        b.services.some(s => {
          const name = typeof s === 'object' && s !== null ? (s.serviceName || s.name || '') : String(s);
          return name.toLowerCase().includes(q);
        })
      );
    }
    return list;
  }, [bookingsForRole, filter, searchQuery]);

  // Group by date for list view
  const groupedByDate = useMemo(() => {
    const groups: Record<string, FirestoreBooking[]> = {};
    const sorted = [...filteredBookings].sort((a, b) => {
      // Sort by appointmentDate ASC, then startTime ASC
      if (a.appointmentDate !== b.appointmentDate) {
        return a.appointmentDate.localeCompare(b.appointmentDate);
      }
      return a.startTime.localeCompare(b.startTime);
    });
    sorted.forEach(b => {
      const key = b.appointmentDate || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    });
    // Sort date keys, most recent first
    const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map(key => ({ date: key, bookings: groups[key] }));
  }, [filteredBookings]);

  // Staff list for manager/owner calendar filter
  const staffList = useMemo(() => {
    const map = new Map<string, string>();
    bookingsForRole.forEach(b => {
      if (b.staffId && b.staffName) {
        map.set(b.staffId, b.staffName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [bookingsForRole]);

  const [staffFilterId, setStaffFilterId] = useState<string>('all');

  const isManagerOrOwner = user?.role !== 'staff';

  // Get service name helper
  const getServiceName = useCallback((booking: FirestoreBooking): string => {
    if (booking.services.length === 0) return '';
    const first = booking.services[0];
    const name = typeof first === 'object' && first !== null
      ? (first.serviceName || first.name || '')
      : String(first);
    if (booking.services.length > 1) {
      return `${name} +${booking.services.length - 1}`;
    }
    return name;
  }, []);

  const getStatusBadge = useCallback((status: string) => {
    switch (status) {
      case 'pending_approval':
        return <span className={`${styles.badge} ${styles.badgePending}`}>{t.admin.bookings.statusPending}</span>;
      case 'confirmed':
        return <span className={`${styles.badge} ${styles.badgeConfirmed}`}>{t.admin.bookings.statusConfirmed}</span>;
      case 'cancelled':
        return <span className={`${styles.badge} ${styles.badgeCancelled}`}>{t.admin.bookings.statusCancelled}</span>;
      default:
        return null;
    }
  }, [t]);

  // ===== Calendar helpers =====
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const hours = useMemo(() => {
    return Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR }, (_, i) => CALENDAR_START_HOUR + i);
  }, []);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Bookings indexed by date for calendar
  const bookingsByDate = useMemo(() => {
    const map: Record<string, FirestoreBooking[]> = {};
    let list = bookingsForRole;
    if (staffFilterId !== 'all') {
      list = list.filter(b => b.staffId === staffFilterId);
    }
    list.forEach(b => {
      const key = b.appointmentDate;
      if (!map[key]) map[key] = [];
      map[key].push(b);
    });
    return map;
  }, [bookingsForRole, staffFilterId]);

  // For manager/owner single-day staff view
  const staffColumnsForDate = useMemo(() => {
    if (!isManagerOrOwner) return [];
    const dayBookings = bookingsByDate[selectedDate] || [];
    const map = new Map<string, { name: string; bookings: FirestoreBooking[] }>();
    dayBookings.forEach(b => {
      if (!map.has(b.staffId)) {
        map.set(b.staffId, { name: b.staffName, bookings: [] });
      }
      map.get(b.staffId)!.bookings.push(b);
    });
    // Also add staff with no bookings from staffList
    staffList.forEach(s => {
      if (!map.has(s.id)) {
        map.set(s.id, { name: s.name, bookings: [] });
      }
    });
    return Array.from(map.entries()).map(([id, data]) => ({ id, ...data }));
  }, [isManagerOrOwner, bookingsByDate, selectedDate, staffList]);

  // Close popover on outside click
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!popover) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [popover]);

  // ===== Calendar week navigation =====
  const goToPrevWeek = () => setWeekStart(prev => addDays(prev, -7));
  const goToNextWeek = () => setWeekStart(prev => addDays(prev, 7));
  const goToToday = () => {
    setWeekStart(getStartOfWeek(new Date()));
    setSelectedDate(new Date().toISOString().split('T')[0]);
  };

  // Week range label
  const weekRangeLabel = useMemo(() => {
    const end = addDays(weekStart, 6);
    return `${formatDateShort(weekStart, locale)} – ${formatDateShort(end, locale)}`;
  }, [weekStart, locale]);

  // ===== Render booking block on calendar =====
  const renderCalBookingBlock = (booking: FirestoreBooking) => {
    const { hours: startH, minutes: startM } = parseTime(booking.startTime);
    const topOffset = (startH - CALENDAR_START_HOUR) * HOUR_HEIGHT + (startM / 60) * HOUR_HEIGHT;
    const height = Math.max((booking.totalDurationMinutes / 60) * HOUR_HEIGHT, 20);
    const endTime = formatEndTime(booking.startTime, booking.totalDurationMinutes);

    let blockClass = styles.calBookingBlock;
    if (booking.status === 'pending_approval') blockClass += ` ${styles.calBlockPending}`;
    if (booking.status === 'cancelled') blockClass += ` ${styles.calBlockCancelled}`;

    return (
      <div
        key={booking.id}
        className={blockClass}
        style={{ top: `${topOffset}px`, height: `${height}px` }}
        onClick={(e) => {
          e.stopPropagation();
          setPopover({ booking, x: e.clientX, y: e.clientY });
        }}
      >
        <div className={styles.calBlockService}>{getServiceName(booking)}</div>
        <div className={styles.calBlockTime}>{booking.startTime}–{endTime}</div>
        {height > 36 && (
          <div className={styles.calBlockCustomer}>{booking.customerName}</div>
        )}
      </div>
    );
  };

  // ===== Render =====

  // Render calendar: Weekly view for staff, daily staff-columns view for manager/owner
  const renderWeeklyCalendar = () => {
    const dayLabels = DAY_LABELS[locale] || DAY_LABELS['en'];
    const numCols = 7;
    const gridTemplate = `60px repeat(${numCols}, 1fr)`;

    return (
      <div className={styles.calendarView}>
        {/* Navigation */}
        <div className={styles.calendarNav}>
          <div className={styles.calNavLeft}>
            <button className={styles.calNavBtn} onClick={goToPrevWeek}><ChevronLeft /></button>
            <span className={styles.calNavLabel}>{weekRangeLabel}</span>
            <button className={styles.calNavBtn} onClick={goToNextWeek}><ChevronRight /></button>
          </div>
          <button className={styles.todayBtn} onClick={goToToday}>
            {locale === 'de' ? 'Heute' : locale === 'vi' ? 'Hôm nay' : 'Today'}
          </button>
        </div>

        {/* Staff filter for managers */}
        {isManagerOrOwner && staffList.length > 0 && (
          <div className={styles.staffFilter}>
            <span className={styles.staffFilterLabel}>
              {locale === 'de' ? 'Mitarbeiter:' : locale === 'vi' ? 'Nhân viên:' : 'Staff:'}
            </span>
            <select
              className={styles.staffSelect}
              value={staffFilterId}
              onChange={(e) => setStaffFilterId(e.target.value)}
            >
              <option value="all">
                {locale === 'de' ? 'Alle' : locale === 'vi' ? 'Tất cả' : 'All'}
              </option>
              {staffList.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Calendar grid */}
        <div className={styles.calendarGrid}>
          <div className={styles.calendarScrollWrapper}>
            <div className={styles.calendarTable} style={{ gridTemplateColumns: gridTemplate }}>
              {/* Header */}
              <div className={styles.calHeaderRow} style={{ display: 'grid', gridTemplateColumns: gridTemplate }}>
                <div className={styles.calHeaderCorner} />
                {weekDays.map((day, i) => {
                  const isToday = isSameDay(day, today);
                  return (
                    <div key={i} className={`${styles.calHeaderCell} ${isToday ? styles.calHeaderToday : ''}`}>
                      <div className={styles.calHeaderDay}>{dayLabels[i]}</div>
                      <div className={styles.calHeaderDate}>{day.getDate()}</div>
                    </div>
                  );
                })}
              </div>

              {/* Body */}
              <div className={styles.calBody}>
                {hours.map((hour) => {
                  const label = `${String(hour).padStart(2, '0')}:00`;
                  return (
                    <div key={hour} className={styles.calTimeRow} style={{ display: 'grid', gridTemplateColumns: gridTemplate }}>
                      <div className={styles.calTimeLabel}>{label}</div>
                      {weekDays.map((day, colIdx) => {
                        const dateStr = day.toISOString().split('T')[0];
                        const isToday = isSameDay(day, today);
                        // Only render blocks in the first hour row (position is absolute)
                        const dayBookings = hour === CALENDAR_START_HOUR ? (bookingsByDate[dateStr] || []) : [];
                        return (
                          <div
                            key={colIdx}
                            className={`${styles.calTimeCell} ${isToday ? styles.calTimeCellToday : ''}`}
                          >
                            {dayBookings.map(b => renderCalBookingBlock(b))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderStaffDayCalendar = () => {
    const cols = staffColumnsForDate;
    const numCols = Math.max(cols.length, 1);
    const gridTemplate = `60px repeat(${numCols}, 1fr)`;

    return (
      <div className={styles.calendarView}>
        {/* Navigation */}
        <div className={styles.calendarNav}>
          <div className={styles.calNavLeft}>
            <button className={styles.calNavBtn} onClick={() => {
              const d = new Date(selectedDate + 'T00:00:00');
              d.setDate(d.getDate() - 1);
              setSelectedDate(d.toISOString().split('T')[0]);
            }}><ChevronLeft /></button>
            <input
              type="date"
              className={styles.datePickerInput}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <button className={styles.calNavBtn} onClick={() => {
              const d = new Date(selectedDate + 'T00:00:00');
              d.setDate(d.getDate() + 1);
              setSelectedDate(d.toISOString().split('T')[0]);
            }}><ChevronRight /></button>
          </div>
          <button className={styles.todayBtn} onClick={goToToday}>
            {locale === 'de' ? 'Heute' : locale === 'vi' ? 'Hôm nay' : 'Today'}
          </button>
        </div>

        {/* Calendar grid */}
        <div className={styles.calendarGrid}>
          <div className={styles.calendarScrollWrapper}>
            <div className={styles.calendarTable} style={{ gridTemplateColumns: gridTemplate }}>
              {/* Header */}
              <div className={styles.calHeaderRow} style={{ display: 'grid', gridTemplateColumns: gridTemplate }}>
                <div className={styles.calHeaderCorner} />
                {cols.length === 0 ? (
                  <div className={styles.calHeaderCell}>
                    <div className={styles.calHeaderDay}>—</div>
                  </div>
                ) : (
                  cols.map((col) => (
                    <div key={col.id} className={styles.calHeaderCell}>
                      <div className={styles.calHeaderDay}>{col.name}</div>
                    </div>
                  ))
                )}
              </div>

              {/* Body */}
              <div className={styles.calBody}>
                {hours.map((hour) => {
                  const label = `${String(hour).padStart(2, '0')}:00`;
                  return (
                    <div key={hour} className={styles.calTimeRow} style={{ display: 'grid', gridTemplateColumns: gridTemplate }}>
                      <div className={styles.calTimeLabel}>{label}</div>
                      {cols.length === 0 ? (
                        <div className={styles.calTimeCell} />
                      ) : (
                        cols.map((col) => {
                          const colBookings = hour === CALENDAR_START_HOUR ? col.bookings : [];
                          return (
                            <div key={col.id} className={styles.calTimeCell}>
                              {colBookings.map(b => renderCalBookingBlock(b))}
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <h1 className={styles.title}>
            {locale === 'vi' ? 'Lịch hẹn' : locale === 'de' ? 'Termine' : 'Bookings'}
          </h1>
        </div>
        <div className={styles.topBarRight}>
          <button
            className={styles.iconBtn}
            onClick={() => setSearchOpen(!searchOpen)}
            title={t.common.search}
          >
            <SearchIcon />
          </button>
          <button
            className={`${styles.iconBtn} ${viewMode === 'list' ? styles.iconBtnActive : ''}`}
            onClick={() => setViewMode('list')}
            title="List"
          >
            <ListIcon />
          </button>
          <button
            className={`${styles.iconBtn} ${viewMode === 'calendar' ? styles.iconBtnActive : ''}`}
            onClick={() => setViewMode('calendar')}
            title="Calendar"
          >
            <CalendarIcon />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      {searchOpen && (
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}><SearchIcon /></span>
          <input
            className={styles.searchInput}
            placeholder={t.common.search + '...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* View Switch */}
      {viewMode === 'list' ? (
        <>
          {/* Filter Tabs */}
          <div className={styles.filterTabs}>
            <button
              className={`${styles.filterTab} ${filter === 'all' ? styles.filterTabActive : ''}`}
              onClick={() => setFilter('all')}
            >
              {t.admin.bookings.tabAll} ({bookingsForRole.length})
            </button>
            <button
              className={`${styles.filterTab} ${filter === 'confirmed' ? styles.filterTabActive : ''}`}
              onClick={() => setFilter('confirmed')}
            >
              {t.admin.bookings.tabConfirmed} ({bookingsForRole.filter(b => b.status === 'confirmed').length})
            </button>
            <button
              className={`${styles.filterTab} ${filter === 'pending_approval' ? styles.filterTabActive : ''}`}
              onClick={() => setFilter('pending_approval')}
            >
              {t.admin.bookings.tabPending} ({bookingsForRole.filter(b => b.status === 'pending_approval').length})
            </button>
            <button
              className={`${styles.filterTab} ${filter === 'cancelled' ? styles.filterTabActive : ''}`}
              onClick={() => setFilter('cancelled')}
            >
              {t.admin.bookings.tabCancelled} ({bookingsForRole.filter(b => b.status === 'cancelled').length})
            </button>
          </div>

          {/* List View */}
          <div className={styles.listView}>
            {loading ? (
              <div className={styles.noBookings}>
                <p>{t.admin.bookings.loading}</p>
              </div>
            ) : filteredBookings.length === 0 ? (
              <div className={styles.noBookings}>
                <span className={styles.emptyIcon}>📭</span>
                <p>{t.admin.bookings.empty}</p>
              </div>
            ) : (
              groupedByDate.map(group => (
                <div key={group.date} className={styles.dateGroup}>
                  <p className={styles.dateLabel}>{formatDateGroupLabel(group.date, locale)}</p>
                  {group.bookings.map(booking => (
                    <div key={booking.id} className={styles.bookingCard}>
                      {/* Left: Time */}
                      <div className={styles.cardTime}>
                        <span className={styles.timeValue}>{booking.startTime}</span>
                        <span className={styles.durationValue}>{booking.totalDurationMinutes} {t.common.minutes}</span>
                      </div>

                      {/* Center: Info */}
                      <div className={styles.cardContent}>
                        <h3 className={styles.serviceName}>{getServiceName(booking)}</h3>
                        <span className={styles.customerName}>{booking.customerName}</span>
                        {user?.role !== 'staff' ? (
                          <span className={styles.customerPhone}>{booking.customerPhone}</span>
                        ) : (
                          <span className={styles.customerPhone}>{t.admin.bookings.contactManager}</span>
                        )}
                        {isManagerOrOwner && (
                          <span className={styles.staffLabel}>{booking.staffName}</span>
                        )}
                      </div>

                      {/* Right: Status + Price + Actions */}
                      <div className={styles.cardRight}>
                        {getStatusBadge(booking.status)}
                        <span className={styles.priceText}>€{booking.totalPrice}</span>
                        {/* Actions for Manager/Owner */}
                        {user?.role !== 'staff' && (
                          <>
                            {booking.status === 'pending_approval' && (
                              <div className={styles.cardActions}>
                                <button
                                  className={styles.rejectBtn}
                                  onClick={() => handleReject(booking.id)}
                                >
                                  {t.admin.bookings.btnReject}
                                </button>
                                <button
                                  className={styles.approveBtn}
                                  onClick={() => handleApprove(booking.id)}
                                >
                                  {t.admin.bookings.btnApprove}
                                </button>
                              </div>
                            )}
                            {booking.status === 'confirmed' && (
                              <div className={styles.cardActions}>
                                <button
                                  className={styles.cancelBtn}
                                  onClick={() => handleReject(booking.id)}
                                >
                                  {t.admin.bookings.btnCancel}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          {/* Calendar View */}
          {isManagerOrOwner
            ? renderStaffDayCalendar()
            : renderWeeklyCalendar()
          }
        </>
      )}

      {/* Popover for calendar booking detail */}
      {popover && (
        <div
          ref={popoverRef}
          className={styles.calPopover}
          style={{
            top: Math.min(popover.y, (typeof window !== 'undefined' ? window.innerHeight - 320 : 400)),
            left: Math.min(popover.x, (typeof window !== 'undefined' ? window.innerWidth - 340 : 400)),
          }}
        >
          <div className={styles.calPopoverHeader}>
            <h4 className={styles.calPopoverTitle}>{getServiceName(popover.booking)}</h4>
            <button className={styles.calPopoverClose} onClick={() => setPopover(null)}>✕</button>
          </div>
          <div className={styles.calPopoverRow}>
            <span className={styles.calPopoverLabel}>{t.admin.bookings.detailTime}</span>
            <span className={styles.calPopoverValue}>
              {popover.booking.startTime} – {formatEndTime(popover.booking.startTime, popover.booking.totalDurationMinutes)}
            </span>
          </div>
          <div className={styles.calPopoverRow}>
            <span className={styles.calPopoverLabel}>{t.admin.bookings.detailDate}</span>
            <span className={styles.calPopoverValue}>{popover.booking.appointmentDate}</span>
          </div>
          <div className={styles.calPopoverRow}>
            <span className={styles.calPopoverLabel}>{t.admin.bookings.detailStaff}</span>
            <span className={styles.calPopoverValue}>{popover.booking.staffName}</span>
          </div>
          {user?.role !== 'staff' && (
            <div className={styles.calPopoverRow}>
              <span className={styles.calPopoverLabel}>
                {locale === 'vi' ? 'Khách hàng' : locale === 'de' ? 'Kunde' : 'Customer'}
              </span>
              <span className={styles.calPopoverValue}>
                {popover.booking.customerName} · {popover.booking.customerPhone}
              </span>
            </div>
          )}
          <div className={styles.calPopoverRow}>
            <span className={styles.calPopoverLabel}>{t.admin.bookings.detailTotal}</span>
            <span className={styles.calPopoverValue}>€{popover.booking.totalPrice}</span>
          </div>
          <div className={styles.calPopoverRow}>
            <span className={styles.calPopoverLabel}>Status</span>
            {getStatusBadge(popover.booking.status)}
          </div>

          {/* Actions in popover */}
          {user?.role !== 'staff' && (
            <>
              {popover.booking.status === 'pending_approval' && (
                <div className={styles.calPopoverActions}>
                  <button className={styles.rejectBtn} onClick={() => { handleReject(popover.booking.id); setPopover(null); }}>
                    {t.admin.bookings.btnReject}
                  </button>
                  <button className={styles.approveBtn} onClick={() => { handleApprove(popover.booking.id); setPopover(null); }}>
                    {t.admin.bookings.btnApprove}
                  </button>
                </div>
              )}
              {popover.booking.status === 'confirmed' && (
                <div className={styles.calPopoverActions}>
                  <button className={styles.cancelBtn} onClick={() => { handleReject(popover.booking.id); setPopover(null); }}>
                    {t.admin.bookings.btnCancel}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
