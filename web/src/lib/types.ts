// ===== BRANCH =====
export interface Branch {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  address: string;
  phone: string;
  currency: string;
  publicStaffSelection: boolean;
  minimumNoticeHours: number;
  bookingWindowDays: number;
  graceTimeMinutes: number;
  slotIntervalMinutes: number;
  absenceDeadlineTime: string;
  isActive: boolean;
  createdAt: string;
}

// ===== SERVICE =====
export interface ServiceCategory {
  id: string;
  branchId: string;
  businessId?: string;                           // link for tenant analytics & rules validation
  name: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
  conflictGroup?: 'gel' | 'acryl';              // gel & acryl cannot coexist in same booking
  requiresStaffAutoAssign?: boolean;             // for Zehenmodellage, Pediküre → no staff selection
}

export interface Service {
  id: string;
  branchId: string;
  businessId?: string;                           // link for tenant analytics & rules validation
  categoryId: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  currency: string;
  displayOrder: number;
  isActive: boolean;
  hasAppointments: boolean;
  type: 'standard' | 'addon';
  isAddon?: boolean;                             // +duration addon like "Design / Extra"
  conflictGroup?: 'gel' | 'acryl';               // inherited from category
  staffType?: 'main' | 'junior' | 'any';         // which staff type can do this
  staffPriority?: 'assistant_staff' | 'main_staff' | 'conditional_assistant' | 'none'; // Spec V1: priority rule for auto-assign
  createdAt: string;
}

// ===== STAFF =====
export interface Staff {
  id: string;
  branchId: string;
  businessId?: string;                           // link for tenant analytics & rules validation
  userUid: string | null;
  name: string;
  initials: string;
  role: 'staff' | 'manager';
  staffType: 'main' | 'junior';                  // thợ chính / thợ phụ (lương cứng)
  serviceIds: string[];
  displayOrder: number;
  status: 'active' | 'inactive' | 'archived';
  hasAppointments: boolean;
  rating?: number;
  languages?: string[];
  title?: string;
  createdAt: string;
}

export interface StaffWorkingHours {
  id: string;
  staffId: string;
  dayOfWeek: number; // 0-6, Mon-Sun
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  isWorking: boolean;
}

export interface StaffAbsence {
  id: string;
  staffId: string;
  branchId: string;
  absenceDate: string;
  startTime: string | null;                      // null = full day
  endTime: string | null;                        // null = full day
  isFullDay: boolean;
  note: string;
  createdBy: string;                             // owner uid — chủ tiệm thao tác trực tiếp
  createdAt: string;
}

// ===== APPOINTMENT =====
export type AppointmentStatus =
  | 'pending_approval'                           // tolerant booking — chờ chủ duyệt
  | 'confirmed'
  | 'cancelled_by_customer'
  | 'cancelled_by_salon'
  | 'cancelled_by_system'
  | 'completed'
  | 'no_show'
  | 'needs_owner_action';                        // thợ nghỉ đột xuất, cần chủ xử lý

export type AppointmentSource = 'online' | 'manual' | 'walk_in';

export interface AppointmentService {
  serviceId: string;
  categoryId: string;
  serviceName: string;
  isExtra: boolean;
  durationMinutes: number;
  price: number;
}

export interface Appointment {
  id: string;
  branchId: string;
  services: AppointmentService[];                // multi-service support
  staffId: string;
  customerId: string | null;
  customerPhone: string | null;
  customerName: string | null;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  totalDurationMinutes: number;                  // sum of all services
  totalPrice: number;                            // sum of all services
  status: AppointmentStatus;
  source: AppointmentSource;
  idempotencyToken: string;
  notes: string;
  smsConfirmationSent: boolean;
  createdAt: string;
  cancelledAt: string | null;
  cancelledReason: string | null;
}

// ===== CUSTOMER =====
export interface Customer {
  id: string;
  phone: string;
  name: string;
  email: string;
  phoneVerified: boolean;
  createdAt: string;
}

// ===== TIME SLOT =====
export interface TimeSlot {
  time: string; // HH:mm
  available: boolean;
  staffId?: string;
  status: 'available' | 'held' | 'booked' | 'request_only'; // request_only = tolerant booking
}

// ===== SELECTED SERVICE (booking flow) =====
export interface SelectedServiceItem {
  categoryId: string;
  categoryName: string;
  mainService: Service;
  extras: Service[];                             // Design/Extra addons
  selectedStaff: Staff | null;                   // Spec V1: per-service staff selection
  selectedStaffType: 'specific' | 'any';         // Spec V1: per-service staff type
}

// ===== BOOKING CONSTANTS (Spec V1) =====
export const MAX_MAIN_SERVICES = 2;              // Spec V1: tối đa 2 dịch vụ chính
export const CUSTOMER_CANCEL_CUTOFF_HOURS = 12;  // Spec V1: hủy lịch confirmed trước 12 giờ

// ===== BOOKING STATE =====
export interface BookingState {
  branchSlug: string;
  branch: Branch | null;
  selectedServices: SelectedServiceItem[];       // Spec V1: max 2 main services
  // NOTE: Staff selection is now per-service (inside SelectedServiceItem)
  // Legacy fields kept for backward compat during migration:
  selectedStaff: Staff | null;
  selectedStaffType: 'specific' | 'any';
  selectedDate: string | null;
  selectedTime: string | null;
  bookingMode: 'instant' | 'request';            // tolerant booking
  skipStaffSelection: boolean;                   // auto-assign for foot services
  customerInfo: {
    name: string;
    phone: string;
    email: string;
    password: string;
    notes: string;
    isReturning: boolean;
  };
  currentStep: number;
}

// ===== COMPUTED HELPERS =====
/**
 * Spec V1: totalDuration chỉ tính dịch vụ chính (main services).
 * Add-on extras không ảnh hưởng đến thời lượng/availability trên calendar.
 * totalPrice vẫn cộng dồn cả extras để hiển thị tham khảo.
 */
export function computeBookingTotals(services: SelectedServiceItem[]): {
  totalDuration: number;
  totalPrice: number;
  serviceCount: number;
} {
  let totalDuration = 0;
  let totalPrice = 0;
  let serviceCount = 0;

  for (const item of services) {
    totalDuration += item.mainService.durationMinutes;
    totalPrice += item.mainService.price;
    serviceCount++;

    for (const extra of item.extras) {
      // Spec V1: Add-on extras do NOT add to duration (no calendar block)
      // but still add to price for reference
      totalPrice += extra.price;
      serviceCount++;
    }
  }

  return { totalDuration, totalPrice, serviceCount };
}

/** Check if adding a category would cause a conflict */
export function hasConflict(
  selectedServices: SelectedServiceItem[],
  newCategoryConflictGroup?: 'gel' | 'acryl'
): boolean {
  if (!newCategoryConflictGroup) return false;
  const oppositeGroup = newCategoryConflictGroup === 'gel' ? 'acryl' : 'gel';

  return selectedServices.some(
    (item) => item.mainService.conflictGroup === oppositeGroup
  );
}

/** Check if all selected services require auto-assign (foot services) */
export function shouldSkipStaffSelection(
  selectedServices: SelectedServiceItem[],
  categories: ServiceCategory[]
): boolean {
  if (selectedServices.length === 0) return false;

  return selectedServices.every((item) => {
    const cat = categories.find((c) => c.id === item.categoryId);
    return cat?.requiresStaffAutoAssign === true;
  });
}

// ===== AUDIT LOG =====
export type AuditEventType =
  | 'created'
  | 'approved'
  | 'rejected'
  | 'cancelled_by_customer'
  | 'cancelled_by_salon'
  | 'cancelled_by_system'
  | 'staff_reassigned'
  | 'manual_created'
  | 'manual_updated'
  | 'marked_completed'
  | 'marked_no_show'
  | 'sms_sent'
  | 'sms_failed'
  | 'absence_created'
  | 'escalated_to_owner';

export interface AuditLog {
  id: string;
  branchId: string;
  appointmentId: string;
  eventType: AuditEventType;
  actorUid: string;
  actorRole: 'customer' | 'owner' | 'manager' | 'system';
  details: Record<string, unknown>;
  createdAt: string;
}

// ===== MULTI-TENANT RBAC USER PROFILE & BUSINESS =====
export type UserRole = 'superadmin' | 'owner' | 'manager' | 'staff';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  businessId: string | null;
  assignedBranches: string[];
  staffId: string | null; // Maps to Staff.id if role is 'staff'
  name: string;
  phone: string;
  createdAt: string;
  approvalStatus?: 'approved' | 'pending_superadmin' | 'pending_owner' | 'rejected';
}

export interface Business {
  id: string;
  ownerUid: string;
  companyName: string;
  status: 'active' | 'trial' | 'past_due' | 'cancelled';
  subscriptionPlan: 'starter' | 'professional' | 'enterprise';
  createdAt: string;
}
