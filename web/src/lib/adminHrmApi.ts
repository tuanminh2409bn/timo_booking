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
  totalAmount: number;
  services: Array<{
    id: string;
    name: string;
    amount: string;
    employees: Array<{
      employeeId: string;
      employeeName: string;
    }>;
  }>;
};

type AttendanceCalendarResponse = {
  items: Array<Omit<AdminAttendanceItem, 'bookingStatus'> & {
    bookingStatus: AdminAttendanceStatus | 'requested' | 'processing';
  }>;
};

export const fetchAdminAttendanceCalendar = async (
  storeId: string,
  fromWorkDate: string,
  toWorkDate: string,
): Promise<AdminAttendanceItem[]> => {
  const inclusiveDays = Math.floor(
    (Date.parse(`${toWorkDate}T00:00:00Z`) - Date.parse(`${fromWorkDate}T00:00:00Z`)) / 86_400_000,
  ) + 1;
  const view = inclusiveDays === 1 ? 'day' : 'week';
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/attendances/calendar?view=${view}&fromWorkDate=${encodeURIComponent(fromWorkDate)}&toWorkDate=${encodeURIComponent(toWorkDate)}`,
  );
  if (!response.ok) {
    throw new Error(`Could not load attendance calendar (${response.status})`);
  }
  const data = await response.json() as AttendanceCalendarResponse;
  return data.items.map((item) => ({
    ...item,
    bookingStatus: item.bookingStatus === 'requested'
      ? 'pending_approval'
      : item.bookingStatus === 'processing'
        ? 'needs_owner_action'
        : item.bookingStatus,
  }));
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
  counters: {
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
  const data = await response.json() as { items: AdminCustomer[] };
  return data.items;
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
  reason: string;
};

export const fetchAdminEmployees = async (storeId: string): Promise<AdminEmployee[]> => {
  const response = await authenticatedHrmFetch(
    `/api/v1/stores/${encodeURIComponent(storeId)}/employees`,
  );
  if (!response.ok) throw new Error(`Could not load employees (${response.status})`);
  const data = await response.json() as { items: AdminEmployee[] };
  return data.items;
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
  payload: Pick<AdminLeaveRequest, 'startDate' | 'endDate' | 'allDay' | 'reason'>,
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
  description?: string;
  category: 'nail' | 'pedicure' | 'manicure' | 'design' | 'other';
  groupService?: string;
  price: number;
  duration: number;
  preferredWorkerType?: 'main' | 'assistant';
  bookingKind?: 'main' | 'add_on';
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
    workerType?: 'main' | 'assistant';
    serviceIds?: string[];
  },
): Promise<void> => {
  const employeeBase = `/api/v1/stores/${encodeURIComponent(storeId)}/employees/${encodeURIComponent(employeeId)}`;
  const updates: Array<{ path: string; body: object }> = [];
  if (payload.workerType !== undefined) {
    updates.push({ path: employeeBase, body: { workerType: payload.workerType } });
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
