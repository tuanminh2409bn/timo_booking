import { z } from "zod";

export const StoreStatusEnum = z.enum(["active", "disabled"]);
export type StoreStatusType = z.infer<typeof StoreStatusEnum>;

export type StoreType = {
  id: string;
  ownerId: string;
  name: string;
  /** Public, human-readable identifier used in salon booking links. */
  bookingSlug?: string;
  phone?: string;
  email?: string;
  manager?: string;
  businessType?: string;
  website?: string;
  openTime?: string;
  closeTime?: string;
  settlementCutoffTime?: string;
  foundedDate?: string;
  address?: {
    line1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  status: StoreStatusType;
  timezone?: string;
  currency?: "EUR";
  bookingWindowDays?: number;
  minimumNoticeHours?: number;
  cancellationNoticeHours?: number;
  slotIntervalMinutes?: number;
  publicStaffSelection?: boolean;
  employeeCount?: number;
  activeEmployeeCount?: number;
  inactiveEmployeeCount?: number;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type ShopServiceCategoryType = "nail" | "pedicure" | "manicure" | "other" | "design";

export const ShopServiceCategoryEnum = z.enum(["nail", "pedicure", "manicure", "other", "design"]);

export const ShopAttendanceDiscountTypeEnum = z.enum(["amount", "percentage"]);
export type ShopAttendanceDiscountTypeValue = z.infer<typeof ShopAttendanceDiscountTypeEnum>;

export const ShopDiscountOwnerCoverageRateEnum = z.union([
  z.literal(0),
  z.literal(50),
  z.literal(100),
]);
export type ShopDiscountOwnerCoverageRateType = z.infer<typeof ShopDiscountOwnerCoverageRateEnum>;

export const ShopEmployeeCompensationModelEnum = z.enum(["commission", "fixed", "hourly"]);
export type ShopEmployeeCompensationModelType = z.infer<typeof ShopEmployeeCompensationModelEnum>;

export type ShopAttendanceAssigneeType = {
  employeeUserId: string;
  employeeName?: string;
  workerType?: "main" | "assistant";
  percentage?: number;
  shareAmount?: number;
};

export type ShopAttendanceDiscountType = {
  type: ShopAttendanceDiscountTypeValue;
  value: number;
  amount: number;
};

export type ShopBookingAddonType = {
  id: string;
  sourceServiceId?: string;
  name: string;
  price: number;
};

export type ShopBookingActorType = "customer" | "user";

/**
 * Booking-level data shared by one or more attendance records.
 * Add-ons live here deliberately: they never create calendar blocks or assignees.
 */
export type ShopBookingType = {
  id: string;
  bookingCode: string;
  ownerId: string;
  storeId: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  workDate: string;
  attendanceIds: string[];
  slotReservationIds?: string[];
  addOns: ShopBookingAddonType[];
  subtotalAmount: number;
  totalAmount: number;
  bookingStatus: ShopAttendanceBookingStatus;
  /** Immutable marker used to keep approved Requests in the Request calendar column. */
  originatedAsRequest?: boolean;
  source: ShopAttendanceSource;
  notes?: string;
  createdByType: ShopBookingActorType;
  createdById: string;
  createdByRole: ShopAttendanceActorRole;
  createdAt: number;
  updatedByType: ShopBookingActorType;
  updatedById: string;
  updatedByRole: ShopAttendanceActorRole;
  updatedAt: number;
};

// Vòng đời lịch hẹn (độc lập với `status: open/closed` của chốt sổ):
// requested = chờ chủ duyệt (ngày fully booked); confirmed = auto khi thợ còn lịch;
// processing = chủ đang xử lý (vd thợ nghỉ / chưa gán thợ); no_show/cancelled = không phát sinh doanh thu.
// Nguồn DUY NHẤT của 5 giá trị — type + zod schema đều derive từ đây.
export const SHOP_ATTENDANCE_BOOKING_STATUSES = [
  "requested",
  "confirmed",
  "processing",
  "no_show",
  "cancelled",
] as const;

export type ShopAttendanceBookingStatus = (typeof SHOP_ATTENDANCE_BOOKING_STATUSES)[number];

export const DEFAULT_BOOKING_STATUS: ShopAttendanceBookingStatus = "confirmed";

export const SHOP_ATTENDANCE_SOURCES = [
  "online_booking",
  "manual_booking",
  "walk_in",
] as const;

export type ShopAttendanceSource = (typeof SHOP_ATTENDANCE_SOURCES)[number];

export const SHOP_ATTENDANCE_ACTOR_ROLES = [
  "customer",
  "owner",
  "manager",
  "employee",
] as const;

export type ShopAttendanceActorRole = (typeof SHOP_ATTENDANCE_ACTOR_ROLES)[number];

export type ShopAttendanceType = {
  id: string;
  bookingId?: string;
  attendanceCode?: string;
  ownerId: string;
  employeeUserId?: string;
  mainAssigneeUserId?: string;
  assistantAssigneeUserId?: string;
  storeId: string;
  storeName: string;
  storeWorkDateKey: string;
  workDate: string;
  storeTimezone?: string;
  settlementCutoffTime?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  startTime: number;
  endTime: number;
  customerName?: string;
  customerPhone?: string;
  customerId?: string;
  note?: string;
  bookingSource?: string;
  /** How the customer selected staff for this calendar segment. */
  staffSelectionType?: "specific" | "any";
  /** Immutable snapshot of the employee explicitly requested by the customer. */
  requestedEmployeeUserId?: string;
  requestedEmployeeName?: string;
  /** Employee whose leave made this segment require owner action. */
  conflictEmployeeUserId?: string;
  conflictEmployeeName?: string;
  /** Replacement selected while the segment remains in its original workflow column. */
  proposedAssigneeUserId?: string;
  proposedAssigneeName?: string;
  proposedAssigneeWorkerType?: "main" | "assistant";
  source?: ShopAttendanceSource | "hrm";
  assignees: ShopAttendanceAssigneeType[];
  services: ShopServiceType[];
  subtotalAmount: number;
  discount?: ShopAttendanceDiscountType;
  totalAmount: number;
  status: "open" | "closed";
  bookingStatus?: ShopAttendanceBookingStatus;
  /** Immutable marker used to keep approved Requests in the Request calendar column. */
  originatedAsRequest?: boolean;
  assigneeUserIds?: string[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
  createdByType?: ShopAttendanceActorRole;
  createdByUserId?: string;
  createdByRole?: ShopAttendanceActorRole;
  updatedByUserId?: string;
  updatedByRole?: ShopAttendanceActorRole;
  /** Human-readable snapshot used by Booking history and cancellation details. */
  updatedByName?: string;
  closedAt?: number;
  closedBy?: string;
};

export type ShopAttendanceCalendarType = Pick<
  ShopAttendanceType,
  | "id"
  | "bookingId"
  | "attendanceCode"
  | "ownerId"
  | "employeeUserId"
  | "mainAssigneeUserId"
  | "assistantAssigneeUserId"
  | "storeId"
  | "storeName"
  | "storeWorkDateKey"
  | "workDate"
  | "storeTimezone"
  | "settlementCutoffTime"
  | "startTimestamp"
  | "endTimestamp"
  | "startTime"
  | "endTime"
  | "customerName"
  | "customerPhone"
  | "customerId"
  | "note"
  | "bookingSource"
  | "staffSelectionType"
  | "requestedEmployeeUserId"
  | "requestedEmployeeName"
  | "conflictEmployeeUserId"
  | "conflictEmployeeName"
  | "proposedAssigneeUserId"
  | "proposedAssigneeName"
  | "proposedAssigneeWorkerType"
  | "source"
  | "assignees"
  | "services"
  | "subtotalAmount"
  | "discount"
  | "totalAmount"
  | "status"
  | "bookingStatus"
  | "originatedAsRequest"
  | "assigneeUserIds"
  | "createdAt"
  | "updatedAt"
  | "createdBy"
  | "updatedBy"
  | "createdByType"
  | "createdByUserId"
  | "createdByRole"
  | "updatedByUserId"
  | "updatedByRole"
  | "updatedByName"
  | "closedAt"
  | "closedBy"
>;

export type ShopWorkDayEmployeeSummaryType = {
  employeeUserId: string;
  employeeName: string;
  totalRevenue: number;
  discountAllocated: number;
  ownerDiscountSupported: number;
  revenueAfterDiscount: number;
  ownerCommission: number;
  employeeEarning: number;
  compensationModel: ShopEmployeeCompensationModelType;
  ownerCommissionRate?: number;
  fixedSalary?: number;
  hourlyRate?: number;
  workedMinutes: number;
  isSelectedForDiscount: boolean;
};

export type ShopWorkDayServiceSummaryType = {
  serviceId: string;
  serviceName: string;
  category: ShopServiceCategoryType | string;
  count: number;
  totalRevenue: number;
  totalRevenueMinor?: number;
  averagePrice: number;
  averagePriceMinor?: number;
};

export const ShopWorkDayDiscountAllocationMethodEnum = z.enum(["revenue_share"]);
export type ShopWorkDayDiscountAllocationMethodType = z.infer<
  typeof ShopWorkDayDiscountAllocationMethodEnum
>;

export type ShopWorkDaySettlementSummaryType = {
  totalEntries: number;
  subtotalAmount: number;
  totalDiscountAmount: number;
  totalEmployeeDiscountAmount?: number;
  totalOwnerDiscountAmount?: number;
  totalNetAmount: number;
  totalOwnerCommission: number;
  totalEmployeeEarning: number;
};

export type ShopWorkDaySettlementReportDayType = {
  id: string;
  workDate: string;
  employeeSummaries: ShopWorkDayEmployeeSummaryType[];
  serviceSummaries?: ShopWorkDayServiceSummaryType[];
  summary: ShopWorkDaySettlementSummaryType;
};

export type ShopClosedWorkDaySettlementType = ShopWorkDaySettlementReportDayType & {
  ownerId: string;
  storeId: string;
  storeTimezone?: string;
  closedAt: number;
  closedByUserId: string;
  ownerDiscountCoverageRate: ShopDiscountOwnerCoverageRateType;
  discountAllocationMethod: ShopWorkDayDiscountAllocationMethodType;
  revision?: number;
  updatedByBackfillAttendanceId?: string;
  updatedByDirectAttendanceEditId?: string;
  recalculatedAt?: number;
  recalculatedBy?: string;
  createdAt: number;
  updatedAt: number;
};

export const SHOP_WORK_DAY_SETTLEMENT_STATUS_VALUES = ["open", "ready", "closed"] as const;
export type ShopWorkDaySettlementStatusType =
  (typeof SHOP_WORK_DAY_SETTLEMENT_STATUS_VALUES)[number];

export type ShopWorkDaySettlementEmployeeListItemType = {
  employeeUserId: string;
  employeeName?: string;
  attendanceCount: number;
  closedCount: number;
  totalRevenue: number;
};

export type ShopWorkDaySettlementAttendanceItemType = {
  id: string;
  attendanceCode?: string;
  startTime: number;
  endTime: number;
  customerName?: string;
  status: "open" | "closed";
  responsibleEmployeeUserId?: string;
  services: Array<{
    name: string;
    employees: Array<{
      employeeUserId: string;
      employeeName?: string;
    }>;
  }>;
};

export type ShopWorkDaySettlementPreviewType = {
  employeeSummaries: ShopWorkDayEmployeeSummaryType[];
  compensationConfigurationErrors: Array<{
    employeeUserId: string;
    reason:
      | "hourly_rate_missing"
      | "fixed_salary_missing"
      | "owner_commission_rate_missing"
      | "compensation_model_missing"
      | "employee_missing";
  }>;
  totalRevenue: number;
  totalDiscount: number;
  totalEmployeeDiscount: number;
  totalOwnerDiscount: number;
  totalOwnerDiscountAbsorbed: number;
  totalEmployeeDiscountAllocated: number;
  totalUnallocatedDiscount: number;
  totalNetAmount: number;
  totalOwnerCommission: number;
  totalOwnerNetAfterDiscount: number;
  totalEmployeeEarning: number;
  allocationSource: "workday";
  discountAllocationError?: string;
  discountTargetEmployeeUserIds: string[];
  discountEligibleEmployeeUserIds: string[];
  submittedEmployeeUserIds: string[];
  incompleteAttendanceIds: string[];
};

export type ShopWorkDaySettlementClosingType = {
  id: string;
  closedAt: number;
  closedByUserId: string;
  ownerDiscountCoverageRate: ShopDiscountOwnerCoverageRateType;
  discountAllocationMethod: ShopWorkDayDiscountAllocationMethodType;
  storeTimezone?: string;
  employeeSummaries?: ShopWorkDayEmployeeSummaryType[];
  summary: ShopWorkDaySettlementSummaryType;
  createdAt: number;
  updatedAt: number;
};

export type ShopWorkDaySettlementType = {
  id: string;
  ownerId: string;
  storeId: string;
  workDate: string;
  settlementEligibleAt: number;
  status: ShopWorkDaySettlementStatusType;
  attendance: {
    totalCount: number;
    openCount: number;
    closedCount: number;
    incompleteCount: number;
    employeeTotalCount: number;
    employeeClosedCount: number;
  };
  employees: ShopWorkDaySettlementEmployeeListItemType[];
  totalRevenue: number;
  totalDiscount: number;
  totalNetAmount: number;
  totalOwnerNetAfterDiscount: number;
  attendanceVersion: string;
  previewOwnerDiscountCoverageRate: ShopDiscountOwnerCoverageRateType;
  preview: ShopWorkDaySettlementPreviewType;
  pendingEmployees: Array<{
    id: string;
    name: string;
  }>;
  attendanceItems?: ShopWorkDaySettlementAttendanceItemType[];
  serviceSummaries: ShopWorkDayServiceSummaryType[];
  closing?: ShopWorkDaySettlementClosingType;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export type ShopWorkDaySettlementListProjectionType = Pick<
  ShopWorkDaySettlementType,
  "id" | "ownerId" | "storeId" | "workDate" | "settlementEligibleAt" | "status" | "employees"
> & {
  attendance: Pick<
    ShopWorkDaySettlementType["attendance"],
    "employeeTotalCount" | "employeeClosedCount"
  >;
};

export type ShopWorkDaySettlementFinancialProjectionType = Pick<
  ShopWorkDaySettlementType,
  "id" | "ownerId" | "storeId" | "workDate" | "serviceSummaries" | "updatedAt"
> & {
  employees: Array<
    Pick<ShopWorkDaySettlementEmployeeListItemType, "employeeUserId" | "attendanceCount">
  >;
  status: "closed";
  attendance: Pick<ShopWorkDaySettlementType["attendance"], "totalCount">;
  preview: Pick<
    ShopWorkDaySettlementType["preview"],
    "employeeSummaries" | "totalEmployeeEarning" | "totalOwnerCommission"
  >;
  closing: Pick<
    NonNullable<ShopWorkDaySettlementType["closing"]>,
    | "id"
    | "closedAt"
    | "closedByUserId"
    | "ownerDiscountCoverageRate"
    | "discountAllocationMethod"
    | "summary"
  >;
};

export type ShopEmployeeWorkDayClosingType = {
  id: string;
  ownerId: string;
  storeId: string;
  workDate: string;
  employeeUserId: string;
  attendanceIds: string[];
  attendanceVersions: Record<string, number>;
  closedAt: number;
  closedByUserId: string;
  createdAt: number;
  updatedAt: number;
};

export type ShopEmployeeTimeTrackingType = {
  id: string;
  ownerId: string;
  storeId: string;
  workDate: string;
  employeeUserId: string;
  status: "working" | "completed";
  checkedInAt: number;
  checkedOutAt?: number;
  workedMinutes?: number;
  createdAt: number;
  updatedAt: number;
};

export type ShopExpenseReceiptImageType = {
  imageUrl: string;
  storagePath?: string;
  fileName?: string;
  contentType?: string;
  uploadedAt: number;
  uploadedByUserId: string;
  storageLifecyclePolicy: "expense-receipt-hot-cold-v1";
};

export type ShopExpenseType = {
  id: string;
  ownerId: string;
  storeId: string;
  workDate: string;
  name: string;
  supplierName?: string;
  note?: string;
  amount: number;
  receiptImage?: ShopExpenseReceiptImageType;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: number;
  updatedAt: number;
};

export type ShopEmployeeLeaveRequestType = {
  id: string;
  ownerId: string;
  storeId: string;
  employeeUserId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  reason: string;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: number;
  updatedAt: number;
};

export type ShopAuditLogActorRoleType = "admin" | "owner" | "manager" | "employee" | "system";

export type ShopAuditLogEntityType =
  | "attendance"
  | "work_day"
  | "employee"
  | "employee_leave"
  | "expense"
  | "store"
  | "service_group"
  | "service"
  | "security"
  | "employee_time_tracking"
  | "owner";

export type ShopAuditLogEventType =
  | "owner_registered"
  | "owner_data_retention_plan_changed"
  | "account_deletion_requested"
  | "password_reset_completed"
  | "employee_created"
  | "employee_updated"
  | "employee_status_changed"
  | "employee_leave_created"
  | "employee_leave_deleted"
  | "attendance_created"
  | "attendance_updated"
  | "attendance_deleted"
  | "attendance_closed"
  | "employee_time_tracking_started"
  | "employee_time_tracking_completed"
  | "employee_work_day_closed"
  | "expense_created"
  | "expense_updated"
  | "expense_deleted"
  | "expense_receipt_uploaded"
  | "workday_closed"
  | "store_created"
  | "store_updated"
  | "service_group_created"
  | "service_created"
  | "service_updated"
  | "service_deleted";

export type ShopAuditLogType = {
  id: string;
  ownerId: string;
  eventType: ShopAuditLogEventType;
  entityType: ShopAuditLogEntityType;
  entityId?: string;
  storeId?: string;
  workDate?: string;
  actorUserId?: string;
  actorRole?: ShopAuditLogActorRoleType;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type ShopServiceType = {
  id: string;
  sourceServiceId?: string;
  serviceCode?: string;
  ownerId: string;
  storeId: string;
  serviceCategoryId?: string;
  type: "predefined" | "custom";
  name: string;
  /** Compact label used by internal owner/employee calendar views. */
  displayName?: string;
  description?: string;
  groupService?: string;
  category: ShopServiceCategoryType;
  price: number;
  imageUrls?: string[];
  durationMin?: number;
  durationMax?: number;
  /** Staff group preferred by the salon when the customer chooses "any staff". */
  preferredWorkerType?: "main" | "assistant";
  /** Add-ons are persisted at booking scope and never reserve calendar time. */
  bookingKind?: "main" | "add_on";
  /** Controls whether customers can select this service on the public booking page. */
  availableForBooking?: boolean;
  discountAmount?: number;
  employees?: ShopAttendanceAssigneeType[];
  sourceAttendanceId?: string;
  approvedByUserId?: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type ShopServiceCatalogGroupType = {
  id: string;
  name: string;
  label: string;
  category: ShopServiceCategoryType;
  sortOrder: number;
  serviceCount: number;
  services: ShopServiceType[];
};

export type ShopServiceCategoryDocumentType = Omit<ShopServiceCatalogGroupType, "services"> & {
  ownerId: string;
  storeId: string;
  createdAt: number;
  updatedAt: number;
};

export type ShopServiceCatalogType = {
  id: string;
  ownerId: string;
  storeId: string;
  version: string;
  groupCount: number;
  serviceCount: number;
  groups: ShopServiceCatalogGroupType[];
  createdAt: number;
  updatedAt: number;
};
