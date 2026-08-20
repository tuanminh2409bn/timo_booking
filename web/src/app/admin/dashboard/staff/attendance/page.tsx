'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { HrmButton, HrmPageHeader } from '@/components/hrm-ui';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  fetchAdminEmployeeAttendanceDays,
  fetchAdminEmployees,
  type AdminEmployee,
  type AdminEmployeeAttendanceDay,
} from '@/lib/adminHrmApi';
import { getRequestedEmployeeId, withEmployeeReturn } from '@/lib/adminNavigation';

const parseLocalDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export default function EmployeeAttendancePage() {
  const router = useRouter();
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const storeId = activeBranch || user?.assignedBranches?.[0];
  const [employeeId] = useState(() => getRequestedEmployeeId());
  const [employee, setEmployee] = useState<AdminEmployee>();
  const [days, setDays] = useState<AdminEmployeeAttendanceDay[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadInitial = useCallback(async () => {
    if (!storeId || !employeeId) return;
    setLoading(true);
    try {
      const [employees, page] = await Promise.all([
        fetchAdminEmployees(storeId),
        fetchAdminEmployeeAttendanceDays(storeId, employeeId),
      ]);
      setEmployee(employees.find((item) => item.id === employeeId));
      setDays(page.items);
      setNextCursor(page.meta.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [employeeId, storeId]);

  useEffect(() => {
    if (user?.role !== 'owner') return;
    void loadInitial().catch((error: unknown) => {
      console.error('Could not load employee attendance days:', error);
      setDays([]);
    });
  }, [loadInitial, user]);

  const loadMore = async () => {
    if (!storeId || !employeeId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchAdminEmployeeAttendanceDays(storeId, employeeId, nextCursor);
      setDays((current) => [...current, ...page.items]);
      setNextCursor(page.meta.nextCursor);
    } catch (error: unknown) {
      console.error('Could not load older employee attendance days:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  const localeName = locale === 'vi' ? 'vi-VN' : locale === 'de' ? 'de-DE' : 'en-GB';
  const formatCurrency = (value: number) => new Intl.NumberFormat(localeName, {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
  const totalRevenue = days.reduce((sum, day) => sum + day.totalRevenue, 0);

  const goBack = () => {
    router.push(employeeId
      ? `/admin/dashboard/staff/?employeeId=${encodeURIComponent(employeeId)}`
      : '/admin/dashboard/staff/');
  };

  if (user?.role !== 'owner') {
    return <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">{locale === 'vi' ? 'Chỉ chủ tiệm được xem báo cáo nhân viên.' : 'Only the owner can view employee reports.'}</div>;
  }

  return (
    <section className="mx-auto max-w-2xl overflow-hidden bg-white pb-4">
      <HrmPageHeader
        className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl"
        title={locale === 'vi' ? 'Chấm công thợ' : 'Employee attendance'}
        onBack={goBack}
      />

      <div className="flex items-center gap-3 px-4 py-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--hrm-blue-700)] text-xs font-bold text-white">
          {(employee?.name || 'NV').split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-semibold text-slate-950">{employee?.name || (loading ? '...' : 'Nhân viên')}</strong>
          <span className="mt-0.5 block truncate text-xs font-medium text-slate-500">
            {locale === 'vi' ? 'Tổng doanh thu đã tải' : 'Loaded revenue'} · <b className="text-[var(--hrm-blue-700)]">{formatCurrency(totalRevenue)}</b>
          </span>
        </span>
      </div>

      {loading ? <div className="px-4 py-10 text-center text-sm text-slate-500">...</div> : (
        <div className="divide-y divide-slate-100">
          {days.map((day) => (
            <button
              key={day.workDate}
              type="button"
              disabled={!day.worked}
              onClick={() => router.push(withEmployeeReturn(`/admin/dashboard/bookings/?view=list&date=${encodeURIComponent(day.workDate)}`, employeeId))}
              className="flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left transition active:bg-slate-50 disabled:cursor-default disabled:opacity-45"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-950">{parseLocalDate(day.workDate).toLocaleDateString(localeName, { weekday: 'long', day: '2-digit', month: '2-digit' })}</span>
                <span className="mt-0.5 block text-xs font-medium text-slate-500">{day.worked ? `${day.attendanceCount} ${locale === 'vi' ? 'lịch hẹn' : 'bookings'}` : (locale === 'vi' ? 'Không có lịch' : 'No bookings')}</span>
              </span>
              <strong className="shrink-0 whitespace-nowrap text-xs font-bold text-slate-950">{day.worked ? `+${formatCurrency(day.totalRevenue)}` : '—'}</strong>
            </button>
          ))}

          {days.length === 0 ? <div className="flex flex-col items-center px-4 py-10 text-sm text-slate-500"><ClipboardList className="mb-2 h-5 w-5" />{locale === 'vi' ? 'Không có dữ liệu.' : 'No data.'}</div> : null}
          {nextCursor ? <div className="px-4 pt-4"><HrmButton variant="outline" disabled={loadingMore} onClick={() => void loadMore()} className="min-h-10 w-full rounded-xl text-xs font-semibold">{loadingMore ? '...' : (locale === 'vi' ? 'Xem thêm 10 ngày' : 'Load 10 more days')}</HrmButton></div> : null}
        </div>
      )}
    </section>
  );
}
