'use client';

import { authenticatedHrmFetch } from './hrmSession';

export type AdminAttendanceStatus =
  | 'pending_approval'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'needs_owner_action';

export type AdminAttendanceItem = {
  id: string;
  attendanceCode?: string;
  bookingId?: string;
  customerName: string;
  customerPhone: string;
  startTime: number;
  endTime: number;
  workDate: string;
  employeeUserId: string;
  mainAssigneeUserId: string;
  bookingStatus: AdminAttendanceStatus;
  source: 'online_booking' | 'manual_booking' | 'walk_in';
  staffSelectionType?: 'specific' | 'any';
  requestedEmployeeUserId?: string;
  requestedEmployeeName?: string;
  conflictEmployeeUserId?: string;
  conflictEmployeeName?: string;
  proposedAssigneeUserId?: string;
  proposedAssigneeName?: string;
  proposedAssigneeWorkerType?: 'main' | 'assistant';
  updatedByUserId?: string;
  updatedByRole?: 'customer' | 'owner' | 'manager' | 'employee';
  updatedByName?: string;
  totalAmount: number;
  addOns?: Array<{
    id: string;
    sourceServiceId?: string;
    name: string;
    price: number;
  }>;
  services: Array<{
    id: string;
    sourceServiceId?: string;
    name: string;
    amount: string | number;
    durationMin?: number;
    durationMax?: number;
    employees: Array<{
      employeeId: string;
      employeeName: string;
    }>;
  }>;
};

type AttendanceCalendarResponse = {
  items: Array<Omit<AdminAttendanceItem, 'bookingStatus' | 'startTime' | 'endTime'> & {
    bookingStatus: AdminAttendanceStatus | 'requested' | 'processing';
    startTime?: number;
    endTime?: number;
    date?: string;
    endDate?: string;
  }>;
};

type RawAdminAttendanceItem = AttendanceCalendarResponse['items'][number];

const resolveAttendanceMinutes = (minutes: unknown, dateTime: unknown): number => {
  if (typeof minutes === 'number' && Number.isFinite(minutes)) return minutes;
  if (typeof dateTime !== 'string') throw new Error('Attendance time is missing');

  const match = dateTime.match(/T(\d{2}):(\d{2})/);
  if (!match) throw new Error(`Invalid attendance time: ${dateTime}`);

  return Number(match[1]) * 60 + Number(match[2]);
};

const normalizeAdminAttendanceItem = (item: RawAdminAttendanceItem): AdminAttendanceItem => ({
  ...item,
  startTime: resolveAttendanceMinutes(item.startTime, item.date),
  endTime: resolveAttendanceMinutes(item.endTime, item.endDate),
  bookingStatus: item.bookingStatus === 'requested'
    ? 'pending_approval'
    : item.bookingStatus === 'processing'
      ? 'needs_owner_action'
      : item.bookingStatus,
});

export const fetchAdminAttendanceCalendar = async (
  storeId: string,
  fromWorkDate: string,
  toWorkDate: string,
): Promise<AdminAttendanceItem[]> => {
  const inclusiveDays = Math.floor(
    (Date.parse(`${toWorkDate}T00:00:00Z`) - Date.parse(`${fromWorkDate}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  const [fromYear, fromMonth, fromDay] = fromWorkDate.split('-').map(Number);
  const monthLastDay = new Date(Date.UTC(fromYear, fromMonth, 0)).getUTCDate();
  const isFullMonth = fromDay === 1 &&
    toWorkDate === `${fromYear}-${String(fromMonth).padStart(2, '0')}-${String(monthLastDay).padStart(2, '0')}`;
  if (inclusiveDays !== 1 && inclusiveDays !== 7 && !isFullMonth) {
    const ranges: Array<[string, string]> = [];
    let cursor = new Date(`${fromWorkDate}T00:00:00.000Z`);
    const finalDate = new Date(`${toWorkDate}T00:00:00.000Z`);
    while (cursor <= finalDate) {
      const remainingDays = Math.floor((finalDate.getTime() - cursor.getTime()) / 86_400_000) + 1;
      const chunkDays = remainingDays >= 7 ? 7 : 1;
      const chunkEnd = new Date(cursor);
      chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
      ranges.push([cursor.toISOString().slice(0, 10), chunkEnd.toISOString().slice(0, 10)]);
      cursor = new Date(chunkEnd);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return (await Promise.all(ranges.map(([from, to]) => fetchAdminAttendanceCalendar(storeId, from, to)))).flat();
  }
  const view = inclusiveDays === 1 ? 'day' : isFullMonth ? 'month' : 'week';
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/attendances/calendar?view=${view}&fromWorkDate=${encodeURIComponent(fromWorkDate)}&toWorkDate=${encodeURIComponent(toWorkDate)}`,
  );
  if (!response.ok) {
    throw new Error(`Could not load attendance calendar (${response.status})`);
  }
  const data = await response.json() as AttendanceCalendarResponse;
  return data.items.map(normalizeAdminAttendanceItem);
};

export const searchAdminAttendances = async (
  storeId: string,
  query: string,
): Promise<AdminAttendanceItem[]> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/attendances/search?q=${encodeURIComponent(query.trim())}`,
  );
  if (!response.ok) {
    throw new Error(`Could not search attendance (${response.status})`);
  }
  const data = await response.json() as AttendanceCalendarResponse;
  return data.items.map(normalizeAdminAttendanceItem);
};

export const updateAdminAttendanceStatus = async (
  storeId: string,
  attendanceId: string,
  status: AdminAttendanceStatus,
  reason?: string,
): Promise<void> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/attendances/${encodeURIComponent(attendanceId)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        ...(reason !== undefined && { reason }),
      }),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as
      | { message?: string }
      | undefined;
    throw new Error(error?.message || `Could not update attendance (${response.status})`);
  }
};

export type AdminCreateBookingPayload = {
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  appointmentDate: string;
  startTime: string;
  services: Array<{
    sourceServiceId?: string;
    name: string;
    category?: string;
    durationMinutes: number;
    price: number;
    employeeUserId: string;
  }>;
  source: 'manual_booking' | 'walk_in';
  quickBooking?: boolean;
  notes?: string;
};

export const createAdminBooking = async (
  storeId: string,
  payload: AdminCreateBookingPayload,
): Promise<void> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/bookings`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as
      | { message?: string }
      | undefined;
    throw new Error(error?.message || `Could not create booking (${response.status})`);
  }
};

export const reassignAdminAttendance = async (
  storeId: string,
  attendanceId: string,
  employeeUserId: string,
): Promise<void> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/attendances/${encodeURIComponent(attendanceId)}/reassign`,
    {
      method: 'PATCH',
      body: JSON.stringify({ employeeUserId }),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as
      | { message?: string }
      | undefined;
    throw new Error(error?.message || `Could not reassign attendance (${response.status})`);
  }
};

export type AdminCustomer = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  blocked: boolean;
  blockedReason?: string;
  lastBookingAt?: number;
  counters?: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
};

export const fetchAdminCustomers = async (storeId: string): Promise<AdminCustomer[]> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/customers?pageSize=50`,
  );
  if (!response.ok) {
    throw new Error(`Could not load customers (${response.status})`);
  }
  const data = await response.json() as { items?: unknown };
  if (!Array.isArray(data.items)) {
    throw new Error('Customer list response is invalid');
  }
  return data.items as AdminCustomer[];
};

export type AdminCustomerAttendanceSummary = {
  total: number;
  pending_approval: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  no_show: number;
};

export type AdminCustomerAttendanceHistoryItem = {
  id: string;
  attendanceCode?: string;
  workDate: string;
  startTime: number;
  endTime: number;
  status: 'open' | 'closed';
  bookingStatus?: AdminAttendanceStatus;
  services: Array<{ id: string; name: string }>;
};

export const fetchAdminCustomerDetail = async (storeId: string, customerId: string): Promise<AdminCustomer> => {
  const response = await authenticatedHrmFetch(`/api/v1/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(customerId)}`);
  if (!response.ok) throw new Error(`Could not load customer (${response.status})`);
  return (await response.json() as { item: AdminCustomer }).item;
};

export const fetchAdminCustomerAttendanceSummary = async (
  storeId: string, customerId: string, startDate: string, endDate: string,
): Promise<AdminCustomerAttendanceSummary> => {
  const response = await authenticatedHrmFetch(`/api/v1/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(customerId)}/attendance-summary?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  if (!response.ok) throw new Error(`Could not load customer summary (${response.status})`);
  return (await response.json() as { summary: AdminCustomerAttendanceSummary }).summary;
};

export const fetchAdminCustomerAttendanceHistory = async (
  storeId: string, customerId: string, startDate: string, endDate: string,
): Promise<AdminCustomerAttendanceHistoryItem[]> => {
  const response = await authenticatedHrmFetch(`/api/v1/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(customerId)}/attendances?pageSize=50&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  if (!response.ok) throw new Error(`Could not load customer history (${response.status})`);
  return (await response.json() as { items: AdminCustomerAttendanceHistoryItem[] }).items;
};

export const setAdminCustomerBlocked = async (
  storeId: string,
  customerId: string,
  blocked: boolean,
  reason?: string,
): Promise<void> => {
  const action = blocked ? 'block' : 'unblock';
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(customerId)}/${action}`,
    {
      method: 'PATCH',
      body: JSON.stringify(blocked ? { reason } : {}),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as
      | { message?: string }
      | undefined;
    throw new Error(error?.message || `Could not update customer (${response.status})`);
  }
};

export type AdminEmployee = {
  id: string;
  name: string;
  active: boolean;
  status: string;
  workerType?: 'main' | 'assistant';
  serviceIds?: string[];
  publicBookingVisible?: boolean;
  compensationModel?: 'commission' | 'hourly' | 'fixed';
  ownerCommissionRate?: number;
  hourlyRate?: number;
  fixedSalary?: number;
};

export type AdminLeaveRequest = {
  id: string;
  employeeUserId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  reason: string;
};

export type AdminLeaveConflict = {
  attendanceId: string;
  attendanceCode?: string;
  bookingId?: string;
  workDate: string;
  startTime: number;
  endTime: number;
  customerName: string;
  services: string[];
  staffSelectionType: 'specific' | 'any';
  resolution: 'auto_reassign' | 'manual_action';
};

export type AdminLeavePreview = {
  conflictCount: number;
  automaticCount: number;
  manualCount: number;
  conflicts: AdminLeaveConflict[];
};

export const fetchAdminEmployees = async (storeId: string): Promise<AdminEmployee[]> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/employees`,
  );
  if (!response.ok) throw new Error(`Could not load employees (${response.status})`);
  const data = await response.json() as { items: AdminEmployee[] };
  return data.items;
};

export type AdminEmployeeAttendanceDay = {
  workDate: string;
  worked: boolean;
  attendanceCount: number;
  totalRevenue: number;
};

export type AdminEmployeeAttendanceDaysPage = {
  items: AdminEmployeeAttendanceDay[];
  meta: {
    storeId: string;
    employeeUserId: string;
    pageSize: number;
    fromWorkDate: string;
    toWorkDate: string;
    hasMore: boolean;
    nextCursor?: string;
    totalAttendanceCount: number;
    workedDayCount: number;
    totalRevenue: number;
  };
};

export const fetchAdminEmployeeAttendanceDays = async (
  storeId: string,
  employeeId: string,
  before?: string,
): Promise<AdminEmployeeAttendanceDaysPage> => {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/employees/${encodeURIComponent(employeeId)}/attendance-days${query}`,
  );
  if (!response.ok) throw new Error(`Could not load employee attendance days (${response.status})`);
  return await response.json() as AdminEmployeeAttendanceDaysPage;
};

export const fetchEmployeeLeave = async (
  storeId: string,
  employeeId: string,
): Promise<AdminLeaveRequest[]> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/employees/${encodeURIComponent(employeeId)}/leave-requests`,
  );
  if (!response.ok) throw new Error(`Could not load leave requests (${response.status})`);
  const data = await response.json() as { items: AdminLeaveRequest[] };
  return data.items;
};

export const createEmployeeLeave = async (
  storeId: string,
  employeeId: string,
  payload: Pick<AdminLeaveRequest, 'startDate' | 'endDate' | 'allDay' | 'reason' | 'startTime' | 'endTime'>,
): Promise<void> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/employees/${encodeURIComponent(employeeId)}/leave-requests`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(error?.message || `Could not create leave (${response.status})`);
  }
};

export const previewEmployeeLeave = async (
  storeId: string,
  employeeId: string,
  payload: Pick<AdminLeaveRequest, 'startDate' | 'endDate' | 'allDay' | 'reason' | 'startTime' | 'endTime'>,
): Promise<AdminLeavePreview> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/employees/${encodeURIComponent(employeeId)}/leave-requests/preview`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(error?.message || `Could not preview leave (${response.status})`);
  }
  return await response.json() as AdminLeavePreview;
};

export const deleteEmployeeLeave = async (
  storeId: string,
  employeeId: string,
  leaveRequestId: string,
): Promise<void> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/employees/${encodeURIComponent(employeeId)}/leave-requests/${encodeURIComponent(leaveRequestId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(`Could not delete leave (${response.status})`);
};

export type AdminServiceInput = {
  name: string;
  displayName?: string;
  description?: string;
  category: 'nail' | 'pedicure' | 'manicure' | 'design' | 'other';
  groupService?: string;
  price: number;
  duration: number;
  preferredWorkerType?: 'main' | 'assistant';
  bookingKind?: 'main' | 'add_on';
  availableForBooking?: boolean;
};

const serviceMutation = async (
  storeId: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  serviceId?: string,
  payload?: AdminServiceInput,
): Promise<void> => {
  const suffix = serviceId ? `/${encodeURIComponent(serviceId)}` : '';
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/services${suffix}`,
    {
      method,
      ...(payload && { body: JSON.stringify(payload) }),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(error?.message || `Could not save service (${response.status})`);
  }
};

export const createAdminService = (storeId: string, payload: AdminServiceInput) =>
  serviceMutation(storeId, 'POST', undefined, payload);
export const updateAdminService = (storeId: string, serviceId: string, payload: AdminServiceInput) =>
  serviceMutation(storeId, 'PATCH', serviceId, payload);
export const deleteAdminService = (storeId: string, serviceId: string) =>
  serviceMutation(storeId, 'DELETE', serviceId);

export type AdminEmployeeInput = {
  name: string;
  email: string;
  password: string;
  phone?: string;
  workerType: 'main' | 'assistant';
  compensationModel: 'commission' | 'hourly' | 'fixed';
  ownerCommissionRate?: number;
  hourlyRate?: number;
  fixedSalary?: number;
  serviceIds?: string[];
  publicBookingVisible?: boolean;
};

export const createAdminEmployee = async (
  storeId: string,
  payload: AdminEmployeeInput,
): Promise<void> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/employees`,
    {
      method: 'POST',
      body: JSON.stringify({ ...payload, role: 'employee' }),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(error?.message || `Could not create employee (${response.status})`);
  }
};

export const updateAdminEmployee = async (
  storeId: string,
  employeeId: string,
  payload: {
    active?: boolean;
    name?: string;
    workerType?: 'main' | 'assistant';
    publicBookingVisible?: boolean;
    serviceIds?: string[];
  },
): Promise<void> => {
  const employeeBase = `/api/v1/stores/${encodeURIComponent(storeId)}/employees/${encodeURIComponent(employeeId)}`;
  const updates: Array<{ path: string; body: object }> = [];
  if (payload.name !== undefined || payload.workerType !== undefined || payload.publicBookingVisible !== undefined) {
    updates.push({ path: employeeBase, body: {
      ...(payload.name !== undefined && { name: payload.name }),
      ...(payload.workerType !== undefined && { workerType: payload.workerType }),
      ...(payload.publicBookingVisible !== undefined && { publicBookingVisible: payload.publicBookingVisible }),
    } });
  }
  if (payload.active !== undefined) {
    updates.push({ path: `${employeeBase}/employment-status`, body: { active: payload.active } });
  }
  if (payload.serviceIds !== undefined) {
    updates.push({ path: `${employeeBase}/services`, body: { serviceIds: payload.serviceIds } });
  }

  for (const update of updates) {
    const response = await authenticatedHrmFetch(update.path, {
      method: 'PATCH',
      body: JSON.stringify(update.body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => undefined) as { message?: string } | undefined;
      throw new Error(error?.message || `Could not update employee (${response.status})`);
    }
  }
};

export const createCardCheckout = async (): Promise<string> => {
  const response = await authenticatedHrmFetch('/api/v1/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const data = await response.json().catch(() => undefined) as
    | { url?: string; message?: string }
    | undefined;
  if (!response.ok || !data?.url) {
    throw new Error(data?.message || `Could not start card payment (${response.status})`);
  }
  return data.url;
};

export type AdminStore = {
  id: string;
  name: string;
  phone?: string;
  status: 'active' | 'disabled';
  addressText?: string;
  openTime?: string;
  closeTime?: string;
  employeeCount?: number;
  bookingSlug?: string;
  bookingWindowDays?: number;
  minimumNoticeHours?: number;
  cancellationNoticeHours?: number;
  slotIntervalMinutes?: number;
  publicStaffSelection?: boolean;
};

export const fetchAdminStores = async (): Promise<AdminStore[]> => {
  const response = await authenticatedHrmFetch('/api/v1/stores');
  if (!response.ok) throw new Error(`Could not load stores (${response.status})`);
  const data = await response.json() as { stores: AdminStore[] };
  return data.stores;
};

export const createAdminStore = async (payload: {
  name: string;
  phone?: string;
  address?: { line1?: string };
  openTime?: string;
  closeTime?: string;
  bookingSlug?: string;
  bookingWindowDays?: number;
  minimumNoticeHours?: number;
  cancellationNoticeHours?: number;
  slotIntervalMinutes?: number;
  publicStaffSelection?: boolean;
}): Promise<void> => {
  const response = await authenticatedHrmFetch('/api/v1/stores', {
    method: 'POST',
    body: JSON.stringify({ ...payload, status: 'active', timezone: 'Europe/Berlin' }),
  });
  if (!response.ok) throw new Error(`Could not create store (${response.status})`);
};

export const updateAdminStore = async (
  storeId: string,
  payload: Partial<{
    name: string;
    phone: string;
    address: { line1?: string };
    openTime: string;
    closeTime: string;
    status: 'active' | 'disabled';
    bookingSlug: string;
    bookingWindowDays: number;
    minimumNoticeHours: number;
    cancellationNoticeHours: number;
    slotIntervalMinutes: number;
    publicStaffSelection: boolean;
  }>,
): Promise<void> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new Error(`Could not update store (${response.status})`);
};

export type PlatformAccount = {
  uid: string;
  email: string;
  name: string;
  role: 'admin' | 'owner' | 'manager' | 'employee';
  ownerId: string;
  storeId?: string;
  active: boolean;
  createdAt?: number;
};

export type PlatformStore = AdminStore & {
  ownerId: string;
  phone?: string;
  createdAt?: number;
};

export const fetchPlatformAccounts = async (): Promise<PlatformAccount[]> => {
  const response = await authenticatedHrmFetch('/api/v1/admin/accounts');
  if (!response.ok) throw new Error(`Could not load platform accounts (${response.status})`);
  return ((await response.json()) as { items: PlatformAccount[] }).items;
};

export const createPlatformOwner = async (payload: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  salonName: string;
  address?: string;
}): Promise<void> => {
  const response = await authenticatedHrmFetch('/api/v1/admin/owners', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(error?.message || `Could not create owner (${response.status})`);
  }
};

export const updatePlatformAccount = async (uid: string, active: boolean): Promise<void> => {
  const response = await authenticatedHrmFetch(`/api/v1/admin/accounts/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  });
  if (!response.ok) throw new Error(`Could not update platform account (${response.status})`);
};

export const fetchPlatformStores = async (): Promise<PlatformStore[]> => {
  const response = await authenticatedHrmFetch('/api/v1/admin/stores');
  if (!response.ok) throw new Error(`Could not load platform stores (${response.status})`);
  return ((await response.json()) as { items: PlatformStore[] }).items;
};

export const updatePlatformStore = async (
  storeId: string,
  status: 'active' | 'disabled',
): Promise<void> => {
  const response = await authenticatedHrmFetch(`/api/v1/admin/stores/${encodeURIComponent(storeId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(`Could not update platform store (${response.status})`);
};

export const fetchPlatformSummary = async (): Promise<{
  totalUsers: number;
  totalStores: number;
  totalBookings: number;
}> => {
  const response = await authenticatedHrmFetch('/api/v1/admin/summary');
  if (!response.ok) throw new Error(`Could not load platform summary (${response.status})`);
  return await response.json() as {
    totalUsers: number;
    totalStores: number;
    totalBookings: number;
  };
};
