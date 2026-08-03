'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  createEmployeeLeave,
  deleteEmployeeLeave,
  fetchAdminEmployees,
  fetchEmployeeLeave,
  type AdminEmployee,
  type AdminLeaveRequest,
} from '@/lib/adminHrmApi';
import { getGermanTodayString } from '@/lib/timeUtils';

export default function LeaveSettingsPage() {
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const storeId = activeBranch || user?.assignedBranches?.[0];
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [items, setItems] = useState<AdminLeaveRequest[]>([]);
  const [startDate, setStartDate] = useState(getGermanTodayString());
  const [endDate, setEndDate] = useState(getGermanTodayString());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const loadLeave = useCallback(async (targetEmployeeId: string) => {
    if (!storeId || !targetEmployeeId) {
      setItems([]);
      return;
    }
    setItems(await fetchEmployeeLeave(storeId, targetEmployeeId));
  }, [storeId]);

  useEffect(() => {
    if (!storeId || user?.role !== 'owner') return;
    fetchAdminEmployees(storeId)
      .then((result) => {
        const activeEmployees = result.filter((employee) => employee.active);
        setEmployees(activeEmployees);
        const firstId = activeEmployees[0]?.id ?? '';
        setEmployeeId(firstId);
        return loadLeave(firstId);
      })
      .catch((error: unknown) => console.error(error));
  }, [storeId, user, loadLeave]);

  if (user?.role !== 'owner') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        {locale === 'vi'
          ? 'Chỉ chủ tiệm được quản lý ngày nghỉ của thợ.'
          : locale === 'de'
            ? 'Nur der Inhaber kann Urlaub verwalten.'
            : 'Only the owner may manage employee leave.'}
      </div>
    );
  }

  const create = async () => {
    if (!storeId || !employeeId || !reason.trim() || startDate > endDate) return;
    setBusy(true);
    try {
      await createEmployeeLeave(storeId, employeeId, {
        startDate,
        endDate,
        allDay: true,
        reason: reason.trim(),
      });
      setReason('');
      await loadLeave(employeeId);
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not create leave');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: AdminLeaveRequest) => {
    if (!storeId || !window.confirm(locale === 'vi' ? 'Xóa kỳ nghỉ này?' : 'Delete this leave?')) return;
    setBusy(true);
    try {
      await deleteEmployeeLeave(storeId, employeeId, item.id);
      await loadLeave(employeeId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-gray-950">
          {locale === 'vi' ? 'Nghỉ phép của thợ' : locale === 'de' ? 'Mitarbeiterurlaub' : 'Employee leave'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {locale === 'vi'
            ? 'Ngày nghỉ sẽ tự động khóa thợ trên lịch đặt hẹn.'
            : 'Leave automatically blocks the employee in booking availability.'}
        </p>
      </header>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-gray-700">
            {locale === 'vi' ? 'Chọn thợ' : 'Employee'}
            <select
              value={employeeId}
              onChange={(event) => {
                setEmployeeId(event.target.value);
                void loadLeave(event.target.value);
              }}
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal outline-none focus:border-blue-500"
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-gray-700">
            {locale === 'vi' ? 'Lý do' : 'Reason'}
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal outline-none focus:border-blue-500"
            />
          </label>
          <label className="text-sm font-semibold text-gray-700">
            {locale === 'vi' ? 'Từ ngày' : 'From'}
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
          </label>
          <label className="text-sm font-semibold text-gray-700">
            {locale === 'vi' ? 'Đến ngày' : 'To'}
            <input type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal" />
          </label>
        </div>
        <button
          type="button"
          disabled={busy || !employeeId || !reason.trim() || startDate > endDate}
          onClick={() => void create()}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          {locale === 'vi' ? 'Thêm ngày nghỉ' : 'Add leave'}
        </button>
      </div>

      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
            <CalendarOff className="mx-auto mb-2 h-7 w-7" />
            {locale === 'vi' ? 'Thợ này chưa có ngày nghỉ.' : 'No leave recorded.'}
          </div>
        ) : items.map((item) => (
          <article key={item.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-600">
              <CalendarOff className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-950">{item.startDate} → {item.endDate}</p>
              <p className="truncate text-sm text-gray-500">{item.reason}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void remove(item)} className="rounded-xl bg-red-50 p-2.5 text-red-600 disabled:opacity-50">
              <Trash2 className="h-4 w-4" />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
