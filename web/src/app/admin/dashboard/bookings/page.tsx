'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { collection, onSnapshot, doc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { getGermanDateObject, getGermanTodayString } from '@/lib/timeUtils';
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
  status: 'pending_approval' | 'confirmed' | 'cancelled' | 'needs_owner_action' | 'completed';
  createdAt: string;
}

type ViewMode = 'list' | 'calendar';
type FilterStatus = 'all' | 'pending_approval' | 'confirmed' | 'needs_owner_action' | 'completed' | 'cancelled';

// ===== Helpers =====

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDateGroupLabel(dateStr: string, locale: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d); // local time
  const today = getGermanDateObject();
  today.setHours(0, 0, 0, 0);
  const tomorrow = addDays(today, 1);

  let prefix = '';
  if (dateObj.getTime() === today.getTime()) {
    prefix = locale === 'de' ? 'Heute' : locale === 'vi' ? 'Hôm nay' : 'Today';
  } else if (dateObj.getTime() === tomorrow.getTime()) {
    prefix = locale === 'de' ? 'Morgen' : locale === 'vi' ? 'Ngày mai' : 'Tomorrow';
  }

  const formatted = dateObj.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  return prefix ? `${prefix}, ${formatted}` : formatted;
}

function formatDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
const HOUR_HEIGHT = 64;

const DAY_LABELS: Record<string, string[]> = {
  vi: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
};

// ===== SVG Icons =====
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
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
  const [weekStart, setWeekStart] = useState(() => getStartOfWeek(getGermanDateObject()));
  const [selectedDate, setSelectedDate] = useState(() => getGermanTodayString());
  const [popover, setPopover] = useState<{ 
    booking: FirestoreBooking; 
    x: number; 
    y: number; 
    blockHeight: number;
  } | null>(null);
  const [popoverHeight, setPopoverHeight] = useState(320);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 769) {
      setViewMode('calendar');
    }
  }, []);

  // Firestore real-time sync
  useEffect(() => {
    if (!user) return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    const bookingsRef = collection(db, 'branches', branchId, 'bookings');
    const bookingsQuery = user.role === 'staff' && user.staffId
      ? query(bookingsRef, where('staffId', '==', user.staffId))
      : bookingsRef;

    const unsubscribe = onSnapshot(bookingsQuery, (snap) => {
      const list: FirestoreBooking[] = [];
      snap.forEach(doc => list.push(doc.data() as FirestoreBooking));
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setBookings(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsubscribe();
  }, [user]);

  // Handlers
  const handleApprove = async (id: string) => {
    if (!user) return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    try { await updateDoc(doc(db, 'branches', branchId, 'bookings', id), { status: 'confirmed' }); } catch (e) { console.error(e); }
  };

  const handleReject = async (id: string) => {
    if (!user) return;
    const branchId = user.assignedBranches?.[0] || 'glamour-nails-berlin';
    try { await updateDoc(doc(db, 'branches', branchId, 'bookings', id), { status: 'cancelled' }); } catch (e) { console.error(e); }
  };

  // Derived data
  const bookingsForRole = useMemo(() => bookings.filter(b => {
    if (user?.role === 'staff') return b.staffId === user.staffId;
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

  const groupedByDate = useMemo(() => {
    const groups: Record<string, FirestoreBooking[]> = {};
    const sorted = [...filteredBookings].sort((a, b) => {
      if (a.appointmentDate !== b.appointmentDate) return a.appointmentDate.localeCompare(b.appointmentDate);
      return a.startTime.localeCompare(b.startTime);
    });
    sorted.forEach(b => {
      const key = b.appointmentDate || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map(key => ({ date: key, bookings: groups[key] }));
  }, [filteredBookings]);

  const staffList = useMemo(() => {
    const map = new Map<string, string>();
    bookingsForRole.forEach(b => { if (b.staffId && b.staffName) map.set(b.staffId, b.staffName); });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [bookingsForRole]);

  const [staffFilterId, setStaffFilterId] = useState<string>('all');
  const isManagerOrOwner = user?.role !== 'staff';

  const getServiceName = useCallback((booking: FirestoreBooking): string => {
    if (booking.services.length === 0) return '';
    const first = booking.services[0];
    const name = typeof first === 'object' && first !== null ? (first.serviceName || first.name || '') : String(first);
    if (booking.services.length > 1) return `${name} +${booking.services.length - 1}`;
    return name;
  }, []);

  const getStatusBadge = useCallback((status: string) => {
    switch (status) {
      case 'pending_approval': return <span className={`${styles.badge} ${styles.badgePending}`}>{t.admin.bookings.statusPending}</span>;
      case 'confirmed': return <span className={`${styles.badge} ${styles.badgeConfirmed}`}>{t.admin.bookings.statusConfirmed}</span>;
      case 'cancelled': return <span className={`${styles.badge} ${styles.badgeCancelled}`}>{t.admin.bookings.statusCancelled}</span>;
      case 'needs_owner_action': return <span className={`${styles.badge} ${styles.badgeNeedsAction}`}>{t.admin.bookings.statusNeedsAction || 'Cần xử lý'}</span>;
      case 'completed': return <span className={`${styles.badge} ${styles.badgeCompleted}`}>{t.admin.bookings.statusCompleted || 'Đã hoàn thành'}</span>;
      default: return null;
    }
  }, [t]);

  // Calendar
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const hours = useMemo(() => Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR }, (_, i) => CALENDAR_START_HOUR + i), []);
  // ===== DATA FETCHING & PROCESSING =====

  const today = useMemo(() => { const d = getGermanDateObject(); d.setHours(0, 0, 0, 0); return d; }, []);

  const bookingsByDate = useMemo(() => {
    const map: Record<string, FirestoreBooking[]> = {};
    let list = bookingsForRole;
    if (staffFilterId !== 'all') list = list.filter(b => b.staffId === staffFilterId);
    list.forEach(b => { const key = b.appointmentDate; if (!map[key]) map[key] = []; map[key].push(b); });
    return map;
  }, [bookingsForRole, staffFilterId]);

  const staffColumnsForDate = useMemo(() => {
    if (!isManagerOrOwner) return [];
    const dayBookings = bookingsByDate[selectedDate] || [];
    const map = new Map<string, { name: string; bookings: FirestoreBooking[] }>();
    dayBookings.forEach(b => {
      if (!map.has(b.staffId)) map.set(b.staffId, { name: b.staffName, bookings: [] });
      map.get(b.staffId)!.bookings.push(b);
    });
    staffList.forEach(s => { if (!map.has(s.id)) map.set(s.id, { name: s.name, bookings: [] }); });
    return Array.from(map.entries()).map(([id, data]) => ({ id, ...data }));
  }, [isManagerOrOwner, bookingsByDate, selectedDate, staffList]);

  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!popover) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setPopover(null);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [popover]);

  useEffect(() => {
    if (popover && popoverRef.current) {
      setPopoverHeight(popoverRef.current.offsetHeight);
    }
  }, [popover]);

  // Cập nhật vị trí popover theo thời gian thực khi cuộn trang hoặc cuộn lịch
  useEffect(() => {
    if (!popover) return;

    const updatePosition = () => {
      const blockEl = document.getElementById(`cal-block-${popover.booking.id}`);
      const containerEl = document.getElementById('bookings-container');
      const popoverEl = popoverRef.current;
      if (!blockEl || !containerEl || !popoverEl) return;

      const rect = blockEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();

      // Kiểm tra xem blockEl có bị cuộn khuất hoàn toàn khỏi phần calBody không
      const calBodyEl = blockEl.closest(`.${styles.calBody}`);
      if (calBodyEl) {
        const bodyRect = calBodyEl.getBoundingClientRect();
        if (rect.bottom < bodyRect.top || rect.top > bodyRect.bottom) {
          // Tự động đóng popover khi bị cuộn khuất để tránh hiển thị lơ lửng ngoài lịch
          setPopover(null);
          return;
        }
      }

      const x = rect.left - containerRect.left;
      const y = rect.top - containerRect.top;
      const blockHeight = rect.height;
      const currentPopoverHeight = popoverEl.offsetHeight || popoverHeight;

      // Tính toán vị trí top và left
      const topVal = (y - currentPopoverHeight - 10 >= 10)
        ? (y - currentPopoverHeight - 10)
        : (y + blockHeight + 10);
        
      const containerWidth = containerEl.offsetWidth || 1000;
      const leftVal = Math.max(10, Math.min(x + rect.width / 2 - 150, containerWidth - 350));

      // Cập nhật trực tiếp vào style của DOM element để tối ưu hiệu năng không cần re-render React khi scroll
      popoverEl.style.top = `${topVal}px`;
      popoverEl.style.left = `${leftVal}px`;
    };

    // Chạy updatePosition ngay sau khi component mount/cập nhật bằng requestAnimationFrame
    const animId = requestAnimationFrame(updatePosition);

    // Lắng nghe sự kiện scroll với capture = true để bắt được sự kiện cuộn từ .calBody
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [popover, popoverHeight]);

  const goToPrevWeek = () => setWeekStart(prev => addDays(prev, -7));
  const goToNextWeek = () => setWeekStart(prev => addDays(prev, 7));
  const goToToday = () => { setWeekStart(getStartOfWeek(getGermanDateObject())); setSelectedDate(getGermanTodayString()); };

  const weekRangeLabel = useMemo(() => {
    const end = addDays(weekStart, 6);
    const fmt = (d: Date) => d.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${fmt(weekStart)} – ${fmt(end)}`;
  }, [weekStart, locale]);

  // ===== RENDER BOOKING BLOCK =====
  const renderCalBookingBlock = (booking: FirestoreBooking) => {
    const { hours: startH, minutes: startM } = parseTime(booking.startTime);
    const topOffset = (startH - CALENDAR_START_HOUR) * HOUR_HEIGHT + (startM / 60) * HOUR_HEIGHT;
    const height = Math.max((booking.totalDurationMinutes / 60) * HOUR_HEIGHT, 28);
    const endTime = formatEndTime(booking.startTime, booking.totalDurationMinutes);

    let blockClass = styles.calBlock;
    if (booking.status === 'pending_approval') blockClass += ` ${styles.calBlockPending}`;
    if (booking.status === 'cancelled') blockClass += ` ${styles.calBlockCancelled}`;
    if (booking.status === 'needs_owner_action') blockClass += ` ${styles.calBlockNeedsAction}`;
    if (booking.status === 'completed') blockClass += ` ${styles.calBlockCompleted}`;

    return (
      <div
        key={booking.id}
        className={blockClass}
        style={{ top: `${topOffset}px`, height: `${height}px` }}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const containerEl = document.getElementById('bookings-container');
          const containerRect = containerEl?.getBoundingClientRect();
          
          const x = rect.left - (containerRect?.left || 0);
          const y = rect.top - (containerRect?.top || 0);
          
          setPopover({
            booking,
            x: x + rect.width / 2,
            y: y,
            blockHeight: rect.height
          });
        }}
      >
        <div className={styles.calBlockService}>{getServiceName(booking)}</div>
        <div className={styles.calBlockTime}>{booking.startTime}–{endTime}</div>
        {height > 48 && user?.role !== 'staff' && <div className={styles.calBlockCustomer}>{booking.customerName}</div>}
      </div>
    );
  };

  // ===== WEEKLY CALENDAR (Staff view) =====
  const renderWeeklyCalendar = () => {
    const dayLabels = DAY_LABELS[locale] || DAY_LABELS['en'];
    const totalHours = CALENDAR_END_HOUR - CALENDAR_START_HOUR;
    const bodyHeight = totalHours * HOUR_HEIGHT;

    return (
      <div className={styles.calendarView}>
        <div className={styles.calendarNav}>
          <div className={styles.calNavLeft}>
            <button className={styles.calNavBtn} onClick={goToPrevWeek}>‹</button>
            <input 
              type="date" 
              className={styles.datePickerInput} 
              value={formatDateLocal(weekStart)} 
              onChange={(e) => {
                if (e.target.value) {
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  setWeekStart(getStartOfWeek(new Date(y, m - 1, d)));
                }
              }} 
            />
            <button className={styles.calNavBtn} onClick={goToNextWeek}>›</button>
          </div>
          <button className={styles.todayBtn} onClick={goToToday}>
            {locale === 'de' ? 'Heute' : locale === 'vi' ? 'Hôm nay' : 'Today'}
          </button>
        </div>

        {isManagerOrOwner && staffList.length > 0 && (
          <div className={styles.staffFilter}>
            <select className={styles.staffSelect} value={staffFilterId} onChange={(e) => setStaffFilterId(e.target.value)}>
              <option value="all">{locale === 'vi' ? 'Tất cả nhân viên' : 'All staff'}</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <div className={styles.calGrid}>
          {/* Header row */}
          <div className={styles.calRow + ' ' + styles.calHeaderRow}>
            <div className={styles.calTimeCol}></div>
            {weekDays.map((day, i) => {
              const isToday = isSameDay(day, today);
              return (
                <div key={i} className={`${styles.calDayCol} ${styles.calHeaderCell} ${isToday ? styles.calHeaderToday : ''}`}>
                  <span className={styles.calDayLabel}>{dayLabels[i]}</span>
                  <span className={`${styles.calDateLabel} ${isToday ? styles.calDateToday : ''}`}>{day.getDate()}</span>
                </div>
              );
            })}
          </div>

          {/* Body */}
          <div className={styles.calBody} style={{ height: `${bodyHeight}px` }}>
            {/* Time labels */}
            <div className={styles.calTimeTrack}>
              {hours.map((hour) => (
                <div key={hour} className={styles.calTimeMark} style={{ top: `${(hour - CALENDAR_START_HOUR) * HOUR_HEIGHT}px` }}>
                  {`${String(hour).padStart(2, '0')}:00`}
                </div>
              ))}
            </div>

            {/* Hour grid lines */}
            {hours.map((hour) => (
              <div key={hour} className={styles.calGridLine} style={{ top: `${(hour - CALENDAR_START_HOUR) * HOUR_HEIGHT}px` }} />
            ))}

            {/* Day columns with bookings */}
            <div className={styles.calColumnsContainer}>
              {weekDays.map((day, colIdx) => {
                const dateStr = formatDateLocal(day);
                const isToday = isSameDay(day, today);
                const dayBookings = bookingsByDate[dateStr] || [];
                return (
                  <div key={colIdx} className={`${styles.calColumn} ${isToday ? styles.calColumnToday : ''}`}>
                    {dayBookings.map(b => renderCalBookingBlock(b))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ===== STAFF DAY CALENDAR (Manager/Owner view) =====
  const renderStaffDayCalendar = () => {
    const cols = staffColumnsForDate;
    const totalHours = CALENDAR_END_HOUR - CALENDAR_START_HOUR;
    const bodyHeight = totalHours * HOUR_HEIGHT;

    return (
      <div className={styles.calendarView}>
        <div className={styles.calendarNav}>
          <div className={styles.calNavLeft}>
            <button className={styles.calNavBtn} onClick={() => {
              const [y, m, d] = selectedDate.split('-').map(Number);
              const dateObj = new Date(y, m - 1, d);
              dateObj.setDate(dateObj.getDate() - 1);
              setSelectedDate(formatDateLocal(dateObj));
            }}>‹</button>
            <input type="date" className={styles.datePickerInput} value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            <button className={styles.calNavBtn} onClick={() => {
              const [y, m, d] = selectedDate.split('-').map(Number);
              const dateObj = new Date(y, m - 1, d);
              dateObj.setDate(dateObj.getDate() + 1);
              setSelectedDate(formatDateLocal(dateObj));
            }}>›</button>
          </div>
          <button className={styles.todayBtn} onClick={goToToday}>
            {locale === 'de' ? 'Heute' : locale === 'vi' ? 'Hôm nay' : 'Today'}
          </button>
        </div>

        <div className={styles.calGrid}>
          {/* Header row - staff columns */}
          <div className={styles.calRow + ' ' + styles.calHeaderRow}>
            <div className={styles.calTimeCol}></div>
            {cols.length === 0 ? (
              <div className={`${styles.calDayCol} ${styles.calHeaderCell}`}>
                <span className={styles.calDayLabel}>—</span>
              </div>
            ) : (
              cols.map((col) => (
                <div key={col.id} className={`${styles.calDayCol} ${styles.calHeaderCell}`}>
                  <div className={styles.staffAvatar}>
                    {col.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <span className={styles.calStaffName}>{col.name}</span>
                </div>
              ))
            )}
          </div>

          {/* Body */}
          <div className={styles.calBody} style={{ height: `${bodyHeight}px` }}>
            <div className={styles.calTimeTrack}>
              {hours.map((hour) => (
                <div key={hour} className={styles.calTimeMark} style={{ top: `${(hour - CALENDAR_START_HOUR) * HOUR_HEIGHT}px` }}>
                  {`${String(hour).padStart(2, '0')}:00`}
                </div>
              ))}
            </div>

            {hours.map((hour) => (
              <div key={hour} className={styles.calGridLine} style={{ top: `${(hour - CALENDAR_START_HOUR) * HOUR_HEIGHT}px` }} />
            ))}

            <div className={styles.calColumnsContainer}>
              {cols.length === 0 ? (
                <div className={styles.calColumn}></div>
              ) : (
                cols.map((col) => (
                  <div key={col.id} className={styles.calColumn}>
                    {col.bookings.map(b => renderCalBookingBlock(b))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ===== MAIN RETURN =====
  return (
    <div id="bookings-container" className={styles.container}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <h1 className={styles.title}>
          {locale === 'vi' ? 'Lịch hẹn' : locale === 'de' ? 'Termine' : 'Bookings'}
        </h1>
        <div className={styles.topBarRight}>
          <button className={styles.iconBtn} onClick={() => setSearchOpen(!searchOpen)}>
            <SearchIcon />
          </button>
          <button
            className={`${styles.iconBtn} ${viewMode === 'list' ? styles.iconBtnActive : ''}`}
            onClick={() => setViewMode('list')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
          </button>
          <button
            className={`${styles.iconBtn} ${viewMode === 'calendar' ? styles.iconBtnActive : ''}`}
            onClick={() => setViewMode('calendar')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}><SearchIcon /></span>
          <input className={styles.searchInput} placeholder={t.common.search + '...'} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} autoFocus />
        </div>
      )}

      {/* View */}
      {viewMode === 'list' ? (
        <>
          <div className={styles.filterTabs}>
            {(['all', 'confirmed', 'pending_approval', 'needs_owner_action', 'completed', 'cancelled'] as FilterStatus[]).map(f => (
              <button key={f} className={`${styles.filterTab} ${filter === f ? styles.filterTabActive : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? t.admin.bookings.tabAll 
                  : f === 'confirmed' ? t.admin.bookings.tabConfirmed 
                  : f === 'pending_approval' ? t.admin.bookings.tabPending 
                  : f === 'needs_owner_action' ? (t.admin.bookings.tabNeedsAction || 'Cần xử lý')
                  : f === 'completed' ? (t.admin.bookings.tabCompleted || 'Đã hoàn thành')
                  : t.admin.bookings.tabCancelled}
                {' '}({bookingsForRole.filter(b => f === 'all' || b.status === f).length})
              </button>
            ))}
          </div>
          <div className={styles.listView}>
            {loading ? (
              <div className={styles.noBookings}><p>{t.admin.bookings.loading}</p></div>
            ) : filteredBookings.length === 0 ? (
              <div className={styles.noBookings}><span className={styles.emptyIcon}>📭</span><p>{t.admin.bookings.empty}</p></div>
            ) : (
              groupedByDate.map(group => (
                <div key={group.date} className={styles.dateGroup}>
                  <p className={styles.dateLabel}>{formatDateGroupLabel(group.date, locale)}</p>
                  {group.bookings.map(booking => (
                    <div key={booking.id} className={styles.bookingCard}>
                      <div className={styles.cardTime}>
                        <span className={styles.timeValue}>{booking.startTime}</span>
                        <span className={styles.durationValue}>{booking.totalDurationMinutes} {t.common.minutes}</span>
                      </div>
                      <div className={styles.cardContent}>
                        <h3 className={styles.serviceName}>{getServiceName(booking)}</h3>
                        {user?.role !== 'staff' && (
                          <>
                            <span className={styles.customerName}>{booking.customerName}</span>
                            <span className={styles.customerPhone}>{booking.customerPhone}</span>
                          </>
                        )}
                        {isManagerOrOwner && <span className={styles.staffLabel}>{booking.staffName}</span>}
                      </div>
                      <div className={styles.cardRight}>
                        {getStatusBadge(booking.status)}
                        <span className={styles.priceText}>€{booking.totalPrice}</span>
                        {user?.role !== 'staff' && (
                          <>
                            {(booking.status === 'pending_approval' || booking.status === 'needs_owner_action') && (
                              <div className={styles.cardActions}>
                                <button className={styles.rejectBtn} onClick={() => handleReject(booking.id)}>{t.admin.bookings.btnReject}</button>
                                <button className={styles.approveBtn} onClick={() => handleApprove(booking.id)}>{t.admin.bookings.btnApprove}</button>
                              </div>
                            )}
                            {booking.status === 'confirmed' && (
                              <div className={styles.cardActions}>
                                <button className={styles.cancelBtn} onClick={() => handleReject(booking.id)}>{t.admin.bookings.btnCancel}</button>
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
        <>{isManagerOrOwner ? renderStaffDayCalendar() : renderWeeklyCalendar()}</>
      )}

      {/* Popover */}
      {popover && (
        <div 
          ref={popoverRef} 
          className={styles.calPopover} 
          style={{
            top: `${(popover.y - popoverHeight - 10 >= 10) ? (popover.y - popoverHeight - 10) : (popover.y + popover.blockHeight + 10)}px`,
            left: `${Math.max(10, Math.min(popover.x - 150, (typeof document !== 'undefined' ? document.getElementById('bookings-container')?.offsetWidth || 1000 : 1000) - 350))}px`,
          }}
        >
          <div className={styles.calPopoverHeader}>
            <h4 className={styles.calPopoverTitle}>{getServiceName(popover.booking)}</h4>
            <button className={styles.calPopoverClose} onClick={() => setPopover(null)}>✕</button>
          </div>
          <div className={styles.calPopoverRow}>
            <span className={styles.calPopoverLabel}>{t.admin.bookings.detailTime}</span>
            <span className={styles.calPopoverValue}>{popover.booking.startTime} – {formatEndTime(popover.booking.startTime, popover.booking.totalDurationMinutes)}</span>
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
              <span className={styles.calPopoverLabel}>{locale === 'vi' ? 'Khách hàng' : 'Customer'}</span>
              <span className={styles.calPopoverValue}>{popover.booking.customerName} · {popover.booking.customerPhone}</span>
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
          {user?.role !== 'staff' && (
            <>
              {(popover.booking.status === 'pending_approval' || popover.booking.status === 'needs_owner_action') && (
                <div className={styles.calPopoverActions}>
                  <button className={styles.rejectBtn} onClick={() => { handleReject(popover.booking.id); setPopover(null); }}>{t.admin.bookings.btnReject}</button>
                  <button className={styles.approveBtn} onClick={() => { handleApprove(popover.booking.id); setPopover(null); }}>{t.admin.bookings.btnApprove}</button>
                </div>
              )}
              {popover.booking.status === 'confirmed' && (
                <div className={styles.calPopoverActions}>
                  <button className={styles.cancelBtn} onClick={() => { handleReject(popover.booking.id); setPopover(null); }}>{t.admin.bookings.btnCancel}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
