'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import Link from 'next/link';
import { getGermanTodayString } from '@/lib/timeUtils';
import { BarChart3, Store, Users, Calendar, Scissors, Clock, CalendarOff, CreditCard } from 'lucide-react';
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
    Promise.all([
      fetchAdminAttendanceCalendar(branchId, today, today),
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
  const todayPendingBookings = todayBookings.filter(b => b.status === 'pending_approval');
  const todayNeedsActionBookings = todayBookings.filter(b => b.status === 'needs_owner_action');
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
    },
  }[locale];

  // ---------- RENDER: SUPER ADMIN ----------
  if (user.role === 'superadmin') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <div className="rounded-[28px] border border-blue-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
              <BarChart3 className="w-6 h-6 text-[#1A56DB]" />
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
          <div className="flex flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <span className="text-3xl font-black text-gray-950">{totalBranches}</span>
            <span className="mt-1 text-xs font-semibold text-gray-500">{locale === 'vi' ? 'Chi nhánh' : 'Branches'}</span>
          </div>
          <div className="flex flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <span className="text-3xl font-black text-gray-950">{totalUsers}</span>
            <span className="mt-1 text-xs font-semibold text-gray-500">{locale === 'vi' ? 'Tài khoản' : 'Accounts'}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="px-1 text-base font-bold text-gray-950">
            {locale === 'vi' ? 'Quản lý' : 'Management'}
          </h3>
          <Link href="/admin/dashboard/branches/" className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:shadow-md">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Store className="w-5 h-5 text-[#1A56DB]" />
            </span>
            <span className="flex-1 text-sm font-semibold text-gray-950">{locale === 'vi' ? 'Chi nhánh' : 'Branches'}</span>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">{totalBranches}</span>
            <span className="text-xl text-gray-400">›</span>
          </Link>
          <Link href="/admin/dashboard/accounts/" className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:shadow-md">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Users className="w-5 h-5 text-[#1A56DB]" />
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-1 py-2 sm:px-4 sm:py-6">
        <div
          className="flex min-h-48 cursor-pointer flex-col justify-between rounded-[28px] border border-blue-400 bg-blue-600 p-6 text-white shadow-[0_18px_36px_-24px_rgba(37,99,235,0.75)] transition active:scale-[0.99]"
          onClick={() => router.push('/admin/dashboard/bookings')}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-white" />
              <h2 className="text-[18px] font-semibold text-white">{copy.bookings}</h2>
            </div>
            <p className="text-[13px] font-medium text-blue-100">{copy.staffSchedule}</p>
          </div>
          <div className="mt-8 flex items-baseline gap-1.5">
            <span className="text-[58px] font-black leading-none tracking-tight text-white">{todayBookings.length}</span>
            <span className="text-[22px] font-bold text-white">{copy.bookingUnit}</span>
          </div>
        </div>
        <p className="px-1 text-center text-xs font-medium text-gray-400">
          {copy.staffNotice}
        </p>
      </div>
    );
  }

  // ---------- RENDER: OWNER / MANAGER ----------
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-1 py-2 sm:px-4 sm:py-6">
      <div
        className="flex min-h-48 cursor-pointer flex-col justify-between rounded-[28px] border border-blue-400 bg-blue-600 p-6 text-white shadow-[0_18px_36px_-24px_rgba(37,99,235,0.75)] transition active:scale-[0.99]"
        onClick={() => router.push('/admin/dashboard/bookings')}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-white" />
            <h2 className="text-[18px] font-semibold text-white">{copy.bookings}</h2>
          </div>
          <p className="text-[13px] font-medium text-blue-100">{copy.salonSchedule}</p>
        </div>
        <div className="mt-8 flex items-baseline gap-1.5">
          <span className="text-[58px] font-black leading-none tracking-tight text-white">{todayBookings.length}</span>
          <span className="text-[22px] font-bold text-white">{copy.bookingUnit}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/admin/dashboard/bookings/"
          className="flex min-h-20 items-center justify-between rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3 transition active:scale-[0.99]"
        >
          <span className="text-sm font-semibold text-yellow-900">
            {copy.requests}
          </span>
          <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-yellow-500 px-2 text-xs font-black text-white">
            {todayPendingBookings.length}
          </span>
        </Link>
        <Link
          href="/admin/dashboard/bookings/"
          className="flex min-h-20 items-center justify-between rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 transition active:scale-[0.99]"
        >
          <span className="text-sm font-semibold text-orange-900">
            {copy.needsAction}
          </span>
          <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-orange-500 px-2 text-xs font-black text-white">
            {todayNeedsActionBookings.length}
          </span>
        </Link>
      </div>

      <Link href="/admin/dashboard/staff/" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-blue-600" />
          <span className="font-semibold text-gray-900">{copy.staff}</span>
        </div>
        <span className="min-w-[24px] h-[24px] rounded-full bg-[#FF3B30] text-white text-[12px] font-bold flex items-center justify-center px-1.5">{staffCount}</span>
      </Link>

      <Link href="/admin/dashboard/services/" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3">
          <Scissors className="w-5 h-5 text-blue-600" />
          <span className="font-semibold text-gray-900">{copy.services}</span>
        </div>
        <span className="min-w-[24px] h-[24px] rounded-full bg-[#FF3B30] text-white text-[12px] font-bold flex items-center justify-center px-1.5">{servicesCount}</span>
      </Link>

      {user.role === 'owner' && (
        <Link href="/admin/dashboard/leave/" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <CalendarOff className="w-5 h-5 text-orange-600" />
            <span className="font-semibold text-gray-900">{copy.leave}</span>
          </div>
        </Link>
      )}

      <Link href="/admin/dashboard/customers/" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between hover:shadow-md transition-shadow">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-violet-600" />
          <span className="font-semibold text-gray-900">{copy.customers}</span>
        </div>
      </Link>

      {user.role === 'owner' && (
        <Link href="/admin/dashboard/billing/" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-emerald-600" />
            <span className="font-semibold text-gray-900">{copy.billing}</span>
          </div>
        </Link>
      )}

      {user.role === 'owner' && (
        <Link href="/admin/dashboard/my-branches/" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <Store className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-gray-900">{copy.branches}</span>
          </div>
          <span className="min-w-[24px] h-[24px] rounded-full bg-[#FF3B30] text-white text-[12px] font-bold flex items-center justify-center px-1.5">{user.assignedBranches?.length || 1}</span>
        </Link>
      )}
    </div>
  );
}
