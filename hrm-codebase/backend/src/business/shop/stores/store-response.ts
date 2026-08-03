import type { StoreType } from "../../../repository/firestore/shop/shop.types.js";
import {
  normalizeBusinessTimeZone,
  normalizeSettlementCutoffTime,
} from "../../../helpers/business-day.js";

export const formatStoreAddress = (store: Pick<StoreType, "address">): string =>
  [
    store.address?.line1,
    store.address?.city,
    store.address?.state,
    store.address?.zipCode,
    store.address?.country,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ");

export const toPublicStoreId = (storeId: string) => {
  const parsedStoreId = Number(storeId);
  return Number.isInteger(parsedStoreId) && `${parsedStoreId}` === storeId
    ? parsedStoreId
    : storeId;
};

export const toStoreListResponse = (
  store: StoreType,
  options: { employeeCount?: number } = {},
) => ({
  id: store.id,
  name: store.name,
  ...(store.bookingSlug !== undefined && { bookingSlug: store.bookingSlug }),
  status: store.status,
  addressText: formatStoreAddress(store),
  employeeCount: options.employeeCount ?? store.employeeCount ?? 0,
  ...(store.openTime !== undefined && { openTime: store.openTime }),
  ...(store.closeTime !== undefined && { closeTime: store.closeTime }),
  settlementCutoffTime: normalizeSettlementCutoffTime(store.settlementCutoffTime),
  timezone: normalizeBusinessTimeZone(store.timezone),
  bookingWindowDays: store.bookingWindowDays ?? 30,
  minimumNoticeHours: store.minimumNoticeHours ?? 2,
  cancellationNoticeHours: store.cancellationNoticeHours ?? 12,
  slotIntervalMinutes: store.slotIntervalMinutes ?? 15,
  publicStaffSelection: store.publicStaffSelection ?? true,
  ...(store.createdAt !== undefined && { createdAt: store.createdAt }),
  ...(store.updatedAt !== undefined && { updatedAt: store.updatedAt }),
});

export const toStoreDetailResponse = (
  store: StoreType,
  options: { employeeCount?: number } = {},
) => ({
  id: store.id,
  name: store.name,
  ...(store.bookingSlug !== undefined && { bookingSlug: store.bookingSlug }),
  status: store.status,
  ...(store.phone !== undefined && { phone: store.phone }),
  ...(store.email !== undefined && { email: store.email }),
  ...(store.manager !== undefined && { manager: store.manager }),
  ...(store.website !== undefined && { website: store.website }),
  ...(store.openTime !== undefined && { openTime: store.openTime }),
  ...(store.closeTime !== undefined && { closeTime: store.closeTime }),
  settlementCutoffTime: normalizeSettlementCutoffTime(store.settlementCutoffTime),
  timezone: normalizeBusinessTimeZone(store.timezone),
  ...(store.foundedDate !== undefined && { foundedDate: store.foundedDate }),
  ...(store.address !== undefined && { address: store.address }),
  employeeCount: options.employeeCount ?? store.employeeCount ?? 0,
  ...(store.createdAt !== undefined && { createdAt: store.createdAt }),
  ...(store.updatedAt !== undefined && { updatedAt: store.updatedAt }),
  addressText: formatStoreAddress(store),
  bookingWindowDays: store.bookingWindowDays ?? 30,
  minimumNoticeHours: store.minimumNoticeHours ?? 2,
  cancellationNoticeHours: store.cancellationNoticeHours ?? 12,
  slotIntervalMinutes: store.slotIntervalMinutes ?? 15,
  publicStaffSelection: store.publicStaffSelection ?? true,
});

export const toStoreResponse = toStoreDetailResponse;
