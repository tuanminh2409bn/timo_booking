import { describe, expect, it } from "vitest";
import { applyAttendanceAssigneeRoles } from "../../src/business/employee/domain/attendance-employees.js";
import { parseAttendancePayload } from "../../src/business/employee/domain/attendance-payload.js";

describe("attendance assignee roles", () => {
  it("marks the explicit main and assistant without changing other fields", () => {
    const result = applyAttendanceAssigneeRoles(
      [
        { employeeUserId: "main", shareAmount: 70 },
        { employeeUserId: "assistant", shareAmount: 30 },
      ],
      "main",
      "assistant",
    );

    expect(result).toEqual([
      { employeeUserId: "main", shareAmount: 70, workerType: "main" },
      { employeeUserId: "assistant", shareAmount: 30, workerType: "assistant" },
    ]);
  });

  it("keeps an explicitly assigned assistant in a service-less attendance", () => {
    const result = parseAttendancePayload({
      storeId: "store-1",
      date: "2026-07-28T10:00:00.000Z",
      employeeUserId: "main",
      assistantAssigneeUserId: "assistant",
      services: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assignees).toEqual([
        expect.objectContaining({ employeeUserId: "main", workerType: "main" }),
        expect.objectContaining({ employeeUserId: "assistant", workerType: "assistant" }),
      ]);
    }
  });
});
