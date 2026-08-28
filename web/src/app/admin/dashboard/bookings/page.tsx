'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import { getGermanDateObject, getGermanTodayString } from '@/lib/timeUtils';
import styles from './page.module.css';
import { List, Calendar, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardList, Clock, Copy, Euro, Pencil, Phone, Plus, Scissors, Search, Timer, Trash2, TriangleAlert, UserRound, X } from 'lucide-react';
import { Button } from '@/components/admin/ui/button';
import { useServiceTranslation } from '@/lib/i18n/serviceTranslations';
import {
  fetchAdminAttendanceCalendar,
  fetchAdminEmployees,
  createAdminBooking,
  deleteAllAdminBookingData,
  fetchBookingPurgePreview,
  reassignAdminAttendance,
  searchAdminAttendances,
  updateAdminAttendanceStatus,
  type AdminAttendanceItem,
  type BookingPurgePreview,
} from '@/lib/adminHrmApi';
import {
  fetchHrmAvailability,
  fetchHrmServices,
  fetchHrmStaff,
  type HrmService,
} from '@/lib/hrmApi';
import { getAdminBackTarget, getRequestedEmployeeId } from '@/lib/adminNavigation';

type BookingServiceExtra = {
  serviceId?: string;
  name?: string;
};

type BookingServiceItem = {
  serviceId: string;
  serviceName: string;
  categoryId?: string;
  categoryName?: string;
  name?: string;
  durationMinutes: number;
  price: number;
  extras?: BookingServiceExtra[];
};

interface FirestoreBooking {
  id: string;
  attendanceId: string;
  bookingId?: string;
  bookingCode?: string;
  customerName: string;
  customerPhone: string;
  services: BookingServiceItem[];
  addOns?: BookingServiceExtra[];
  staffId: string;
  staffName: string;
  staffSelectionType?: 'specific' | 'any';
  requestedStaffId?: string;
  requestedStaffName?: string;
  conflictStaffId?: string;
  conflictStaffName?: string;
  proposedStaffId?: string;
  proposedStaffName?: string;
  appointmentDate: string;
  startTime: string;
  totalPrice: number;
  totalDurationMinutes: number;
  status: 'pending_approval' | 'confirmed' | 'cancelled' | 'needs_owner_action' | 'completed' | 'no_show';
  originatedAsRequest?: boolean;
  source: 'online_booking' | 'manual_booking' | 'walk_in';
  createdAt: string;
  updatedByUserId?: string;
  updatedByRole?: 'customer' | 'owner' | 'manager' | 'employee';
  updatedByName?: string;
}

type ViewMode = 'list' | 'calendar';
type StaffAbsence = {
  employeeUserId: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  absenceDate: string;
  isFullDay: boolean;
  startTime?: string;
  endTime?: string;
  note?: string;
};
type FilterStatus =
  | 'all'
  | 'request'
  | 'pending_approval'
  | 'confirmed'
  | 'cancelled'
  | 'needs_owner_action';
type SourceFilter = 'all' | 'online_booking' | 'owner_created';

type BookingGroupIdentity = {
  accent: string;
  background: string;
  outline: string;
  text: string;
};

type BookingListGroup = {
  key: string;
  visibleBookings: FirestoreBooking[];
  allBookings: FirestoreBooking[];
};

const BOOKING_GROUP_PALETTE: BookingGroupIdentity[] = [
  { accent: '#2563EB', background: '#EFF6FF', outline: '#BFDBFE', text: '#1D4ED8' },
  { accent: '#7C3AED', background: '#F5F3FF', outline: '#DDD6FE', text: '#6D28D9' },
  { accent: '#0891B2', background: '#ECFEFF', outline: '#A5F3FC', text: '#0E7490' },
  { accent: '#DB2777', background: '#FDF2F8', outline: '#FBCFE8', text: '#BE185D' },
  { accent: '#4F46E5', background: '#EEF2FF', outline: '#C7D2FE', text: '#4338CA' },
  { accent: '#0F766E', background: '#F0FDFA', outline: '#99F6E4', text: '#0F766E' },
  { accent: '#9333EA', background: '#FAF5FF', outline: '#E9D5FF', text: '#7E22CE' },
  { accent: '#0369A1', background: '#F0F9FF', outline: '#BAE6FD', text: '#0369A1' },
];

function getBookingGroupIdentity(index: number): BookingGroupIdentity {
  const preset = BOOKING_GROUP_PALETTE[index];
  if (preset) return preset;

  // A busy day can contain more groups than the fixed palette. Generate an
  // additional cool pastel identity instead of cycling back to purple/blue,
  // otherwise unrelated customer bookings can appear to be one group.
  const hue = 185 + ((index * 47) % 146);
  return {
    accent: `hsl(${hue} 72% 43%)`,
    background: `hsl(${hue} 82% 96%)`,
    outline: `hsl(${hue} 72% 84%)`,
    text: `hsl(${hue} 72% 35%)`,
  };
}

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
  return dateObj.toLocaleDateString(locale === 'de' ? 'de-DE' : locale === 'vi' ? 'vi-VN' : 'en-US', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatWeekRangeLabel(start: Date, locale: string): string {
  const end = addDays(start, 6);
  const localeCode = locale === 'vi' ? 'vi-VN' : locale === 'de' ? 'de-DE' : 'en-GB';
  const startLabel = start.toLocaleDateString(localeCode, {
    day: '2-digit',
    month: '2-digit',
    ...(start.getFullYear() !== end.getFullYear() && { year: 'numeric' }),
  });
  const endLabel = end.toLocaleDateString(localeCode, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `${startLabel} – ${endLabel}`;
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

function matchesSourceFilter(booking: FirestoreBooking, sourceFilter: SourceFilter): boolean {
  if (sourceFilter === 'all') return true;
  if (sourceFilter === 'online_booking') return booking.source === 'online_booking';
  return booking.source === 'manual_booking' || booking.source === 'walk_in';
}

function isClaimableUnassignedBooking(booking: FirestoreBooking): boolean {
  const hasNoAssignedStaff = !booking.staffId || booking.staffId === 'any';
  return (
    (booking.originatedAsRequest === true && hasNoAssignedStaff &&
      !['cancelled', 'no_show', 'completed'].includes(booking.status)) ||
    (booking.status === 'pending_approval' && hasNoAssignedStaff) ||
    (booking.status === 'needs_owner_action' && !booking.proposedStaffId)
  );
}

function isStaffAbsentDuringBooking(
  staffId: string,
  booking: FirestoreBooking,
  absencesByStaff: Record<string, StaffAbsence[]>,
): boolean {
  const { hours, minutes } = parseTime(booking.startTime);
  const bookingStart = hours * 60 + minutes;
  const bookingEnd = bookingStart + Math.max(booking.totalDurationMinutes, 1);

  return (absencesByStaff[staffId] ?? []).some((absence) => {
    if (absence.absenceDate !== booking.appointmentDate) return false;
    if (absence.isFullDay) return true;
    if (!absence.startTime || !absence.endTime) return true;

    const absenceStartTime = parseTime(absence.startTime);
    const absenceEndTime = parseTime(absence.endTime);
    const absenceStart = absenceStartTime.hours * 60 + absenceStartTime.minutes;
    const absenceEnd = absenceEndTime.hours * 60 + absenceEndTime.minutes;
    return bookingStart < absenceEnd && bookingEnd > absenceStart;
  });
}

function getPeakConcurrentBookingCount(bookings: FirestoreBooking[]): number {
  const events = bookings.flatMap((booking) => {
    const { hours, minutes } = parseTime(booking.startTime);
    const startMinutes = hours * 60 + minutes;
    return [
      { time: startMinutes, delta: 1 },
      { time: startMinutes + booking.totalDurationMinutes, delta: -1 },
    ];
  }).sort((left, right) => left.time - right.time || left.delta - right.delta);

  let concurrentBookings = 0;
  let peakConcurrentBookings = 0;
  events.forEach((event) => {
    concurrentBookings += event.delta;
    peakConcurrentBookings = Math.max(peakConcurrentBookings, concurrentBookings);
  });
  return peakConcurrentBookings;
}

function getBookingDisplayCode(booking: FirestoreBooking): string {
  const explicitCode = booking.bookingCode?.trim();
  if (explicitCode) return explicitCode;

  const compactId = booking.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return compactId ? `BK-${compactId}` : 'BK';
}

function getBookingGroupKey(booking: FirestoreBooking): string {
  const bookingId = booking.bookingId?.trim();
  return bookingId ? `booking:${bookingId}` : `attendance:${booking.id}`;
}

const DEFAULT_CALENDAR_START_HOUR = 8;
const DEFAULT_CALENDAR_END_HOUR = 20;
const HOUR_HEIGHT = 72;

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

/**
 * Keep every segment of one customer booking in the same visual lane inside
 * the Request column. The normal overlap layout recalculates lanes for every
 * time cluster, which can make two consecutive segments swap colours/columns.
 */
function computeRequestGroupedLayout(bookings: FirestoreBooking[]): { booking: FirestoreBooking; left: number; width: number }[] {
  if (bookings.length === 0) return [];

  const groups = new Map<string, {
    key: string;
    start: number;
    end: number;
    bookings: FirestoreBooking[];
    lane: number;
    laneCount: number;
  }>();

  bookings.forEach((booking) => {
    const { hours, minutes } = parseTime(booking.startTime);
    const start = hours * 60 + minutes;
    const end = start + booking.totalDurationMinutes;
    const key = getBookingGroupKey(booking);
    const group = groups.get(key);
    if (group) {
      group.start = Math.min(group.start, start);
      group.end = Math.max(group.end, end);
      group.bookings.push(booking);
      return;
    }
    groups.set(key, { key, start, end, bookings: [booking], lane: 0, laneCount: 1 });
  });

  const sortedGroups = [...groups.values()].sort((left, right) =>
    left.start - right.start ||
    right.end - left.end ||
    left.key.localeCompare(right.key),
  );
  const clusters: Array<typeof sortedGroups> = [];
  let currentCluster: typeof sortedGroups = [];
  let currentClusterEnd = -1;

  sortedGroups.forEach((group) => {
    if (currentCluster.length === 0 || group.start < currentClusterEnd) {
      currentCluster.push(group);
      currentClusterEnd = Math.max(currentClusterEnd, group.end);
      return;
    }
    clusters.push(currentCluster);
    currentCluster = [group];
    currentClusterEnd = group.end;
  });
  if (currentCluster.length > 0) clusters.push(currentCluster);

  clusters.forEach((cluster) => {
    const laneEnds: number[] = [];
    cluster.forEach((group) => {
      const reusableLane = laneEnds.findIndex((laneEnd) => group.start >= laneEnd);
      group.lane = reusableLane >= 0 ? reusableLane : laneEnds.length;
      if (reusableLane >= 0) laneEnds[reusableLane] = group.end;
      else laneEnds.push(group.end);
    });
    cluster.forEach((group) => { group.laneCount = laneEnds.length; });
  });

  return sortedGroups.flatMap((group) => {
    const width = 100 / group.laneCount;
    const left = group.lane * width;
    return group.bookings.map((booking) => ({ booking, left, width }));
  });
}

function mapAttendanceItemsToBookings(
  items: AdminAttendanceItem[],
  locale: string,
  catalogServices: Array<HrmService & { categoryId: string }>,
): FirestoreBooking[] {
  const serviceById = new Map(catalogServices.map((service) => [service.id, service]));

  return items.flatMap((item): FirestoreBooking[] => {
    let serviceStartMinutes = item.startTime;
    const services = item.services.length > 0 ? item.services : [{
      id: item.id,
      name: locale === 'vi' ? 'Dịch vụ' : 'Service',
      amount: String(item.totalAmount),
      durationMin: Math.max(item.endTime - item.startTime, 1),
      durationMax: Math.max(item.endTime - item.startTime, 1),
      employees: [],
    }];

    return services.map((service, serviceIndex) => {
      const remainingMinutes = Math.max(item.endTime - serviceStartMinutes, 1);
      const durationMinutes = Math.min(
        Math.max(service.durationMax ?? service.durationMin ?? remainingMinutes, 1),
        remainingMinutes,
      );
      const segmentStartMinutes = serviceStartMinutes;
      serviceStartMinutes += durationMinutes;
      const assignedEmployee = service.employees[0];
      const staffId = assignedEmployee?.employeeId || item.mainAssigneeUserId || item.employeeUserId;
      const staffName = assignedEmployee?.employeeName ??
        item.services
          .flatMap((candidate) => candidate.employees)
          .find((employee) => employee.employeeId === staffId)
          ?.employeeName ?? '';
      const catalogService = service.sourceServiceId
        ? serviceById.get(service.sourceServiceId)
        : undefined;

      return {
        id: `${item.id}:${service.id}:${serviceIndex}`,
        attendanceId: item.id,
        bookingId: item.bookingId,
        bookingCode: item.attendanceCode ?? (item.bookingId
          ? `BK-${item.bookingId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`
          : undefined),
        customerName: item.customerName,
        customerPhone: item.customerPhone,
        services: [{
          serviceId: service.sourceServiceId ?? service.id,
          serviceName: catalogService?.displayName?.trim() || catalogService?.name || service.name,
          durationMinutes,
          price: Number(service.amount) || 0,
        }],
        addOns: serviceIndex === 0 ? item.addOns?.map((addOn) => {
          const catalogAddOn = addOn.sourceServiceId
            ? serviceById.get(addOn.sourceServiceId)
            : undefined;
          return {
            serviceId: addOn.sourceServiceId ?? addOn.id,
            name: catalogAddOn?.displayName?.trim() || catalogAddOn?.name || addOn.name,
          };
        }) : undefined,
        staffId,
        staffName,
        staffSelectionType: item.staffSelectionType,
        requestedStaffId: item.requestedEmployeeUserId,
        requestedStaffName: item.requestedEmployeeName,
        conflictStaffId: item.conflictEmployeeUserId,
        conflictStaffName: item.conflictEmployeeName,
        proposedStaffId: item.proposedAssigneeUserId,
        proposedStaffName: item.proposedAssigneeName,
        appointmentDate: item.workDate,
        startTime: `${Math.floor(segmentStartMinutes / 60).toString().padStart(2, '0')}:${(segmentStartMinutes % 60).toString().padStart(2, '0')}`,
        totalPrice: Number(service.amount) || 0,
        totalDurationMinutes: durationMinutes,
        status: item.bookingStatus,
        originatedAsRequest: item.originatedAsRequest,
        source: item.source,
        createdAt: item.workDate,
        updatedByUserId: item.updatedByUserId,
        updatedByRole: item.updatedByRole,
        updatedByName: item.updatedByName,
      };
    });
  });
}

// ===== Component =====
export default function BookingsManagementPage() {
  const router = useRouter();
  const { user, activeBranch } = useAuth();
  const { t, locale } = useI18n();
  const { getServiceName: translateService, getCategoryName: translateCategory } = useServiceTranslation();
  const [bookings, setBookings] = useState<FirestoreBooking[]>([]);
  const [realStaffList, setRealStaffList] = useState<{ id: string; name: string; status: string; serviceIds?: string[]; staffType?: string }[]>([]);
  const [staffAbsences, setStaffAbsences] = useState<Record<string, StaffAbsence[]>>({});
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('calendar');
  const [staffCalendarScope, setStaffCalendarScope] = useState<'day' | 'week'>('day');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBookings, setSearchBookings] = useState<FirestoreBooking[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [futureIssuesMode, setFutureIssuesMode] = useState(false);
  const [copiedBookingId, setCopiedBookingId] = useState<string | null>(null);
  const [hoveredBookingGroupKey, setHoveredBookingGroupKey] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => getStartOfWeek(getGermanDateObject()));
  const [selectedDate, setSelectedDate] = useState(() => getGermanTodayString());
  const [popover, setPopover] = useState<{
    booking: FirestoreBooking;
  } | null>(null);
  const [popoverAnchorEl, setPopoverAnchorEl] = useState<HTMLElement | null>(null);

  // Walk-in booking modal state
  const [showNewBookingModal, setShowNewBookingModal] = useState(false);
  const [newBookingStaffId, setNewBookingStaffId] = useState('');
  const [newBookingStaffName, setNewBookingStaffName] = useState('');
  const [newBookingTime, setNewBookingTime] = useState('09:00');
  const [newBookingCustomerName, setNewBookingCustomerName] = useState('');
  const [newBookingCustomerPhone, setNewBookingCustomerPhone] = useState('');
  const [newBookingNotes, setNewBookingNotes] = useState('');
  const [newBookingServices, setNewBookingServices] = useState<{categoryId: string; categoryName: string; serviceId: string; serviceName: string; duration: number; price: number}[]>([]);
  const [newBookingCreating, setNewBookingCreating] = useState(false);
  const [showBookingPurgeModal, setShowBookingPurgeModal] = useState(false);
  const [bookingPurgePreview, setBookingPurgePreview] = useState<BookingPurgePreview | null>(null);
  const [bookingPurgeLoading, setBookingPurgeLoading] = useState(false);
  const [bookingPurgeDeleting, setBookingPurgeDeleting] = useState(false);
  const [bookingPurgeError, setBookingPurgeError] = useState('');
  const [bookingPurgeConfirmation, setBookingPurgeConfirmation] = useState('');
  const [bookingPurgeDeletedCount, setBookingPurgeDeletedCount] = useState<number | null>(null);
  // Quick 2-tap booking popup state
  const [quickBookPopup, setQuickBookPopup] = useState<{
    staffId: string;
    staffName: string;
    timeStr: string;
    anchorRect: { top: number; left: number; bottom: number; width: number };
    isUpward: boolean;
  } | null>(null);
  const [allCategories, setAllCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [allServices, setAllServices] = useState<Array<HrmService & { categoryId: string }>>([]);
  const isManagerOrOwner = user?.role !== 'staff';
  const isOwner = user?.role === 'owner';
  const normalizedSearchQuery = searchQuery.trim();
  const isGlobalSearchActive = normalizedSearchQuery.length >= 2;

  // Apply route intent from dashboard, employee attendance and status banners.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const requestedView = searchParams.get('view');
      if (requestedView === 'list' || requestedView === 'calendar') setViewMode(requestedView);
      const requestedDate = searchParams.get('date');
      if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? '')) setSelectedDate(requestedDate as string);
      const requestedStatus = searchParams.get('status');
      if (['all', 'request', 'pending_approval', 'confirmed', 'cancelled', 'needs_owner_action'].includes(requestedStatus ?? '')) {
        setFilter(requestedStatus as FilterStatus);
      }
      const requestedSource = searchParams.get('source');
      if (['all', 'online_booking', 'owner_created'].includes(requestedSource ?? '')) {
        setSourceFilter(requestedSource as SourceFilter);
      }
      setFutureIssuesMode(searchParams.get('scope') === 'future');
      if (searchParams.get('new') === '1' && ['owner', 'manager'].includes(user?.role ?? '')) {
        setShowNewBookingModal(true);
        // Clear param so it doesn't reopen on refresh
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [user]);

  const refreshCanonicalCalendar = useCallback(async () => {
    const storeId = activeBranch || user?.assignedBranches?.[0];
    if (!storeId) return;
    const futureEndDate = formatDateLocal(addDays(getGermanDateObject(), 90));
    const fromDate = futureIssuesMode
      ? getGermanTodayString()
      : user?.role === 'staff' && staffCalendarScope === 'week'
      ? formatDateLocal(weekStart)
      : selectedDate;
    const toDate = futureIssuesMode
      ? futureEndDate
      : user?.role === 'staff' && staffCalendarScope === 'week'
      ? formatDateLocal(addDays(weekStart, 6))
      : selectedDate;
    const items = await fetchAdminAttendanceCalendar(storeId, fromDate, toDate);
    setBookings(mapAttendanceItemsToBookings(items, locale, allServices));
  }, [activeBranch, allServices, futureIssuesMode, locale, selectedDate, staffCalendarScope, user, weekStart]);

  const bookingPurgePhrase = locale === 'vi'
    ? 'XÓA TẤT CẢ'
    : locale === 'de'
      ? 'ALLE LÖSCHEN'
      : 'DELETE ALL';

  const openBookingPurgeModal = async () => {
    if (!isOwner) return;
    const storeId = activeBranch || user?.assignedBranches?.[0];
    if (!storeId) return;

    setShowBookingPurgeModal(true);
    setBookingPurgePreview(null);
    setBookingPurgeConfirmation('');
    setBookingPurgeDeletedCount(null);
    setBookingPurgeError('');
    setBookingPurgeLoading(true);
    try {
      setBookingPurgePreview(await fetchBookingPurgePreview(storeId));
    } catch (error: unknown) {
      setBookingPurgeError(error instanceof Error ? error.message : 'Could not inspect Booking data');
    } finally {
      setBookingPurgeLoading(false);
    }
  };

  const handleDeleteAllBookingData = async () => {
    if (!isOwner || bookingPurgeConfirmation.trim() !== bookingPurgePhrase) return;
    const storeId = activeBranch || user?.assignedBranches?.[0];
    if (!storeId) return;

    setBookingPurgeDeleting(true);
    setBookingPurgeError('');
    try {
      const result = await deleteAllAdminBookingData(storeId);
      setBookingPurgeDeletedCount(result.bookingCount);
      setBookingPurgePreview({
        ...result,
        bookingCount: 0,
        attendanceSegmentCount: 0,
        slotReservationCount: 0,
        workDateCount: 0,
        workDates: [],
      });
      setBookingPurgeConfirmation('');
      setBookings([]);
      setSearchBookings([]);
      setPopover(null);
      setPopoverAnchorEl(null);
    } catch (error: unknown) {
      setBookingPurgeError(error instanceof Error ? error.message : 'Could not delete Booking data');
    } finally {
      setBookingPurgeDeleting(false);
    }
  };

  // Canonical attendance sync from the HRM backend.
  useEffect(() => {
    if (!user) return;
    const storeId = activeBranch || user.assignedBranches?.[0];
    if (!storeId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    refreshCanonicalCalendar()
      .catch((error: unknown) => {
        console.error('Could not load canonical attendance calendar:', error);
        if (active) setBookings([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user, activeBranch, refreshCanonicalCalendar]);

  // 19/08: search is store-wide, not restricted to the currently selected
  // calendar date. The backend performs the all-date lookup on demand.
  useEffect(() => {
    const storeId = activeBranch || user?.assignedBranches?.[0];
    if (!storeId || !isGlobalSearchActive) {
      setSearchBookings([]);
      setSearchLoading(false);
      setSearchError('');
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError('');
      searchAdminAttendances(storeId, normalizedSearchQuery)
        .then((items) => {
          if (active) setSearchBookings(mapAttendanceItemsToBookings(items, locale, allServices));
        })
        .catch((error: unknown) => {
          console.error('Could not search all booking dates:', error);
          if (active) {
            setSearchBookings([]);
            setSearchError(locale === 'vi' ? 'Không thể tìm kiếm toàn bộ lịch.' : 'Could not search all bookings.');
          }
        })
        .finally(() => {
          if (active) setSearchLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [activeBranch, allServices, isGlobalSearchActive, locale, normalizedSearchQuery, user]);

  // Staff, services, categories and leave blocks all come from the current HRM data source.
  useEffect(() => {
    const storeId = activeBranch || user?.assignedBranches?.[0];
    if (!storeId) return;
    let active = true;
    Promise.all([
      isManagerOrOwner ? fetchAdminEmployees(storeId) : fetchHrmStaff(storeId),
      fetchHrmServices(storeId),
      Promise.all((user?.role === 'staff' && staffCalendarScope === 'week'
        ? Array.from({ length: 7 }, (_, index) => formatDateLocal(addDays(weekStart, index)))
        : [selectedDate]
      ).map((date) => fetchHrmAvailability(storeId, date))),
    ]).then(([staff, services, availabilityDays]) => {
      if (!active) return;
      setRealStaffList(staff.map((item) => ({
        id: 'uid' in item ? item.uid : item.id,
        name: item.name,
        status: 'status' in item ? item.status : 'active',
        serviceIds: item.serviceIds,
        staffType: item.workerType,
      })));
      const mappedServices = services.map((service) => ({
        ...service,
        categoryId: service.category || 'other',
      }));
      setAllServices(mappedServices);
      setAllCategories(
        [...new Set(mappedServices.map((service) => service.categoryId))]
          .map((categoryId) => ({ id: categoryId, name: categoryId })),
      );
      const absenceMap: Record<string, StaffAbsence[]> = {};
      for (const day of availabilityDays) {
        for (const absence of day.absences) {
          absenceMap[absence.employeeUserId] = [
            ...(absenceMap[absence.employeeUserId] ?? []),
            {
              ...absence,
              absenceDate: day.date,
              isFullDay: absence.allDay,
            },
          ];
        }
      }
      setStaffAbsences(absenceMap);
    }).catch((error: unknown) => {
      console.error('Could not load HRM calendar options:', error);
    });
    return () => { active = false; };
  }, [user, activeBranch, isManagerOrOwner, selectedDate, staffCalendarScope, weekStart]);

  // Handlers
  const handleApprove = async (id: string): Promise<boolean> => {
    if (!user) return false;
    const storeId = activeBranch || user.assignedBranches?.[0];
    if (!storeId) return false;
    if (!window.confirm(locale === 'vi'
      ? 'Xác nhận phê duyệt booking này? Booking vẫn được giữ trong cột Yêu cầu.'
      : 'Approve this booking? It will remain in the Request column.')) return false;
    try {
      const attendanceId = bookings.find((booking) => booking.id === id)?.attendanceId ?? id;
      await updateAdminAttendanceStatus(storeId, attendanceId, 'confirmed');
      await refreshCanonicalCalendar();
      return true;
    } catch (error: unknown) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : (locale === 'vi' ? 'Không thể duyệt yêu cầu.' : 'Could not approve request.'));
      return false;
    }
  };

  const handleReject = async (id: string): Promise<boolean> => {
    if (!user) return false;
    const storeId = activeBranch || user.assignedBranches?.[0];
    if (!storeId) return false;
    if (!window.confirm(locale === 'vi'
      ? 'Xác nhận hủy booking này?'
      : 'Cancel this booking?')) return false;
    try {
      const targetBooking = bookings.find((booking) => booking.id === id);
      const attendanceId = targetBooking?.attendanceId ?? id;
      await updateAdminAttendanceStatus(storeId, attendanceId, 'cancelled');
      const targetBookingId = targetBooking?.bookingId;
      setBookings((current) =>
        current.map((booking) =>
          booking.id === id || (targetBookingId && booking.bookingId === targetBookingId)
            ? { ...booking, status: 'cancelled' }
            : booking,
        ),
      );
      return true;
    } catch (error: unknown) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : 'Could not cancel booking');
      return false;
    }
  };

  const handleLifecycleStatus = async (
    id: string,
    status: 'completed' | 'no_show',
  ): Promise<boolean> => {
    if (!user) return false;
    const storeId = activeBranch || user.assignedBranches?.[0];
    if (!storeId) return false;
    const confirmationText = status === 'completed'
      ? (locale === 'vi' ? 'Xác nhận hoàn thành dịch vụ này?' : 'Mark this service completed?')
      : (locale === 'vi' ? 'Xác nhận khách không đến?' : 'Mark this customer as no-show?');
    if (!window.confirm(confirmationText)) return false;
    try {
      const attendanceId = bookings.find((booking) => booking.id === id)?.attendanceId ?? id;
      await updateAdminAttendanceStatus(storeId, attendanceId, status);
      await refreshCanonicalCalendar();
      return true;
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not update booking');
      return false;
    }
  };

  const handleReassignStaff = async (bookingId: string, staffId: string, staffName: string) => {
    if (!user) return;
    const branchId = activeBranch || user.assignedBranches?.[0] || 'glamour-nails-berlin';

    // Find the booking being reassigned
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;

    const reassignmentMessage = booking.staffSelectionType === 'specific'
      ? (locale === 'vi'
        ? `Khách đã chọn đích danh ${booking.requestedStaffName || booking.staffName || 'một thợ'}. Hãy gọi cho khách trước khi đổi sang ${staffName}. Bạn xác nhận đã trao đổi và muốn tiếp tục?`
        : `The customer selected ${booking.requestedStaffName || booking.staffName || 'a specific employee'}. Call the customer before changing to ${staffName}. Continue?`)
      : (locale === 'vi'
        ? `Xác nhận gán dịch vụ này cho ${staffName}?`
        : `Assign this service to ${staffName}?`);
    if (!window.confirm(reassignmentMessage)) return;

    // 1. Check if staff is on leave on the booking date
    const absences = staffAbsences[staffId] || [];
    const dateAbsences = absences.filter((abs: StaffAbsence) => abs.absenceDate === booking.appointmentDate);

    if (dateAbsences.length > 0) {
      for (const abs of dateAbsences) {
        if (abs.isFullDay) {
          const msg = locale === 'vi'
            ? `⚠️ ${staffName} đang nghỉ phép cả ngày ${booking.appointmentDate}. Không thể chuyển lịch sang thợ này.`
            : locale === 'de'
            ? `⚠️ ${staffName} hat am ${booking.appointmentDate} ganztägig frei. Zuweisung nicht möglich.`
            : `⚠️ ${staffName} is on full-day leave on ${booking.appointmentDate}. Cannot reassign.`;
          alert(msg);
          return;
        }
        // Partial leave — check time overlap
        if (abs.startTime && abs.endTime) {
          const [absStartH, absStartM] = abs.startTime.split(':').map(Number);
          const [absEndH, absEndM] = abs.endTime.split(':').map(Number);
          const absStart = absStartH * 60 + absStartM;
          const absEnd = absEndH * 60 + absEndM;

          const [bStartH, bStartM] = booking.startTime.split(':').map(Number);
          const bStart = bStartH * 60 + bStartM;
          const bEnd = bStart + (booking.totalDurationMinutes || 30);

          if (bStart < absEnd && bEnd > absStart) {
            const msg = locale === 'vi'
              ? `⚠️ ${staffName} đang nghỉ phép từ ${abs.startTime} đến ${abs.endTime} ngày ${booking.appointmentDate}. Lịch hẹn ${booking.startTime} bị trùng.`
              : locale === 'de'
              ? `⚠️ ${staffName} ist von ${abs.startTime} bis ${abs.endTime} am ${booking.appointmentDate} abwesend. Termin ${booking.startTime} kollidiert.`
              : `⚠️ ${staffName} is on leave ${abs.startTime}-${abs.endTime} on ${booking.appointmentDate}. Booking at ${booking.startTime} conflicts.`;
            alert(msg);
            return;
          }
        }
      }
    }

    // 2. Check if staff already has a booking at the same time
    const conflictBooking = booking.status === 'pending_approval' ? undefined : bookings.find(b =>
      b.id !== bookingId &&
      b.staffId === staffId &&
      b.appointmentDate === booking.appointmentDate &&
      b.status !== 'cancelled'
    );
    if (conflictBooking) {
      const [cStartH, cStartM] = conflictBooking.startTime.split(':').map(Number);
      const cStart = cStartH * 60 + cStartM;
      const cEnd = cStart + (conflictBooking.totalDurationMinutes || 30);

      const [bStartH, bStartM] = booking.startTime.split(':').map(Number);
      const bStart = bStartH * 60 + bStartM;
      const bEnd = bStart + (booking.totalDurationMinutes || 30);

      if (bStart < cEnd && bEnd > cStart) {
        const msg = locale === 'vi'
          ? `⚠️ ${staffName} đã có lịch hẹn khác lúc ${conflictBooking.startTime} ngày ${booking.appointmentDate}. Bạn có muốn chuyển không?`
          : locale === 'de'
          ? `⚠️ ${staffName} hat bereits einen Termin um ${conflictBooking.startTime} am ${booking.appointmentDate}. Trotzdem zuweisen?`
          : `⚠️ ${staffName} already has a booking at ${conflictBooking.startTime} on ${booking.appointmentDate}. Reassign anyway?`;
        if (!confirm(msg)) return;
      }
    }

    try {
      await reassignAdminAttendance(branchId, booking.attendanceId, staffId);
      await refreshCanonicalCalendar();
    } catch (e) {
      console.error('Error reassigning staff:', e);
      alert(e instanceof Error ? e.message : 'Could not reassign staff');
    }
  };

  const handleClaimBooking = async (booking: FirestoreBooking) => {
    if (!user?.staffId) return;
    const branchId = activeBranch || user.assignedBranches?.[0];
    if (!branchId) return;
    const remainsPendingOwnerApproval = booking.status === 'needs_owner_action';
    if (!window.confirm(locale === 'vi'
      ? remainsPendingOwnerApproval
        ? `Nhận dịch vụ “${getServiceName(booking)}” làm thợ thay? Lịch vẫn chờ chủ tiệm xác nhận.`
        : `Nhận dịch vụ “${getServiceName(booking)}” cho mình? Booking sẽ tự động được xác nhận.`
      : remainsPendingOwnerApproval
        ? `Claim “${getServiceName(booking)}” as the replacement? The owner must still confirm it.`
        : `Claim “${getServiceName(booking)}”? The booking will be confirmed automatically.`)) return;
    try {
      await reassignAdminAttendance(branchId, booking.attendanceId, user.staffId);
      await refreshCanonicalCalendar();
      setPopover(null);
      setPopoverAnchorEl(null);
    } catch (error: unknown) {
      window.alert(error instanceof Error
        ? error.message
        : (locale === 'vi' ? 'Không thể nhận lịch này.' : 'Could not claim this booking.'));
      await refreshCanonicalCalendar();
    }
  };

  // Derived data
  const bookingsForRole = useMemo(() => bookings.filter(b => {
    if (user?.role === 'staff') {
      const isOwnBooking = b.staffId === user.staffId || b.proposedStaffId === user.staffId;
      const isSharedRequest = b.originatedAsRequest === true &&
        !['cancelled', 'no_show'].includes(b.status);
      const isSharedLeaveConflict = b.status === 'needs_owner_action';
      return isOwnBooking || isSharedRequest || isSharedLeaveConflict ||
        isClaimableUnassignedBooking(b);
    }
    return true;
  }), [bookings, user]);

  const staffList = useMemo(() => {
    return realStaffList.map(s => ({ id: s.id, name: s.name, status: s.status }));
  }, [realStaffList]);

  const [staffFilterId, setStaffFilterId] = useState<string>('all');
  useEffect(() => {
    if (!isManagerOrOwner) return;
    const requestedEmployeeId = getRequestedEmployeeId();
    if (requestedEmployeeId && realStaffList.some((staff) => staff.id === requestedEmployeeId)) {
      setStaffFilterId(requestedEmployeeId);
    }
  }, [isManagerOrOwner, realStaffList]);
  const dayFilteredBookings = useMemo(() => {
    let list = isGlobalSearchActive
      ? [...searchBookings]
      : bookingsForRole.filter((booking) => futureIssuesMode
        ? booking.appointmentDate >= getGermanTodayString() && booking.status === 'needs_owner_action'
        : booking.appointmentDate === selectedDate);

    // Filter by staff
    if (staffFilterId !== 'all') {
      list = list.filter(b => b.staffId === staffFilterId);
    }

    list = list.filter((booking) => matchesSourceFilter(booking, sourceFilter));

    // Filter by status
    if (filter !== 'all') {
      list = filter === 'request'
        ? list.filter((booking) => booking.originatedAsRequest === true)
        : list.filter(b => b.status === filter);
    }

    // Sort by start time ascending
    return list.sort((a, b) => `${a.appointmentDate}-${a.startTime}`.localeCompare(`${b.appointmentDate}-${b.startTime}`));
  }, [bookingsForRole, filter, futureIssuesMode, isGlobalSearchActive, searchBookings, selectedDate, sourceFilter, staffFilterId]);

  const bookingIdentityByGroupKey = useMemo(() => {
    const identities = new Map<string, BookingGroupIdentity>();
    [...(isGlobalSearchActive ? searchBookings : bookingsForRole)]
      .sort((left, right) => (
        `${left.appointmentDate}-${left.startTime}-${getBookingGroupKey(left)}`
          .localeCompare(`${right.appointmentDate}-${right.startTime}-${getBookingGroupKey(right)}`)
      ))
      .forEach((booking) => {
        const groupKey = getBookingGroupKey(booking);
        if (!identities.has(groupKey)) identities.set(groupKey, getBookingGroupIdentity(identities.size));
      });
    return identities;
  }, [bookingsForRole, isGlobalSearchActive, searchBookings]);

  const selectedDayBookingsByGroupKey = useMemo(() => {
    const groups = new Map<string, FirestoreBooking[]>();
    (isGlobalSearchActive ? searchBookings : bookingsForRole)
      .filter((booking) => isGlobalSearchActive || (futureIssuesMode ? booking.appointmentDate >= getGermanTodayString() : booking.appointmentDate === selectedDate))
      .sort((left, right) => left.startTime.localeCompare(right.startTime))
      .forEach((booking) => {
        const groupKey = getBookingGroupKey(booking);
        const group = groups.get(groupKey) ?? [];
        group.push(booking);
        groups.set(groupKey, group);
      });
    return groups;
  }, [bookingsForRole, futureIssuesMode, isGlobalSearchActive, searchBookings, selectedDate]);

  const dayFilteredBookingGroups = useMemo<BookingListGroup[]>(() => {
    const groups = new Map<string, FirestoreBooking[]>();
    dayFilteredBookings.forEach((booking) => {
      const groupKey = getBookingGroupKey(booking);
      const group = groups.get(groupKey) ?? [];
      group.push(booking);
      groups.set(groupKey, group);
    });

    return [...groups.entries()].map(([key, visibleBookings]) => ({
      key,
      visibleBookings,
      allBookings: selectedDayBookingsByGroupKey.get(key) ?? visibleBookings,
    }));
  }, [dayFilteredBookings, selectedDayBookingsByGroupKey]);

  const dayNeedsActionCount = useMemo(
    () => bookingsForRole.filter(
      (booking) => booking.appointmentDate === selectedDate && booking.status === 'needs_owner_action',
    ).length,
    [bookingsForRole, selectedDate],
  );
  const dayRequestCount = useMemo(
    () => bookingsForRole.filter(
      (booking) => booking.appointmentDate === selectedDate &&
        booking.originatedAsRequest === true &&
        !['cancelled', 'no_show', 'completed'].includes(booking.status),
    ).length,
    [bookingsForRole, selectedDate],
  );
  const applyDayStatusFilter = useCallback((nextFilter: FilterStatus) => {
    setFutureIssuesMode(false);
    setFilter(nextFilter);
    setViewMode('list');

    if (typeof window === 'undefined') return;
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set('view', 'list');
    searchParams.set('status', nextFilter);
    searchParams.set('date', selectedDate);
    searchParams.delete('scope');
    window.history.replaceState({}, '', `${window.location.pathname}?${searchParams.toString()}`);
  }, [selectedDate]);
  const renderAttentionSummary = () => (
    isManagerOrOwner && (dayRequestCount > 0 || dayNeedsActionCount > 0) ? (
      <div className={styles.attentionSummaryRow}>
        {dayRequestCount > 0 && (
          <button type="button" className={styles.attentionSummaryButton} onClick={() => applyDayStatusFilter('request')}>
            <span className={styles.attentionSummaryCount}>{dayRequestCount}</span>
            <span>{locale === 'vi' ? 'Yêu cầu' : 'Requests'}</span>
          </button>
        )}
        {dayNeedsActionCount > 0 && (
          <button type="button" className={styles.attentionSummaryButton} onClick={() => applyDayStatusFilter('needs_owner_action')}>
            <span className={styles.attentionSummaryCount}>{dayNeedsActionCount}</span>
            <span>{locale === 'vi' ? 'Cần xử lý' : 'Needs action'}</span>
          </button>
        )}
      </div>
    ) : null
  );
  const popoverBookingGroup = useMemo(() => {
    if (!popover) return [];
    if (!popover.booking.bookingId) return [popover.booking];
    return bookings
      .filter((booking) => booking.bookingId === popover.booking.bookingId)
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  }, [bookings, popover]);
  const popoverBookingSummary = useMemo(() => {
    if (popoverBookingGroup.length === 0) return undefined;
    const startMinutes = Math.min(...popoverBookingGroup.map((booking) => {
      const { hours, minutes } = parseTime(booking.startTime);
      return hours * 60 + minutes;
    }));
    const endMinutes = Math.max(...popoverBookingGroup.map((booking) => {
      const { hours, minutes } = parseTime(booking.startTime);
      return hours * 60 + minutes + booking.totalDurationMinutes;
    }));
    const formatMinutes = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return {
      startTime: formatMinutes(startMinutes),
      endTime: formatMinutes(endMinutes),
      durationMinutes: Math.max(endMinutes - startMinutes, 1),
    };
  }, [popoverBookingGroup]);
  const handleCopyBookingCode = useCallback(async (booking: FirestoreBooking) => {
    const bookingCode = getBookingDisplayCode(booking);
    try {
      await navigator.clipboard.writeText(bookingCode);
      setCopiedBookingId(booking.id);
      window.setTimeout(() => {
        setCopiedBookingId((current) => current === booking.id ? null : current);
      }, 1400);
    } catch (error) {
      console.error('Could not copy booking code:', error);
    }
  }, []);

  /** Translate a single service item: "CategoryName – ServiceName" */
  const translateServiceItem = useCallback((s: BookingServiceItem | string): string => {
    if (typeof s === 'string') {
      // Old format: plain string like "Natur" or "Natur + Design / Extra"
      return s;
    }
    if (typeof s === 'object' && s !== null) {
      // New format: object with serviceId, categoryId, serviceName, categoryName
      const compactCatalogName = allServices.find((service) => service.id === s.serviceId)?.displayName?.trim();
      const svcName = compactCatalogName || (s.serviceId
        ? translateService(s.serviceId, s.serviceName || s.name || '')
        : (s.serviceName || s.name || ''));
      const catName = s.categoryId
        ? translateCategory(s.categoryId, s.categoryName || '')
        : (s.categoryName || '');

      // Build extras suffix
      let extrasSuffix = '';
      if (s.extras && Array.isArray(s.extras) && s.extras.length > 0) {
        const extrasNames = s.extras.map((e: BookingServiceExtra) =>
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
  }, [allServices, translateService, translateCategory]);

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

  const getStatusLabel = useCallback((status: string) => {
    switch (status) {
      case 'pending_approval': return t.admin.bookings.statusPending;
      case 'confirmed': return t.admin.bookings.statusConfirmed;
      case 'cancelled': return t.admin.bookings.statusCancelled;
      case 'needs_owner_action': return t.admin.bookings.statusNeedsAction || 'Cần xử lý';
      case 'completed': return t.admin.bookings.statusCompleted || 'Đã hoàn thành';
      case 'no_show': return locale === 'vi' ? 'Không đến' : locale === 'de' ? 'Nicht erschienen' : 'No-show';
      default: return status;
    }
  }, [locale, t]);

  const getUpdateActorLabel = useCallback((booking: FirestoreBooking) => {
    if (booking.updatedByName?.trim()) return booking.updatedByName.trim();
    if (booking.updatedByRole === 'customer') return locale === 'vi' ? 'Khách hàng' : 'Customer';
    if (booking.updatedByRole === 'employee') {
      return realStaffList.find((staff) => staff.id === booking.updatedByUserId)?.name ||
        (locale === 'vi' ? 'Nhân viên' : 'Employee');
    }
    if (booking.updatedByRole === 'manager') return locale === 'vi' ? 'Quản lý' : 'Manager';
    if (booking.updatedByRole === 'owner') return locale === 'vi' ? 'Chủ tiệm' : 'Owner';
    return locale === 'vi' ? 'Hệ thống' : 'System';
  }, [locale, realStaffList]);

  // Walk-in booking: open modal with pre-filled staff + time
  const openNewBookingModal = useCallback((staffId: string, staffName: string, timeStr: string) => {
    // Block if staff is inactive
    if (staffId) {
      const staff = realStaffList.find(s => s.id === staffId);
      if (staff && staff.status !== 'active') {
        const msg = locale === 'vi' ? `⚠️ ${staffName} đang nghỉ việc, không thể đặt lịch.`
          : locale === 'de' ? `⚠️ ${staffName} ist inaktiv.`
          : `⚠️ ${staffName} is inactive.`;
        alert(msg);
        return;
      }
      // Block if staff is on leave at selected date/time
      const absences = staffAbsences[staffId] || [];
      const dateAbsences = absences.filter((abs: StaffAbsence) => abs.absenceDate === selectedDate);
      for (const abs of dateAbsences) {
        if (abs.isFullDay) {
          const msg = locale === 'vi' ? `⚠️ ${staffName} nghỉ phép cả ngày ${selectedDate}.`
            : locale === 'de' ? `⚠️ ${staffName} hat am ${selectedDate} ganztägig frei.`
            : `⚠️ ${staffName} is on full-day leave on ${selectedDate}.`;
          alert(msg);
          return;
        }
        if (abs.startTime && abs.endTime) {
          const [absStartH, absStartM] = abs.startTime.split(':').map(Number);
          const [absEndH, absEndM] = abs.endTime.split(':').map(Number);
          const absStart = absStartH * 60 + absStartM;
          const absEnd = absEndH * 60 + absEndM;
          const [clickH, clickM] = timeStr.split(':').map(Number);
          const clickMin = clickH * 60 + clickM;
          if (clickMin >= absStart && clickMin < absEnd) {
            const msg = locale === 'vi' ? `⚠️ ${staffName} nghỉ phép ${abs.startTime}-${abs.endTime}. Không thể đặt lúc ${timeStr}.`
              : locale === 'de' ? `⚠️ ${staffName} ist ${abs.startTime}-${abs.endTime} abwesend.`
              : `⚠️ ${staffName} is on leave ${abs.startTime}-${abs.endTime}.`;
            alert(msg);
            return;
          }
        }
      }
    }
    setNewBookingStaffId(staffId);
    setNewBookingStaffName(staffName);
    setNewBookingTime(timeStr);
    setNewBookingCustomerName('');
    setNewBookingCustomerPhone('');
    setNewBookingNotes('');
    setNewBookingServices([]);
    setShowNewBookingModal(true);
  }, [realStaffList, staffAbsences, selectedDate, locale]);

  useEffect(() => {
    const openManualBooking = () => {
      if (['owner', 'manager'].includes(user?.role ?? '')) {
        openNewBookingModal('', '', '09:00');
      }
    };

    window.addEventListener('timmo:open-manual-booking', openManualBooking);
    return () => window.removeEventListener('timmo:open-manual-booking', openManualBooking);
  }, [user?.role, openNewBookingModal]);

  // ── Quick 2-tap booking: open small popup at slot ──
  const openQuickBookPopup = useCallback((staffId: string, staffName: string, timeStr: string, e: React.MouseEvent) => {
    // Same validation as openNewBookingModal
    if (staffId) {
      const staff = realStaffList.find(s => s.id === staffId);
      if (staff && staff.status !== 'active') {
        alert(locale === 'vi' ? `⚠️ ${staffName} đang nghỉ việc.` : `⚠️ ${staffName} is inactive.`);
        return;
      }
      const absences = staffAbsences[staffId] || [];
      const dateAbsences = absences.filter((abs: StaffAbsence) => abs.absenceDate === selectedDate);
      for (const abs of dateAbsences) {
        if (abs.isFullDay) { alert(locale === 'vi' ? `⚠️ ${staffName} nghỉ phép cả ngày.` : `⚠️ ${staffName} is on full-day leave.`); return; }
        if (abs.startTime && abs.endTime) {
          const absStart = abs.startTime.split(':').map(Number).reduce((h: number, m: number, i: number) => i === 0 ? h * 60 : h + m, 0);
          const absEnd = abs.endTime.split(':').map(Number).reduce((h: number, m: number, i: number) => i === 0 ? h * 60 : h + m, 0);
          const clickMin = timeStr.split(':').map(Number).reduce((h: number, m: number, i: number) => i === 0 ? h * 60 : h + m, 0);
          if (clickMin >= absStart && clickMin < absEnd) { alert(locale === 'vi' ? `⚠️ ${staffName} nghỉ phép lúc ${timeStr}.` : `⚠️ On leave at ${timeStr}.`); return; }
        }
      }
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isUpward = rect.bottom + 180 > window.innerHeight; // if near bottom
    setQuickBookPopup({
      staffId,
      staffName,
      timeStr,
      anchorRect: { top: rect.top, left: rect.left, bottom: rect.bottom, width: rect.width },
      isUpward
    });
  }, [realStaffList, staffAbsences, selectedDate, locale]);

  // ── Quick create walk-in booking (60 or 120 min) ──
  const handleQuickCreate = useCallback(async (durationMinutes: number) => {
    if (!quickBookPopup || !user) return;
    const resolvedBranchId = activeBranch || user.assignedBranches?.[0] || '';
    if (!resolvedBranchId) return;
    const { staffId, timeStr } = quickBookPopup;
    if (!window.confirm(locale === 'vi'
      ? `Tạo lịch nhanh ${durationMinutes} phút lúc ${timeStr}?`
      : `Create a ${durationMinutes}-minute quick booking at ${timeStr}?`)) return;
    setQuickBookPopup(null);

    const svcName = durationMinutes === 60
      ? (locale === 'vi' ? '1 Dịch vụ' : locale === 'de' ? '1 Dienstleistung' : '1 Service')
      : (locale === 'vi' ? '2 Dịch vụ' : locale === 'de' ? '2 Dienstleistungen' : '2 Services');
    const bookingPayload = {
      customerName: locale === 'vi' ? 'Khách vãng lai' : locale === 'de' ? 'Laufkundschaft' : 'Walk-in',
      customerPhone: '',
      appointmentDate: selectedDate,
      startTime: timeStr,
      services: [{
        name: svcName,
        category: 'other',
        durationMinutes,
        price: 0,
        employeeUserId: staffId,
      }],
      source: selectedDate > getGermanTodayString()
        ? 'manual_booking' as const
        : 'walk_in' as const,
      quickBooking: true,
      notes: '',
    };
    try {
      await createAdminBooking(resolvedBranchId, bookingPayload);
      await refreshCanonicalCalendar();
    } catch (e) {
      console.error('Quick create error:', e);
      alert(e instanceof Error ? e.message : (locale === 'vi' ? 'Lỗi khi tạo lịch.' : 'Error creating booking.'));
    }
  }, [quickBookPopup, activeBranch, user, selectedDate, locale, refreshCanonicalCalendar]);

  const handleCreateWalkInBooking = useCallback(async () => {
    if (!user || newBookingServices.length === 0) {
      alert(t.admin.bookings.fillRequired || 'Please fill required fields');
      return;
    }
    if (user.role === 'staff' && selectedDate > getGermanTodayString()) {
      alert(locale === 'vi'
        ? 'Thợ chỉ được ghi nhận khách vãng lai trong ngày hiện tại hoặc ngày đã qua.'
        : 'Staff may only record walk-ins for today or a past day.');
      return;
    }

    if (!window.confirm(locale === 'vi'
      ? `Xác nhận tạo lịch ${newBookingTime} ngày ${selectedDate} với ${newBookingServices.length} dịch vụ?`
      : `Create this booking at ${newBookingTime} on ${selectedDate}?`)) return;

    // --- Validation 1: Staff service compatibility ---
    if (newBookingStaffId) {
      const staff = realStaffList.find(s => s.id === newBookingStaffId);
      if (staff && staff.serviceIds && staff.serviceIds.length > 0) {
        const incompatible = newBookingServices.filter(svc => !staff.serviceIds!.includes(svc.serviceId));
        if (incompatible.length > 0) {
          const names = incompatible.map(s => s.serviceName).join(', ');
          const msg = locale === 'vi' ? `⚠️ ${staff.name} không làm được dịch vụ: ${names}. Vui lòng chọn thợ khác hoặc bỏ dịch vụ này.`
            : locale === 'de' ? `⚠️ ${staff.name} kann folgende Services nicht: ${names}.`
            : `⚠️ ${staff.name} cannot perform: ${names}. Please choose another staff or remove the service.`;
          alert(msg);
          return;
        }
      }

      // --- Validation 2: Staff inactive ---
      if (staff && staff.status !== 'active') {
        const msg = locale === 'vi' ? `⚠️ ${staff.name} đang nghỉ việc.` : `⚠️ ${staff.name} is inactive.`;
        alert(msg);
        return;
      }

      // --- Validation 3: Staff on leave ---
      const absences = staffAbsences[newBookingStaffId] || [];
      const dateAbsences = absences.filter((abs: StaffAbsence) => abs.absenceDate === selectedDate);
      const totalDuration = newBookingServices.reduce((sum, s) => sum + s.duration, 0);
      const [startH, startM] = newBookingTime.split(':').map(Number);
      const bookStart = startH * 60 + startM;
      const bookEnd = bookStart + totalDuration;

      for (const abs of dateAbsences) {
        if (abs.isFullDay) {
          const msg = locale === 'vi' ? `⚠️ ${newBookingStaffName} nghỉ phép cả ngày ${selectedDate}.`
            : `⚠️ ${newBookingStaffName} is on full-day leave on ${selectedDate}.`;
          alert(msg);
          return;
        }
        if (abs.startTime && abs.endTime) {
          const [aH1, aM1] = abs.startTime.split(':').map(Number);
          const [aH2, aM2] = abs.endTime.split(':').map(Number);
          const absStart = aH1 * 60 + aM1;
          const absEnd = aH2 * 60 + aM2;
          if (bookStart < absEnd && bookEnd > absStart) {
            const msg = locale === 'vi' ? `⚠️ ${newBookingStaffName} nghỉ phép ${abs.startTime}-${abs.endTime}. Lịch ${newBookingTime} bị trùng.`
              : `⚠️ ${newBookingStaffName} is on leave ${abs.startTime}-${abs.endTime}. Conflicts with ${newBookingTime}.`;
            alert(msg);
            return;
          }
        }
      }

      // --- Validation 4: Time conflict with existing bookings ---
      const conflictBookings = bookings.filter(b =>
        b.staffId === newBookingStaffId &&
        b.appointmentDate === selectedDate &&
        b.status !== 'cancelled'
      );
      for (const cb of conflictBookings) {
        const [cH, cM] = cb.startTime.split(':').map(Number);
        const cStart = cH * 60 + cM;
        const cEnd = cStart + (cb.totalDurationMinutes || 30);
        if (bookStart < cEnd && bookEnd > cStart) {
          const msg = locale === 'vi'
            ? `⚠️ ${newBookingStaffName} đã có lịch lúc ${cb.startTime} (${cb.totalDurationMinutes}min). Bạn có muốn đặt trùng không?`
            : `⚠️ ${newBookingStaffName} has a booking at ${cb.startTime}. Overlap anyway?`;
          if (!confirm(msg)) return;
          break;
        }
      }
    }
    setNewBookingCreating(true);
    const branchId = activeBranch || user.assignedBranches?.[0] || 'glamour-nails-berlin';

    try {
      await createAdminBooking(branchId, {
        customerName: newBookingCustomerName.trim() || (
          locale === 'vi' ? 'Khách vãng lai' : locale === 'de' ? 'Laufkundschaft' : 'Walk-in'
        ),
        customerPhone: newBookingCustomerPhone.trim(),
        appointmentDate: selectedDate,
        startTime: newBookingTime,
        services: newBookingServices.map((service) => ({
          sourceServiceId: service.serviceId,
          name: service.serviceName,
          category: service.categoryId || 'other',
          durationMinutes: service.duration,
          price: service.price,
          employeeUserId: newBookingStaffId,
        })),
        source: user.role === 'staff'
          ? 'walk_in'
          : selectedDate > getGermanTodayString() ? 'manual_booking' : 'walk_in',
        notes: newBookingNotes.trim(),
      });

      setShowNewBookingModal(false);
      await refreshCanonicalCalendar();
      alert(t.admin.bookings.bookingCreated || 'Booking created!');
    } catch (err) {
      console.error('Error creating walk-in booking:', err);
      alert('Error creating booking');
    } finally {
      setNewBookingCreating(false);
    }
  }, [user, activeBranch, newBookingServices, newBookingCustomerName, newBookingCustomerPhone, newBookingNotes, newBookingTime, newBookingStaffId, newBookingStaffName, selectedDate, t, realStaffList, staffAbsences, bookings, locale, refreshCanonicalCalendar]);

  // Calendar
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const calendarVisibleBookings = useMemo(
    () => bookingsForRole.filter((booking) => booking.status !== 'cancelled' && booking.status !== 'no_show'),
    [bookingsForRole],
  );
  const selectedDateBookings = useMemo(
    () => calendarVisibleBookings.filter((booking) => booking.appointmentDate === selectedDate),
    [calendarVisibleBookings, selectedDate],
  );
  const calendarStartHour = useMemo(() => selectedDateBookings.reduce((earliestHour, booking) => {
    const { hours: bookingHour } = parseTime(booking.startTime);
    return Math.max(0, Math.min(earliestHour, bookingHour));
  }, DEFAULT_CALENDAR_START_HOUR), [selectedDateBookings]);
  const calendarEndHour = useMemo(() => selectedDateBookings.reduce((latestHour, booking) => {
    const { hours: bookingHour, minutes: bookingMinute } = parseTime(booking.startTime);
    const bookingEndHour = Math.ceil(
      (bookingHour * 60 + bookingMinute + Math.max(booking.totalDurationMinutes, 1)) / 60,
    );
    return Math.min(24, Math.max(latestHour, bookingEndHour));
  }, DEFAULT_CALENDAR_END_HOUR), [selectedDateBookings]);
  const hours = useMemo(
    () => Array.from(
      { length: calendarEndHour - calendarStartHour },
      (_, index) => calendarStartHour + index,
    ),
    [calendarEndHour, calendarStartHour],
  );
  // ===== DATA FETCHING & PROCESSING =====

  const today = useMemo(() => { const d = getGermanDateObject(); d.setHours(0, 0, 0, 0); return d; }, []);

  const bookingsByDate = useMemo(() => {
    const map: Record<string, FirestoreBooking[]> = {};
    let list = calendarVisibleBookings;
    if (staffFilterId !== 'all') list = list.filter(b => b.staffId === staffFilterId);
    list = list.filter((booking) => matchesSourceFilter(booking, sourceFilter));
    list.forEach(b => { const key = b.appointmentDate; if (!map[key]) map[key] = []; map[key].push(b); });
    return map;
  }, [calendarVisibleBookings, sourceFilter, staffFilterId]);

  const staffColumnsForDate = useMemo(() => {
    const dayBookings = bookingsByDate[selectedDate] || [];

    // Employees see their own column plus a permanent, wider Unassigned
    // workflow column. Request-origin segments stay yellow after assignment or
    // approval; the third line shows who claimed each segment.
    if (!isManagerOrOwner) {
      const currentStaff = realStaffList.find((staff) => staff.id === user?.staffId);
      if (!user?.staffId) return [];

      const ownBookings = dayBookings.filter((booking) =>
        booking.originatedAsRequest !== true &&
        booking.status !== 'needs_owner_action' &&
        (booking.staffId === user.staffId || booking.proposedStaffId === user.staffId),
      );
      const unassignedBookings = dayBookings.filter((booking) =>
        booking.originatedAsRequest === true ||
        booking.status === 'needs_owner_action',
      );
      const unassignedColumnSpan = Math.max(
        2,
        Math.min(3, getPeakConcurrentBookingCount(unassignedBookings)),
      );
      const columns: Array<{
        id: string;
        name: string;
        bookings: FirestoreBooking[];
        isInactive: boolean;
        columnType: 'staff' | 'request';
        span: number;
      }> = [{
        id: user.staffId,
        name:
          currentStaff?.name ||
          dayBookings[0]?.staffName ||
          (locale === 'vi' ? 'Lịch của tôi' : locale === 'de' ? 'Mein Kalender' : 'My calendar'),
        bookings: ownBookings,
        isInactive: currentStaff ? currentStaff.status !== 'active' : false,
        columnType: 'staff',
        span: 1,
      }];
      columns.push({
        id: '__unassigned__',
        name: locale === 'vi' ? 'Chưa gán' : locale === 'de' ? 'Nicht zugewiesen' : 'Unassigned',
        bookings: unassignedBookings,
        isInactive: false,
        columnType: 'request',
        span: unassignedColumnSpan,
      });
      return columns;
    }

    const map = new Map<string, {
      name: string;
      bookings: FirestoreBooking[];
      isInactive: boolean;
      columnType: 'staff' | 'request';
      span: number;
    }>();

    // 1. Add all active staff first (sorted by name for consistent order)
    const sortedStaff = [...realStaffList].sort((a, b) => a.name.localeCompare(b.name));

    sortedStaff.forEach(s => {
      if (s.status === 'active') {
        map.set(s.id, {
          name: s.name,
          bookings: [],
          isInactive: false,
          columnType: 'staff',
          span: 1,
        });
      }
    });

    // Customer Requests remain in Request after assignment and approval.
    // Confirmed appointments disrupted by leave stay in their original staff
    // column with a warning so the owner can see exactly who was affected.
    const requestColumnBookings: FirestoreBooking[] = [];
    // 2. Assign bookings to columns
    dayBookings.forEach(b => {
      const isUnassigned = !b.staffId || b.staffId === 'any' || b.staffId === '';
      const isPending = b.status === 'pending_approval';
      if (isUnassigned || isPending || b.originatedAsRequest === true) {
        requestColumnBookings.push(b);
      } else {
        if (!map.has(b.staffId)) {
          // Staff is inactive but has bookings on this day → add column for them
          const staff = realStaffList.find(s => s.id === b.staffId);
          const name = staff ? staff.name : b.staffName;
          const isInactive = staff ? staff.status !== 'active' : true;
          map.set(b.staffId, {
            name,
            bookings: [],
            isInactive,
            columnType: 'staff',
            span: 1,
          });
        }
        map.get(b.staffId)!.bookings.push(b);
      }
    });

    const staffColumns = Array.from(map.entries()).map(([id, data]) => ({ id, ...data }));

    // Sort: active staff by name first, then inactive staff with bookings by name
    staffColumns.sort((a, b) => {
      if (a.id === '__request__') return 1;
      if (b.id === '__request__') return -1;
      if (a.isInactive && !b.isInactive) return 1;
      if (!a.isInactive && b.isInactive) return -1;
      return a.name.localeCompare(b.name);
    });

    // Permanent workflow columns from the mockup. They remain visible even
    // when empty so the owner always knows where requests and disruptions go.
    const peakConcurrentRequests = getPeakConcurrentBookingCount(requestColumnBookings);
    staffColumns.push({
      id: '__request__',
      name: locale === 'vi' ? 'Yêu cầu' : locale === 'de' ? 'Anfragen' : 'Requests',
      bookings: requestColumnBookings,
      isInactive: false,
      columnType: 'request',
      span: Math.max(1, Math.min(3, peakConcurrentRequests)),
    });

    return staffColumns;
  }, [isManagerOrOwner, bookingsByDate, selectedDate, realStaffList, locale, user?.staffId]);

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

      if (window.innerWidth <= 767) {
        const mobilePopoverWidth = popoverEl.offsetWidth || Math.min(window.innerWidth - 32, 432);
        const mobilePopoverHeight = popoverEl.offsetHeight || 480;
        popoverEl.style.top = `${Math.max(16, (window.innerHeight - mobilePopoverHeight) / 2)}px`;
        popoverEl.style.left = `${Math.max(16, (window.innerWidth - mobilePopoverWidth) / 2)}px`;
        popoverEl.style.opacity = '1';
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

  // ===== RENDER BOOKING BLOCK =====
  const renderCalBookingBlock = (booking: FirestoreBooking, leftPercent = 0, widthPercent = 100) => {
    const { hours: startH, minutes: startM } = parseTime(booking.startTime);
    const topOffset = (startH - calendarStartHour) * HOUR_HEIGHT + (startM / 60) * HOUR_HEIGHT;
    const height = Math.max(
      (booking.totalDurationMinutes / 60) * HOUR_HEIGHT,
      booking.totalDurationMinutes >= 45 ? 54 : 42,
    );
    const endTime = formatEndTime(booking.startTime, booking.totalDurationMinutes);
    const hasLeaveConflict = Boolean(booking.conflictStaffId);
    const isSpecificLeaveConflict = hasLeaveConflict && booking.staffSelectionType === 'specific';

    let blockClass = styles.calBlock;
    if (booking.status === 'confirmed') blockClass += ` ${styles.calBlockConfirmed}`;
    if (booking.status === 'pending_approval') blockClass += ` ${styles.calBlockPending}`;
    if (booking.status === 'needs_owner_action') {
      blockClass += ` ${styles.calBlockNeedsAction}`;
      blockClass += booking.staffSelectionType === 'specific'
        ? ` ${styles.calBlockNeedsActionSpecific}`
        : ` ${styles.calBlockNeedsActionAny}`;
    }
    if (booking.status === 'cancelled') blockClass += ` ${styles.calBlockCancelled}`;
    const bookingGroupKey = getBookingGroupKey(booking);
    const bookingIdentity = bookingIdentityByGroupKey.get(bookingGroupKey) ?? BOOKING_GROUP_PALETTE[0];
    const visibleIdentity = bookingIdentity;
    if (hoveredBookingGroupKey === bookingGroupKey) blockClass += ` ${styles.calBlockGroupHighlighted}`;
    if (hoveredBookingGroupKey && hoveredBookingGroupKey !== bookingGroupKey) blockClass += ` ${styles.calBlockGroupMuted}`;

    return (
      <div
        key={booking.id}
        id={`cal-block-${booking.id}`}
        className={blockClass}
        style={{
          top: `${topOffset}px`,
          height: `${height}px`,
          left: `calc(${leftPercent}% + 3px)`,
          width: `calc(${widthPercent}% - 6px)`,
          backgroundColor: visibleIdentity.background,
          borderLeftColor: visibleIdentity.accent,
        }}
        data-booking-group={bookingGroupKey}
        title={`${booking.customerName} · ${getBookingDisplayCode(booking)} · ${getServiceName(booking)}`}
        onMouseEnter={() => setHoveredBookingGroupKey(bookingGroupKey)}
        onMouseLeave={() => setHoveredBookingGroupKey(null)}
        onFocus={() => setHoveredBookingGroupKey(bookingGroupKey)}
        onBlur={() => setHoveredBookingGroupKey(null)}
        onClick={(e) => {
          e.stopPropagation();
          setPopover({ booking });
        }}
      >
        <span
          className={styles.calBlockGroupCode}
          style={{ color: visibleIdentity.text, borderColor: visibleIdentity.outline }}
          aria-label={locale === 'vi'
            ? `Mã đặt lịch ${getBookingDisplayCode(booking)}`
            : `Booking ID ${getBookingDisplayCode(booking)}`}
        >
          {getBookingDisplayCode(booking)}
        </span>
        <span className={`${styles.calBlockStatusDot} ${styles[`calBlockStatusDot_${booking.status}`]}`} aria-hidden="true" />
        <div className={styles.calBlockService} style={booking.status === 'cancelled' ? undefined : { color: visibleIdentity.text }}>{getServiceName(booking)}</div>
        <div className={styles.calBlockTime}>{booking.startTime}–{endTime}</div>
        {height >= 44 && (
          <div className={styles.calBlockCustomer}>
            {hasLeaveConflict && booking.proposedStaffName
              ? `${locale === 'vi' ? 'Thợ thay' : locale === 'de' ? 'Vertretung' : 'Replacement'}: ${booking.proposedStaffName}`
              : hasLeaveConflict
              ? `${locale === 'vi' ? 'Thợ gốc' : locale === 'de' ? 'Ursprünglich' : 'Original'}: ${booking.requestedStaffName || booking.conflictStaffName || getStaffNameDisplay(booking.staffId, booking.staffName)}`
              : booking.originatedAsRequest === true && booking.staffId && booking.staffId !== 'any'
              ? `${locale === 'vi' ? 'Thợ' : 'Staff'}: ${getStaffNameDisplay(booking.staffId, booking.staffName)}`
              : booking.originatedAsRequest === true
                ? (locale === 'vi' ? 'Chưa có thợ nhận' : 'Unassigned')
              : booking.status === 'needs_owner_action' && booking.proposedStaffName
                ? `${locale === 'vi' ? 'Thợ thay' : 'Replacement'}: ${booking.proposedStaffName}`
                : booking.status === 'needs_owner_action' && (booking.requestedStaffName || booking.conflictStaffName)
                  ? `${locale === 'vi' ? 'Thợ gốc' : 'Original'}: ${booking.requestedStaffName || booking.conflictStaffName}`
                  : user?.role === 'staff'
                    ? getStaffNameDisplay(booking.staffId, booking.staffName)
                    : booking.customerName}
          </div>
        )}
        {(booking.status === 'needs_owner_action' || booking.status === 'pending_approval') && (
          <span className={styles.calBlockWarning} title={booking.status === 'pending_approval'
            ? hasLeaveConflict
              ? isSpecificLeaveConflict
                ? (locale === 'vi' ? 'Khách đã yêu cầu đích danh thợ đang nghỉ' : 'Customer requested the absent employee')
                : (locale === 'vi' ? 'Thợ được xếp tự động đang nghỉ' : 'The automatically assigned employee is absent')
              : (locale === 'vi' ? 'Yêu cầu chưa được duyệt' : 'Request is awaiting approval')
            : booking.staffSelectionType === 'specific'
              ? (locale === 'vi' ? 'Khách đã yêu cầu đích danh thợ đang nghỉ' : 'Customer requested the absent employee')
              : (locale === 'vi' ? 'Không còn thợ phù hợp đang rảnh' : 'No eligible employee is currently available')}>
            <TriangleAlert className="h-3 w-3" />
          </span>
        )}
      </div>
    );
  };

  const renderBookingListRow = (booking: FirestoreBooking, grouped = false) => {
    let borderLeftColor = '#E5E7EB';
    if (booking.status === 'confirmed') borderLeftColor = '#1A56DB';
    else if (booking.status === 'pending_approval') borderLeftColor = booking.conflictStaffId
      ? (booking.staffSelectionType === 'specific' ? '#EF4444' : '#F97316')
      : '#EAB308';
    else if (booking.status === 'needs_owner_action') borderLeftColor = booking.staffSelectionType === 'specific' ? '#EF4444' : '#F97316';
    else if (booking.status === 'cancelled') borderLeftColor = '#9CA3AF';
    else if (booking.status === 'completed') borderLeftColor = '#2563EB';

    const bookingGroupKey = getBookingGroupKey(booking);
    const bookingIdentity = bookingIdentityByGroupKey.get(bookingGroupKey) ?? BOOKING_GROUP_PALETTE[0];

    return (
      <div key={booking.id} className={`${styles.bookingRow} ${grouped ? styles.bookingRowGrouped : ''}`}>
        <div className={styles.rowTimeContainer}>
          {(futureIssuesMode || isGlobalSearchActive) && <span className={styles.rowFutureDate}>{booking.appointmentDate}</span>}
          <span className={styles.rowTime}>{booking.startTime} - {formatEndTime(booking.startTime, booking.totalDurationMinutes)}</span>
          <span className={styles.rowDuration}>{booking.totalDurationMinutes} {t.common.minutes}</span>
        </div>
        <div
          className={styles.bookingListItemCard}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setPopoverAnchorEl(event.currentTarget as HTMLElement);
            setPopover({ booking });
          }}
        >
          <span className={styles.cardStatusDivider} style={{ backgroundColor: borderLeftColor }} />
          <div className={styles.cardDetails}>
            <div className={styles.bookingCodeRow}>
              <span className={styles.bookingGroupDot} style={{ backgroundColor: bookingIdentity.accent }} aria-hidden="true" />
              <span>{getBookingDisplayCode(booking)}</span>
              <button
                type="button"
                className={styles.copyBookingCodeButton}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleCopyBookingCode(booking);
                }}
                aria-label={locale === 'vi' ? `Sao chép mã ${getBookingDisplayCode(booking)}` : `Copy ${getBookingDisplayCode(booking)}`}
              >
                {copiedBookingId === booking.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <h3 className={styles.cardServiceTitle}>{getServiceName(booking)}</h3>
            <div className={styles.cardStaffLine}>
              {getStaffNameDisplay(booking.staffId, booking.staffName)}
              {(() => {
                const staff = realStaffList.find((item) => item.id === booking.staffId);
                if (staff && staff.status !== 'active') {
                  return <span className={styles.cardInactiveBadge}>{locale === 'vi' ? 'Nghỉ làm' : locale === 'de' ? 'Inaktiv' : 'Inactive'}</span>;
                }
                return null;
              })()}
            </div>
            {user?.role !== 'staff' && booking.customerName && (
              <div className={styles.cardCustomerLine}>
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span className={styles.customerNameText}>{booking.customerName}</span>
              </div>
            )}
          </div>
          <div className={styles.cardStatus}>{getStatusBadge(booking.status)}</div>
        </div>
      </div>
    );
  };

  // ===== WEEKLY CALENDAR (Staff view) =====
  const renderWeeklyCalendar = () => {
    const dayLabels = DAY_LABELS[locale] || DAY_LABELS['en'];
    const totalHours = calendarEndHour - calendarStartHour;
    const bodyHeight = totalHours * HOUR_HEIGHT;

    return (
      <div className={styles.calendarView}>
        <div className={styles.calendarNav}>
          <div className={`${styles.calNavLeft} ${styles.staffWeekDateNav}`}>
            <Button variant="outline" size="icon" className={styles.calNavBtn} onClick={goToPrevWeek}>
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className={styles.datePickerWrapper}>
              <span className={styles.dateLabelText}>{formatWeekRangeLabel(weekStart, locale)}</span>
              <input
                type="date"
                className={styles.datePickerInputHidden}
                value={formatDateLocal(weekStart)}
                onChange={(e) => {
                  if (e.target.value) {
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    setWeekStart(getStartOfWeek(new Date(y, m - 1, d)));
                  }
                }}
              />
            </div>
            <Button variant="outline" size="icon" className={styles.calNavBtn} onClick={goToNextWeek}>
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
          <Button variant="outline" className={styles.weekTodayButton} onClick={goToToday}>
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

        <div className={styles.calGridScroller}>
          <div className={`${styles.calGrid} ${styles.calGridMobileScrollable}`}>
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
                <div key={hour} className={styles.calTimeMark} style={{ top: `${(hour - calendarStartHour) * HOUR_HEIGHT}px` }}>
                  {`${String(hour).padStart(2, '0')}:00`}
                </div>
              ))}
            </div>

            {/* Hour grid lines */}
            {hours.map((hour) => (
              <div key={hour} className={styles.calGridLine} style={{ top: `${(hour - calendarStartHour) * HOUR_HEIGHT}px` }} />
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
      </div>
    );
  };

  // ===== STAFF DAY CALENDAR (Manager/Owner view) =====
  const renderStaffDayCalendar = () => {
    const cols = staffColumnsForDate;
    const columnUnits = cols.reduce((total, column) => total + column.span, 0);
    const totalHours = calendarEndHour - calendarStartHour;
    const bodyHeight = totalHours * HOUR_HEIGHT;

    return (
      <div className={styles.calendarView}>
        <div className={styles.calendarToolbarRow}>
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
              <ChevronLeft className="w-4 h-4" />
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
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

        </div>

        {renderAttentionSummary()}

        <div className={styles.calGridScroller}>
          <div
            className={`${styles.calGrid} ${columnUnits > 3 ? styles.calGridMobileScrollable : ''}`}
            style={{ minWidth: `${Math.max(390, 56 + columnUnits * 82)}px` }}
          >
          {/* Header row - staff columns */}
          <div className={styles.calRow + ' ' + styles.calHeaderRow}>
            <div className={styles.calTimeCol}>
              <div className={styles.cornerLabel}>
                {locale === 'vi' ? 'Giờ' : locale === 'de' ? 'Zeit' : 'Time'}
              </div>
            </div>
            {cols.length === 0 ? (
              <div className={`${styles.calDayCol} ${styles.calHeaderCell}`}>
                <span className={styles.calDayLabel}>—</span>
              </div>
            ) : (
              cols.map((col) => {
                const isRequestCol = col.columnType === 'request';
                const isUnassignedCol = col.id === '__unassigned__';
                const isSpecialCol = isRequestCol;
                const displayName = isSpecialCol ? col.name : getStaffNameDisplay(col.id, col.name);
                const isInactive = 'isInactive' in col && col.isInactive;
                return (
                  <div key={col.id} style={{ '--calendar-column-span': col.span, flexGrow: col.span } as React.CSSProperties} className={`${styles.calDayCol} ${styles.calHeaderCell} ${isRequestCol ? styles.calHeaderCellRequest : ''} ${isInactive ? styles.calHeaderCellInactive : ''}`}>
                    <span className={styles.calStaffName}>{displayName}</span>
                    <span className={styles.calStaffSubtitle}>
                      {isUnassignedCol
                        ? (locale === 'vi' ? 'tự nhận lịch' : locale === 'de' ? 'zur Übernahme' : 'claim a booking')
                        : isRequestCol
                        ? (locale === 'vi' ? 'chờ duyệt' : locale === 'de' ? 'wartend' : 'pending')
                        : isInactive
                        ? (locale === 'vi' ? '🔴 Nghỉ làm' : locale === 'de' ? '🔴 Inaktiv' : '🔴 Inactive')
                        : (locale === 'vi' ? 'nhân viên' : locale === 'de' ? 'Mitarbeiter' : 'employee')}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Body */}
          <div className={styles.calBody} style={{ height: `${bodyHeight}px` }}>
            <div className={styles.calTimeTrack}>
              {hours.map((hour) => (
                <div key={hour} className={styles.calTimeMark} style={{ top: `${(hour - calendarStartHour) * HOUR_HEIGHT}px` }}>
                  {`${String(hour).padStart(2, '0')}:00`}
                </div>
              ))}
            </div>

            {hours.map((hour) => (
              <div key={hour} className={styles.calGridLine} style={{ top: `${(hour - calendarStartHour) * HOUR_HEIGHT}px` }} />
            ))}

            <div className={styles.calColumnsContainer}>
              {cols.length === 0 ? (
                <div className={styles.calColumn}></div>
              ) : (
                cols.map((col) => {
                  const positioned = col.columnType === 'request'
                    ? computeRequestGroupedLayout(col.bookings)
                    : computeOverlappingLayout(col.bookings);
                  // Get absence blocks for this staff on selected date
                  const isStaffColumn = col.columnType === 'staff';
                  const colAbsences = (isStaffColumn && staffAbsences[col.id])
                    ? staffAbsences[col.id].filter((abs: StaffAbsence) => abs.absenceDate === selectedDate)
                    : [];
                  return (
                    <div
                      key={col.id}
                      style={{ '--calendar-column-span': col.span, flexGrow: col.span } as React.CSSProperties}
                      className={styles.calColumn}
                    >
                      {/* Clickable time slots for walk-in booking */}
                      {isStaffColumn && isManagerOrOwner && hours.flatMap((hour) => {
                        return [0, 30].map((minOffset) => {
                          const topPx = (hour - calendarStartHour) * HOUR_HEIGHT + (minOffset / 60) * HOUR_HEIGHT;
                          const timeStr = `${String(hour).padStart(2, '0')}:${String(minOffset).padStart(2, '0')}`;
                          return (
                            <div
                              key={`slot-${hour}-${minOffset}`}
                              className={styles.calTimeSlot}
                              style={{ top: `${topPx}px`, height: `${HOUR_HEIGHT / 2}px` }}
                              onClick={(e) => {
                                e.stopPropagation();
                                openQuickBookPopup(col.id, col.name, timeStr, e);
                              }}
                              title={timeStr}
                            />
                          );
                        });
                      })}
                      {/* Absence blocks */}
                      {colAbsences.map((abs: StaffAbsence, idx: number) => {
                        let absStartH: number, absStartM: number, absEndH: number, absEndM: number;
                        if (abs.isFullDay) {
                          absStartH = calendarStartHour; absStartM = 0;
                          absEndH = calendarEndHour; absEndM = 0;
                        } else if (abs.startTime && abs.endTime) {
                          [absStartH, absStartM] = abs.startTime.split(':').map(Number);
                          [absEndH, absEndM] = abs.endTime.split(':').map(Number);
                        } else {
                          return null;
                        }
                        const topOffset = (absStartH - calendarStartHour) * HOUR_HEIGHT + (absStartM / 60) * HOUR_HEIGHT;
                        const durationMins = (absEndH * 60 + absEndM) - (absStartH * 60 + absStartM);
                        const height = (durationMins / 60) * HOUR_HEIGHT;
                        const leaveLabel = locale === 'vi' ? 'Nghỉ phép' : locale === 'de' ? 'Abwesend' : 'On leave';
                        const timeLabel = abs.isFullDay
                          ? (locale === 'vi' ? 'Cả ngày' : locale === 'de' ? 'Ganztägig' : 'Full day')
                          : `${abs.startTime} - ${abs.endTime}`;
                        return (
                          <div
                            key={`abs-${idx}`}
                            className={styles.calAbsenceBlock}
                            style={{ top: `${topOffset}px`, height: `${Math.max(height, 24)}px` }}
                          >
                            <span className={styles.calAbsenceLabel}>{leaveLabel}</span>
                            <span className={styles.calAbsenceTime}>{timeLabel}</span>
                            {abs.note && <span className={styles.calAbsenceNote}>{abs.note}</span>}
                          </div>
                        );
                      })}
                      {positioned.map(({ booking, left, width }) => renderCalBookingBlock(booking, left, width))}
                    </div>
                  );
                })
              )}
            </div>
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
            <span className={`${styles.legendDot} ${styles.legendDotYellow}`}></span>
            <span className={styles.legendText}>{t.admin.bookings.statusPending}</span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotOrange}`}></span>
            <span className={styles.legendText}>
              {locale === 'vi' ? 'Cần xử lý' : locale === 'de' ? 'Zu bearbeiten' : 'Needs action'}
            </span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotGrey}`}></span>
            <span className={styles.legendText}>{t.admin.bookings.statusCancelled}</span>
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.legendDot} ${styles.legendDotRed}`}></span>
            <span className={styles.legendText}>{locale === 'vi' ? 'Nghỉ phép' : locale === 'de' ? 'Abwesend' : 'On leave'}</span>
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
        <button className={styles.backBtn} onClick={() => router.push(getAdminBackTarget())}>
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className={`${styles.title} ${styles.titleCenter}`}>
          {locale === 'vi' ? 'Lịch hẹn' : locale === 'de' ? 'Termine' : 'Bookings'}
        </h1>
        <div className={styles.topBarRight}>
          {isManagerOrOwner && (
            <Button variant="outline" className={styles.walkInTopBtn} onClick={() => openNewBookingModal('', '', '09:00')}>
              + {locale === 'vi' ? 'Khách lẻ' : 'Walk-in'}
            </Button>
          )}
          {isOwner && (
            <Button
              variant="outline"
              size="icon"
              className={styles.bookingPurgeTopBtn}
              onClick={() => void openBookingPurgeModal()}
              aria-label={locale === 'vi' ? 'Xóa toàn bộ dữ liệu Booking' : 'Delete all Booking data'}
              title={locale === 'vi' ? 'Xóa toàn bộ dữ liệu Booking' : 'Delete all Booking data'}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          )}
          {viewMode === 'list' ? (
            <>
              <Button
                variant="outline"
                size="icon"
                className={styles.toggleViewBtn}
                onClick={() => setSearchOpen((current) => !current)}
                aria-label={locale === 'vi' ? 'Tìm kiếm lịch hẹn' : 'Search bookings'}
              >
                <Search className="h-5 w-5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={`${styles.toggleViewBtn} ${styles.desktopTopAction}`}
                onClick={() => setViewMode('calendar')}
                aria-label={locale === 'vi' ? 'Xem lịch dạng lịch' : 'Calendar view'}
              >
                <Calendar className="h-5 w-5" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="icon"
                className={styles.toggleViewBtn}
                onClick={() => setSearchOpen((current) => !current)}
                aria-label={locale === 'vi' ? 'Tìm kiếm toàn bộ lịch hẹn' : 'Search all bookings'}
              >
                <Search className="h-5 w-5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className={styles.toggleViewBtn}
                onClick={() => setViewMode('list')}
                aria-label={locale === 'vi' ? 'Xem lịch dạng danh sách' : 'List view'}
              >
                <List className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {searchOpen && <div className={styles.mobileSearchRow}>
        <div className={styles.mobileSearchBox}>
          <Search className="h-4 w-4" />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={locale === 'vi' ? 'Tìm mã CC, khách, dịch vụ, thợ' : 'Search code, customer, service, staff'} />
        </div>
        <button type="button" className={styles.mobileSearchClose} onClick={() => { setSearchOpen(false); setSearchQuery(''); }} aria-label={locale === 'vi' ? 'Đóng tìm kiếm' : 'Close search'}>
          <X className="h-4 w-4" />
        </button>
      </div>}

      {/* View */}
      {viewMode === 'list' || isGlobalSearchActive ? (
        <>
          {/* Centered Date Navigator */}
          <div className={styles.dateNavRow}>
            <div className={styles.calendarNavCentered}>
              {isGlobalSearchActive ? (
                <div className={styles.datePickerWrapper}><span className={styles.dateLabelText}>{locale === 'vi' ? 'Kết quả trên toàn bộ lịch' : 'Results across all dates'}</span></div>
              ) : futureIssuesMode ? (
                <div className={styles.datePickerWrapper}><span className={styles.dateLabelText}>{locale === 'vi' ? 'Lịch tương lai cần xử lý' : 'Future bookings needing action'}</span></div>
              ) : <>
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
              </>}
            </div>
            {!isGlobalSearchActive && (
              <button
                type="button"
                className={styles.mobileFilterButton}
                onClick={() => setViewMode('calendar')}
                aria-label={locale === 'vi' ? 'Chuyển sang lịch dạng cột' : 'Switch to calendar view'}
              >
                <Calendar className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className={styles.mobileFilterPanel}>
              {isManagerOrOwner && (
                <label className={styles.mobileFilterField}>
                  <span>{locale === 'vi' ? 'Thợ' : 'Staff'}</span>
                  <div className={styles.mobileFilterSelectControl}>
                    <span aria-hidden="true">
                      {staffFilterId === 'all'
                        ? (locale === 'vi' ? 'Tất cả thợ' : 'All staff')
                        : getStaffNameDisplay(
                          staffFilterId,
                          staffList.find((staff) => staff.id === staffFilterId)?.name || '',
                        )}
                    </span>
                    <select
                      aria-label={locale === 'vi' ? 'Chọn thợ' : 'Select staff'}
                      value={staffFilterId}
                      onChange={(event) => setStaffFilterId(event.target.value)}
                    >
                      <option value="all">{locale === 'vi' ? 'Tất cả thợ' : 'All staff'}</option>
                      {staffList.map((staff) => <option key={staff.id} value={staff.id}>{getStaffNameDisplay(staff.id, staff.name)}</option>)}
                    </select>
                  </div>
                </label>
              )}
              <label className={styles.mobileFilterField}>
                <span>{locale === 'vi' ? 'Nguồn lịch' : 'Source'}</span>
                <div className={styles.mobileFilterSelectControl}>
                  <span aria-hidden="true">
                    {sourceFilter === 'all'
                      ? (locale === 'vi' ? 'Tất cả nguồn' : 'All sources')
                      : sourceFilter === 'online_booking'
                        ? (locale === 'vi' ? 'Khách đặt từ web' : 'Web booking')
                        : (locale === 'vi' ? 'Chủ tiệm tạo' : 'Owner created')}
                  </span>
                  <select
                    aria-label={locale === 'vi' ? 'Chọn nguồn lịch' : 'Select booking source'}
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
                  >
                    <option value="all">{locale === 'vi' ? 'Tất cả nguồn' : 'All sources'}</option>
                    <option value="online_booking">{locale === 'vi' ? 'Khách đặt từ web' : 'Web booking'}</option>
                    <option value="owner_created">{locale === 'vi' ? 'Chủ tiệm tạo' : 'Owner created'}</option>
                  </select>
                </div>
              </label>
            </div>

          {renderAttentionSummary()}

          <div className={styles.mobileStatusChips}>
            {([
              ['all', locale === 'vi' ? 'Tất cả' : 'All'],
              ['confirmed', t.admin.bookings.statusConfirmed],
              ['pending_approval', t.admin.bookings.statusPending],
              ['needs_owner_action', locale === 'vi' ? 'Cần xử lý' : 'Needs action'],
              ['cancelled', t.admin.bookings.statusCancelled],
            ] as Array<[FilterStatus, string]>).map(([value, label]) => (
              <button key={value} type="button" onClick={() => applyDayStatusFilter(value)} className={filter === value ? styles.mobileStatusChipActive : styles.mobileStatusChip}>
                {label}
              </button>
            ))}
          </div>

          <div className={styles.listView}>
            {(isGlobalSearchActive ? searchLoading : loading) ? (
              <div className={styles.noBookings}><p>{t.admin.bookings.loading}</p></div>
            ) : searchError ? (
              <div className={styles.noBookings}><p>{searchError}</p></div>
            ) : dayFilteredBookings.length === 0 ? (
              <div className={styles.noBookings}><Calendar className={styles.emptyCalendarIcon} /><p>{t.admin.bookings.empty}</p></div>
            ) : (
              dayFilteredBookingGroups.map((group) => {
                const firstBooking = group.allBookings[0] ?? group.visibleBookings[0];
                if (!firstBooking) return null;
                const identity = bookingIdentityByGroupKey.get(group.key) ?? BOOKING_GROUP_PALETTE[0];
                const totalServiceCount = group.allBookings.reduce((total, booking) => total + Math.max(booking.services.length, 1), 0);
                const visibleServiceCount = group.visibleBookings.reduce((total, booking) => total + Math.max(booking.services.length, 1), 0);
                const groupEndMinute = Math.max(...group.allBookings.map((booking) => {
                  const { hours: startHour, minutes: startMinute } = parseTime(booking.startTime);
                  return startHour * 60 + startMinute + booking.totalDurationMinutes;
                }));
                const groupEndLabel = `${String(Math.floor(groupEndMinute / 60) % 24).padStart(2, '0')}:${String(groupEndMinute % 60).padStart(2, '0')}`;
                const serviceCountLabel = visibleServiceCount === totalServiceCount
                  ? `${totalServiceCount} ${locale === 'vi' ? 'dịch vụ' : 'services'}`
                  : `${visibleServiceCount}/${totalServiceCount} ${locale === 'vi' ? 'dịch vụ' : 'services'}`;
                const isMultiSegmentBooking = group.allBookings.length > 1;

                if (!isMultiSegmentBooking) return renderBookingListRow(firstBooking);

                return (
                  <section
                    key={group.key}
                    className={styles.bookingGroup}
                    style={{ borderColor: identity.outline }}
                    aria-label={locale === 'vi' ? `Nhóm lịch của ${firstBooking.customerName}` : `Booking group for ${firstBooking.customerName}`}
                  >
                    <button
                      type="button"
                      className={styles.bookingGroupHeader}
                      style={{ backgroundColor: identity.background }}
                      onClick={(event) => {
                        setPopoverAnchorEl(event.currentTarget as HTMLElement);
                        setPopover({ booking: group.visibleBookings[0] });
                      }}
                    >
                      <span className={styles.bookingGroupMarker} style={{ backgroundColor: identity.accent }} aria-hidden="true" />
                      <span className={styles.bookingGroupHeading}>
                        <strong>{firstBooking.customerName || (locale === 'vi' ? 'Khách vãng lai' : 'Walk-in')}</strong>
                        <span>
                          {getBookingDisplayCode(firstBooking)} · {serviceCountLabel} · {firstBooking.startTime}–{groupEndLabel}
                        </span>
                      </span>
                      <span className={styles.bookingGroupCount} style={{ color: identity.text, borderColor: identity.outline }}>
                        {group.allBookings.length}
                      </span>
                    </button>
                    <div className={styles.bookingGroupItems}>
                      {group.visibleBookings.map((booking) => renderBookingListRow(booking, true))}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </>
      ) : (
        <>
          {user?.role === 'staff' && (
            <div className={styles.staffCalendarScopeToggle}>
              <button type="button" className={staffCalendarScope === 'week' ? styles.staffCalendarScopeActive : ''} onClick={() => setStaffCalendarScope('week')}>{locale === 'vi' ? 'Tuần' : 'Week'}</button>
              <button type="button" className={staffCalendarScope === 'day' ? styles.staffCalendarScopeActive : ''} onClick={() => setStaffCalendarScope('day')}>{locale === 'vi' ? 'Ngày' : 'Day'}</button>
            </div>
          )}
          {user?.role === 'staff' && staffCalendarScope === 'week' ? renderWeeklyCalendar() : renderStaffDayCalendar()}
        </>
      )}

      {/* Quick 2-Tap Booking Popup */}
      {isManagerOrOwner && quickBookPopup && (
        <>
          <div className={styles.modalOverlay} style={{ background: 'transparent' }} onClick={() => setQuickBookPopup(null)} />
          <div
            className={styles.quickBookPopup}
            style={{
              top: quickBookPopup.isUpward ? 'auto' : quickBookPopup.anchorRect.top,
              bottom: quickBookPopup.isUpward ? (window.innerHeight - quickBookPopup.anchorRect.top) : 'auto',
              left: quickBookPopup.anchorRect.left
            }}
          >
            <div className={styles.quickBookHeader}>
              <span className={styles.quickBookTitle}>
                {quickBookPopup.timeStr} · {quickBookPopup.staffName}
              </span>
              <button className={styles.quickBookClose} onClick={() => setQuickBookPopup(null)}>×</button>
            </div>
            <div className={styles.quickBookBtns}>
              <button className={styles.quickBookBtn} onClick={() => handleQuickCreate(60)}>
                <span className={styles.quickBookBtnLabel}>
                  {locale === 'vi' ? '1 Dịch vụ' : locale === 'de' ? '1 Dienst' : '1 Service'}
                </span>
                <span className={styles.quickBookBtnTime}>60 {locale === 'vi' ? 'phút' : 'min'}</span>
              </button>
              <button className={styles.quickBookBtn} onClick={() => handleQuickCreate(120)}>
                <span className={styles.quickBookBtnLabel}>
                  {locale === 'vi' ? '2 Dịch vụ' : locale === 'de' ? '2 Dienste' : '2 Services'}
                </span>
                <span className={styles.quickBookBtnTime}>120 {locale === 'vi' ? 'phút' : 'min'}</span>
              </button>
            </div>
            <button className={styles.quickBookDetailBtn} onClick={() => { setQuickBookPopup(null); openNewBookingModal(quickBookPopup.staffId, quickBookPopup.staffName, quickBookPopup.timeStr); }}>
              {locale === 'vi' ? '+ Chi tiết' : locale === 'de' ? '+ Details' : '+ Details'}
            </button>
          </div>
        </>
      )}

      {/* Walk-in Booking Modal */}
      {showNewBookingModal && (
        <>
          <div className={styles.modalOverlay} onClick={() => setShowNewBookingModal(false)} />
          <div className={styles.newBookingModal}>
            <div className={styles.nbmHeader}>
              <span aria-hidden="true" className={styles.nbmHeaderSpacer} />
              <h3 className={styles.nbmTitle}>{t.admin.bookings.walkInBooking || 'Walk-in Booking'}</h3>
              <button type="button" className={styles.nbmCloseButton} onClick={() => setShowNewBookingModal(false)} aria-label={locale === 'vi' ? 'Đóng' : 'Close'}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className={styles.nbmBody}>
              <section className={styles.nbmCard}>
                <div className={styles.nbmHero}>
                  <span className={styles.nbmHeroCircleOne} />
                  <span className={styles.nbmHeroCircleTwo} />
                  <span className={styles.nbmHeroCircleThree} />
                </div>

                <div className={styles.nbmCardContent}>
                  <div className={styles.nbmIdentityRow}>
                    <span className={styles.nbmAvatar}>
                      <UserRound className="h-12 w-12" strokeWidth={1.8} />
                    </span>
                    <div className={styles.nbmCustomerNameWrap}>
                      <input
                        type="text"
                        className={styles.nbmCustomerNameInput}
                        aria-label={t.admin.bookings.customerName || 'Customer name'}
                        placeholder={locale === 'vi' ? 'Khách lẻ' : locale === 'de' ? 'Laufkundschaft' : 'Walk-in customer'}
                        value={newBookingCustomerName}
                        onChange={(e) => setNewBookingCustomerName(e.target.value)}
                      />
                      <Pencil className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </div>
                  </div>

                  <label className={styles.nbmDateBar}>
                    <CalendarDays className="h-5 w-5 shrink-0" />
                    <span>{formatDateGroupLabel(selectedDate, locale)}</span>
                    <input
                      type="date"
                      className={styles.nbmDateInput}
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      aria-label={t.admin.bookings.detailDate}
                    />
                  </label>

                  <div className={styles.nbmTimeGrid}>
                    <label className={styles.nbmTimeCard}>
                      <span className={styles.nbmTimeLabel}><Clock className="h-4 w-4" />{t.admin.bookings.startTime || 'Start time'}</span>
                      <select
                        className={styles.nbmTimeInput}
                        value={newBookingTime}
                        onChange={(e) => setNewBookingTime(e.target.value)}
                        aria-label={t.admin.bookings.startTime || 'Start time'}
                      >
                        {Array.from({ length: 96 }, (_, index) => {
                          const totalMinutes = index * 15;
                          const value = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
                          return <option key={value} value={value}>{value}</option>;
                        })}
                      </select>
                    </label>
                    <div className={styles.nbmTimeCard}>
                      <span className={styles.nbmTimeLabel}><Clock className="h-4 w-4" />{locale === 'vi' ? 'Kết thúc' : locale === 'de' ? 'Ende' : 'End time'}</span>
                      <span className={`${styles.nbmTimeInput} ${styles.nbmEndTime}`}>
                        {formatEndTime(newBookingTime, newBookingServices.reduce((sum, service) => sum + service.duration, 0) || 60)}
                      </span>
                    </div>
                  </div>

                  <label className={styles.nbmControlShell}>
                    <UserRound className="h-4 w-4 shrink-0" />
                    <select
                      className={styles.nbmControl}
                      value={newBookingStaffId}
                      disabled={user?.role === 'staff'}
                      aria-label={t.admin.bookings.detailStaff}
                      onChange={(e) => {
                        const s = realStaffList.find(st => st.id === e.target.value);
                        setNewBookingStaffId(e.target.value);
                        setNewBookingStaffName(s?.name || '');
                        if (s && s.serviceIds && s.serviceIds.length > 0) {
                          setNewBookingServices(prev => prev.filter(svc => s.serviceIds!.includes(svc.serviceId)));
                        }
                      }}
                    >
                      {user?.role !== 'staff' && <option value="">{t.admin.bookings.anyStaff}</option>}
                      {realStaffList.filter(s => s.status === 'active').map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>

                  <div className={styles.nbmServiceShell}>
                    {newBookingServices.length < 2 && (() => {
                      const selectedStaff = newBookingStaffId ? realStaffList.find(s => s.id === newBookingStaffId) : null;
                      const staffServiceIds = selectedStaff?.serviceIds;
                      const hasServiceFilter = staffServiceIds && staffServiceIds.length > 0;
                      const availableServices = hasServiceFilter
                        ? allServices.filter((service) => staffServiceIds.includes(service.id))
                        : allServices;

                      return (
                        <div className={styles.nbmServicePicker}>
                          <Scissors className="h-4 w-4 shrink-0" />
                          <select
                            className={styles.nbmControl}
                            value=""
                            aria-label={t.admin.bookings.service || 'Service'}
                            onChange={(e) => {
                              const svcId = e.target.value;
                              if (!svcId) return;
                              const svc = allServices.find((service) => service.id === svcId);
                              if (!svc) return;
                              const cat = allCategories.find((category) => category.id === svc.categoryId);
                              setNewBookingServices(prev => [...prev, {
                                categoryId: svc.categoryId || '',
                                categoryName: cat?.name || svc.category || '',
                                serviceId: svc.id,
                                serviceName: svc.name || '',
                                duration: svc.durationMin || 30,
                                price: svc.price || 0,
                              }]);
                            }}
                          >
                            <option value="">{locale === 'vi' ? 'Chọn dịch vụ' : locale === 'de' ? 'Dienstleistung auswählen' : 'Choose service'}</option>
                            {allCategories.map((cat) => {
                              const catServices = availableServices.filter((service) => service.categoryId === cat.id);
                              if (catServices.length === 0) return null;
                              return (
                                <optgroup key={cat.id} label={translateCategory(cat.id, cat.name)}>
                                  {catServices.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {translateService(s.id, s.name)} ({s.durationMin || 30}min · €{s.price})
                                    </option>
                                  ))}
                                </optgroup>
                              );
                            })}
                          </select>
                          <span className={styles.nbmServiceAddIcon}><Plus className="h-4 w-4" /></span>
                        </div>
                      );
                    })()}

                    {newBookingServices.length > 0 && (
                      <div className={styles.nbmSelectedServices}>
                        {newBookingServices.map((svc, idx) => (
                          <div key={`${svc.serviceId}-${idx}`} className={styles.nbmServiceRow}>
                            <span className={styles.nbmServiceIcon}><Scissors className="h-4 w-4" /></span>
                            <span className={styles.nbmServiceInfo}>
                              <span className={styles.nbmServiceName}>{svc.serviceName}</span>
                              <span className={styles.nbmServiceMeta}>{svc.duration} min · €{svc.price}</span>
                            </span>
                            <button type="button" className={styles.nbmRemoveBtn} onClick={() => setNewBookingServices(prev => prev.filter((_, i) => i !== idx))} aria-label={locale === 'vi' ? `Xóa ${svc.serviceName}` : `Remove ${svc.serviceName}`}>
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className={styles.nbmControlShell}>
                    <UserRound className="h-4 w-4 shrink-0" />
                    <input
                      type="tel"
                      inputMode="tel"
                      className={styles.nbmControl}
                      placeholder={t.admin.bookings.customerPhone || (locale === 'vi' ? 'Số điện thoại' : 'Phone number')}
                      value={newBookingCustomerPhone}
                      onChange={(e) => setNewBookingCustomerPhone(e.target.value)}
                      aria-label={t.admin.bookings.customerPhone || 'Phone'}
                    />
                  </label>

                  <label className={styles.nbmNoteShell}>
                    <span className={styles.nbmNoteLabel}><ClipboardList className="h-4 w-4" />{t.admin.bookings.notes || 'Notes'}</span>
                    <textarea
                      className={styles.nbmNoteInput}
                      placeholder={locale === 'vi' ? 'Ghi chú nếu có' : locale === 'de' ? 'Notiz, falls vorhanden' : 'Add a note'}
                      value={newBookingNotes}
                      onChange={(e) => setNewBookingNotes(e.target.value)}
                      rows={2}
                    />
                  </label>

                  {newBookingServices.length > 0 && (() => {
                    const totalDuration = newBookingServices.reduce((sum, service) => sum + service.duration, 0);
                    const totalPrice = newBookingServices.reduce((sum, service) => sum + service.price, 0);
                    return <div className={styles.nbmSummary}><Timer size={14} /> {totalDuration} min <span aria-hidden="true">·</span> <Euro size={14} /> {totalPrice}</div>;
                  })()}
                </div>
              </section>
            </div>

            <div className={styles.nbmFooter}>
              <button
                type="button"
                className={styles.nbmConfirmButton}
                onClick={handleCreateWalkInBooking}
                disabled={newBookingCreating || newBookingServices.length === 0 || !newBookingStaffId}
              >
                {newBookingCreating ? '...' : (t.admin.bookings.confirmCreate || 'Confirm booking')}
                {!newBookingCreating && <Check className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Owner-only Booking data cleanup. This deliberately excludes HRM-only records. */}
      {isOwner && showBookingPurgeModal && (
        <>
          <div className={styles.modalOverlay} onClick={() => !bookingPurgeDeleting && setShowBookingPurgeModal(false)} />
          <section
            className={styles.bookingPurgeModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-purge-title"
          >
            <header className={styles.bookingPurgeHeader}>
              <span className={styles.bookingPurgeIcon}><Trash2 className="h-5 w-5" /></span>
              <div>
                <h3 id="booking-purge-title">
                  {locale === 'vi' ? 'Xóa toàn bộ lịch Booking' : locale === 'de' ? 'Alle Booking-Termine löschen' : 'Delete all Booking data'}
                </h3>
                <p>{locale === 'vi' ? 'Chỉ áp dụng cho cửa hàng đang chọn' : 'Only for the currently selected store'}</p>
              </div>
              <button
                type="button"
                className={styles.bookingPurgeClose}
                onClick={() => setShowBookingPurgeModal(false)}
                disabled={bookingPurgeDeleting}
                aria-label={locale === 'vi' ? 'Đóng' : 'Close'}
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className={styles.bookingPurgeBody}>
              {bookingPurgeLoading ? (
                <p className={styles.bookingPurgeLoading}>{locale === 'vi' ? 'Đang kiểm tra dữ liệu…' : 'Inspecting data…'}</p>
              ) : bookingPurgeDeletedCount !== null ? (
                <div className={styles.bookingPurgeSuccess}>
                  <Check className="h-6 w-6" />
                  <strong>{locale === 'vi' ? `Đã xóa ${bookingPurgeDeletedCount} booking.` : `Deleted ${bookingPurgeDeletedCount} bookings.`}</strong>
                  <span>{locale === 'vi' ? 'Dữ liệu HRM độc lập được giữ nguyên.' : 'Standalone HRM data was preserved.'}</span>
                </div>
              ) : bookingPurgePreview ? (
                <>
                  <div className={styles.bookingPurgeStats}>
                    <div><strong>{bookingPurgePreview.bookingCount}</strong><span>Booking</span></div>
                    <div><strong>{bookingPurgePreview.attendanceSegmentCount}</strong><span>{locale === 'vi' ? 'đoạn lịch' : 'segments'}</span></div>
                    <div><strong>{bookingPurgePreview.workDateCount}</strong><span>{locale === 'vi' ? 'ngày' : 'dates'}</span></div>
                  </div>
                  <div className={styles.bookingPurgeWarning}>
                    <TriangleAlert className="h-5 w-5" />
                    <p>
                      <strong>{locale === 'vi' ? 'Thao tác này không thể hoàn tác.' : 'This cannot be undone.'}</strong>
                      <span>{locale === 'vi'
                        ? 'Booking gốc, các đoạn lịch do Booking tạo và khóa khung giờ sẽ bị xóa. Chấm công HRM độc lập, nhân viên, dịch vụ, nghỉ phép, chốt ngày và khách hàng được giữ nguyên.'
                        : 'Booking records, linked Booking segments and slot locks will be deleted. Standalone HRM attendance and HRM configuration remain unchanged.'}</span>
                    </p>
                  </div>
                  {bookingPurgePreview.bookingCount > 0 && (
                    <label className={styles.bookingPurgeConfirmField}>
                      <span>{locale === 'vi' ? `Nhập “${bookingPurgePhrase}” để xác nhận` : `Type “${bookingPurgePhrase}” to confirm`}</span>
                      <input
                        type="text"
                        value={bookingPurgeConfirmation}
                        onChange={(event) => setBookingPurgeConfirmation(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={bookingPurgeDeleting}
                      />
                    </label>
                  )}
                </>
              ) : null}

              {bookingPurgeError && <p className={styles.bookingPurgeError}>{bookingPurgeError}</p>}
            </div>

            <footer className={styles.bookingPurgeFooter}>
              <button type="button" className={styles.bookingPurgeCancel} onClick={() => setShowBookingPurgeModal(false)} disabled={bookingPurgeDeleting}>
                {bookingPurgeDeletedCount !== null ? (locale === 'vi' ? 'Đóng' : 'Close') : (locale === 'vi' ? 'Hủy' : 'Cancel')}
              </button>
              {bookingPurgeDeletedCount === null && bookingPurgePreview && bookingPurgePreview.bookingCount > 0 && (
                <button
                  type="button"
                  className={styles.bookingPurgeDelete}
                  onClick={() => void handleDeleteAllBookingData()}
                  disabled={bookingPurgeDeleting || bookingPurgeConfirmation.trim() !== bookingPurgePhrase}
                >
                  {bookingPurgeDeleting ? (locale === 'vi' ? 'Đang xóa…' : 'Deleting…') : (locale === 'vi' ? 'Xóa sạch dữ liệu Booking' : 'Delete Booking data')}
                </button>
              )}
            </footer>
          </section>
        </>
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-detail-title"
          >
            <div className={styles.calPopoverHero}>
              <button type="button" className={styles.calPopoverClose} onClick={() => { setPopover(null); setPopoverAnchorEl(null); }} aria-label={locale === 'vi' ? 'Đóng chi tiết lịch' : 'Close booking details'}>
                <X className="h-5 w-5" />
              </button>
              <span className={styles.calPopoverHeroIcon}><Scissors className="h-5 w-5" /></span>
              <span className={styles.calPopoverCode}>
                {getBookingDisplayCode(popover.booking)}
              </span>
              <h4 id="booking-detail-title" className={styles.calPopoverTitle}>{popoverBookingGroup.map(getFullServicesDisplay).join(' + ')}</h4>
              <p className={styles.calPopoverHeroMeta}>
                {popoverBookingSummary?.startTime ?? popover.booking.startTime} – {popoverBookingSummary?.endTime ?? formatEndTime(popover.booking.startTime, popover.booking.totalDurationMinutes)} · {popoverBookingSummary?.durationMinutes ?? popover.booking.totalDurationMinutes} {t.common.minutes}
              </p>
            </div>

            <div className={styles.calPopoverBody}>
              <div className={styles.calPopoverStatGrid}>
                <div className={styles.calPopoverStatCard}>
                  <span className={styles.calPopoverStatLabel}><Clock className="h-4 w-4" />{t.admin.bookings.detailTime}</span>
                  <strong>{popoverBookingSummary?.startTime ?? popover.booking.startTime} – {popoverBookingSummary?.endTime ?? formatEndTime(popover.booking.startTime, popover.booking.totalDurationMinutes)}</strong>
                </div>
                <div className={styles.calPopoverStatCard}>
                  <span className={styles.calPopoverStatLabel}><CalendarDays className="h-4 w-4" />{t.admin.bookings.detailDate}</span>
                  <strong>{popover.booking.appointmentDate}</strong>
                </div>
              </div>

              <div className={styles.calPopoverDetailsCard}>
                {popoverBookingGroup.length > 1 ? (
                  <div className={styles.calPopoverSegments}>
                    <span className={styles.calPopoverLabel}>{locale === 'vi' ? 'Phân công từng dịch vụ' : 'Assign each segment'}</span>
                    {popoverBookingGroup.map((segment) => (
                      <div key={segment.id} className={styles.calPopoverSegmentRow}>
                        <span className={styles.calPopoverSegmentInfo}>
                          <strong>{segment.startTime}–{formatEndTime(segment.startTime, segment.totalDurationMinutes)}</strong>
                          <span>{getFullServicesDisplay(segment)}</span>
                        </span>
                        {isManagerOrOwner ? (
                          <select
                            className={styles.popoverStaffSelect}
                            value={(segment.status === 'needs_owner_action' ? segment.proposedStaffId : segment.staffId) || 'any'}
                            onChange={(event) => {
                              const newStaffId = event.target.value;
                              const newStaff = realStaffList.find((staff) => staff.id === newStaffId);
                              void handleReassignStaff(segment.id, newStaffId, newStaff?.name || '');
                            }}
                          >
                            <option value="any">{t.admin.bookings.anyStaff || 'Bất kỳ ai'}</option>
                            {realStaffList.map((staff) => {
                              const isInactive = staff.status !== 'active';
                              const isAbsent = isStaffAbsentDuringBooking(staff.id, segment, staffAbsences);
                              const suffix = isInactive
                                ? (locale === 'vi' ? 'Nghỉ làm' : locale === 'de' ? 'Inaktiv' : 'Inactive')
                                : isAbsent
                                  ? (locale === 'vi' ? 'Đang nghỉ' : locale === 'de' ? 'Abwesend' : 'On leave')
                                  : '';
                              return <option key={staff.id} value={staff.id} disabled={isInactive || isAbsent}>{staff.name}{suffix ? ` (${suffix})` : ''}</option>;
                            })}
                          </select>
                        ) : <strong>{getStaffNameDisplay(segment.staffId, segment.staffName)}</strong>}
                      </div>
                    ))}
                  </div>
                ) : <div className={styles.calPopoverDetailRow}>
                  <span className={styles.calPopoverDetailIcon}><UserRound className="h-4 w-4" /></span>
                  <span className={styles.calPopoverDetailText}>
                    <span className={styles.calPopoverLabel}>{t.admin.bookings.detailStaff}</span>
                    {isManagerOrOwner ? (
                      <select
                        className={styles.popoverStaffSelect}
                        value={(popover.booking.status === 'needs_owner_action' ? popover.booking.proposedStaffId : popover.booking.staffId) || 'any'}
                        onChange={(e) => {
                          const newStaffId = e.target.value;
                          const newStaff = realStaffList.find(s => s.id === newStaffId);
                          const newStaffName = newStaff ? newStaff.name : (newStaffId === 'any' ? (t.admin.bookings.anyStaff || 'Bất kỳ ai') : '');
                          void handleReassignStaff(popover.booking.id, newStaffId, newStaffName);
                        }}
                      >
                        <option value="any">{t.admin.bookings.anyStaff || 'Bất kỳ ai'}</option>
                        {realStaffList.map(s => {
                          const isInactive = s.status !== 'active';
                          const isAbsent = isStaffAbsentDuringBooking(s.id, popover.booking, staffAbsences);
                          const label = isInactive
                            ? `🔴 ${s.name} (${locale === 'vi' ? 'Nghỉ làm' : locale === 'de' ? 'Inaktiv' : 'Inactive'})`
                            : isAbsent
                              ? `🔴 ${s.name} (${locale === 'vi' ? 'Đang nghỉ' : locale === 'de' ? 'Abwesend' : 'On leave'})`
                              : s.name;
                          return <option key={s.id} value={s.id} disabled={isInactive || isAbsent}>{label}</option>;
                        })}
                      </select>
                    ) : (
                      <strong className={styles.calPopoverValue}>{getStaffNameDisplay(popover.booking.staffId, popover.booking.staffName)}</strong>
                    )}
                  </span>
                </div>}

                {popover.booking.status === 'needs_owner_action' && (
                  <div className={`${styles.calPopoverNotice} ${popover.booking.staffSelectionType === 'specific' ? styles.calPopoverNoticeDanger : styles.calPopoverNoticeWarning}`}>
                    <TriangleAlert className="h-4 w-4" />
                    <span>
                      <strong>{popover.booking.staffSelectionType === 'specific'
                        ? (locale === 'vi' ? 'Khách đã chọn đích danh thợ' : 'Customer requested a specific employee')
                        : (locale === 'vi' ? 'Không còn thợ phù hợp đang rảnh' : 'No eligible employee is available')}</strong>
                      {popover.booking.staffSelectionType === 'specific' && (
                        <small>{locale === 'vi'
                          ? `Khách yêu cầu: ${popover.booking.requestedStaffName || popover.booking.conflictStaffName || '—'}. Hãy gọi khách trước khi đổi thợ.`
                          : `Requested: ${popover.booking.requestedStaffName || popover.booking.conflictStaffName || '—'}. Call the customer before changing staff.`}</small>
                      )}
                      {popover.booking.proposedStaffName && (
                        <small>{locale === 'vi'
                          ? `Thợ thay thế đang chờ duyệt: ${popover.booking.proposedStaffName}`
                          : `Replacement awaiting approval: ${popover.booking.proposedStaffName}`}</small>
                      )}
                    </span>
                  </div>
                )}

                <div className={styles.calPopoverDetailRow}>
                  <span className={styles.calPopoverDetailIcon}><ClipboardList className="h-4 w-4" /></span>
                  <span className={styles.calPopoverDetailText}>
                    <span className={styles.calPopoverLabel}>{locale === 'vi' ? 'Cách khách đặt' : 'Customer staff choice'}</span>
                    <strong className={styles.calPopoverValue}>
                      {popover.booking.staffSelectionType === 'specific'
                        ? (locale === 'vi'
                          ? `Chọn đích danh: ${popover.booking.requestedStaffName || popover.booking.staffName || '—'}`
                          : `Specific employee: ${popover.booking.requestedStaffName || popover.booking.staffName || '—'}`)
                        : (locale === 'vi' ? 'Thợ bất kỳ' : 'Any available employee')}
                    </strong>
                  </span>
                </div>

                {user?.role !== 'staff' && (
                  <div className={styles.calPopoverDetailRow}>
                    <span className={styles.calPopoverDetailIcon}><Phone className="h-4 w-4" /></span>
                    <span className={styles.calPopoverDetailText}>
                      <span className={styles.calPopoverLabel}>{locale === 'vi' ? 'Khách hàng' : 'Customer'}</span>
                      <strong className={styles.calPopoverValue}>{popover.booking.customerName}{popover.booking.customerPhone ? ` · ${popover.booking.customerPhone}` : ''}</strong>
                    </span>
                  </div>
                )}

                {popover.booking.addOns && popover.booking.addOns.length > 0 && (
                  <div className={styles.calPopoverDetailRow}>
                    <span className={styles.calPopoverDetailIcon}><Plus className="h-4 w-4" /></span>
                    <span className={styles.calPopoverDetailText}>
                      <span className={styles.calPopoverLabel}>Add-ons</span>
                      <strong className={styles.calPopoverValue}>{popover.booking.addOns.map((addOn) => addOn.name || '').join(', ')}</strong>
                    </span>
                  </div>
                )}
              </div>

              <div className={styles.calPopoverSummaryRow}>
                <span className={styles.calPopoverSummaryItem}>
                  <span className={styles.calPopoverLabel}>{t.admin.bookings.detailTotal}</span>
                  <strong>€{popoverBookingGroup.reduce((sum, segment) => sum + segment.totalPrice, 0)}</strong>
                </span>
                <span className={styles.calPopoverSummaryItem}>
                  <span className={styles.calPopoverLabel}>{locale === 'vi' ? 'Trạng thái' : 'Status'}</span>
                  <strong className={`${styles.calPopoverSummaryValue} ${styles[`calPopoverStatus_${popover.booking.status}`] || ''}`}>
                    {getStatusLabel(popover.booking.status)}
                  </strong>
                </span>
              </div>

              {(popover.booking.status === 'cancelled' || popover.booking.status === 'no_show') && (
                <div className={styles.calPopoverActorRow}>
                  <span>{popover.booking.status === 'cancelled'
                    ? (locale === 'vi' ? 'Người hủy' : 'Cancelled by')
                    : (locale === 'vi' ? 'Người đánh dấu không đến' : 'Marked no-show by')}</span>
                  <strong>{getUpdateActorLabel(popover.booking)}</strong>
                </div>
              )}

              {user?.role !== 'staff' && (
                <>
                  {(popover.booking.status === 'pending_approval' || popover.booking.status === 'needs_owner_action') && (
                    <div className={`${styles.calPopoverActions} ${styles.calPopoverActionsTwo}`}>
                      <button type="button" className={`${styles.calPopoverAction} ${styles.calPopoverActionDanger}`} onClick={() => { void handleReject(popover.booking.id).then((cancelled) => { if (cancelled) { setPopover(null); setPopoverAnchorEl(null); } }); }}>{t.admin.bookings.btnReject}</button>
                      <button
                        type="button"
                        className={`${styles.calPopoverAction} ${styles.calPopoverActionPrimary}`}
                        onClick={() => { void handleApprove(popover.booking.id).then((approved) => { if (approved) { setPopover(null); setPopoverAnchorEl(null); } }); }}
                      >{t.admin.bookings.btnApprove}</button>
                    </div>
                  )}
                  {popover.booking.status === 'confirmed' && (
                    <div className={`${styles.calPopoverActions} ${popover.booking.appointmentDate === getGermanTodayString() ? '' : styles.calPopoverActionsTwo}`}>
                      <button type="button" className={`${styles.calPopoverAction} ${styles.calPopoverActionDanger}`} onClick={() => { void handleReject(popover.booking.id).then((cancelled) => { if (cancelled) { setPopover(null); setPopoverAnchorEl(null); } }); }}>{t.admin.bookings.btnCancel}</button>
                      {popover.booking.appointmentDate === getGermanTodayString() && (
                        <button type="button" className={`${styles.calPopoverAction} ${styles.calPopoverActionNeutral}`} onClick={() => { void handleLifecycleStatus(popover.booking.id, 'no_show').then((updated) => { if (updated) setPopover(null); }); }}>{locale === 'vi' ? 'Không đến' : 'No-show'}</button>
                      )}
                      <button type="button" className={`${styles.calPopoverAction} ${styles.calPopoverActionPrimary}`} onClick={() => { void handleLifecycleStatus(popover.booking.id, 'completed').then((updated) => { if (updated) setPopover(null); }); }} title={locale === 'vi' ? 'Xác nhận dịch vụ đã hoàn tất' : locale === 'de' ? 'Dienstleistung als abgeschlossen bestätigen' : 'Confirm the service is completed'}>{locale === 'vi' ? 'Xác nhận' : locale === 'de' ? 'Bestätigen' : 'Confirm'}</button>
                    </div>
                  )}
                </>
              )}
              {user?.role === 'staff' && popover.booking.status === 'confirmed' && (
                <div className={`${styles.calPopoverActions} ${popover.booking.appointmentDate === getGermanTodayString() ? styles.calPopoverActionsTwo : styles.calPopoverActionsOne}`}>
                  <button
                    type="button"
                    className={`${styles.calPopoverAction} ${styles.calPopoverActionDanger}`}
                    onClick={() => { void handleReject(popover.booking.id).then((cancelled) => { if (cancelled) { setPopover(null); setPopoverAnchorEl(null); } }); }}
                  >{t.admin.bookings.btnCancel}</button>
                  {popover.booking.appointmentDate === getGermanTodayString() && (
                    <button
                      type="button"
                      className={`${styles.calPopoverAction} ${styles.calPopoverActionNeutral}`}
                      onClick={() => { void handleLifecycleStatus(popover.booking.id, 'no_show').then((updated) => { if (updated) { setPopover(null); setPopoverAnchorEl(null); } }); }}
                    >{locale === 'vi' ? 'Không đến' : 'No-show'}</button>
                  )}
                </div>
              )}
              {user?.role === 'staff' && isClaimableUnassignedBooking(popover.booking) && (
                <div className={`${styles.calPopoverActions} ${styles.calPopoverActionsOne}`}>
                  <button
                    type="button"
                    className={`${styles.calPopoverAction} ${styles.calPopoverActionPrimary}`}
                    onClick={() => { void handleClaimBooking(popover.booking); }}
                  >{locale === 'vi' ? 'Nhận lịch này' : locale === 'de' ? 'Termin übernehmen' : 'Claim booking'}</button>
                </div>
              )}
              {user?.role === 'staff' && popover.booking.originatedAsRequest === true && popover.booking.status === 'pending_approval' && (
                <div className={`${styles.calPopoverActions} ${styles.calPopoverActionsTwo}`}>
                  <button type="button" className={`${styles.calPopoverAction} ${styles.calPopoverActionDanger}`} onClick={() => { void handleReject(popover.booking.id).then((cancelled) => { if (cancelled) setPopover(null); }); }}>{t.admin.bookings.btnReject}</button>
                  <button type="button" className={`${styles.calPopoverAction} ${styles.calPopoverActionPrimary}`} onClick={() => { void handleApprove(popover.booking.id).then((approved) => { if (approved) setPopover(null); }); }}>{t.admin.bookings.btnApprove}</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
