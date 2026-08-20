import type {
  ShopServiceCategoryDocumentType,
  ShopServiceCatalogGroupType,
  ShopServiceType,
} from "../../../repository/firestore/shop/shop.types.js";

const SERVICE_CATEGORY_LABELS: Record<ShopServiceType["category"], string> = {
  nail: "Nail",
  pedicure: "Pedicure",
  manicure: "Manicure",
  design: "Design",
  other: "Other",
};

export const toShopServiceListItem = (service: ShopServiceType) => ({
  id: service.id,
  ...(service.serviceCode !== undefined && { serviceCode: service.serviceCode }),
  name: service.name,
  ...(service.displayName !== undefined && { displayName: service.displayName }),
  category: service.category,
  ...(service.description !== undefined && { description: service.description }),
  groupService: service.groupService ?? SERVICE_CATEGORY_LABELS[service.category],
  price: service.price,
  durationMinutes: Math.max(service.durationMax ?? service.durationMin ?? 0, 0),
  ...(service.createdAt !== undefined && { createdAt: service.createdAt }),
  ...(service.updatedAt !== undefined && { updatedAt: service.updatedAt }),
  preferredWorkerType: service.preferredWorkerType ?? "main",
  bookingKind: service.bookingKind ?? "main",
  availableForBooking: service.availableForBooking ?? true,
});

export const toShopServiceGroupItem = (
  group: ShopServiceCategoryDocumentType | ShopServiceCatalogGroupType,
) => ({
  id: group.id,
  name: group.name,
  label: group.label,
  category: group.category,
  sortOrder: group.sortOrder,
  serviceCount: group.serviceCount,
});
