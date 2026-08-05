/**
 * HRM API Client
 *
 * Helper functions to call the HRM Backend public booking API endpoints.
 * Used by the booking flow to read store/staff/services data and create bookings.
 */

import { HRM_API_BASE_URL } from '@/lib/firebase/config';

const API_BASE = HRM_API_BASE_URL;

// ===== RESPONSE TYPES FROM HRM =====

export interface HrmStore {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  openTime?: string;
  closeTime?: string;
  address?: {
    line1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  addressText?: string;
  timezone?: string;
  bookingSlug?: string;
  bookingWindowDays: number;
  minimumNoticeHours: number;
  cancellationNoticeHours: number;
  slotIntervalMinutes: number;
  publicStaffSelection: boolean;
}

export interface HrmPublicStoreSummary {
  id: string;
  bookingSlug: string;
  name: string;
  phone?: string;
  openTime?: string;
  closeTime?: string;
  address?: HrmStore['address'];
  addressText?: string;
  timezone?: string;
}

export interface HrmPublicStoreDirectoryResponse {
  items: HrmPublicStoreSummary[];
  meta: {
    total: number;
    nextCursor?: string;
  };
}

export interface HrmStaffMember {
  uid: string;
  name: string;
  workerType?: 'main' | 'assistant';
  serviceIds?: string[];
}

export interface HrmService {
  id: string;
  name: string;
  category?: string;
  price: number;
  durationMin?: number;
  durationMax?: number;
  groupService?: string;
  preferredWorkerType?: 'main' | 'assistant';
  bookingKind?: 'main' | 'add_on';
}

export interface HrmBookingServiceInput {
  sourceServiceId?: string;
  staffSelectionType?: 'specific' | 'any';
  name: string;
  category?: string;
  durationMinutes: number;
  price: number;
  employeeUserId?: string;
  employeeName?: string;
}

export interface HrmBookingAddonInput {
  sourceServiceId?: string;
  name: string;
  price: number;
}

export interface HrmCreateBookingPayload {
  storeId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  appointmentDate: string;  // YYYY-MM-DD
  startTime: string;        // HH:mm
  endTime: string;          // HH:mm
  services: HrmBookingServiceInput[];
  addOns?: HrmBookingAddonInput[];
  staffSelectionType: 'specific' | 'any';
  bookingMode?: 'instant' | 'request';
  notes?: string;
  source?: string;
}

export interface HrmBookingResponse {
  item: {
    bookingId: string;
    bookingCode: string;
    attendanceCode: string;
    id: string;
    workDate: string;
    startTime: number;
    endTime: number;
    customerName: string;
    status: string;
  };
  meta: {
    storeId: string;
    storeName: string;
  };
}

export interface HrmAvailability {
  date: string;
  busy: Array<{
    employeeUserId: string;
    startTime: number;
    endTime: number;
    status: string;
  }>;
  absences: Array<{
    employeeUserId: string;
    startDate: string;
    endDate: string;
    allDay: boolean;
  }>;
}

// ===== API FUNCTIONS =====

export async function fetchHrmPublicStores(options: {
  query?: string;
  limit?: number;
  cursor?: string;
} = {}): Promise<HrmPublicStoreDirectoryResponse> {
  const params = new URLSearchParams();
  const query = options.query?.trim();
  if (query) params.set('q', query);
  params.set('limit', String(options.limit ?? 24));
  if (options.cursor) params.set('cursor', options.cursor);

  const res = await fetch(`${API_BASE}/api/v1/public/stores?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch public stores: ${res.status}`);
  }
  return await res.json() as HrmPublicStoreDirectoryResponse;
}

/**
 * Fetch store info from HRM public API.
 */
export async function fetchHrmStore(storeId: string): Promise<HrmStore> {
  const res = await fetch(`${API_BASE}/api/v1/public/stores/${storeId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch store: ${res.status}`);
  }
  const data = await res.json();
  return data.store;
}

/**
 * Fetch active staff list from HRM public API.
 */
export async function fetchHrmStaff(storeId: string): Promise<HrmStaffMember[]> {
  const res = await fetch(`${API_BASE}/api/v1/public/stores/${storeId}/staff`);
  if (!res.ok) {
    throw new Error(`Failed to fetch staff: ${res.status}`);
  }
  const data = await res.json();
  return data.items;
}

/**
 * Fetch service catalog from HRM public API.
 */
export async function fetchHrmServices(storeId: string): Promise<HrmService[]> {
  const res = await fetch(`${API_BASE}/api/v1/public/stores/${storeId}/services`);
  if (!res.ok) {
    throw new Error(`Failed to fetch services: ${res.status}`);
  }
  const data = await res.json();
  return data.items;
}

export async function fetchHrmAvailability(
  storeId: string,
  date: string,
): Promise<HrmAvailability> {
  const res = await fetch(
    `${API_BASE}/api/v1/public/stores/${encodeURIComponent(storeId)}/availability?date=${encodeURIComponent(date)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch availability: ${res.status}`);
  }
  return await res.json() as HrmAvailability;
}

/**
 * Create a booking via HRM public API.
 * This creates an attendance record in the HRM system.
 */
export async function createHrmBooking(payload: HrmCreateBookingPayload): Promise<HrmBookingResponse> {
  const res = await fetch(`${API_BASE}/api/v1/public/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `Failed to create booking: ${res.status}`);
  }
  return await res.json();
}
