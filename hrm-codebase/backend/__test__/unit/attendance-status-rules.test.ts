import { describe, expect, it } from "vitest";
import {
  getAttendanceAssistantAssigneeUserId,
  getAttendanceMainAssigneeUserId,
  isAttendanceMainAssignee,
  isAttendanceReadyForConfirmation,
} from "../../src/business/employee/domain/attendance-rules.js";
import { isAttendanceStartInFuture } from "../../src/business/employee/domain/attendance-timing.js";

describe("attendance booking status rules", () => {
  it("keeps one explicit main and assistant assignee per attendance", () => {
    const attendance = {
      employeeUserId: "main-1",
      mainAssigneeUserId: "main-1",
      assistantAssigneeUserId: "assistant-1",
      assignees: [
        { employeeUserId: "main-1", workerType: "main" as const },
        { employeeUserId: "assistant-1", workerType: "assistant" as const },
      ],
      services: [],
    };

    expect(getAttendanceMainAssigneeUserId(attendance)).toBe("main-1");
    expect(getAttendanceAssistantAssigneeUserId(attendance)).toBe("assistant-1");
    expect(isAttendanceMainAssignee(attendance, "main-1")).toBe(true);
    expect(isAttendanceMainAssignee(attendance, "assistant-1")).toBe(false);
  });
  it("requires a service with a complete worker allocation before confirmation", () => {
    expect(
      isAttendanceReadyForConfirmation({
        assignees: [],
        services: [],
      }),
    ).toBe(false);

    expect(
      isAttendanceReadyForConfirmation({
        employeeUserId: "staff-1",
        assignees: [{ employeeUserId: "staff-1", percentage: 100 }],
        services: [
          {
            id: "service-1",
            ownerId: "owner-1",
            storeId: "store-1",
            type: "predefined",
            name: "Manicure",
            category: "manicure",
            price: 50,
            employees: [{ employeeUserId: "staff-1", percentage: 100 }],
          },
        ],
      }),
    ).toBe(true);

    expect(
      isAttendanceReadyForConfirmation({
        employeeUserId: "staff-1",
        assignees: [{ employeeUserId: "staff-1", percentage: 90 }],
        services: [
          {
            id: "service-1",
            ownerId: "owner-1",
            storeId: "store-1",
            type: "predefined",
            name: "Manicure",
            category: "manicure",
            price: 50,
            employees: [{ employeeUserId: "staff-1", percentage: 90 }],
          },
        ],
      }),
    ).toBe(false);
  });

  it("treats a later appointment on the same work date as future", () => {
    const now = new Date("2026-07-27T15:00:00.000Z").getTime();

    expect(
      isAttendanceStartInFuture(
        {
          workDate: "2026-07-27",
          startTimestamp: new Date("2026-07-27T16:00:00.000Z").getTime(),
          startTime: 18 * 60,
          storeTimezone: "Europe/Berlin",
          settlementCutoffTime: "23:00",
        },
        now,
      ),
    ).toBe(true);

    expect(
      isAttendanceStartInFuture(
        {
          workDate: "2026-07-27",
          startTimestamp: new Date("2026-07-27T14:00:00.000Z").getTime(),
          startTime: 16 * 60,
          storeTimezone: "Europe/Berlin",
          settlementCutoffTime: "23:00",
        },
        now,
      ),
    ).toBe(false);
  });
});
