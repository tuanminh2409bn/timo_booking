'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { HrmButton, HrmCard, HrmEmptyState, HrmInput, HrmPageHeader } from '@/components/hrm-ui';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  createEmployeeLeave,
  deleteEmployeeLeave,
  fetchAdminEmployees,
  fetchEmployeeLeave,
  previewEmployeeLeave,
  type AdminEmployee,
  type AdminLeaveRequest,
} from '@/lib/adminHrmApi';
import { getGermanTodayString } from '@/lib/timeUtils';
import { getAdminBackTarget, getRequestedEmployeeId } from '@/lib/adminNavigation';

export default function LeaveSettingsPage() {
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const storeId = activeBranch || user?.assignedBranches?.[0];
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [items, setItems] = useState<AdminLeaveRequest[]>([]);
  const [startDate, setStartDate] = useState(getGermanTodayString());
  const [endDate, setEndDate] = useState(getGermanTodayString());
  const [reason, setReason] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
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
        const requestedEmployeeId = getRequestedEmployeeId();
        const initialEmployeeId = activeEmployees.some((employee) => employee.id === requestedEmployeeId)
          ? requestedEmployeeId
          : activeEmployees[0]?.id ?? '';
        setEmployeeId(initialEmployeeId);
        return loadLeave(initialEmployeeId);
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
      const payload = {
        startDate,
        endDate: allDay ? endDate : startDate,
        allDay,
        ...(!allDay && { startTime, endTime }),
        reason: reason.trim(),
      };
      const preview = await previewEmployeeLeave(storeId, employeeId, payload);
      if (preview.conflictCount > 0) {
        const details = locale === 'vi'
          ? `${preview.conflictCount} lịch bị ảnh hưởng (${preview.automaticCount} lịch có thể tự xếp lại, ${preview.manualCount} lịch cần chủ xử lý). Vẫn tạo đơn nghỉ?`
          : `${preview.conflictCount} bookings are affected. Create leave anyway?`;
        if (!window.confirm(details)) return;
      }
      await createEmployeeLeave(storeId, employeeId, payload);
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
    <section className="mx-auto max-w-2xl space-y-4">
      <HrmPageHeader
        className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl"
        title={locale === 'vi' ? 'Nghỉ phép của thợ' : locale === 'de' ? 'Mitarbeiterurlaub' : 'Employee leave'}
        onBack={() => router.push(getAdminBackTarget())}
      />
        <p className="text-sm leading-6 text-gray-500">
          {locale === 'vi'
            ? 'Ngày nghỉ sẽ tự động khóa thợ trên lịch đặt hẹn.'
            : 'Leave automatically blocks the employee in booking availability.'}
        </p>

      <HrmCard className="p-4">
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
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5 sm:col-span-2">
            <span className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Nghỉ cả ngày' : 'All day'}</span>
            <button type="button" onClick={() => setAllDay((value) => !value)} className={`relative h-6 w-10 rounded-full ${allDay ? 'bg-[var(--hrm-blue-700)]' : 'bg-slate-200'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow ${allDay ? 'left-[18px]' : 'left-0.5'}`} /></button>
          </div>
          {!allDay && <><label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Từ giờ' : 'Start time'}<HrmInput type="time" step="900" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-1.5 font-normal" /></label><label className="text-sm font-semibold text-gray-700">{locale === 'vi' ? 'Đến giờ' : 'End time'}<HrmInput type="time" step="900" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="mt-1.5 font-normal" /></label></>}
          <label className="text-sm font-semibold text-gray-700">
            {locale === 'vi' ? 'Lý do' : 'Reason'}
            <HrmInput
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1.5 font-normal"
            />
          </label>
          <label className="text-sm font-semibold text-gray-700">
            {locale === 'vi' ? 'Từ ngày' : 'From'}
            <HrmInput type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1.5 font-normal" />
          </label>
          <label className="text-sm font-semibold text-gray-700">
            {locale === 'vi' ? 'Đến ngày' : 'To'}
            <HrmInput type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1.5 font-normal" />
          </label>
        </div>
        <HrmButton
          disabled={busy || !employeeId || !reason.trim() || startDate > endDate || (!allDay && startTime >= endTime)}
          onClick={() => void create()}
          className="mt-4 min-h-11 w-full rounded-xl px-4 text-sm font-bold sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          {locale === 'vi' ? 'Thêm ngày nghỉ' : 'Add leave'}
        </HrmButton>
      </HrmCard>

      <div className="space-y-3">
        {items.length === 0 ? (
          <HrmEmptyState icon={<CalendarOff className="h-7 w-7" />} title={locale === 'vi' ? 'Thợ này chưa có ngày nghỉ.' : 'No leave recorded.'} />
        ) : items.map((item) => (
          <HrmCard key={item.id} className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]">
              <CalendarOff className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-950">{item.startDate} → {item.endDate}{item.allDay ? '' : ` · ${item.startTime}–${item.endTime}`}</p>
              <p className="truncate text-sm text-gray-500">{item.reason}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => void remove(item)} className="rounded-xl bg-gray-50 p-2.5 text-gray-400 hover:text-red-600 disabled:opacity-50">
              <Trash2 className="h-4 w-4" />
            </button>
          </HrmCard>
        ))}
      </div>
    </section>
  );
}
