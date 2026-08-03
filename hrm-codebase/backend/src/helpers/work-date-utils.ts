export const getNextWorkDate = (workDate: string): string => {
  const nextDate = new Date(`${workDate}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
};

export const createStoreWorkDateKey = (storeId: string, workDate: string): string =>
  `${storeId}__${workDate}`;

// Zero-pads a month number (1-12) to 2 digits for `YYYY-MM-DD` work-date strings.
export const toTwoDigitMonth = (month: number): string => `${month}`.padStart(2, "0");

// First and last work-date (`YYYY-MM-DD`) of a calendar month, e.g. (2026, 5) ->
// { fromWorkDate: "2026-05-01", toWorkDate: "2026-05-31" }.
export const getMonthWorkDateRange = (year: number, month: number) => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    fromWorkDate: `${year}-${toTwoDigitMonth(month)}-01`,
    toWorkDate: `${year}-${toTwoDigitMonth(month)}-${`${lastDay}`.padStart(2, "0")}`,
  };
};