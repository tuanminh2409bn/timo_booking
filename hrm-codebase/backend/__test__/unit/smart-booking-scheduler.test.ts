import { describe, expect, it } from "vitest";
import {
  planSmartAnyStaffBooking,
  type SmartBookingAssignment,
  type SmartBookingBusyInterval,
  type SmartBookingEmployee,
  type SmartBookingServiceSegment,
} from "../../src/business/public-booking/smart-booking-scheduler.js";

const employees: SmartBookingEmployee[] = [
  { employeeUserId: "main-1", workerType: "main", serviceIds: [] },
  { employeeUserId: "main-2", workerType: "main", serviceIds: [] },
  { employeeUserId: "main-3", workerType: "main", serviceIds: [] },
  { employeeUserId: "assistant-1", workerType: "assistant", serviceIds: [] },
];

const createSegments = (bookingCode: string): SmartBookingServiceSegment[] => [
  {
    segmentId: `${bookingCode}-hand`,
    sourceServiceId: "hand-service",
    durationMinutes: 45,
    preferredWorkerType: "main",
  },
  {
    segmentId: `${bookingCode}-pedi`,
    sourceServiceId: "pedi-service",
    durationMinutes: 45,
    preferredWorkerType: "assistant",
  },
];

const appendBookingIntervals = (
  busyIntervals: SmartBookingBusyInterval[],
  bookingKey: string,
  assignments: readonly SmartBookingAssignment[],
) => {
  busyIntervals.push(
    ...assignments.map((assignment) => ({
      employeeUserId: assignment.employeeUserId,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      bookingKey,
    })),
  );
};

describe("smart Any-staff booking scheduler", () => {
  it("packs four simultaneous two-service bookings by customer and worker specialty", () => {
    const busyIntervals: SmartBookingBusyInterval[] = [];
    const plans = new Map<string, SmartBookingAssignment[]>();

    for (const bookingCode of ["CC-103", "CC-104", "CC-105", "CC-106"]) {
      const plan = planSmartAnyStaffBooking({
        startTime: 540,
        segments: createSegments(bookingCode),
        employees,
        busyIntervals,
        allowServiceReordering: true,
        isEmployeeAvailable: () => true,
      });
      expect(plan).toBeDefined();
      plans.set(bookingCode, plan!);
      appendBookingIntervals(busyIntervals, bookingCode, plan!);
    }

    expect(plans.get("CC-103")).toEqual([
      expect.objectContaining({
        segmentId: "CC-103-hand",
        employeeUserId: "main-1",
        startTime: 540,
        endTime: 585,
      }),
      expect.objectContaining({
        segmentId: "CC-103-pedi",
        employeeUserId: "assistant-1",
        startTime: 585,
        endTime: 630,
      }),
    ]);
    expect(plans.get("CC-104")).toEqual([
      expect.objectContaining({
        segmentId: "CC-104-pedi",
        employeeUserId: "assistant-1",
        startTime: 540,
        endTime: 585,
      }),
      expect.objectContaining({
        segmentId: "CC-104-hand",
        employeeUserId: "main-1",
        startTime: 585,
        endTime: 630,
      }),
    ]);
    expect(new Set(plans.get("CC-105")?.map((item) => item.employeeUserId))).toEqual(
      new Set(["main-2"]),
    );
    expect(new Set(plans.get("CC-106")?.map((item) => item.employeeUserId))).toEqual(
      new Set(["main-3"]),
    );
  });

  it("returns the same plan for the same store-day state", () => {
    const input = {
      startTime: 540,
      segments: createSegments("CC-STABLE"),
      employees,
      busyIntervals: [] as SmartBookingBusyInterval[],
      allowServiceReordering: true,
      isEmployeeAvailable: () => true,
    };

    expect(planSmartAnyStaffBooking(input)).toEqual(planSmartAnyStaffBooking(input));
  });

  it("preserves service order when a booking contains a fixed-staff segment", () => {
    const segments = createSegments("CC-MIXED");
    const firstSegment = segments[0];
    if (!firstSegment) throw new Error("hand segment fixture missing");
    firstSegment.fixedEmployeeUserId = "main-2";

    const plan = planSmartAnyStaffBooking({
      startTime: 540,
      segments,
      employees,
      busyIntervals: [],
      allowServiceReordering: false,
      isEmployeeAvailable: () => true,
    });

    expect(plan?.map((assignment) => assignment.segmentId)).toEqual([
      "CC-MIXED-hand",
      "CC-MIXED-pedi",
    ]);
    expect(plan?.[0]?.employeeUserId).toBe("main-2");
  });
});
