'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CalendarX,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Clock3,
  Pencil,
  Search,
  Thermometer,
  Trash2,
  UserPlus,
  UserRound,
  UserRoundX,
  Wrench,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { HrmButton, HrmIconButton, HrmInput, HrmPageHeader } from '@/components/hrm-ui';
import { useAuth } from '@/lib/authContext';
import { useI18n } from '@/lib/i18n';
import {
  createAdminEmployee,
  createEmployeeLeave,
  deleteEmployeeLeave,
  fetchAdminAttendanceCalendar,
  fetchAdminEmployees,
  fetchEmployeeLeave,
  previewEmployeeLeave,
  updateAdminEmployee,
  type AdminAttendanceItem,
  type AdminEmployee,
  type AdminEmployeeInput,
  type AdminLeaveRequest,
  type AdminLeavePreview,
} from '@/lib/adminHrmApi';
import { fetchHrmServices, type HrmService } from '@/lib/hrmApi';
import { getRequestedEmployeeId } from '@/lib/adminNavigation';

const emptyForm: AdminEmployeeInput = {
  name: '',
  email: '',
  password: '',
  phone: '',
  workerType: 'main',
  compensationModel: 'commission',
  ownerCommissionRate: 50,
  serviceIds: [],
  publicBookingVisible: true,
};

type DetailPeriod = 'week' | 'month';
type EmployeeDetailDialog = 'profile' | 'leaveHistory' | 'leaveCreate' | 'services' | null;
const LEAVE_PREVIEW_PAGE_SIZE = 5;

const formatLocalDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const parseLocalDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const getDetailRange = (anchor: string, period: DetailPeriod) => {
  const anchorDate = parseLocalDate(anchor);
  if (period === 'month') {
    return {
      from: formatLocalDate(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)),
      to: formatLocalDate(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0)),
    };
  }

  const day = anchorDate.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const fromDate = new Date(anchorDate);
  fromDate.setDate(anchorDate.getDate() + mondayOffset);
  const toDate = new Date(fromDate);
  toDate.setDate(fromDate.getDate() + 6);
  return { from: formatLocalDate(fromDate), to: formatLocalDate(toDate) };
};

const formatDetailRange = (from: string, to: string, period: DetailPeriod, locale: string) => {
  const localeName = locale === 'vi' ? 'vi-VN' : locale === 'de' ? 'de-DE' : 'en-GB';
  if (period === 'month') {
    return parseLocalDate(from).toLocaleDateString(localeName, { month: '2-digit', year: 'numeric' });
  }
  const fromLabel = parseLocalDate(from).toLocaleDateString(localeName, { day: '2-digit', month: '2-digit' });
  const toLabel = parseLocalDate(to).toLocaleDateString(localeName, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${fromLabel} - ${toLabel}`;
};

const countSickDays = (leaveItems: AdminLeaveRequest[], rangeFrom: string, rangeTo: string) => {
  const sickDates = new Set<string>();

  leaveItems.forEach((leave) => {
    if (!/ốm|sick|krank/.test(leave.reason.toLocaleLowerCase())) return;
    const overlapFrom = leave.startDate > rangeFrom ? leave.startDate : rangeFrom;
    const overlapTo = leave.endDate < rangeTo ? leave.endDate : rangeTo;
    if (overlapFrom > overlapTo) return;

    const cursor = parseLocalDate(overlapFrom);
    const end = parseLocalDate(overlapTo);
    while (cursor <= end) {
      sickDates.add(formatLocalDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  return sickDates.size;
};

const formatLeavePeriod = (leave: AdminLeaveRequest, locale: string) => {
  const localeName = locale === 'vi' ? 'vi-VN' : locale === 'de' ? 'de-DE' : 'en-GB';
  const formatDate = (value: string) => parseLocalDate(value).toLocaleDateString(localeName, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const dateLabel = leave.startDate === leave.endDate
    ? formatDate(leave.startDate)
    : `${formatDate(leave.startDate)} - ${formatDate(leave.endDate)}`;
  if (!leave.allDay && leave.startTime && leave.endTime) {
    return `${dateLabel} · ${leave.startTime}-${leave.endTime}`;
  }
  return `${dateLabel} · ${locale === 'vi' ? 'Cả ngày' : locale === 'de' ? 'Ganztägig' : 'All day'}`;
};

const getServiceDuration = (service: HrmService) => {
  const duration = service.durationMin ?? service.durationMax;
  return duration ? `${duration} phút` : '';
};

export default function StaffManagementPage() {
  const { user, activeBranch } = useAuth();
  const { locale } = useI18n();
  const router = useRouter();
  const storeId = activeBranch || user?.assignedBranches?.[0];
  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [services, setServices] = useState<HrmService[]>([]);
  const [form, setForm] = useState<AdminEmployeeInput>(emptyForm);
  const [open, setOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<AdminEmployee>();
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedEmployee, setSelectedEmployee] = useState<AdminEmployee>();
  const [detailPeriod, setDetailPeriod] = useState<DetailPeriod>('week');
  const [detailAnchor, setDetailAnchor] = useState(() => formatLocalDate(new Date()));
  const [detailAttendances, setDetailAttendances] = useState<AdminAttendanceItem[]>([]);
  const [detailLeave, setDetailLeave] = useState<AdminLeaveRequest[]>([]);
  const [detailStatsLoading, setDetailStatsLoading] = useState(false);
  const [detailDialog, setDetailDialog] = useState<EmployeeDetailDialog>(null);
  const [detailDialogBusy, setDetailDialogBusy] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileWorkerType, setProfileWorkerType] = useState<'main' | 'assistant'>('main');
  const [profilePublicBookingVisible, setProfilePublicBookingVisible] = useState(true);
  const [leaveStartDate, setLeaveStartDate] = useState(() => formatLocalDate(new Date()));
  const [leaveEndDate, setLeaveEndDate] = useState(() => formatLocalDate(new Date()));
  const [leaveAllDay, setLeaveAllDay] = useState(true);
  const [leaveStartTime, setLeaveStartTime] = useState('09:00');
  const [leaveEndTime, setLeaveEndTime] = useState('10:00');
  const [leaveReason, setLeaveReason] = useState('');
  const [leavePreview, setLeavePreview] = useState<AdminLeavePreview | null>(null);
  const [leavePreviewPage, setLeavePreviewPage] = useState(0);
  const [selectedServiceDraftIds, setSelectedServiceDraftIds] = useState<string[]>([]);
  const [expandedServiceGroupKey, setExpandedServiceGroupKey] = useState<string | null>(null);

  const detailRange = useMemo(
    () => getDetailRange(detailAnchor, detailPeriod),
    [detailAnchor, detailPeriod],
  );

  const filteredEmployees = useMemo(() => employees.filter((employee) => {
    if (statusFilter === 'active' && !employee.active) return false;
    if (statusFilter === 'inactive' && employee.active) return false;
    return employee.name.toLowerCase().includes(query.trim().toLowerCase());
  }), [employees, query, statusFilter]);

  const serviceGroups = useMemo(() => {
    const grouped = new Map<string, { key: string; label: string; services: HrmService[] }>();
    services.forEach((service) => {
      const label = service.groupService?.trim() || service.category?.trim() || (locale === 'vi' ? 'Dịch vụ khác' : 'Other services');
      const key = label.toLocaleLowerCase();
      const group = grouped.get(key) ?? { key, label, services: [] };
      group.services.push(service);
      grouped.set(key, group);
    });
    return [...grouped.values()].map((group) => ({
      ...group,
      services: [...group.services].sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name)),
    }));
  }, [locale, services]);

  const leavePreviewPageCount = Math.max(1, Math.ceil((leavePreview?.conflicts.length ?? 0) / LEAVE_PREVIEW_PAGE_SIZE));
  const visibleLeaveConflicts = leavePreview?.conflicts.slice(
    leavePreviewPage * LEAVE_PREVIEW_PAGE_SIZE,
    (leavePreviewPage + 1) * LEAVE_PREVIEW_PAGE_SIZE,
  ) ?? [];

  const load = useCallback(async () => {
    if (!storeId) return;
    const [employeeItems, serviceItems] = await Promise.all([
      fetchAdminEmployees(storeId),
      fetchHrmServices(storeId),
    ]);
    setEmployees(employeeItems);
    setServices(serviceItems);
  }, [storeId]);

  useEffect(() => {
    if (user?.role !== 'owner') return;
    void load().catch((error: unknown) => console.error(error));
  }, [user, load]);

  useEffect(() => {
    const requestedEmployeeId = getRequestedEmployeeId();
    if (!requestedEmployeeId) return;
    const requestedEmployee = employees.find((employee) => employee.id === requestedEmployeeId);
    if (requestedEmployee) setSelectedEmployee(requestedEmployee);
  }, [employees]);

  useEffect(() => {
    if (!storeId || !selectedEmployee) return;
    let active = true;
    setDetailStatsLoading(true);
    Promise.all([
      fetchAdminAttendanceCalendar(storeId, detailRange.from, detailRange.to),
      fetchEmployeeLeave(storeId, selectedEmployee.id),
    ]).then(([attendanceItems, leaveItems]) => {
      if (!active) return;
      setDetailAttendances(attendanceItems.filter((attendance) =>
        attendance.mainAssigneeUserId === selectedEmployee.id ||
        attendance.employeeUserId === selectedEmployee.id ||
        attendance.services.some((service) => service.employees.some((employee) => employee.employeeId === selectedEmployee.id)),
      ));
      setDetailLeave(leaveItems);
    }).catch((error: unknown) => {
      console.error('Could not load employee detail statistics:', error);
      if (active) {
        setDetailAttendances([]);
        setDetailLeave([]);
      }
    }).finally(() => {
      if (active) setDetailStatsLoading(false);
    });
    return () => { active = false; };
  }, [detailRange.from, detailRange.to, selectedEmployee, storeId]);

  const moveDetailRange = (direction: -1 | 1) => {
    const nextDate = parseLocalDate(detailAnchor);
    if (detailPeriod === 'week') nextDate.setDate(nextDate.getDate() + direction * 7);
    else nextDate.setMonth(nextDate.getMonth() + direction);
    setDetailAnchor(formatLocalDate(nextDate));
  };

  if (user?.role !== 'owner') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        {locale === 'vi'
          ? 'Chỉ chủ tiệm được tạo và thay đổi tài khoản thợ.'
          : locale === 'de'
            ? 'Nur der Inhaber kann Mitarbeiterkonten verwalten.'
            : 'Only the owner may manage employee accounts.'}
      </div>
    );
  }

  const save = async () => {
    if (!storeId || !form.name.trim() || (!editingEmployee && (!form.email.trim() || form.password.length < 6))) return;
    setBusy(true);
    try {
      if (editingEmployee) {
        await updateAdminEmployee(storeId, editingEmployee.id, {
          name: form.name.trim(),
          workerType: form.workerType,
          serviceIds: form.serviceIds,
          publicBookingVisible: form.publicBookingVisible,
        });
      } else {
        await createAdminEmployee(storeId, {
          ...form,
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone?.trim() || undefined,
        });
      }
      setOpen(false);
      setEditingEmployee(undefined);
      setSelectedEmployee(undefined);
      setForm(emptyForm);
      await load();
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not create employee');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (employee: AdminEmployee) => {
    if (!storeId) return;
    setBusy(true);
    try {
      await updateAdminEmployee(storeId, employee.id, { active: !employee.active });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openEmployeeDetail = (employee: AdminEmployee) => {
    setSelectedEmployee(employee);
    router.replace(`/admin/dashboard/staff/?employeeId=${encodeURIComponent(employee.id)}`);
  };

  const closeEmployeeDetail = () => {
    setDetailDialog(null);
    setSelectedEmployee(undefined);
    router.replace('/admin/dashboard/staff/');
  };

  const openProfileEditor = (employee: AdminEmployee) => {
    setProfileName(employee.name);
    setProfileWorkerType(employee.workerType ?? 'main');
    setProfilePublicBookingVisible(employee.publicBookingVisible !== false);
    setDetailDialog('profile');
  };

  const openLeaveHistory = async (employee: AdminEmployee) => {
    setDetailDialog('leaveHistory');
    if (!storeId) return;
    setDetailDialogBusy(true);
    try {
      setDetailLeave(await fetchEmployeeLeave(storeId, employee.id));
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not load leave requests');
    } finally {
      setDetailDialogBusy(false);
    }
  };

  const openLeaveEditor = () => {
    const today = formatLocalDate(new Date());
    setLeaveStartDate(today);
    setLeaveEndDate(today);
    setLeaveAllDay(true);
    setLeaveReason('');
    setLeavePreview(null);
    setLeavePreviewPage(0);
    setDetailDialog('leaveCreate');
  };

  const openServiceEditor = (employee: AdminEmployee) => {
    setSelectedServiceDraftIds(employee.serviceIds ?? services.map((service) => service.id));
    setExpandedServiceGroupKey(serviceGroups[0]?.key ?? null);
    setDetailDialog('services');
  };

  const updateSelectedEmployeeLocally = (updates: Partial<AdminEmployee>) => {
    if (!selectedEmployee) return;
    const nextEmployee = { ...selectedEmployee, ...updates };
    setSelectedEmployee(nextEmployee);
    setEmployees((current) => current.map((employee) => employee.id === nextEmployee.id ? nextEmployee : employee));
  };

  const saveProfile = async () => {
    if (!storeId || !selectedEmployee || !profileName.trim()) return;
    setDetailDialogBusy(true);
    try {
      const updates = {
        name: profileName.trim(),
        workerType: profileWorkerType,
        publicBookingVisible: profilePublicBookingVisible,
      };
      await updateAdminEmployee(storeId, selectedEmployee.id, updates);
      updateSelectedEmployeeLocally(updates);
      setDetailDialog(null);
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not update employee');
    } finally {
      setDetailDialogBusy(false);
    }
  };

  const createLeave = async () => {
    if (!storeId || !selectedEmployee || !leaveReason.trim() || leaveEndDate < leaveStartDate) return;
    setDetailDialogBusy(true);
    try {
      const payload = {
        startDate: leaveStartDate,
        endDate: leaveAllDay ? leaveEndDate : leaveStartDate,
        allDay: leaveAllDay,
        ...(!leaveAllDay && { startTime: leaveStartTime, endTime: leaveEndTime }),
        reason: leaveReason.trim(),
      };
      const preview = await previewEmployeeLeave(storeId, selectedEmployee.id, payload);
      if (preview.conflictCount > 0) {
        setLeavePreviewPage(0);
        setLeavePreview(preview);
        return;
      }
      await createEmployeeLeave(storeId, selectedEmployee.id, payload);
      setDetailLeave(await fetchEmployeeLeave(storeId, selectedEmployee.id));
      setDetailDialog(null);
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not create leave request');
    } finally {
      setDetailDialogBusy(false);
    }
  };

  const confirmLeaveWithConflicts = async () => {
    if (!storeId || !selectedEmployee || !leavePreview) return;
    setDetailDialogBusy(true);
    try {
      await createEmployeeLeave(storeId, selectedEmployee.id, {
        startDate: leaveStartDate,
        endDate: leaveAllDay ? leaveEndDate : leaveStartDate,
        allDay: leaveAllDay,
        ...(!leaveAllDay && { startTime: leaveStartTime, endTime: leaveEndTime }),
        reason: leaveReason.trim(),
      });
      setDetailLeave(await fetchEmployeeLeave(storeId, selectedEmployee.id));
      setLeavePreview(null);
      setDetailDialog(null);
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not create leave request');
    } finally {
      setDetailDialogBusy(false);
    }
  };

  const removeLeave = async (leaveRequestId: string) => {
    if (!storeId || !selectedEmployee) return;
    setDetailDialogBusy(true);
    try {
      await deleteEmployeeLeave(storeId, selectedEmployee.id, leaveRequestId);
      setDetailLeave((current) => current.filter((leave) => leave.id !== leaveRequestId));
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not delete leave request');
    } finally {
      setDetailDialogBusy(false);
    }
  };

  const saveEmployeeServices = async () => {
    if (!storeId || !selectedEmployee) return;
    setDetailDialogBusy(true);
    try {
      await updateAdminEmployee(storeId, selectedEmployee.id, { serviceIds: selectedServiceDraftIds });
      updateSelectedEmployeeLocally({ serviceIds: selectedServiceDraftIds });
      setDetailDialog(null);
    } catch (error: unknown) {
      window.alert(error instanceof Error ? error.message : 'Could not update employee services');
    } finally {
      setDetailDialogBusy(false);
    }
  };

  // Keep rendering the shared page shell while the editor is open. Returning
  // the detail view unconditionally used to hide the dialog until the user
  // pressed Back, even though `open` had already been set to true.
  if (selectedEmployee && !open) {
    const assignedServiceIds = selectedEmployee.serviceIds ?? services.map((service) => service.id);
    const selectedServices = services.filter((service) => assignedServiceIds.includes(service.id));
    const cancelledCount = detailAttendances.filter((attendance) => attendance.bookingStatus === 'cancelled').length;
    const noShowCount = detailAttendances.filter((attendance) => attendance.bookingStatus === 'no_show').length;
    const sickDayCount = countSickDays(detailLeave, detailRange.from, detailRange.to);
    const statValue = (value: number) => detailStatsLoading ? '—' : value;
    const detailMenuItems = [
      {
        title: locale === 'vi' ? 'Chấm công' : 'Attendance',
        subtitle: locale === 'vi' ? 'Danh sách theo nhân viên' : 'Employee attendance list',
        highlight: true,
        hideArrow: true,
        onClick: () => router.push(`/admin/dashboard/staff/attendance/?employeeId=${encodeURIComponent(selectedEmployee.id)}`),
      },
      {
        title: locale === 'vi' ? 'Hồ sơ' : 'Profile',
        subtitle: locale === 'vi' ? 'Thông tin cá nhân' : 'Personal information',
        onClick: () => openProfileEditor(selectedEmployee),
      },
      {
        title: locale === 'vi' ? 'Đơn nghỉ' : 'Leave requests',
        subtitle: locale === 'vi' ? 'Danh sách đơn đã gửi' : 'Submitted requests',
        onClick: () => void openLeaveHistory(selectedEmployee),
      },
      {
        title: locale === 'vi' ? 'Nghỉ phép' : 'Leave',
        subtitle: locale === 'vi' ? 'Tạo đơn nghỉ' : 'Create leave request',
        onClick: openLeaveEditor,
      },
      {
        title: locale === 'vi' ? 'Dịch vụ' : 'Services',
        subtitle: `${selectedServices.length}/${services.length} ${locale === 'vi' ? 'dịch vụ' : 'services'}`,
        onClick: () => openServiceEditor(selectedEmployee),
      },
    ];
    return (
      <section className="mx-auto max-w-2xl space-y-3 pb-4">
        <HrmPageHeader
          className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl"
          title={locale === 'vi' ? 'Chi tiết nhân viên' : 'Employee details'}
          onBack={closeEmployeeDetail}
          right={<HrmIconButton aria-label={locale === 'vi' ? 'Sửa hồ sơ nhân viên' : 'Edit employee profile'} onClick={() => openProfileEditor(selectedEmployee)} className="text-[var(--hrm-blue-700)]"><Pencil className="h-5 w-5" /></HrmIconButton>}
        />
        <div className="relative overflow-hidden rounded-2xl bg-white shadow-[var(--hrm-shadow-card)]">
          <div className="h-20 bg-[var(--hrm-blue-700)]" />
          <div className="relative px-4 pb-4 pt-10">
            <div className="absolute -top-9 left-4 flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white bg-[var(--hrm-blue-50)] text-lg font-bold text-[var(--hrm-blue-700)] shadow-sm">{selectedEmployee.name.slice(0, 2).toUpperCase()}</div>
            <span className="absolute right-4 top-3 rounded-full bg-[var(--hrm-blue-50)] px-3 py-1.5 text-[11px] font-bold text-[var(--hrm-blue-700)]">{selectedEmployee.active ? (locale === 'vi' ? 'Đang làm' : 'Active') : (locale === 'vi' ? 'Đã nghỉ' : 'Inactive')}</span>
            <h2 className="truncate text-lg font-bold text-slate-950">{selectedEmployee.name}</h2>
            <p className="mt-0.5 text-sm font-medium text-slate-500">{selectedEmployee.workerType === 'assistant' ? (locale === 'vi' ? 'Thợ phụ' : 'Assistant') : (locale === 'vi' ? 'Thợ chính' : 'Main staff')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-[var(--hrm-shadow-card)]">
          <div className="flex rounded-full bg-slate-100 p-1">
            {(['week', 'month'] as const).map((period) => <button key={period} onClick={() => setDetailPeriod(period)} className={`min-h-8 rounded-full px-3 text-xs font-bold transition sm:px-4 ${detailPeriod === period ? 'bg-[var(--hrm-blue-700)] text-white shadow-md' : 'text-slate-500'}`}>{period === 'week' ? (locale === 'vi' ? 'Tuần' : 'Week') : (locale === 'vi' ? 'Tháng' : 'Month')}</button>)}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <button onClick={() => moveDetailRange(-1)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-[var(--hrm-shadow-card)]"><ChevronLeft className="h-4 w-4" /></button>
            <strong className="min-w-[86px] text-center text-[11px] text-slate-950 sm:min-w-[118px] sm:text-xs">{formatDetailRange(detailRange.from, detailRange.to, detailPeriod, locale)}</strong>
            <button onClick={() => moveDetailRange(1)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-[var(--hrm-shadow-card)]"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: CalendarCheck, label: locale === 'vi' ? 'Tổng lượt hẹn' : 'Appointments', value: statValue(detailAttendances.length) },
            { icon: CalendarX, label: locale === 'vi' ? 'Lịch hủy' : 'Cancelled', value: statValue(cancelledCount) },
            { icon: UserRoundX, label: locale === 'vi' ? 'Không tới' : 'No-show', value: statValue(noShowCount) },
            { icon: Thermometer, label: locale === 'vi' ? 'Ngày ốm' : 'Sick days', value: statValue(sickDayCount) },
          ].map((stat) => (
            <div key={stat.label} className="flex min-h-[76px] items-center gap-3 rounded-2xl bg-white p-3 shadow-[var(--hrm-shadow-card)]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]"><stat.icon className="h-4 w-4 stroke-[1.8]" /></span>
              <span className="min-w-0"><span className="block text-xs font-medium leading-tight text-slate-500">{stat.label}</span><strong className="mt-1 block text-lg font-bold text-slate-950">{stat.value}</strong></span>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-[var(--hrm-shadow-card)]">
          {detailMenuItems.map((item, index) => (
            <button key={item.title} onClick={item.onClick} className={`flex min-h-[58px] w-full items-center gap-3 px-4 text-left ${item.highlight ? 'bg-[var(--hrm-blue-50)]' : 'bg-white'} ${index ? 'border-t border-slate-100' : ''}`}>
              <span className="min-w-0 flex-1"><strong className={`block truncate text-sm font-semibold leading-tight ${item.highlight ? 'text-[var(--hrm-blue-700)]' : 'text-slate-950'}`}>{item.title}</strong><span className={`mt-0.5 block truncate text-xs font-medium leading-tight ${item.highlight ? 'text-blue-600' : 'text-slate-500'}`}>{item.subtitle}</span></span>
              {item.hideArrow ? null : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
            </button>
          ))}
        </div>

        {!selectedEmployee.active && (
          <HrmButton variant="outline" disabled={busy} onClick={() => void toggleActive(selectedEmployee)} className="min-h-11 w-full rounded-xl text-[var(--hrm-blue-700)]">{locale === 'vi' ? 'Kích hoạt lại' : 'Reactivate'}</HrmButton>
        )}

        {detailDialog === 'profile' && (
          <dialog open className="animate-fade-in fixed inset-0 z-[102] m-0 h-full max-h-none w-full max-w-none border-0 bg-black/40 p-0" aria-labelledby="booking-employee-profile-title">
            <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={() => setDetailDialog(null)} aria-label="Đóng hồ sơ nhân viên" />
            <section className="booking-admin-centered-dialog-panel animate-modal-in fixed flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-[#F7F7F7] bg-white shadow-xl">
              <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
                <h3 id="booking-employee-profile-title" className="truncate text-base font-semibold text-slate-950">{locale === 'vi' ? 'Hồ sơ nhân viên' : 'Employee profile'}</h3>
                <button type="button" onClick={() => setDetailDialog(null)} disabled={detailDialogBusy} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 disabled:opacity-60" aria-label="Đóng"><X className="h-4 w-4" /></button>
              </div>
              <div className="hrm-scrollbar-hidden flex-1 overflow-y-auto px-4 py-4">
                <div className="grid gap-4">
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-slate-600">{locale === 'vi' ? 'Họ tên' : 'Name'}</span>
                    <span className="flex h-11 items-center rounded-xl border border-[#E1EDFF] bg-white px-3 shadow-[0_1px_2px_0_rgba(16,24,40,0.06),0_1px_3px_0_rgba(16,24,40,0.10)] transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                      <input value={profileName} onChange={(event) => setProfileName(event.target.value)} className="h-full min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400" placeholder={locale === 'vi' ? 'Tên nhân viên' : 'Employee name'} />
                    </span>
                  </label>
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-slate-600">{locale === 'vi' ? 'Loại thợ' : 'Staff type'}</span>
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                      {([['main', locale === 'vi' ? 'Thợ chính' : 'Main staff'], ['assistant', locale === 'vi' ? 'Thợ phụ' : 'Assistant']] as const).map(([value, label]) => (
                        <button key={value} type="button" onClick={() => setProfileWorkerType(value)} className={`h-10 rounded-lg px-3 text-sm font-semibold transition ${profileWorkerType === value ? 'bg-[var(--hrm-blue-700)] text-white shadow-sm' : 'text-slate-500 hover:bg-white/70'}`}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex min-h-14 items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                    <span className="min-w-0">
                      <strong className="block text-sm font-semibold text-slate-900">{locale === 'vi' ? 'Hiển thị trên Booking' : 'Visible on Booking'}</strong>
                      <span className="mt-0.5 block text-xs font-medium text-slate-500">{locale === 'vi' ? 'Cho khách chọn và cho phép tự động xếp lịch.' : 'Allow customers and auto-assignment to use this employee.'}</span>
                    </span>
                    <button type="button" onClick={() => setProfilePublicBookingVisible((value) => !value)} className={`relative h-6 w-10 shrink-0 rounded-full transition ${profilePublicBookingVisible ? 'bg-[var(--hrm-blue-700)]' : 'bg-slate-300'}`} aria-pressed={profilePublicBookingVisible}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${profilePublicBookingVisible ? 'left-[18px]' : 'left-0.5'}`} /></button>
                  </div>
                </div>
              </div>
              <div className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
                <button type="button" onClick={() => void saveProfile()} disabled={detailDialogBusy || !profileName.trim()} className="flex h-12 w-full items-center justify-center rounded-xl bg-[var(--hrm-blue-700)] text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgba(29,78,216,0.55)] disabled:bg-blue-300">{detailDialogBusy ? '...' : locale === 'vi' ? 'Lưu' : 'Save'}</button>
              </div>
            </section>
          </dialog>
        )}

        {detailDialog === 'leaveCreate' && (
          <dialog open className="animate-fade-in fixed inset-0 z-[102] m-0 h-full max-h-none w-full max-w-none border-0 bg-black/40 p-0" aria-labelledby="booking-employee-leave-title">
            <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={() => setDetailDialog(null)} aria-label="Đóng tạo đơn nghỉ" />
            <section className="booking-admin-centered-dialog-panel animate-modal-in fixed flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-[#F7F7F7] bg-white shadow-xl">
              <div className="mx-auto mt-3 h-1 w-12 rounded-full bg-slate-300" />
              <div className="flex items-center justify-between gap-3 px-5 pt-5">
                <h3 id="booking-employee-leave-title" className="truncate text-base font-bold text-slate-950">{locale === 'vi' ? 'Tạo đơn nghỉ' : 'Create leave request'}</h3>
                <button type="button" onClick={() => setDetailDialog(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100" aria-label="Đóng"><X className="h-5 w-5" /></button>
              </div>
              <div className="hrm-scrollbar-hidden flex-1 overflow-y-auto px-5 py-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{locale === 'vi' ? 'Từ ngày' : 'From'}</span><input type="date" value={leaveStartDate} onChange={(event) => { const value = event.target.value; setLeaveStartDate(value); if (leaveEndDate < value) setLeaveEndDate(value); }} className="h-11 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
                  <label className="flex flex-col gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{locale === 'vi' ? 'Đến ngày' : 'To'}</span><input type="date" min={leaveStartDate} value={leaveEndDate} onChange={(event) => setLeaveEndDate(event.target.value)} className="h-11 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
                </div>
                <div className="mt-3 flex h-10 items-center justify-between rounded-lg border border-slate-200 bg-white px-3">
                  <span className="text-sm font-semibold text-slate-800">{locale === 'vi' ? 'Cả ngày' : 'All day'}</span>
                  <button type="button" onClick={() => setLeaveAllDay((value) => !value)} className={`relative h-6 w-10 rounded-full transition ${leaveAllDay ? 'bg-[var(--hrm-blue-700)]' : 'bg-slate-200'}`} aria-pressed={leaveAllDay}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition ${leaveAllDay ? 'left-[18px]' : 'left-0.5'}`} /></button>
                </div>
                {!leaveAllDay && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{locale === 'vi' ? 'Từ giờ' : 'Start time'}</span><input type="time" step="900" value={leaveStartTime} onChange={(event) => setLeaveStartTime(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold" /></label>
                    <label className="flex flex-col gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{locale === 'vi' ? 'Đến giờ' : 'End time'}</span><input type="time" step="900" value={leaveEndTime} onChange={(event) => setLeaveEndTime(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold" /></label>
                  </div>
                )}
                <label className="mt-3 flex flex-col gap-1.5"><span className="text-[11px] font-semibold text-slate-500">{locale === 'vi' ? 'Lý do' : 'Reason'}</span><input value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100" placeholder={locale === 'vi' ? 'Du lịch gia đình' : 'Family holiday'} /></label>
              </div>
              <div className="px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
                <button type="button" onClick={() => void createLeave()} disabled={detailDialogBusy || !leaveReason.trim() || leaveEndDate < leaveStartDate || (!leaveAllDay && leaveStartTime >= leaveEndTime)} className="flex h-12 w-full items-center justify-center rounded-xl bg-[var(--hrm-blue-700)] text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgba(29,78,216,0.55)] disabled:bg-blue-300">{detailDialogBusy ? (locale === 'vi' ? 'Đang kiểm tra...' : 'Checking...') : (locale === 'vi' ? 'Kiểm tra và tạo đơn' : 'Review and create')}</button>
              </div>
            </section>
          </dialog>
        )}

        {leavePreview && (
          <dialog open className="fixed inset-0 z-[106] m-0 h-full max-h-none w-full max-w-none border-0 bg-black/50 p-0" aria-labelledby="leave-conflict-preview-title">
            <section className="booking-admin-centered-dialog-panel fixed flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between px-5 pb-3 pt-5"><div><h3 id="leave-conflict-preview-title" className="text-base font-bold text-slate-950">{locale === 'vi' ? 'Lịch bị ảnh hưởng' : 'Affected bookings'}</h3><p className="mt-1 text-xs font-medium text-slate-500">{leavePreview.conflictCount} {locale === 'vi' ? 'lịch trùng thời gian nghỉ' : 'conflicting bookings'}</p></div><button type="button" onClick={() => { setLeavePreview(null); setLeavePreviewPage(0); }} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100"><X className="h-5 w-5" /></button></div>
              <div className="grid grid-cols-2 gap-2 px-5 pb-3">
                <div className="rounded-xl bg-blue-50 px-3 py-2"><span className="block text-[10px] font-bold uppercase tracking-wide text-blue-600">{locale === 'vi' ? 'Tự xếp lại' : 'Auto reassign'}</span><strong className="mt-0.5 block text-lg text-blue-700">{leavePreview.automaticCount}</strong></div>
                <div className="rounded-xl bg-amber-50 px-3 py-2"><span className="block text-[10px] font-bold uppercase tracking-wide text-amber-600">{locale === 'vi' ? 'Cần xử lý' : 'Manual action'}</span><strong className="mt-0.5 block text-lg text-amber-700">{leavePreview.manualCount}</strong></div>
              </div>
              <div className="hrm-scrollbar-hidden flex-1 space-y-2 overflow-y-auto px-5 py-2">{visibleLeaveConflicts.map((conflict) => <article key={conflict.attendanceId} className="rounded-xl border border-slate-200 p-3"><div className="flex justify-between gap-3"><strong className="text-sm text-slate-950">{conflict.attendanceCode ? `${conflict.attendanceCode} · ` : ''}{conflict.workDate} · {String(Math.floor(conflict.startTime / 60)).padStart(2, '0')}:{String(conflict.startTime % 60).padStart(2, '0')}–{String(Math.floor(conflict.endTime / 60)).padStart(2, '0')}:{String(conflict.endTime % 60).padStart(2, '0')}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${conflict.resolution === 'auto_reassign' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{conflict.resolution === 'auto_reassign' ? (locale === 'vi' ? 'Tự xếp lại' : 'Auto reassign') : (locale === 'vi' ? 'Cần xử lý' : 'Manual action')}</span></div><p className="mt-1 text-xs font-semibold text-slate-700">{conflict.customerName} · {conflict.services.join(', ')}</p></article>)}</div>
              {leavePreviewPageCount > 1 && <div className="flex items-center justify-center gap-3 border-t border-slate-100 px-5 py-2"><button type="button" onClick={() => setLeavePreviewPage((page) => Math.max(0, page - 1))} disabled={leavePreviewPage === 0} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 disabled:opacity-35" aria-label={locale === 'vi' ? 'Trang trước' : 'Previous page'}><ChevronLeft className="h-4 w-4" /></button><span className="text-xs font-bold text-slate-600">{leavePreviewPage + 1}/{leavePreviewPageCount}</span><button type="button" onClick={() => setLeavePreviewPage((page) => Math.min(leavePreviewPageCount - 1, page + 1))} disabled={leavePreviewPage >= leavePreviewPageCount - 1} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 disabled:opacity-35" aria-label={locale === 'vi' ? 'Trang sau' : 'Next page'}><ChevronRight className="h-4 w-4" /></button></div>}
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4"><button type="button" onClick={() => { setLeavePreview(null); setLeavePreviewPage(0); }} className="h-11 rounded-xl border border-slate-200 text-sm font-bold">{locale === 'vi' ? 'Quay lại' : 'Back'}</button><button type="button" onClick={() => void confirmLeaveWithConflicts()} disabled={detailDialogBusy} className="h-11 rounded-xl bg-[var(--hrm-blue-700)] text-sm font-bold text-white">{locale === 'vi' ? 'Vẫn tạo đơn' : 'Create anyway'}</button></div>
            </section>
          </dialog>
        )}

        {detailDialog === 'leaveHistory' && (
          <dialog open className="animate-fade-in fixed inset-0 z-[102] m-0 h-full max-h-none w-full max-w-none border-0 bg-black/40 p-0" aria-labelledby="booking-employee-leave-history-title">
            <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={() => setDetailDialog(null)} aria-label="Đóng lịch sử nghỉ phép" />
            <section className="booking-admin-centered-dialog-panel animate-modal-in fixed flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-[#F7F7F7] bg-white shadow-xl">
              <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
                <h3 id="booking-employee-leave-history-title" className="truncate text-base font-bold text-slate-950">{locale === 'vi' ? 'Lịch sử nghỉ phép' : 'Leave history'}</h3>
                <button type="button" onClick={() => setDetailDialog(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200" aria-label="Đóng"><X className="h-5 w-5" /></button>
              </div>
              <div className="hrm-scrollbar-hidden flex-1 overflow-y-auto px-5 py-3">
                {detailDialogBusy && detailLeave.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-950">{locale === 'vi' ? 'Đang tải lịch sử nghỉ phép...' : 'Loading leave history...'}</div>
                ) : detailLeave.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center"><p className="text-sm font-bold text-slate-950">{locale === 'vi' ? 'Chưa có đơn nghỉ' : 'No leave requests'}</p><p className="mt-1 text-xs font-medium text-slate-500">{locale === 'vi' ? 'Các đơn nghỉ đã tạo sẽ hiển thị tại đây.' : 'Created leave requests will appear here.'}</p></div>
                ) : (
                  <div className="grid gap-3">
                    {detailLeave.map((leave) => {
                      const date = parseLocalDate(leave.startDate);
                      return (
                        <article key={leave.id} className="relative overflow-hidden rounded-xl border border-[#F7F7F7] bg-white p-4 pl-5 shadow-[0_1px_2px_0_rgba(16,24,40,0.06),0_1px_3px_0_rgba(16,24,40,0.10)]">
                          <span className="absolute bottom-0 left-0 top-0 w-1 bg-[var(--hrm-blue-700)]" />
                          <div className="grid grid-cols-[70px_1fr_36px] items-start gap-3">
                            <div className="min-w-0 border-r border-slate-100 pr-3"><strong className="block text-xl leading-tight text-[var(--hrm-blue-700)]">{String(date.getDate()).padStart(2, '0')}</strong><span className="mt-1 block text-sm font-medium text-slate-500">{String(date.getMonth() + 1).padStart(2, '0')}/{date.getFullYear()}</span></div>
                            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-[var(--hrm-blue-50)] px-2 py-1 text-xs font-bold text-[var(--hrm-blue-700)]">{locale === 'vi' ? 'Nghỉ phép' : 'Leave'}</span><span className="flex items-center gap-1 text-xs font-semibold text-slate-500"><Clock3 className="h-3.5 w-3.5" />{formatLeavePeriod(leave, locale)}</span></div><p className="mt-2 break-words text-sm font-medium leading-snug text-slate-700">{locale === 'vi' ? 'Lý do' : 'Reason'}: {leave.reason}</p></div>
                            <button type="button" onClick={() => void removeLeave(leave.id)} disabled={detailDialogBusy} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50" aria-label={locale === 'vi' ? 'Xóa đơn nghỉ' : 'Delete leave request'}><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3"><button type="button" onClick={() => setDetailDialog(null)} className="flex h-12 w-full items-center justify-center rounded-xl border border-blue-200 bg-white text-sm font-bold text-[var(--hrm-blue-700)]">{locale === 'vi' ? 'Đóng' : 'Close'}</button></div>
            </section>
          </dialog>
        )}

        {detailDialog === 'services' && (
          <dialog open className="animate-fade-in fixed inset-0 z-[102] m-0 h-full max-h-none w-full max-w-none border-0 bg-black/40 p-0" aria-labelledby="booking-employee-services-title">
            <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={() => setDetailDialog(null)} aria-label="Đóng dịch vụ nhân viên" />
            <section className="booking-admin-centered-dialog-panel animate-modal-in fixed flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border border-[#F7F7F7] bg-white shadow-xl">
              <div className="mx-auto mt-3 h-1 w-12 rounded-full bg-slate-300" />
              <div className="flex items-center justify-between gap-3 px-5 pt-4"><h3 id="booking-employee-services-title" className="truncate text-base font-bold text-slate-950">{locale === 'vi' ? 'Dịch vụ có thể làm' : 'Available services'}</h3><button type="button" onClick={() => setDetailDialog(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200" aria-label="Đóng"><X className="h-5 w-5" /></button></div>
              <div className="flex justify-end px-5 pt-3"><button type="button" onClick={() => setSelectedServiceDraftIds(selectedServiceDraftIds.length === services.length ? [] : services.map((service) => service.id))} disabled={services.length === 0} className="text-xs font-bold text-[var(--hrm-blue-700)] disabled:opacity-40">{selectedServiceDraftIds.length === services.length ? (locale === 'vi' ? 'Bỏ chọn tất cả' : 'Clear all') : (locale === 'vi' ? 'Chọn tất cả' : 'Select all')}</button></div>
              <div className="hrm-scrollbar-hidden flex-1 overflow-y-auto px-5 py-4">
                {services.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center"><p className="text-sm font-semibold text-slate-950">{locale === 'vi' ? 'Chưa có dịch vụ' : 'No services'}</p><p className="mt-1 text-xs font-medium text-slate-500">{locale === 'vi' ? 'Thêm dịch vụ trong màn quản lý dịch vụ trước.' : 'Add services in service management first.'}</p></div>
                ) : (
                  <div className="grid gap-2">
                    {serviceGroups.map((group) => {
                      const expanded = expandedServiceGroupKey === group.key;
                      const selectedInGroup = group.services.filter((service) => selectedServiceDraftIds.includes(service.id)).length;
                      return (
                        <section key={group.key} className="overflow-hidden rounded-xl border border-[#F7F7F7] bg-white shadow-[0_1px_2px_0_rgba(16,24,40,0.06),0_1px_3px_0_rgba(16,24,40,0.10)]">
                          <div className="flex min-h-[54px] items-center gap-2 px-3"><button type="button" onClick={() => setExpandedServiceGroupKey(expanded ? null : group.key)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-bold text-slate-950">{group.label}</span></button><button type="button" onClick={() => { const groupIds = group.services.map((service) => service.id); setSelectedServiceDraftIds((current) => selectedInGroup === groupIds.length ? current.filter((id) => !groupIds.includes(id)) : [...new Set([...current, ...groupIds])]); }} className="shrink-0 text-xs font-bold text-[var(--hrm-blue-700)]">{selectedInGroup}/{group.services.length}</button><button type="button" onClick={() => setExpandedServiceGroupKey(expanded ? null : group.key)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500" aria-label={expanded ? 'Thu gọn' : 'Mở rộng'}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></div>
                          {expanded && <div className="border-t border-slate-100 px-3 py-1">{group.services.map((service) => { const selected = selectedServiceDraftIds.includes(service.id); return <label key={service.id} className="flex min-h-[42px] w-full cursor-pointer items-center gap-3 text-left"><input type="checkbox" checked={selected} onChange={() => setSelectedServiceDraftIds((current) => selected ? current.filter((id) => id !== service.id) : [...current, service.id])} className="h-5 w-5 shrink-0 rounded-md accent-[var(--hrm-blue-700)]" /><span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{service.displayName || service.name}</span><span className="shrink-0 text-xs font-medium text-slate-500">{getServiceDuration(service)}</span></label>; })}</div>}
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 px-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-3 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]"><button type="button" onClick={() => void saveEmployeeServices()} disabled={detailDialogBusy} className="h-11 w-full rounded-xl bg-[var(--hrm-blue-700)] px-6 text-sm font-bold text-white disabled:opacity-60">{detailDialogBusy ? (locale === 'vi' ? 'Đang lưu...' : 'Saving...') : (locale === 'vi' ? 'Lưu' : 'Save')}</button></div>
            </section>
          </dialog>
        )}
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <HrmPageHeader
        className="-mx-4 -mt-4 md:mx-0 md:mt-0 md:rounded-xl"
        title={locale === 'vi' ? 'Nhân sự' : locale === 'de' ? 'Mitarbeiter' : 'Staff'}
        onBack={() => router.push('/admin/dashboard/')}
      />

      <div className="flex h-10 items-center gap-3 rounded-full border border-slate-200 bg-white px-4 text-slate-400"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={locale === 'vi' ? 'Tìm kiếm nhân viên' : 'Search employees'} className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-950 outline-none" /></div>
      <div className="hrm-scrollbar-hidden flex gap-2 overflow-x-auto">
        {([['all', locale === 'vi' ? 'Tất cả' : 'All'], ['active', locale === 'vi' ? 'Hoạt động' : 'Active'], ['inactive', locale === 'vi' ? 'Đã nghỉ' : 'Inactive']] as const).map(([value, label]) => <button key={value} onClick={() => setStatusFilter(value)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${statusFilter === value ? 'bg-[var(--hrm-blue-700)] text-white' : 'bg-[var(--hrm-blue-50)] text-[var(--hrm-blue-700)]'}`}>{label}</button>)}
      </div>

      <button onClick={() => { setEditingEmployee(undefined); setForm(emptyForm); setOpen(true); }} className="flex w-full items-center gap-3 bg-transparent py-2 text-left">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--hrm-blue-700)] text-white"><UserPlus className="h-5 w-5 stroke-[1.8]" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-950">{locale === 'vi' ? 'Thêm nhân viên' : 'Add employee'}</span></span>
        <CircleHelp className="h-5 w-5 text-[var(--hrm-blue-700)]" />
      </button>

      <div>
        <h2 className="mb-1 text-base font-semibold text-gray-950">{locale === 'vi' ? 'Danh sách' : 'List'}</h2>
        <div className="space-y-1">
          {filteredEmployees.map((employee) => (
            <button key={employee.id} onClick={() => openEmployeeDetail(employee)} className={`flex min-h-[60px] w-full items-center gap-3 py-1 text-left transition active:bg-slate-50 ${employee.active ? '' : 'opacity-55'}`}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--hrm-blue-700)] text-white">{employee.workerType === 'assistant' ? <Wrench className="h-5 w-5 stroke-[1.8]" /> : <UserRound className="h-5 w-5 stroke-[1.8]" />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold leading-tight text-slate-950">{employee.name}</span><span className="mt-0.5 block truncate text-xs font-semibold leading-tight text-slate-500">{employee.workerType === 'assistant' ? (locale === 'vi' ? 'Thợ phụ' : 'Assistant') : (locale === 'vi' ? 'Thợ chính' : 'Main staff')}</span></span>
              <ChevronRight className="h-5 w-5 text-gray-300" />
            </button>
          ))}
        </div>
      </div>

      {open && (
        <>
          <button type="button" aria-label="Close" onClick={() => { setOpen(false); setEditingEmployee(undefined); }} className="fixed inset-0 z-[102] h-full w-full cursor-default bg-black/45" />
          <section
            role="dialog"
            aria-modal="true"
            style={{ transform: 'translate(-50%, -50%)' }}
            className="fixed left-1/2 top-1/2 z-[103] flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md flex-col overflow-y-auto overscroll-contain rounded-2xl bg-white p-5"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editingEmployee ? (locale === 'vi' ? 'Sửa thợ' : 'Edit employee') : (locale === 'vi' ? 'Tạo tài khoản thợ' : 'Create employee account')}</h2>
              <button onClick={() => { setOpen(false); setEditingEmployee(undefined); }} className="rounded-full bg-gray-100 p-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Họ tên' : 'Name'}
                <HrmInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 bg-slate-50 font-normal" />
              </label>
              {!editingEmployee && <label className="text-sm font-semibold text-gray-700">
                Email
                <HrmInput type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="mt-1.5 bg-slate-50 font-normal" />
              </label>}
              {!editingEmployee && <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Mật khẩu ban đầu' : 'Initial password'}
                <HrmInput type="password" minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="mt-1.5 bg-slate-50 font-normal" />
              </label>}
              <label className="text-sm font-semibold text-gray-700">
                {locale === 'vi' ? 'Loại thợ' : 'Staff type'}
                <select value={form.workerType} onChange={(event) => {
                  const workerType = event.target.value as 'main' | 'assistant';
                  setForm({
                    ...form,
                    workerType,
                    compensationModel: workerType === 'assistant' ? 'fixed' : 'commission',
                    ...(workerType === 'assistant' && { fixedSalary: form.fixedSalary ?? 0 }),
                  });
                }} className="mt-1.5 w-full rounded-xl border border-gray-200 px-3 py-2.5 font-normal">
                  <option value="main">{locale === 'vi' ? 'Thợ chính' : 'Main staff'}</option>
                  <option value="assistant">{locale === 'vi' ? 'Thợ phụ' : 'Assistant'}</option>
                </select>
              </label>
              {!editingEmployee && form.workerType === 'assistant' && (
                <label className="text-sm font-semibold text-gray-700">
                  {locale === 'vi' ? 'Lương cố định' : 'Fixed salary'}
                  <HrmInput type="number" min="0" value={form.fixedSalary ?? 0} onChange={(event) => setForm({ ...form, fixedSalary: Number(event.target.value) })} className="mt-1.5 bg-slate-50 font-normal" />
                </label>
              )}
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-semibold text-gray-700">
                  {locale === 'vi' ? 'Dịch vụ có thể làm' : 'Services this employee can perform'}
                </legend>
                <div className="grid max-h-44 gap-2 overflow-y-auto rounded-xl border border-gray-200 p-3 sm:grid-cols-2">
                  {services.map((service) => (
                    <label key={service.id} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.serviceIds?.includes(service.id) ?? false}
                        onChange={(event) => setForm({
                          ...form,
                          serviceIds: event.target.checked
                            ? [...(form.serviceIds ?? []), service.id]
                            : (form.serviceIds ?? []).filter((id) => id !== service.id),
                        })}
                      />
                      {service.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <HrmButton disabled={busy || !form.name.trim() || (!editingEmployee && (!form.email.trim() || form.password.length < 6))} onClick={() => void save()} className="mt-5 min-h-11 w-full rounded-xl text-sm font-bold">
              {busy ? '...' : editingEmployee ? (locale === 'vi' ? 'Lưu thay đổi' : 'Save changes') : (locale === 'vi' ? 'Tạo tài khoản' : 'Create account')}
            </HrmButton>
            {editingEmployee?.active && (
              <HrmButton
                variant="outline"
                disabled={busy}
                onClick={() => void toggleActive(editingEmployee).then(() => {
                  setOpen(false);
                  setEditingEmployee(undefined);
                  closeEmployeeDetail();
                })}
                className="mt-2 min-h-11 w-full rounded-xl text-red-600"
              >
                {locale === 'vi' ? 'Đánh dấu đã nghỉ' : 'Mark inactive'}
              </HrmButton>
            )}
          </section>
        </>
      )}
    </section>
  );
}
