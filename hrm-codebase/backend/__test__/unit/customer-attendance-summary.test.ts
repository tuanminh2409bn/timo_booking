import { Firestore } from "@google-cloud/firestore";
import { describe, expect, it, vi } from "vitest";
import { getShopCustomerAttendanceSummaryFactory } from "../../src/repository/firestore/shop/shop-customer-factory.js";

type QueryFilter = {
  fieldPath: string;
  value: string;
};

const appointmentCounts = new Map<string, number>([
  ["total", 10],
  ["requested", 1],
  ["processing", 2],
  ["cancelled", 3],
  ["no_show", 1],
  ["closed", 2],
]);

const createCountQuery = (filters: QueryFilter[] = []) => {
  const query = {
    where: vi.fn((fieldPath: string, _operator: string, value: string) =>
      createCountQuery([...filters, { fieldPath, value }]),
    ),
    count: vi.fn(() => ({
      get: vi.fn(() => {
        const bookingStatusFilter = filters.find((filter) => filter.fieldPath === "bookingStatus");
        const statusFilter = filters.find((filter) => filter.fieldPath === "status");
        const count = bookingStatusFilter
          ? (appointmentCounts.get(bookingStatusFilter.value) ?? 0)
          : statusFilter
            ? (appointmentCounts.get(statusFilter.value) ?? 0)
            : (appointmentCounts.get("total") ?? 0);

        return Promise.resolve({ data: () => ({ count }) });
      }),
    })),
  };

  return query;
};

describe("customer attendance summary", () => {
  it("counts every booking status and treats legacy records as confirmed", async () => {
    const firestoreDB = new Firestore({ projectId: "test-project" });
    const archivedAttendanceCounters = {
      totalAppointments: 6,
      requestedAppointments: 1,
      confirmedAppointments: 1,
      processingAppointments: 1,
      cancelledAppointments: 2,
      noShowAppointments: 1,
      completedAppointments: 1,
    };

    Reflect.set(
      firestoreDB,
      "collection",
      vi.fn(() => ({
        doc: vi.fn(() => ({
          collection: vi.fn((name: string) =>
            name === "customers"
              ? {
                  doc: vi.fn(() => ({
                    get: vi.fn().mockResolvedValue({
                      exists: true,
                      data: () => ({
                        ownerId: "owner-1",
                        storeId: "store-1",
                        phone: "+84123456",
                        archivedAttendanceCounters,
                        createdAt: 100,
                        updatedAt: 100,
                      }),
                    }),
                  })),
                }
              : createCountQuery(),
          ),
        })),
      })),
    );

    const getCustomerAttendanceSummary = getShopCustomerAttendanceSummaryFactory(firestoreDB);
    const summary = await getCustomerAttendanceSummary("owner-1", "store-1", "customer-1");

    expect(summary).toEqual({
      totalAppointments: 16,
      requestedAppointments: 2,
      confirmedAppointments: 4,
      processingAppointments: 3,
      cancelledAppointments: 5,
      noShowAppointments: 2,
      total: 16,
      pending_approval: 5,
      confirmed: 1,
      completed: 3,
      cancelled: 5,
      no_show: 2,
    });

    const rangedSummary = await getCustomerAttendanceSummary("owner-1", "store-1", "customer-1", {
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });

    expect(rangedSummary).toEqual({
      totalAppointments: 10,
      requestedAppointments: 1,
      confirmedAppointments: 3,
      processingAppointments: 2,
      cancelledAppointments: 3,
      noShowAppointments: 1,
      total: 10,
      pending_approval: 3,
      confirmed: 1,
      completed: 2,
      cancelled: 3,
      no_show: 1,
    });
  });
});
