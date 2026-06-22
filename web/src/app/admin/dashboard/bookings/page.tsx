'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { collection, onSnapshot, doc, updateDoc, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { getGermanDateObject, getGermanTodayString } from '@/lib/timeUtils';
import styles from './page.module.css';
import { Search, List, Calendar, ChevronLeft, ChevronRight, X, Users, User, Clock, ChevronDown } from 'lucide-react';
import { Button } from '@/components/admin/ui/button';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';

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
type FilterStatus = 'all' | 'pending_approval' | 'confirmed' | 'cancelled';

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

// SVG Icons removed in favor of Lucide Icons

function computeOverlappingLayout(bookings: FirestoreBooking[]): { booking: FirestoreBooking; left: number; width: number }[] {
  if (bookings.length === 0) return [];

  const parsed = bookings.map(b => {
    const { hours, minutes } = parseTime(b.startTime);
    const start = hours * 60 + minutes;
    const end = start + b.totalDurationMinutes;
    return {
      booking: b,
      start,
      end,
      colIndex: 0,
      maxCols: 1,
    };
  });

  // Sort by start time ascending, then by duration descending
  parsed.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });

  const clusters: typeof parsed[] = [];
  let currentCluster: typeof parsed = [];

  for (const item of parsed) {
    if (currentCluster.length === 0) {
      currentCluster.push(item);
    } else {
      const maxEndInCluster = Math.max(...currentCluster.map(c => c.end));
      if (item.start < maxEndInCluster) {
        currentCluster.push(item);
      } else {
        clusters.push(currentCluster);
        currentCluster = [item];
      }
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const result: { booking: FirestoreBooking; left: number; width: number }[] = [];

  for (const cluster of clusters) {
    const columns: number[] = [];

    for (const item of cluster) {
      let placed = false;
      for (let i = 0; i < columns.length; i++) {
        if (item.start >= columns[i]) {
          columns[i] = item.end;
          item.colIndex = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.colIndex = columns.length;
        columns.push(item.end);
      }
    }

    const maxCols = columns.length;
    for (const item of cluster) {
      item.maxCols = maxCols;
      const width = 100 / maxCols;
      const left = item.colIndex * width;
      result.push({
        booking: item.booking,
        left,
        width,
      });
    }
  }

  return result;
}

// ===== Component =====
export default function BookingsManagementPage() {
  const router = useRouter();
  const { user, activeBranch } = useAuth();
  const { t, locale } = useI18n();
  const { getServiceName: translateService, getCategoryName: translateCategory } = useServiceTranslation();
  const [bookings, setBookings] = useState<FirestoreBooking[]>([]);
  const [realStaffList, setRealStaffList] = useState<{ id: string; name: string; status: string }[]>([]);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [weekStart, setWeekStart] = useState(() => getStartOfWeek(getGermanDateObject()));
  const [selectedDate, setSelectedDate] = useState(() => getGermanTodayString());
  const [popover, setPopover] = useState<{ 
    booking: FirestoreBooking; 
  } | null>(null);
  const [popoverAnchorEl, setPopoverAnchorEl] = useState<HTMLElement | null>(null);

  // Firestore real-time sync for Bookings
  useEffect(() => {
    if (!user) return;
    const branchId = activeBranch || user.assignedBranches?.[0] || 'glamour-nails-berlin';
    const bookingsRef = collection(db, 'branches', branchId, 'bookings');
    const bookingsQuery = user.role === 'staff' && user.staffId
      ? query(bookingsRef, where('staffId', '==', user.staffId))
      : bookingsRef;

    const unsubscribe = onSnapshot(bookingsQuery, (snap) => {
      const list: FirestoreBooking[] = [];
      snap.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() } as FirestoreBooking);
      });
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setBookings(list);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsubscribe();
  }, [user, activeBranch]);

  // Firestore real-time sync for Staff List
  useEffect(() => {
    if (!user) return;
    const branchId = activeBranch || user.assignedBranches?.[0] || 'glamour-nails-berlin';
    const staffRef = collection(db, 'branches', branchId, 'staff');

    const unsubscribe = onSnapshot(staffRef, (snap) => {
      const list: { id: string; name: string; status: string }[] = [];
      snap.forEach(doc => {
        const data = doc.data();
        list.push({
          id: doc.id,
          name: data.name || '',
          status: data.status || 'active',
        });
      });
      setRealStaffList(list);
    }, (err) => console.error('Error fetching staff list:', err));
    return () => unsubscribe();
  }, [user, activeBranch]);

  // Handlers
  const handleApprove = async (id: string) => {
    if (!user) return;
    const branchId = activeBranch || user.assignedBranches?.[0] || 'glamour-nails-berlin';
    try { await updateDoc(doc(db, 'branches', branchId, 'bookings', id), { status: 'confirmed' }); } catch (e) { console.error(e); }
  };

  const handleReject = async (id: string) => {
    if (!user) return;
    const branchId = activeBranch || user.assignedBranches?.[0] || 'glamour-nails-berlin';
    try { await updateDoc(doc(db, 'branches', branchId, 'bookings', id), { status: 'cancelled' }); } catch (e) { console.error(e); }
  };

  const handleReassignStaff = async (bookingId: string, staffId: string, staffName: string) => {
    if (!user) return;
    const branchId = activeBranch || user.assignedBranches?.[0] || 'glamour-nails-berlin';
    try {
      await updateDoc(doc(db, 'branches', branchId, 'bookings', bookingId), {
        staffId,
        staffName
      });
    } catch (e) {
      console.error('Error reassigning staff:', e);
    }
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
          const name = typeof s === 'object' && s !== null 
            ? `${s.categoryName || ''} ${s.serviceName || s.name || ''}` 
            : String(s);
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
    return realStaffList.map(s => ({ id: s.id, name: s.name, status: s.status }));
  }, [realStaffList]);

  const [staffFilterId, setStaffFilterId] = useState<string>('all');
  const isManagerOrOwner = user?.role !== 'staff';

  const dayFilteredBookings = useMemo(() => {
    let list = bookingsForRole.filter(b => b.appointmentDate === selectedDate);
    
    // Filter by staff
    if (staffFilterId !== 'all') {
      list = list.filter(b => b.staffId === staffFilterId);
    }
    
    // Filter by status
    if (filter !== 'all') {
      list = list.filter(b => b.status === filter);
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(b =>
        b.customerName.toLowerCase().includes(q) ||
        b.customerPhone.includes(q) ||
        b.staffName.toLowerCase().includes(q) ||
        b.services.some(s => {
          const name = typeof s === 'object' && s !== null 
            ? `${s.categoryName || ''} ${s.serviceName || s.name || ''}` 
            : String(s);
          return name.toLowerCase().includes(q);
        })
      );
    }
    
    // Sort by start time ascending
    return list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  }, [bookingsForRole, selectedDate, staffFilterId, filter, searchQuery]);

  /** Translate a single service item: "CategoryName – ServiceName" */
  const translateServiceItem = useCallback((s: any): string => {
    if (typeof s === 'string') {
      // Old format: plain string like "Natur" or "Natur + Design / Extra"
      return s;
    }
    if (typeof s === 'object' && s !== null) {
      // New format: object with serviceId, categoryId, serviceName, categoryName
      const svcName = s.serviceId
        ? translateService(s.serviceId, s.serviceName || s.name || '')
        : (s.serviceName || s.name || '');
      const catName = s.categoryId
        ? translateCategory(s.categoryId, s.categoryName || '')
        : (s.categoryName || '');
      
      // Build extras suffix
      let extrasSuffix = '';
      if (s.extras && Array.isArray(s.extras) && s.extras.length > 0) {
        const extrasNames = s.extras.map((e: any) => 
          e.serviceId ? translateService(e.serviceId, e.name || '') : (e.name || '')
        ).join(', ');
        extrasSuffix = ` + ${extrasNames}`;
      }
      
      if (catName) {
        return `${catName} – ${svcName}${extrasSuffix}`;
      }
      return `${svcName}${extrasSuffix}`;
    }
    return String(s);
  }, [translateService, translateCategory]);

  const getServiceName = useCallback((booking: FirestoreBooking): string => {
    if (booking.services.length === 0) return '';
    const first = translateServiceItem(booking.services[0]);
    if (booking.services.length > 1) return `${first} +${booking.services.length - 1}`;
    return first;
  }, [translateServiceItem]);

  const getFullServicesDisplay = useCallback((booking: FirestoreBooking): string => {
    if (booking.services.length === 0) return '';
    return booking.services.map(s => translateServiceItem(s)).join(', ');
  }, [translateServiceItem]);

  const getStaffNameDisplay = useCallback((staffId: string, staffName: string): string => {
    if (
      staffId === 'any' || 
      staffName === 'Bất kỳ ai' || 
      staffName?.toLowerCase() === 'any staff' || 
      staffName?.toLowerCase() === 'beliebiger mitarbeiter'
    ) {
      return t.admin.bookings.anyStaff || 'Bất kỳ ai';
    }
    const staff = realStaffList.find(s => s.id === staffId);
    return staff ? staff.name : staffName;
  }, [realStaffList, t]);

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

    // 1. Thêm tất cả nhân viên có status === 'active' từ realStaffList
    realStaffList.forEach(s => {
      if (s.status === 'active') {
        map.set(s.id, { name: s.name, bookings: [] });
      }
    });

    // Spec V1: Tạo cột Request cho các booking chờ duyệt hoặc chưa gán thợ
    const requestColumnBookings: FirestoreBooking[] = [];

    // 2. Phân loại booking vào cột tương ứng
    dayBookings.forEach(b => {
      // Spec V1: Booking pending_approval hoặc chưa gán thợ → cột Request
      const isUnassigned = !b.staffId || b.staffId === 'any' || b.staffId === '';
      const isPending = b.status === 'pending_approval';

      if (isUnassigned || isPending) {
        requestColumnBookings.push(b);
      } else {
        if (!map.has(b.staffId)) {
          const staff = realStaffList.find(s => s.id === b.staffId);
          const name = staff ? staff.name : b.staffName;
          map.set(b.staffId, { name, bookings: [] });
        }
        map.get(b.staffId)!.bookings.push(b);
      }
    });

    const staffColumns = Array.from(map.entries()).map(([id, data]) => ({ id, ...data }));

    // Spec V1: Thêm cột Request ở cuối nếu có booking chờ duyệt
    if (requestColumnBookings.length > 0 || dayBookings.some(b => b.status === 'pending_approval')) {
      staffColumns.push({
        id: '__request__',
        name: locale === 'vi' ? 'Yêu cầu' : locale === 'de' ? 'Anfragen' : 'Requests',
        bookings: requestColumnBookings,
      });
    }

    return staffColumns;
  }, [isManagerOrOwner, bookingsByDate, selectedDate, realStaffList, locale]);

  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!popover) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) { setPopover(null); setPopoverAnchorEl(null); }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [popover]);

  // Cập nhật vị trí popover theo thời gian thực khi cuộn trang hoặc cuộn lịch
  useEffect(() => {
    if (!popover) return;

    const updatePosition = () => {
      // Try calendar block element first, then fall back to anchor element from list view
      const blockEl = document.getElementById(`cal-block-${popover.booking.id}`) || popoverAnchorEl;
      const popoverEl = popoverRef.current;
      if (!blockEl || !popoverEl) {
        // If no anchor element found, show popover centered on screen (mobile modal style)
        if (popoverEl) {
          const currentPopoverWidth = popoverEl.offsetWidth || 300;
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const currentPopoverHeight = popoverEl.offsetHeight || 320;
          popoverEl.style.top = `${Math.max(20, (viewportHeight - currentPopoverHeight) / 2)}px`;
          popoverEl.style.left = `${Math.max(10, (viewportWidth - currentPopoverWidth) / 2)}px`;
          popoverEl.style.opacity = '1';
        }
        return;
      }

      const rect = blockEl.getBoundingClientRect();

      const currentPopoverHeight = popoverEl.offsetHeight || 320;
      const currentPopoverWidth = popoverEl.offsetWidth || 300;

      // Tính toán vị trí top (so với viewport)
      // Try above the block first, if not enough space, show below
      let topVal = rect.top - currentPopoverHeight - 10;
      if (topVal < 10) {
        topVal = rect.bottom + 10;
      }
      // If still overflows bottom, center vertically
      if (topVal + currentPopoverHeight > window.innerHeight - 10) {
        topVal = Math.max(10, (window.innerHeight - currentPopoverHeight) / 2);
      }

      // Tính toán vị trí left (so với viewport)
      // Căn giữa popover theo chiều ngang của block lịch hẹn
      let leftVal = rect.left + rect.width / 2 - currentPopoverWidth / 2;

      // Giới hạn left để popover không bị tràn ra ngoài 2 cạnh màn hình trái/phải
      const viewportWidth = window.innerWidth;
      leftVal = Math.max(10, Math.min(leftVal, viewportWidth - currentPopoverWidth - 10));

      // Cập nhật trực tiếp vào style của DOM element
      popoverEl.style.top = `${topVal}px`;
      popoverEl.style.left = `${leftVal}px`;
      popoverEl.style.opacity = '1'; // Hiện popover sau khi đã định vị xong
    };

    // Chạy updatePosition bằng requestAnimationFrame để đảm bảo popoverEl đã được thêm vào DOM và đo được kích thước thực tế
    const animId = requestAnimationFrame(updatePosition);

    // Lắng nghe sự kiện scroll với capture = true để bắt được sự kiện cuộn từ .calBody và window
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [popover, popoverAnchorEl]);

  const goToPrevWeek = () => setWeekStart(prev => addDays(prev, -7));
  const goToNextWeek = () => setWeekStart(prev => addDays(prev, 7));
  const goToToday = () => { setWeekStart(getStartOfWeek(getGermanDateObject())); setSelectedDate(getGermanTodayString()); };

  const weekRangeLabel = useMemo(() => {
    const end = addDays(weekStart, 6);
    const fmt = (d: Date) => d.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${fmt(weekStart)} – ${fmt(end)}`;
  }, [weekStart, locale]);

  // ===== RENDER BOOKING BLOCK =====
  const renderCalBookingBlock = (booking: FirestoreBooking, leftPercent = 0, widthPercent = 100) => {
    const { hours: startH, minutes: startM } = parseTime(booking.startTime);
    const topOffset = (startH - CALENDAR_START_HOUR) * HOUR_HEIGHT + (startM / 60) * HOUR_HEIGHT;
    const height = Math.max((booking.totalDurationMinutes / 60) * HOUR_HEIGHT, 28);
    const endTime = formatEndTime(booking.startTime, booking.totalDurationMinutes);

    let blockClass = styles.calBlock;
    if (booking.status === 'confirmed') blockClass += ` ${styles.calBlockConfirmed}`;
    if (booking.status === 'pending_approval') blockClass += ` ${styles.calBlockPending}`;
    if (booking.status === 'cancelled') blockClass += ` ${styles.calBlockCancelled}`;

    return (
      <div
        key={booking.id}
        id={`cal-block-${booking.id}`}
        className={blockClass}
        style={{
          top: `${topOffset}px`,
          height: `${height}px`,
          left: `calc(${leftPercent}% + 3px)`,
          width: `calc(${widthPercent}% - 6px)`
        }}
        onClick={(e) => {
          e.stopPropagation();
          setPopover({ booking });
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
            <Button variant="outline" size="icon" onClick={goToPrevWeek}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
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
            <Button variant="outline" size="icon" onClick={goToNextWeek}>
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
          <Button variant="outline" onClick={goToToday}>
            {locale === 'de' ? 'Heute' : locale === 'vi' ? 'Hôm nay' : 'Today'}
          </Button>
        </div>

        {isManagerOrOwner && staffList.length > 0 && (
          <div className={styles.staffFilter}>
            <select className={styles.staffSelect} value={staffFilterId} onChange={(e) => setStaffFilterId(e.target.value)}>
              <option value="all">{locale === 'vi' ? 'Tất cả nhân viên' : 'All staff'}</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{getStaffNameDisplay(s.id, s.name)}</option>)}
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
                const positioned = computeOverlappingLayout(dayBookings);
                return (
                  <div key={colIdx} className={`${styles.calColumn} ${isToday ? styles.calColumnToday : ''}`}>
                    {positioned.map(({ booking, left, width }) => renderCalBookingBlock(booking, left, width))}
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
        {/* Centered Date Navigator */}
        <div className={styles.calendarNavCentered}>
          <Button 
            variant="outline" 
            size="icon" 
            className={styles.calNavBtn}
            onClick={() => {
              const [y, m, d] = selectedDate.split('-').map(Number);
              const dateObj = new Date(y, m - 1, d);
              dateObj.setDate(dateObj.getDate() - 1);
              setSelectedDate(formatDateLocal(dateObj));
            }}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className={styles.datePickerWrapper}>
            <span className={styles.dateLabelText}>
              {formatDateGroupLabel(selectedDate, locale)}
            </span>
            <input 
              type="date" 
              className={styles.datePickerInputHidden} 
              value={selectedDate} 
              onChange={(e) => setSelectedDate(e.target.value)} 
            />
          </div>
          <Button 
            variant="outline" 
            size="icon" 
            className={styles.calNavBtn}
            onClick={() => {
              const [y, m, d] = selectedDate.split('-').map(Number);
              const dateObj = new Date(y, m - 1, d);
              dateObj.setDate(dateObj.getDate() + 1);
              setSelectedDate(formatDateLocal(dateObj));
            }}
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        <div className={styles.calGrid}>
          {/* Header row - staff columns */}
          <div className={styles.calRow + ' ' + styles.calHeaderRow}>
            <div className={styles.calTimeCol}>
              <div className={styles.cornerLabel}>
                {locale === 'vi' ? 'Nhân viên/Giờ' : locale === 'de' ? 'Mitarb./Uhr' : 'Staff/Hour'}
              </div>
            </div>
            {cols.length === 0 ? (
              <div className={`${styles.calDayCol} ${styles.calHeaderCell}`}>
                <span className={styles.calDayLabel}>—</span>
              </div>
            ) : (
              cols.map((col) => {
                const isRequestCol = col.id === '__request__';
                const displayName = isRequestCol ? col.name : getStaffNameDisplay(col.id, col.name);
                return (
                  <div key={col.id} className={`${styles.calDayCol} ${styles.calHeaderCell} ${isRequestCol ? styles.calHeaderCellRequest : ''}`}>
                    <div className={isRequestCol ? styles.requestAvatar : styles.staffAvatar}>
                      {isRequestCol ? '📋' : displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <span className={styles.calStaffName}>{displayName}</span>
                    <span className={styles.calStaffSubtitle}>{isRequestCol ? (locale === 'vi' ? 'chờ duyệt' : 'pending') : 'employee'}</span>
                  </div>
                );
              })
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
                cols.map((col) => {
                  const positioned = computeOverlappingLayout(col.bookings);
                  return (
                    <div key={col.id} className={styles.calColumn}>
                      {positioned.map(({ booking, left, width }) => renderCalBookingBlock(booking, left, width))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Legend Footer */}
        <div className={styles.legendContainer}>
          <div className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotGreen}`}></span>
            <span className={styles.legendText}>{t.admin.bookings.statusConfirmed}</span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotOrange}`}></span>
            <span className={styles.legendText}>{t.admin.bookings.statusPending}</span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotGrey}`}></span>
            <span className={styles.legendText}>{t.admin.bookings.statusCancelled}</span>
          </div>
        </div>
      </div>
    );
  };

  // ===== MAIN RETURN =====
  return (
    <div id="bookings-container" className={styles.container}>
      {/* Top Bar */}
      {viewMode === 'list' ? (
        <div className={styles.topBar}>
          <h1 className={styles.title}>
            {locale === 'vi' ? 'Lịch hẹn' : locale === 'de' ? 'Termine' : 'Bookings'}
          </h1>
          <div className={styles.topBarRight}>
            <Button
              variant="outline"
              size="icon"
              className={styles.toggleViewBtn}
              onClick={() => setViewMode('calendar')}
            >
              <Calendar className="w-5 h-5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.topBar}>
          <button 
            className={styles.backBtn}
            onClick={() => router.push('/admin/dashboard/')}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className={`${styles.title} ${styles.titleCenter}`}>
            {locale === 'vi' ? 'Lịch hẹn' : locale === 'de' ? 'Termine' : 'Bookings'}
          </h1>
          <div className={styles.topBarRight}>
            <Button
              variant="outline"
              size="icon"
              className={styles.toggleViewBtn}
              onClick={() => setViewMode('list')}
            >
              <List className="w-5 h-5" />
            </Button>
          </div>
        </div>
      )}

      {/* View */}
      {viewMode === 'list' ? (
        <>
          {/* Dual Dropdown Select Filter Bar */}
          <div className={styles.filtersBar}>
            <div className={styles.filterHalf}>
              <Users className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
              <select 
                className={styles.filterSelect} 
                value={staffFilterId} 
                onChange={(e) => setStaffFilterId(e.target.value)}
              >
                <option value="all">{locale === 'vi' ? 'Tất cả thợ' : locale === 'de' ? 'Alle Mitarbeiter' : 'All staff'}</option>
                {staffList.map(s => (
                  <option key={s.id} value={s.id}>{getStaffNameDisplay(s.id, s.name)}</option>
                ))}
              </select>
            </div>
            <div className={styles.filterDivider}></div>
            <div className={styles.filterHalf}>
              <div className={`${styles.statusDot} ${styles[`statusDot_${filter}`]}`} />
              <select 
                className={styles.filterSelect} 
                value={filter} 
                onChange={(e) => setFilter(e.target.value as FilterStatus)}
              >
                <option value="all">{locale === 'vi' ? 'Tất cả trạng thái' : locale === 'de' ? 'Alle Status' : 'All status'}</option>
                <option value="pending_approval">{t.admin.bookings.statusPending}</option>
                <option value="confirmed">{t.admin.bookings.statusConfirmed}</option>
                <option value="cancelled">{t.admin.bookings.statusCancelled}</option>
              </select>
            </div>
          </div>

          {/* Centered Date Navigator */}
          <div className={styles.calendarNavCentered}>
            <Button 
              variant="outline" 
              size="icon" 
              className={styles.calNavBtn}
              onClick={() => {
                const [y, m, d] = selectedDate.split('-').map(Number);
                const dateObj = new Date(y, m - 1, d);
                dateObj.setDate(dateObj.getDate() - 1);
                setSelectedDate(formatDateLocal(dateObj));
              }}
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className={styles.datePickerWrapper}>
              <span className={styles.dateLabelText}>
                {formatDateGroupLabel(selectedDate, locale)}
              </span>
              <input 
                type="date" 
                className={styles.datePickerInputHidden} 
                value={selectedDate} 
                onChange={(e) => setSelectedDate(e.target.value)} 
              />
            </div>
            <Button 
              variant="outline" 
              size="icon" 
              className={styles.calNavBtn}
              onClick={() => {
                const [y, m, d] = selectedDate.split('-').map(Number);
                const dateObj = new Date(y, m - 1, d);
                dateObj.setDate(dateObj.getDate() + 1);
                setSelectedDate(formatDateLocal(dateObj));
              }}
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>

          <div className={styles.listView}>
            {loading ? (
              <div className={styles.noBookings}><p>{t.admin.bookings.loading}</p></div>
            ) : dayFilteredBookings.length === 0 ? (
              <div className={styles.noBookings}><span className={styles.emptyIcon}>📭</span><p>{t.admin.bookings.empty}</p></div>
            ) : (
              dayFilteredBookings.map(booking => {
                let borderLeftColor = '#E5E7EB';
                if (booking.status === 'confirmed') borderLeftColor = '#059669';
                else if (booking.status === 'pending_approval' || booking.status === 'needs_owner_action') borderLeftColor = '#D97706';
                else if (booking.status === 'cancelled') borderLeftColor = '#9CA3AF';
                else if (booking.status === 'completed') borderLeftColor = '#2563EB';

                return (
                  <div key={booking.id} className={styles.bookingRow}>
                    <div className={styles.rowTimeContainer}>
                      <span className={styles.rowTime}>{booking.startTime}</span>
                      <span className={styles.rowDuration}>{booking.totalDurationMinutes} {t.common.minutes}</span>
                    </div>
                    <div 
                      className={styles.bookingListItemCard}
                      style={{ borderLeft: `4px solid ${borderLeftColor}` }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPopoverAnchorEl(e.currentTarget as HTMLElement);
                        setPopover({ booking });
                      }}
                    >
                      <div className={styles.cardHeaderRow}>
                        <h3 className={styles.cardServiceTitle}>{getServiceName(booking)}</h3>
                        {getStatusBadge(booking.status)}
                      </div>
                      <div className={styles.cardStaffLine}>
                        {getStaffNameDisplay(booking.staffId, booking.staffName)}
                      </div>
                      {user?.role !== 'staff' && (
                        <div className={styles.cardCustomerLine}>
                          <span className="text-gray-400 mr-1.5 flex-shrink-0">📞</span>
                          <span className={styles.customerPhoneNumber}>{booking.customerPhone}</span>
                          <span className="mx-1.5 text-gray-300">·</span>
                          <span className={styles.customerNameText}>{booking.customerName}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        <>{isManagerOrOwner ? renderStaffDayCalendar() : renderWeeklyCalendar()}</>
      )}

      {/* Popover */}
      {popover && (
        <>
          <div 
            className={styles.popoverBackdrop} 
            onClick={() => { setPopover(null); setPopoverAnchorEl(null); }} 
          />
          <div 
            ref={popoverRef} 
            className={styles.calPopover} 
            style={{ opacity: 0 }}
          >
          <div className={styles.calPopoverHeader}>
            <h4 className={styles.calPopoverTitle}>{getFullServicesDisplay(popover.booking)}</h4>
            <Button variant="ghost" size="icon" className="w-6 h-6 p-0 text-gray-400 hover:text-gray-600 border-0 bg-transparent cursor-pointer" onClick={() => { setPopover(null); setPopoverAnchorEl(null); }}>
              <X className="w-4 h-4" />
            </Button>
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
            {isManagerOrOwner ? (
              <select
                className={styles.popoverStaffSelect}
                value={popover.booking.staffId || 'any'}
                onChange={(e) => {
                  const newStaffId = e.target.value;
                  const newStaff = realStaffList.find(s => s.id === newStaffId);
                  const newStaffName = newStaff ? newStaff.name : (newStaffId === 'any' ? (t.admin.bookings.anyStaff || 'Bất kỳ ai') : '');
                  handleReassignStaff(popover.booking.id, newStaffId, newStaffName);
                  setPopover(prev => prev ? { ...prev, booking: { ...prev.booking, staffId: newStaffId, staffName: newStaffName } } : null);
                }}
              >
                <option value="any">{t.admin.bookings.anyStaff || 'Bất kỳ ai'}</option>
                {realStaffList.map(s => (
                  <option key={s.id} value={s.id}>{s.name} {s.status !== 'active' ? `(${locale === 'vi' ? 'Khóa' : 'Inactive'})` : ''}</option>
                ))}
              </select>
            ) : (
              <span className={styles.calPopoverValue}>{getStaffNameDisplay(popover.booking.staffId, popover.booking.staffName)}</span>
            )}
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
                  <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700" onClick={() => { handleReject(popover.booking.id); setPopover(null); setPopoverAnchorEl(null); }}>{t.admin.bookings.btnReject}</Button>
                  <Button size="sm" onClick={() => { handleApprove(popover.booking.id); setPopover(null); setPopoverAnchorEl(null); }}>{t.admin.bookings.btnApprove}</Button>
                </div>
              )}
              {popover.booking.status === 'confirmed' && (
                <div className={styles.calPopoverActions}>
                  <Button variant="outline" size="sm" className="text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200" onClick={() => { handleReject(popover.booking.id); setPopover(null); setPopoverAnchorEl(null); }}>{t.admin.bookings.btnCancel}</Button>
                </div>
              )}
            </>
          )}
        </div>
        </>
      )}
    </div>
  );
}
