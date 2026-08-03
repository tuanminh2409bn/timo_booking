import type { AuthorizedAppContext } from "../../../helpers/role-access.js";
import {
  buildWorkDaySettlementPreview,
} from "../../../helpers/work-day-settlement.js";
import { firestoreRepository } from "../../../repository/firestore/index.js";
import type {
  ShopAttendanceType,
  ShopWorkDaySettlementClosingType,
  ShopWorkDaySettlementType,
} from "../../../repository/firestore/shop/shop.types.js";
import { normalizeAttendanceForResponse } from "../domain/attendance-presentation.js";
import { filterActiveEmployeesByStore } from "../domain/attendance-employees.js";
import {
  synchronizeWorkDaySettlement,
} from "../work-days/work-day-settlement-sync.js";

// 4 điều kiện chung của mọi lần tính lại chốt sổ: dữ liệu chia tiền phải đủ và tiền phải phân bổ hết.
const hasInvalidSettlementNumbers = (
  settlementPreview: ReturnType<typeof buildWorkDaySettlementPreview>,
): boolean => {
  const someAttendanceIncomplete = settlementPreview.incompleteAttendanceIds.length > 0;

  if (someAttendanceIncomplete) {
    return true;
  }

  const discountAllocationFailed = settlementPreview.discountAllocationError !== undefined;

  if (discountAllocationFailed) {
    return true;
  }

  const someDiscountUnallocated = settlementPreview.totalUnallocatedDiscount > 0;

  if (someDiscountUnallocated) {
    return true;
  }

  // Thợ hưởng hoa hồng (không phải hourly) mà thu nhập âm → settlement sai.
  const someCommissionEmployeeEarningNegative = settlementPreview.employeeSummaries.some(
    (employeeSummary) =>
      employeeSummary.compensationModel === "commission" && employeeSummary.employeeEarning < 0,
  );

  return someCommissionEmployeeEarningNegative;
};

// Chủ sửa chấm công nằm trong ngày đã chốt.
// ⚠️ CỐ Ý KHÔNG kiểm "mọi chấm công của ngày đã đóng": dữ liệu cũ có thể còn chấm công `open`
// trong ngày đã chốt, và chủ phải sửa được để dọn. Xem test
// "lets owner edit attendance on a closed work day even when the attendance is still open".
export const isClosingInvalidAfterAttendanceEdit = (
  settlementPreview: ReturnType<typeof buildWorkDaySettlementPreview>,
): boolean => {
  const compensationConfigurationIncomplete =
    settlementPreview.compensationConfigurationErrors.length > 0;

  if (compensationConfigurationIncomplete) {
    return true;
  }

  return hasInvalidSettlementNumbers(settlementPreview);
};

// Chủ ghi bù chấm công MỚI vào ngày đã chốt — chặt hơn nhánh sửa: ngoài các điều kiện chung,
// mọi chấm công của ngày phải đã đóng thì mới cho thêm bản ghi mới vào sổ đã chốt.
export const isClosingInvalidAfterBackfill = (
  attendances: ShopAttendanceType[],
  settlementPreview: ReturnType<typeof buildWorkDaySettlementPreview>,
): boolean => {
  const someAttendanceStillOpen = attendances.some((attendance) => attendance.status !== "closed");

  if (someAttendanceStillOpen) {
    return true;
  }

  return hasInvalidSettlementNumbers(settlementPreview);
};

export const getAffectedAttendanceWorkDates = (
  attendance: ShopAttendanceType,
  nextWorkDate: string | undefined,
): string[] => {
  const affectedDates = [attendance.workDate];

  if (nextWorkDate !== undefined && nextWorkDate !== attendance.workDate) {
    affectedDates.push(nextWorkDate);
  }

  return affectedDates;
};

type ClosedWorkDaySettlement = ShopWorkDaySettlementType & {
  status: "closed";
  closing: ShopWorkDaySettlementClosingType;
};

type AffectedClosingRecalculation = {
  settlement: ClosedWorkDaySettlement;
  attendances: ShopAttendanceType[];
  settlementPreview: ReturnType<typeof buildWorkDaySettlementPreview>;
};

export type ClosingRecalculation = AffectedClosingRecalculation;

// Normalize danh sách chấm công của 1 ngày rồi tính preview settlement theo cấu hình lương của bản chốt
// sổ đó. Nguồn DUY NHẤT dựng preview khi tính lại — cả nhánh ghi bù lẫn nhánh sửa đều dùng, để cấu hình
// tính lương (ownerDiscountCoverageRate + employeeConfigs) không bị lệch giữa 2 nhánh.
const computeClosingSettlementPreview = (
  dayAttendances: ShopAttendanceType[],
  closing: Pick<ShopWorkDaySettlementClosingType, "ownerDiscountCoverageRate">,
  activeEmployeesInStore: Parameters<typeof filterActiveEmployeesByStore>[0],
): { normalizedAttendances: ShopAttendanceType[]; settlementPreview: ReturnType<typeof buildWorkDaySettlementPreview> } => {
  const normalizedAttendances = dayAttendances.map(normalizeAttendanceForResponse);
  const settlementPreview = buildWorkDaySettlementPreview(normalizedAttendances, {
    ownerDiscountCoverageRate: closing.ownerDiscountCoverageRate,
    employeeConfigs: activeEmployeesInStore.map((employee) => ({
      uid: employee.uid,
      name: employee.name,
      compensationModel: employee.compensationModel,
      ownerCommissionRate: employee.ownerCommissionRate,
      fixedSalary: employee.fixedSalary,
      hourlyRate: employee.hourlyRate,
    })),
    employeeWorkDayClosings: [],
  });

  return { normalizedAttendances, settlementPreview };
};

// Ghi bù chấm công MỚI vào ngày đã chốt: tính trước kết quả chốt sổ mới (chấm công cũ của ngày
// + chấm công sắp tạo) để caller chặn được TRƯỚC khi ghi document.
export const buildClosingRecalculationForBackfill = async (
  ownerId: string,
  existingWorkDaySettlement: ClosedWorkDaySettlement,
  candidateAttendance: ShopAttendanceType,
  activeEmployeesInStore: Parameters<typeof filterActiveEmployeesByStore>[0],
): Promise<ClosingRecalculation> => {
  const existingAttendances =
    await firestoreRepository.shop.attendance.listShopAttendanceByStoreWorkDateKey(
      ownerId,
      existingWorkDaySettlement.storeId,
      existingWorkDaySettlement.workDate,
    );
  const { normalizedAttendances, settlementPreview } = computeClosingSettlementPreview(
    existingAttendances.concat(candidateAttendance),
    existingWorkDaySettlement.closing,
    activeEmployeesInStore,
  );

  return {
    settlement: existingWorkDaySettlement,
    attendances: normalizedAttendances,
    settlementPreview,
  };
};

// Chấm công gây tính lại chốt sổ: ghi bù (tạo mới) hay sửa trực tiếp — chỉ khác tên field ghi vết.
type ClosingRecalculationTrigger =
  | { kind: "backfill"; attendanceId: string }
  | { kind: "edit"; attendanceId: string };

// Ghi lại bản chốt sổ của ngày với số liệu đã tính lại, tăng revision và ghi vết chấm công gây tính lại.
// Nguồn DUY NHẤT ghi closing khi tính lại — cả nhánh ghi bù lẫn nhánh sửa đều gọi (payload không lệch).
export const applyClosingRecalculation = async (
  ownerId: string,
  closingRecalculation: ClosingRecalculation,
  _options: {
    triggeredBy: ClosingRecalculationTrigger;
    actorUserId: string;
    fallbackStoreTimezone: string;
    recalculatedAt?: number | undefined;
  },
) => {
  await synchronizeWorkDaySettlement(
    ownerId,
    closingRecalculation.settlement.storeId,
    closingRecalculation.settlement.workDate,
    { preserveClosedStatus: true },
  );
};

export type AffectedClosingRecalculationResult =
  | { ok: true; recalculations: AffectedClosingRecalculation[] }
  | { ok: false; reason: "invalid_settlement_state" };

// Tính lại settlement cho ĐÚNG 1 ngày đã chốt, sau khi áp lần sửa attendance vào ngày đó.
const recalculateClosingForDay = async (
  authContext: AuthorizedAppContext,
  settlement: ClosedWorkDaySettlement,
  beforeAttendance: ShopAttendanceType,
  nextAttendance: ShopAttendanceType,
  activeShopEmployees: Parameters<typeof filterActiveEmployeesByStore>[0],
): Promise<AffectedClosingRecalculation> => {
  const storedAttendances =
    await firestoreRepository.shop.attendance.listShopAttendanceByStoreWorkDateKey(
      authContext.ownerId,
      beforeAttendance.storeId,
      settlement.workDate,
    );

  // Bỏ bản cũ của attendance đang sửa; nếu bản mới rơi vào đúng ngày này thì thêm vào.
  const dayAttendancesAfterEdit = storedAttendances.filter(
    (attendance) => attendance.id !== beforeAttendance.id,
  );

  if (nextAttendance.workDate === settlement.workDate) {
    dayAttendancesAfterEdit.push(nextAttendance);
  }

  const { normalizedAttendances, settlementPreview } = computeClosingSettlementPreview(
    dayAttendancesAfterEdit,
    settlement.closing,
    filterActiveEmployeesByStore(activeShopEmployees, settlement.storeId),
  );

  return { settlement, attendances: normalizedAttendances, settlementPreview };
};

export const prepareAffectedClosingRecalculations = async (
  authContext: AuthorizedAppContext,
  beforeAttendance: ShopAttendanceType,
  nextAttendance: ShopAttendanceType,
  affectedDates: string[],
): Promise<AffectedClosingRecalculationResult> => {
  const [activeShopEmployees, settlementsForAffectedDates] = await Promise.all([
    firestoreRepository.user.listActiveShopEmployees(authContext.ownerId),
    Promise.all(
      affectedDates.map((workDate) =>
        firestoreRepository.shop.settlement.getWorkDaySettlement(
          authContext.ownerId,
          beforeAttendance.storeId,
          workDate,
        ),
      ),
    ),
  ]);

  const recalculations: AffectedClosingRecalculation[] = [];

  for (const settlement of settlementsForAffectedDates) {
    // Ngày chưa chốt → không có gì để tính lại.
    if (!settlement || settlement.status !== "closed" || settlement.closing === undefined) {
      continue;
    }

    const closedSettlement: ClosedWorkDaySettlement = {
      ...settlement,
      status: "closed",
      closing: settlement.closing,
    };

    const recalculation = await recalculateClosingForDay(
      authContext,
      closedSettlement,
      beforeAttendance,
      nextAttendance,
      activeShopEmployees,
    );

    // Bất kỳ ngày nào sau khi sửa mà settlement không hợp lệ → chặn cả thao tác.
    if (isClosingInvalidAfterAttendanceEdit(recalculation.settlementPreview)) {
      return { ok: false, reason: "invalid_settlement_state" };
    }

    recalculations.push(recalculation);
  }

  return { ok: true, recalculations };
};
