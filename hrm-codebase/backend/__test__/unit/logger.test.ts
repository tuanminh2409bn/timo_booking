import { describe, expect, it } from "vitest";
import { filterRequestErrorLogFields } from "../../src/modules/logger.js";

describe("request error log fields", () => {
  it("keeps only safe error summary fields", () => {
    expect(
      filterRequestErrorLogFields({
        errorType: "/stores/work-day-settlements/work-day-has-open-attendance",
        errorName: "ServiceError",
        statusCode: 409,
        errorSource: "logic",
        errorScope: "domain",
        errorContext: {
          pendingEmployeeUserIds: ["employee-secret"],
          unresolvedAttendanceIds: ["attendance-secret"],
        },
        errorMessage: "private internal message",
        authorization: "secret-token",
      }),
    ).toEqual({
      errorType: "/stores/work-day-settlements/work-day-has-open-attendance",
      errorName: "ServiceError",
      statusCode: 409,
      errorSource: "logic",
      errorScope: "domain",
    });
  });

  it("rejects non-finite numbers and oversized strings", () => {
    expect(
      filterRequestErrorLogFields({
        statusCode: Number.NaN,
        errorType: "x".repeat(201),
      }),
    ).toEqual({});
  });
});
