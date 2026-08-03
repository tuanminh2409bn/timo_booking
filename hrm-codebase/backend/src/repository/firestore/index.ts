import { Firestore } from "@google-cloud/firestore";
import dotenv from "dotenv";
import {
  createShopAttendanceFactory,
  deleteShopAttendanceFactory,
  getShopAttendanceFactory,
  listShopAttendanceByEmployeeDateRangeFactory,
  listShopAttendanceByStoreDateRangeFactory,
  listShopAttendanceCancellationsByStoreDateRangeFactory,
  listShopAttendanceCalendarByStoreDateRangeFactory,
  listShopAttendanceSummaryByStoreDateRangeFactory,
  listShopAttendanceByStoreWorkDateKeyFactory,
  listShopAttendanceByWorkDateRangeFactory,
  updateShopAttendanceFactory,
} from "./shop/shop-attendance-factory.js";
import {
  blockShopCustomerFactory,
  createShopCustomerFactory,
  getShopCustomerAttendanceSummaryFactory,
  getShopCustomerFactory,
  listShopCustomerAttendancesFactory,
  listShopCustomersFactory,
  unblockShopCustomerFactory,
} from "./shop/shop-customer-factory.js";
import {
  createShopAuditLogFactory,
  listShopAuditLogsFactory,
} from "./shop/shop-audit-log-factory.js";
import {
  adjustStoreEmployeeCountsFactory,
  createStoreFactory,
  getStoreFactory,
  getStoreListFactory,
  getStoreListWithMetadataFactory,
  getStoreSummaryListFactory,
  updateStoreFactory,
} from "./shop/shop-store-factory.js";
import {
  createShopExpensesFactory,
  deleteShopExpenseFactory,
  getShopExpenseFactory,
  listShopExpensesFactory,
  updateShopExpenseFactory,
} from "./shop/shop-expense-factory.js";
import {
  createEmployeeLeaveRequestFactory,
  deleteEmployeeLeaveRequestFactory,
  listEmployeeLeaveRequestsFactory,
} from "./shop/shop-employee-leave-request-factory.js";
import {
  createShopServiceCategoryFactory,
  getShopServiceCatalogFactory,
} from "./shop/shop-service-catalog-factory.js";
import {
  createShopServiceFactory,
  deleteShopServiceFactory,
  getShopServiceByIdFactory,
  getShopServiceFactory,
  updateShopServiceFactory,
} from "./shop/shop-service-factory.js";
import {
  closeShopEmployeeWorkDayFactory,
  deleteShopEmployeeWorkDayClosingFactory,
  getShopEmployeeWorkDayClosingFactory,
  listShopEmployeeWorkDayClosingsByStoreDateRangeFactory,
  listShopEmployeeWorkDayClosingsByStoreWorkDateFactory,
} from "./shop/shop-employee-work-day-closing-factory.js";
import {
  getShopEmployeeTimeTrackingFactory,
  listOpenShopEmployeeTimeTrackingFactory,
  upsertShopEmployeeTimeTrackingFactory,
} from "./shop/shop-employee-time-tracking-factory.js";
import {
  countOpenShopWorkDaySettlementsByStoreFactory,
  deleteShopWorkDaySettlementFactory,
  getShopWorkDaySettlementFactory,
  listShopWorkDaySettlementAttendanceItemsFactory,
  listClosedShopWorkDaySettlementFinancialProjectionByStoreDateRangeFactory,
  listShopWorkDaySettlementsByStatusPaginatedFactory,
  markShopWorkDaySettlementEmployeeClosedFactory,
  upsertShopWorkDaySettlementFactory,
} from "./shop/shop-work-day-settlement-factory.js";
import type { WorkDaySettlementCommitObserver } from "./shop/work-day-settlement-commit-observer.js";
import {
  createWeeklyReportFactory,
  deleteWeeklyReportsByWeekFactory,
  getWeeklyReportFactory,
  listWeeklyReportsFactory,
} from "./shop/weekly-report.repository.js";
import {
  countShopEmployeesFactory,
  getUserByEmailFactory,
  getUserFactory,
  getSigninUserFactory,
  insertUserFactory,
  isUserCorrectRoleFactory,
  isUserExistingFactory,
  listActiveShopEmployeesFactory,
  listShopEmployeesFactory,
  touchUserLastLoginAtFactory,
  updateUserFactory,
} from "./user/user-factory.js";
import {
  listOwnerDataRetentionPoliciesFactory,
  updateOwnerDataRetentionPolicyFactory,
  runStoreDataRetentionFactory,
} from "./data-retention/data-retention.repository.js";
import {
  getBillingAccountByProviderSubscriptionFactory,
  getBillingAccountFactory,
  upsertBillingAccountFactory,
} from "./billing/billing.repository.js";

dotenv.config();

const normalizePrivateKey = (value: string | undefined): string | undefined => {
  const normalized = value?.replace(/\\n/g, "\n").trim();

  return normalized?.includes("BEGIN PRIVATE KEY") === true ? normalized : undefined;
};

const privateKey = normalizePrivateKey(process.env["FIREBASE_PRIVATE_KEY"]);
const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"];
const projectId = process.env["GCP_PROJECT_ID"];
const databaseId = process.env["FIRESTORE_DATABASE_ID"];

if (!projectId || !databaseId) {
  throw new Error("Missing Firestore project ID or database ID");
}

export const firestoreAuth = new Firestore({
  databaseId,
  projectId,
  ...(clientEmail !== undefined &&
    privateKey !== undefined && {
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
    }),
});

const upsertWorkDaySettlement = upsertShopWorkDaySettlementFactory(firestoreAuth);
const listWorkDaySettlementAttendanceItems =
  listShopWorkDaySettlementAttendanceItemsFactory(firestoreAuth);
const markWorkDaySettlementEmployeeClosed =
  markShopWorkDaySettlementEmployeeClosedFactory(firestoreAuth);

export const firestoreRepository = {
  maintenance: {
    listOwnerDataRetentionPolicies: listOwnerDataRetentionPoliciesFactory(firestoreAuth),
    updateOwnerDataRetentionPolicy: updateOwnerDataRetentionPolicyFactory(firestoreAuth),
    runStoreDataRetention: runStoreDataRetentionFactory(firestoreAuth),
  },
  billing: {
    getBillingAccount: getBillingAccountFactory(firestoreAuth),
    getBillingAccountByProviderSubscription:
      getBillingAccountByProviderSubscriptionFactory(firestoreAuth),
    upsertBillingAccount: upsertBillingAccountFactory(firestoreAuth),
  },
  user: {
    insertUser: insertUserFactory(firestoreAuth),
    getUser: getUserFactory(firestoreAuth),
    getSigninUser: getSigninUserFactory(firestoreAuth),
    getUserByEmail: getUserByEmailFactory(firestoreAuth),
    isCorrectRole: isUserCorrectRoleFactory(firestoreAuth),
    isExisting: isUserExistingFactory(firestoreAuth),
    listActiveShopEmployees: listActiveShopEmployeesFactory(firestoreAuth),
    listShopEmployees: listShopEmployeesFactory(firestoreAuth),
    countShopEmployees: countShopEmployeesFactory(firestoreAuth),
    touchLastLoginAt: touchUserLastLoginAtFactory(firestoreAuth),
    updateUser: updateUserFactory(firestoreAuth),
  },
  shop: {
    settlement: {
      getWorkDaySettlement: getShopWorkDaySettlementFactory(firestoreAuth),
      listWorkDaySettlementAttendanceItems,
      markWorkDaySettlementEmployeeClosed,
      countOpenWorkDaySettlementsByStore:
        countOpenShopWorkDaySettlementsByStoreFactory(firestoreAuth),
      listClosedWorkDaySettlementFinancialProjectionByStoreDateRange:
        listClosedShopWorkDaySettlementFinancialProjectionByStoreDateRangeFactory(firestoreAuth),
      listWorkDaySettlementsByStatusPaginated:
        listShopWorkDaySettlementsByStatusPaginatedFactory(firestoreAuth),
      upsertWorkDaySettlement,
      createClosedWorkDaySettlement: (
        ownerId: string,
        settlement: Parameters<typeof upsertWorkDaySettlement>[1],
        options: { onCommitted?: WorkDaySettlementCommitObserver } = {},
      ) =>
        upsertWorkDaySettlement(ownerId, settlement, {
          rejectClosedSettlement: true,
          commitStage: "store_closing",
          ...(options.onCommitted !== undefined && { onCommitted: options.onCommitted }),
        }),
      deleteWorkDaySettlement: deleteShopWorkDaySettlementFactory(firestoreAuth),
    },
    session: {
      closeEmployeeWorkDay: closeShopEmployeeWorkDayFactory(firestoreAuth),
      deleteEmployeeWorkDayClosing: deleteShopEmployeeWorkDayClosingFactory(firestoreAuth),
      getEmployeeWorkDayClosing: getShopEmployeeWorkDayClosingFactory(firestoreAuth),
      listEmployeeWorkDayClosingsByStoreWorkDate:
        listShopEmployeeWorkDayClosingsByStoreWorkDateFactory(firestoreAuth),
      listEmployeeWorkDayClosingsByStoreDateRange:
        listShopEmployeeWorkDayClosingsByStoreDateRangeFactory(firestoreAuth),
    },
    timeTracking: {
      getEmployeeTimeTracking: getShopEmployeeTimeTrackingFactory(firestoreAuth),
      listOpenEmployeeTimeTracking: listOpenShopEmployeeTimeTrackingFactory(firestoreAuth),
      upsertEmployeeTimeTracking: upsertShopEmployeeTimeTrackingFactory(firestoreAuth),
    },
    store: {
      createStore: createStoreFactory(firestoreAuth),
      adjustEmployeeCounts: adjustStoreEmployeeCountsFactory(firestoreAuth),
      getStore: getStoreFactory(firestoreAuth),
      getStoreList: getStoreListFactory(firestoreAuth),
      getStoreListWithMetadata: getStoreListWithMetadataFactory(firestoreAuth),
      getStoreSummaryList: getStoreSummaryListFactory(firestoreAuth),
      updateStore: updateStoreFactory(firestoreAuth),
    },
    service: {
      createShopService: createShopServiceFactory(firestoreAuth),
      createShopServiceCategory: createShopServiceCategoryFactory(firestoreAuth),
      getShopServiceFactory: getShopServiceFactory(firestoreAuth),
      getShopServiceCatalog: getShopServiceCatalogFactory(firestoreAuth),
      getShopService: getShopServiceByIdFactory(firestoreAuth),
      updateShopService: updateShopServiceFactory(firestoreAuth),
      deleteShopService: deleteShopServiceFactory(firestoreAuth),
    },
    expense: {
      createShopExpenses: createShopExpensesFactory(firestoreAuth),
      getShopExpense: getShopExpenseFactory(firestoreAuth),
      listShopExpenses: listShopExpensesFactory(firestoreAuth),
      updateShopExpense: updateShopExpenseFactory(firestoreAuth),
      deleteShopExpense: deleteShopExpenseFactory(firestoreAuth),
    },
    employeeLeave: {
      createEmployeeLeaveRequest: createEmployeeLeaveRequestFactory(firestoreAuth),
      listEmployeeLeaveRequests: listEmployeeLeaveRequestsFactory(firestoreAuth),
      deleteEmployeeLeaveRequest: deleteEmployeeLeaveRequestFactory(firestoreAuth),
    },
    attendance: {
      createShopAttendance: createShopAttendanceFactory(firestoreAuth),
      deleteShopAttendance: deleteShopAttendanceFactory(firestoreAuth),
      getShopAttendance: getShopAttendanceFactory(firestoreAuth),
      updateShopAttendance: updateShopAttendanceFactory(firestoreAuth),
      listShopAttendanceByStoreWorkDateKey:
        listShopAttendanceByStoreWorkDateKeyFactory(firestoreAuth),
      listShopAttendanceByWorkDateRange: listShopAttendanceByWorkDateRangeFactory(firestoreAuth),
      listShopAttendanceByStoreDateRange: listShopAttendanceByStoreDateRangeFactory(firestoreAuth),
      listShopAttendanceCancellationsByStoreDateRange:
        listShopAttendanceCancellationsByStoreDateRangeFactory(firestoreAuth),
      listShopAttendanceByEmployeeDateRange:
        listShopAttendanceByEmployeeDateRangeFactory(firestoreAuth),
      listShopAttendanceCalendarByStoreDateRange:
        listShopAttendanceCalendarByStoreDateRangeFactory(firestoreAuth),
      listShopAttendanceSummaryByStoreDateRange:
        listShopAttendanceSummaryByStoreDateRangeFactory(firestoreAuth),
    },
    customer: {
      blockShopCustomer: blockShopCustomerFactory(firestoreAuth),
      createShopCustomer: createShopCustomerFactory(firestoreAuth),
      getShopCustomer: getShopCustomerFactory(firestoreAuth),
      getShopCustomerAttendanceSummary: getShopCustomerAttendanceSummaryFactory(firestoreAuth),
      listShopCustomers: listShopCustomersFactory(firestoreAuth),
      listShopCustomerAttendances: listShopCustomerAttendancesFactory(firestoreAuth),
      unblockShopCustomer: unblockShopCustomerFactory(firestoreAuth),
    },
    audit: {
      createShopAuditLog: createShopAuditLogFactory(firestoreAuth),
      listShopAuditLogs: listShopAuditLogsFactory(firestoreAuth),
    },
    weeklyReport: {
      createWeeklyReport: createWeeklyReportFactory(firestoreAuth),
      deleteWeeklyReportsByWeek: deleteWeeklyReportsByWeekFactory(firestoreAuth),
      getWeeklyReport: getWeeklyReportFactory(firestoreAuth),
      listWeeklyReports: listWeeklyReportsFactory(firestoreAuth),
    },
  },
};
