'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import Link from 'next/link';
import { getGermanTodayString } from '@/lib/timeUtils';
import { BarChart3, Store, Users, Calendar, Globe2 } from 'lucide-react';
import { fetchAdminAttendanceCalendar, fetchPlatformSummary } from '@/lib/adminHrmApi';
import { fetchHrmServices, fetchHrmStaff } from '@/lib/hrmApi';

type DashboardBooking = {
  id: string;
  appointmentDate: string;
  staffId?: string;
  status: 'pending_approval' | 'confirmed' | 'cancelled' | 'needs_owner_action' | 'completed';
};

const isDashboardBookingStatus = (
  value: unknown
): value is DashboardBooking['status'] =>
  typeof value === 'string' &&
  ['pending_approval', 'confirmed', 'cancelled', 'needs_owner_action', 'completed'].includes(value);

export default function DashboardPage() {
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const [realBookings, setRealBookings] = useState<DashboardBooking[]>([]);

  // Owner/Manager states
  const [staffCount, setStaffCount] = useState(0);
  const [servicesCount, setServicesCount] = useState(0);

  // SuperAdmin states
  const [totalBranches, setTotalBranches] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPlatformBookings, setTotalPlatformBookings] = useState(0);

  // Platform summary from the canonical admin API.
  useEffect(() => {
    if (!user || user.role !== 'superadmin') return;
    fetchPlatformSummary().then((summary) => {
      setTotalUsers(summary.totalUsers);
      setTotalBranches(summary.totalStores);
      setTotalPlatformBookings(summary.totalBookings);
    }).catch((error: unknown) => console.error(error));
  }, [user]);

  // Booking dashboard uses the same canonical attendance source as the calendar.
  useEffect(() => {
    if (!user || user.role === 'superadmin') return;
    const branchId = activeBranch || user.assignedBranches?.[0];
    if (!branchId) return;
    let active = true;
    const today = getGermanTodayString();
    const futureDate = new Date(`${today}T00:00:00.000Z`);
    futureDate.setUTCDate(futureDate.getUTCDate() + 90);
    const futureEnd = futureDate.toISOString().slice(0, 10);
    Promise.all([
      fetchAdminAttendanceCalendar(branchId, today, futureEnd),
      fetchHrmStaff(branchId),
      fetchHrmServices(branchId),
    ]).then(([attendanceItems, staff, services]) => {
      if (!active) return;
      setRealBookings(attendanceItems
        .filter((item) => isDashboardBookingStatus(item.bookingStatus))
        .map((item) => ({
          id: item.id,
          appointmentDate: item.workDate,
          staffId: item.mainAssigneeUserId || item.employeeUserId,
          status: item.bookingStatus as DashboardBooking['status'],
        })));
      setStaffCount(staff.length);
      setServicesCount(services.length);
    }).catch((error: unknown) => {
      console.error('Could not load HRM dashboard summary:', error);
    });
    return () => { active = false; };
  }, [user, activeBranch]);

  if (!user) return null;

  // ---------- COMPUTED ----------
  const todayStr = getGermanTodayString();
  const todayBookings = realBookings.filter(b => {
    if (b.appointmentDate !== todayStr || b.status === 'cancelled') return false;
    if (user.role === 'staff' && b.staffId !== user.staffId) return false;
    return true;
  });
  const futureIssues = realBookings.filter((booking) => booking.appointmentDate >= todayStr && booking.status === 'needs_owner_action');
  const copy = {
    vi: {
      bookings: 'Lịch hẹn',
      staffSchedule: 'Lịch làm việc của bạn hôm nay',
      salonSchedule: 'Tổng lịch tại tiệm hôm nay',
      bookingUnit: 'lịch',
      staffNotice: 'Bạn chỉ có quyền xem các lịch được phân công cho mình.',
      requests: 'Yêu cầu',
      needsAction: 'Cần xử lý',
      staff: 'Nhân sự',
      services: 'Dịch vụ',
      leave: 'Nghỉ phép',
      customers: 'Khách hàng',
      billing: 'Thanh toán gói',
      branches: 'Cửa hàng',
      attendanceCalendar: 'Lịch chấm công',
    },
    de: {
      bookings: 'Termine',
      staffSchedule: 'Dein Terminplan für heute',
      salonSchedule: 'Heutige Termine im Salon',
      bookingUnit: 'Termine',
      staffNotice: 'Du kannst nur die dir zugewiesenen Termine ansehen.',
      requests: 'Anfragen',
      needsAction: 'Zu bearbeiten',
      staff: 'Mitarbeiter',
      services: 'Dienste',
      leave: 'Urlaub',
      customers: 'Kunden',
      billing: 'Abonnement',
      branches: 'Filialen',
      attendanceCalendar: 'Arbeitskalender',
    },
    en: {
      bookings: 'Bookings',
      staffSchedule: 'Your schedule today',
      salonSchedule: 'Today at the salon',
      bookingUnit: 'bookings',
      staffNotice: 'You can only view appointments assigned to you.',
      requests: 'Requests',
      needsAction: 'Needs action',
      staff: 'Staff',
      services: 'Services',
      leave: 'Leave',
      customers: 'Customers',
      billing: 'Billing',
      branches: 'Branches',
      attendanceCalendar: 'Attendance calendar',
    },
  }[locale];

  // ---------- RENDER: SUPER ADMIN ----------
  if (user.role === 'superadmin') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <div className="rounded-[1.75rem] border border-white/80 bg-white p-6 shadow-[0_12px_32px_-24px_rgba(15,23,42,0.55)]">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
              <BarChart3 className="h-6 w-6 text-[var(--hrm-blue-700)]" />
            </span>
            <div>
              <div className="text-sm font-semibold text-gray-500">
                {locale === 'vi' ? 'Tổng quan hệ thống' : 'System Overview'}
              </div>
              <div className="mt-1 text-2xl font-black text-gray-950">
                {totalPlatformBookings} {locale === 'vi' ? 'lịch hẹn' : 'bookings'}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col rounded-xl border border-[var(--hrm-border)] bg-white p-5 shadow-[var(--hrm-shadow-card)]">
            <span className="text-3xl font-black text-gray-950">{totalBranches}</span>
            <span className="mt-1 text-xs font-semibold text-gray-500">{locale === 'vi' ? 'Chi nhánh' : 'Branches'}</span>
          </div>
          <div className="flex flex-col rounded-xl border border-[var(--hrm-border)] bg-white p-5 shadow-[var(--hrm-shadow-card)]">
            <span className="text-3xl font-black text-gray-950">{totalUsers}</span>
            <span className="mt-1 text-xs font-semibold text-gray-500">{locale === 'vi' ? 'Tài khoản' : 'Accounts'}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="px-1 text-base font-bold text-gray-950">
            {locale === 'vi' ? 'Quản lý' : 'Management'}
          </h3>
          <Link href="/admin/dashboard/branches/" className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/80 bg-white px-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.5)] transition active:scale-[0.99]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Store className="h-5 w-5 text-[var(--hrm-blue-700)]" />
            </span>
            <span className="flex-1 text-sm font-semibold text-gray-950">{locale === 'vi' ? 'Chi nhánh' : 'Branches'}</span>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">{totalBranches}</span>
            <span className="text-xl text-gray-400">›</span>
          </Link>
          <Link href="/admin/dashboard/accounts/" className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/80 bg-white px-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.5)] transition active:scale-[0.99]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Users className="h-5 w-5 text-[var(--hrm-blue-700)]" />
            </span>
            <span className="flex-1 text-sm font-semibold text-gray-950">{locale === 'vi' ? 'Tài khoản' : 'Accounts'}</span>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">{totalUsers}</span>
            <span className="text-xl text-gray-400">›</span>
          </Link>
        </div>
      </div>
    );
  }

  // ---------- RENDER: STAFF ----------
  if (user.role === 'staff') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-0 py-1 sm:px-4 sm:py-6">
        <div
          className="flex min-h-44 cursor-pointer flex-col justify-between rounded-[1.75rem] border border-[var(--hrm-blue-400)] bg-[var(--hrm-blue-700)] p-6 text-white shadow-[0_18px_36px_-24px_rgba(37,99,235,0.75)] transition active:scale-[0.99]"
          onClick={() => router.push('/admin/dashboard/bookings/?view=calendar')}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-white" />
              <h2 className="text-lg font-semibold text-white">{copy.bookings}</h2>
            </div>
            <p className="text-sm font-semibold text-blue-100">{locale === 'vi' ? 'Hôm nay' : copy.staffSchedule}</p>
          </div>
          <div className="mt-8 flex items-baseline gap-1.5">
            <span className="text-5xl font-black leading-none tracking-normal text-white">{todayBookings.length}</span>
            <span className="text-xl font-bold text-white">{copy.bookingUnit}</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------- RENDER: OWNER / MANAGER ----------
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-0 py-1 sm:px-4 sm:py-6">
      <div
        className="flex min-h-44 cursor-pointer flex-col justify-between rounded-[1.75rem] border border-[var(--hrm-blue-400)] bg-[var(--hrm-blue-700)] p-6 text-white shadow-[0_18px_36px_-24px_rgba(37,99,235,0.75)] transition active:scale-[0.99]"
        onClick={() => router.push('/admin/dashboard/bookings/?view=calendar')}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-white" />
            <h2 className="text-lg font-semibold text-white">{copy.bookings}</h2>
          </div>
          <p className="text-sm font-semibold text-blue-100">{copy.salonSchedule}</p>
        </div>
        <div className="mt-8 flex items-baseline gap-1.5">
          <span className="text-5xl font-black leading-none tracking-normal text-white">{todayBookings.length}</span>
          <span className="text-xl font-bold text-white">{copy.bookingUnit}</span>
        </div>
      </div>

      <Link
        href="/admin/dashboard/bookings/?view=list&status=needs_owner_action&scope=future"
        className={`flex min-h-14 items-center justify-between rounded-2xl border px-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.35)] transition active:scale-[0.99] ${futureIssues.length > 0 ? 'border-orange-100 bg-orange-50' : 'border-white/80 bg-white'}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-black ${futureIssues.length > 0 ? 'bg-orange-100 text-orange-700' : 'bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]'}`}>!</span>
          <span className="min-w-0">
            <strong className="block truncate text-sm text-slate-900">{locale === 'vi' ? 'Lịch tương lai cần xử lý' : 'Future issues'}</strong>
            <span className="block truncate text-xs font-medium text-slate-500">{futureIssues.length > 0 ? (locale === 'vi' ? 'Thợ nghỉ hoặc lịch cần phân công lại' : 'Bookings that need reassignment') : (locale === 'vi' ? 'Hiện không có lịch cần xử lý' : 'No bookings need action')}</span>
          </span>
        </div>
        <span className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold text-white ${futureIssues.length > 0 ? 'bg-orange-600' : 'bg-[var(--hrm-blue-700)]'}`}>{futureIssues.length}</span>
      </Link>

      <div className="grid grid-cols-2 gap-3">
      <Link href="/admin/dashboard/staff/" className="flex min-h-14 items-center justify-between rounded-2xl border border-white/80 bg-white px-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.5)] transition active:scale-[0.99]">
        <div className="flex items-center gap-3">
          <Users className="h-4 w-4 text-[var(--hrm-blue-700)]" />
          <span className="text-sm font-semibold text-slate-800">{copy.staff}</span>
        </div>
        <span className="flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-[#ff3158] px-1.5 text-[12px] font-bold text-white">{staffCount}</span>
      </Link>

      <Link href="/admin/dashboard/services/" className="flex min-h-14 items-center justify-between rounded-2xl border border-white/80 bg-white px-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.5)] transition active:scale-[0.99]">
        <div className="flex items-center gap-3">
          <Globe2 className="h-4 w-4 text-[var(--hrm-blue-700)]" />
          <span className="text-sm font-semibold text-slate-800">{copy.services}</span>
        </div>
        <span className="flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-[#ff3158] px-1.5 text-[12px] font-bold text-white">{servicesCount}</span>
      </Link>
      </div>
      {user.role === 'owner' && (
        <Link href="/admin/dashboard/bookings/?view=list" className="flex min-h-14 items-center justify-between rounded-2xl border border-white/80 bg-white px-4 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.5)] transition active:scale-[0.99]">
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-[var(--hrm-blue-700)]" />
            <span className="text-sm font-semibold text-slate-800">{copy.attendanceCalendar}</span>
          </div>
          <span className="flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-[#ff3158] px-1.5 text-[12px] font-bold text-white">{todayBookings.length}</span>
        </Link>
      )}
    </div>
  );
}
