import { randomUUID } from "node:crypto";
import type {
  ShopAttendanceDiscountType,
  ShopServiceType,
} from "../../../repository/firestore/shop/shop.types.js";
import {
  allocateMoneyMinorUnits,
  fromMoneyMinorUnit,
  toMoneyMinorUnit,
} from "../../../helpers/money.js";
import {
  getAttendanceServiceDuration,
  type NormalizedAttendanceAssigneeInput,
  type NormalizedAttendanceServiceInput,
} from "./attendance-payload.js";

type ResolveAttendanceServicesOptions = {
  ownerId: string;
  storeId: string;
  serviceCatalog: ShopServiceType[];
  existingServices?: ShopServiceType[];
};

// Phần trăm được tính trên thang nhân 100 (đơn vị "percent unit") để chia phần không bị lệch do làm tròn.
const PERCENT_SCALE = 100;
const FULL_PERCENT_UNITS = 100 * PERCENT_SCALE;

const toPercentUnits = (value: number): number => Math.max(0, Math.round(value * PERCENT_SCALE));

const fromPercentUnits = (value: number): number => value / PERCENT_SCALE;

const getRoundedRatioPercentUnits = (partMinorUnit: number, totalMinorUnit: number): number => {
  if (totalMinorUnit <= 0) {
    return 0;
  }

  return Math.round((partMinorUnit * FULL_PERCENT_UNITS) / totalMinorUnit);
};

// Giảm giá 0đ — dùng khi FE gửi `discountAmount: 0` (khác với không gửi gì: giữ nguyên discount cũ).
export const buildZeroDiscount = (): ShopAttendanceDiscountType => ({
  type: "amount",
  value: 0,
  amount: 0,
});

// Chia tiền 1 service cho các thợ làm service đó. Không khai phần trăm → chia đều.
export const buildAttendanceAssignees = (
  assignees: NormalizedAttendanceAssigneeInput[],
  servicePrice: number,
) => {
  if (assignees.length === 0) {
    return [];
  }

  const hasExplicitPercentages = assignees.some((assignee) => assignee.percentage !== undefined);
  const servicePriceMinor = toMoneyMinorUnit(servicePrice);
  const weights = hasExplicitPercentages
    ? assignees.map((assignee) => toPercentUnits(assignee.percentage ?? 0))
    : assignees.map(() => 1);
  const totalPercentUnits = weights.reduce((sum, weight) => sum + weight, 0);
  const shouldNormalizeToFullAmount =
    !hasExplicitPercentages || Math.abs(totalPercentUnits - FULL_PERCENT_UNITS) <= 1;
  const allocationTotalMinor = shouldNormalizeToFullAmount
    ? servicePriceMinor
    : Math.round((servicePriceMinor * totalPercentUnits) / FULL_PERCENT_UNITS);
  const shareMinorUnits = allocateMoneyMinorUnits(allocationTotalMinor, weights);
  const percentageUnits = shouldNormalizeToFullAmount
    ? allocateMoneyMinorUnits(FULL_PERCENT_UNITS, weights)
    : weights;

  return assignees.map((assignee, index) => ({
    employeeUserId: assignee.employeeUserId,
    ...(assignee.employeeName !== undefined && { employeeName: assignee.employeeName }),
    ...(assignee.workerType !== undefined && { workerType: assignee.workerType }),
    percentage: fromPercentUnits(percentageUnits[index] ?? 0),
    shareAmount: fromMoneyMinorUnit(shareMinorUnits[index] ?? 0),
  }));
};

// Cộng phần chia của 1 thợ trên nhiều service lại thành tổng của cả chấm công.
export const mergeAttendanceAssignees = (
  services: Pick<ShopServiceType, "employees" | "price">[],
  subtotalAmount: number,
) => {
  const assigneeMap = new Map<
    string,
    {
      employeeUserId: string;
      employeeName?: string;
      workerType?: "main" | "assistant";
      shareAmount: number;
    }
  >();

  services.forEach((service) => {
    (service.employees ?? []).forEach((employee) => {
      const existingAssignee = assigneeMap.get(employee.employeeUserId);
      const nextShareAmount = fromMoneyMinorUnit(
        toMoneyMinorUnit(existingAssignee?.shareAmount ?? 0) +
          toMoneyMinorUnit(employee.shareAmount ?? 0),
      );
      const resolvedEmployeeName = employee.employeeName ?? existingAssignee?.employeeName;

      const nextAssignee = {
        employeeUserId: employee.employeeUserId,
        shareAmount: nextShareAmount,
        ...(resolvedEmployeeName !== undefined && {
          employeeName: resolvedEmployeeName,
        }),
        ...(employee.workerType !== undefined && { workerType: employee.workerType }),
      };

      assigneeMap.set(employee.employeeUserId, nextAssignee);
    });
  });

  const subtotalMinor = toMoneyMinorUnit(subtotalAmount);

  return Array.from(assigneeMap.values()).map((assignee) => ({
    employeeUserId: assignee.employeeUserId,
    ...(assignee.employeeName !== undefined && { employeeName: assignee.employeeName }),
    ...(assignee.workerType !== undefined && { workerType: assignee.workerType }),
    ...(subtotalAmount > 0 && {
      percentage: fromPercentUnits(
        getRoundedRatioPercentUnits(toMoneyMinorUnit(assignee.shareAmount), subtotalMinor),
      ),
    }),
    shareAmount: assignee.shareAmount,
  }));
};

// Dựng service để lưu vào chấm công: ưu tiên dữ liệu client gửi, thiếu thì lấy từ service đang lưu,
// rồi mới tới catalog của store.
export const resolveAttendanceServices = (
  services: NormalizedAttendanceServiceInput[],
  options: ResolveAttendanceServicesOptions,
): ShopServiceType[] => {
  const serviceCatalogMap = new Map(options.serviceCatalog.map((service) => [service.id, service]));
  const existingServiceMap = new Map(
    (options.existingServices ?? []).map((service) => [service.id, service]),
  );

  return services.map((service) => {
    const referencedServiceId = service.sourceServiceId;
    const catalogService =
      referencedServiceId !== undefined ? serviceCatalogMap.get(referencedServiceId) : undefined;
    const existingService =
      service.id !== undefined ? existingServiceMap.get(service.id) : undefined;
    const resolvedDuration = getAttendanceServiceDuration(service);
    const resolvedPrice = service.price ?? existingService?.price ?? catalogService?.price ?? 0;
    const normalizedEmployees = buildAttendanceAssignees(service.employees, resolvedPrice);
    const resolvedDescription =
      service.description ?? existingService?.description ?? catalogService?.description;
    const resolvedImageUrls =
      service.imageUrls ?? existingService?.imageUrls ?? catalogService?.imageUrls;

    return {
      id: catalogService?.id ?? existingService?.id ?? service.id ?? randomUUID(),
      ownerId: options.ownerId,
      storeId: catalogService?.storeId ?? existingService?.storeId ?? options.storeId,
      type:
        catalogService?.type ?? existingService?.type ?? (catalogService ? "predefined" : "custom"),
      name: service.name || existingService?.name || catalogService?.name || "Service",
      category:
        service.category ?? existingService?.category ?? catalogService?.category ?? "other",
      price: resolvedPrice,
      ...(resolvedDescription !== undefined && { description: resolvedDescription }),
      ...(resolvedImageUrls !== undefined && { imageUrls: resolvedImageUrls }),
      ...resolvedDuration,
      employees: normalizedEmployees,
      ...(existingService?.sourceAttendanceId !== undefined && {
        sourceAttendanceId: existingService.sourceAttendanceId,
      }),
    };
  });
};
