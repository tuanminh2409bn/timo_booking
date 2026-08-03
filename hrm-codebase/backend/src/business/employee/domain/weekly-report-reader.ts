// Tầng ĐỌC/DIỄN GIẢI weekly report — dùng chung cho reports/salary/portal (đều bên employee/), thay vì mỗi
// nơi tự chép. shop/weekly-reports LO phần SINH; đây là phần TIÊU THỤ. Gom về 1 chỗ để chỉ 1 nơi hiểu shape
// weekly report → đổi shape thì sửa 1 chỗ, không lệch số liệu giữa 3 màn.
//
// (Chưa gom: `getRawDateRanges` — reports & portal trả field khác tên và lọt vào response meta nên gộp sẽ
// đổi contract; xem docs/todo.md.)
import { DEFAULT_MONEY_SCALE, resolveMoneyAmount } from "../../../helpers/money.js";
import { getWeekEndDate } from "../../../helpers/weekly-report-generator.js";
import type {
  WeeklyReportDailyEmployeeBreakdown,
  WeeklyReportDailyServiceBreakdown,
  WeeklyReportEmployeeBreakdown,
  WeeklyReportServiceBreakdown,
  WeeklyReportType,
} from "../../../repository/firestore/shop/weekly-report.types.js";

// Tuần nằm TRỌN trong [from, to].
export const isFullWeekInsideRange = (
  report: Pick<WeeklyReportType, "weekStartDate" | "weekEndDate">,
  fromWorkDate: string,
  toWorkDate: string,
): boolean => report.weekStartDate >= fromWorkDate && report.weekEndDate <= toWorkDate;

// Dùng được weekly report này cho khoảng [from, to] không: có breakdown theo NGÀY (cắt được bất kỳ khoảng)
// HOẶC cả tuần nằm trọn trong khoảng (dùng breakdown cả tuần).
export const canUseWeeklyReportForRange = (
  report: WeeklyReportType,
  fromWorkDate: string,
  toWorkDate: string,
): boolean =>
  Array.isArray(report.dailyEmployeeBreakdowns) ||
  isFullWeekInsideRange(report, fromWorkDate, toWorkDate);

// Breakdown theo THỢ giao với [from, to]: ưu tiên bản theo ngày (lọc theo workDate), không có thì bản cả tuần
// (chỉ khi tuần nằm trọn trong khoảng).
export const getEmployeeBreakdownsForRange = (
  report: WeeklyReportType,
  fromWorkDate: string,
  toWorkDate: string,
): Array<WeeklyReportDailyEmployeeBreakdown | WeeklyReportEmployeeBreakdown> => {
  if (Array.isArray(report.dailyEmployeeBreakdowns)) {
    return report.dailyEmployeeBreakdowns.filter(
      (breakdown) => breakdown.workDate >= fromWorkDate && breakdown.workDate <= toWorkDate,
    );
  }

  return isFullWeekInsideRange(report, fromWorkDate, toWorkDate) ? report.employeeBreakdowns : [];
};

// Breakdown theo DỊCH VỤ giao với [from, to] — cùng quy tắc getEmployeeBreakdownsForRange.
export const getServiceBreakdownsForRange = (
  report: WeeklyReportType,
  fromWorkDate: string,
  toWorkDate: string,
): Array<WeeklyReportDailyServiceBreakdown | WeeklyReportServiceBreakdown> => {
  if (Array.isArray(report.dailyServiceBreakdowns)) {
    return report.dailyServiceBreakdowns.filter(
      (breakdown) => breakdown.workDate >= fromWorkDate && breakdown.workDate <= toWorkDate,
    );
  }

  return isFullWeekInsideRange(report, fromWorkDate, toWorkDate) ? report.serviceBreakdowns : [];
};

// Scale tiền của report (thiếu → mặc định).
export const getReportMoneyScale = (report: WeeklyReportType) =>
  report.moneyScale ?? DEFAULT_MONEY_SCALE;

// Resolve số tiền từ (major fallback, minor) theo scale của report.
export const getWeeklyMoney = (
  report: WeeklyReportType,
  fallbackAmount: number | undefined,
  minorUnit: number | undefined,
) => resolveMoneyAmount(fallbackAmount, minorUnit, getReportMoneyScale(report));

const addWorkDateDays = (workDate: string, days: number): string => {
  const date = new Date(`${workDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// Các khoảng ngày [from, to] KHÔNG được weekly report phủ (phần phải đọc raw/closing để bù). `coveredWeeks`
// là các tuần đã dùng weekly report. Trả field chuẩn codebase `{fromWorkDate, toWorkDate}`; consumer nào cần
// tên khác (reports meta dùng {startDate, endDate}) thì map tại chỗ.
export const getRawDateRanges = (
  fromWorkDate: string,
  toWorkDate: string,
  coveredWeeks: string[],
): Array<{ fromWorkDate: string; toWorkDate: string }> => {
  const coveredRanges = coveredWeeks
    .map((weekStartDate) => ({
      fromWorkDate: weekStartDate > fromWorkDate ? weekStartDate : fromWorkDate,
      toWorkDate:
        getWeekEndDate(weekStartDate) < toWorkDate ? getWeekEndDate(weekStartDate) : toWorkDate,
    }))
    .filter((range) => range.fromWorkDate <= range.toWorkDate)
    .sort((left, right) => left.fromWorkDate.localeCompare(right.fromWorkDate));
  const rawRanges: Array<{ fromWorkDate: string; toWorkDate: string }> = [];
  let cursor = fromWorkDate;

  for (const range of coveredRanges) {
    if (cursor < range.fromWorkDate) {
      rawRanges.push({
        fromWorkDate: cursor,
        toWorkDate: addWorkDateDays(range.fromWorkDate, -1),
      });
    }

    const nextCursor = addWorkDateDays(range.toWorkDate, 1);
    if (nextCursor > cursor) {
      cursor = nextCursor;
    }
  }

  if (cursor <= toWorkDate) {
    rawRanges.push({ fromWorkDate: cursor, toWorkDate });
  }

  return rawRanges;
};
