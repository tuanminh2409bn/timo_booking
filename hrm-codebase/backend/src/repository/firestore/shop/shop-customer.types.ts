import type { ShopAttendanceBookingStatus } from "./shop.types.js";

export type ShopCustomerType = {
  id: string;
  ownerId: string;
  storeId: string;
  phone?: string;
  customerCode?: string;
  name?: string;
  blocked: boolean;
  blockedReason?: string;
  blockedByUserId?: string;
  blockedByRole?: "owner" | "manager";
  blockedAt?: number;
  unblockedByUserId?: string;
  unblockedByRole?: "owner" | "manager";
  unblockedAt?: number;
  archivedAttendanceCounters?: ShopCustomerAttendanceSummaryType;
  createdAt: number;
  updatedAt: number;
};

export type ShopCustomerUpsertInput = {
  storeId: string;
  phone?: string;
  name?: string;
};

export type ShopCustomerBlockInput = {
  reason: string;
  userId: string;
  role: "owner" | "manager";
};

export type ShopCustomerUnblockInput = {
  userId: string;
  role: "owner" | "manager";
};

export type ShopCustomerListCursor = {
  createdAt: number;
  id: string;
};

export type ShopCustomerAttendanceCursor = {
  workDate: string;
  startTime: number;
  id: string;
};

export type ShopCustomerAttendanceDateRange = {
  startDate: string;
  endDate: string;
};

export type ShopCustomerAttendanceHistoryItemType = {
  id: string;
  attendanceCode?: string;
  workDate: string;
  startTime: number;
  endTime: number;
  status: "open" | "closed";
  bookingStatus?: ShopAttendanceBookingStatus;
  services: Array<{
    id: string;
    name: string;
  }>;
};

export type ShopCustomerAttendanceSummaryType = {
  totalAppointments: number;
  requestedAppointments: number;
  confirmedAppointments: number;
  processingAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  completedAppointments?: number;
  total?: number;
  pending_approval?: number;
  confirmed?: number;
  completed?: number;
  cancelled?: number;
  no_show?: number;
};
