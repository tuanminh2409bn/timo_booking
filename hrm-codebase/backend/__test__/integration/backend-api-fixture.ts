import jwt from "jsonwebtoken";
import type { Test } from "supertest";
import { beforeAll, beforeEach, vi } from "vitest";
import type { Express } from "express";
import { cacheDeleteByPrefix } from "../../src/repository/cache/cache-client.js";
import {
  getResponsibleEmployeeUserIdsForAttendance,
  isSettlementAttendance,
} from "../../src/helpers/work-day-settlement.js";
import {
  FirestoreDataExistingError,
  FirestoreDataNotFoundError,
} from "../../src/constants/firestore-error.js";
import { isEmployeeRole } from "../../src/helpers/user-roles.js";
import {
  ShopAttendanceType,
  ShopAuditLogType,
  ShopEmployeeLeaveRequestType,
  ShopEmployeeTimeTrackingType,
  ShopEmployeeWorkDayClosingType,
  StoreType,
  ShopExpenseType,
  ShopServiceCategoryDocumentType,
  ShopServiceCatalogType,
  ShopServiceType,
  ShopClosedWorkDaySettlementType,
  ShopWorkDaySettlementClosingType,
  ShopWorkDaySettlementFinancialProjectionType,
  ShopWorkDayServiceSummaryType,
  ShopWorkDaySettlementType,
} from "../../src/repository/firestore/shop/shop.types.js";
import type { WeeklyReportType } from "../../src/repository/firestore/shop/weekly-report.types.js";
import type { ShopCustomerType } from "../../src/repository/firestore/shop/shop-customer.types.js";
import type {
  WorkDaySettlementCommitObserver,
  WorkDaySettlementPersistAction,
} from "../../src/repository/firestore/shop/work-day-settlement-commit-observer.js";
import {
  notifyEmployeeTimeTrackingCommit,
  type EmployeeTimeTrackingCommitObserver,
} from "../../src/repository/firestore/shop/employee-time-tracking-commit-observer.js";
import { withEmployeeTimeTrackingSpan } from "../../src/business/employee/time-tracking/employee-time-tracking-observability.js";
import { EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS } from "../../src/business/employee/time-tracking/employee-time-tracking-tracing-contract.js";
import {
  canMergeCustomerByName,
  getCustomerDocumentId,
  getCustomerNameDocumentId,
  normalizeCustomerName,
  normalizeCustomerPhone,
} from "../../src/helpers/customer-phone.js";
import { UserType } from "../../src/repository/firestore/user/user.types.js";
import type { BillingAccountRecord } from "../../src/business/billing/billing.types.js";

process.env["NODE_ENV"] = "test";
process.env["JWT_SECRET"] = "test-jwt-secret";
process.env["AUTH_JWT_ISSUER"] = "nail-api";
process.env["AUTH_JWT_AUDIENCE"] = "nail-web";
process.env["SERVICE_PORT"] = "8080";
process.env["TRUST_PROXY_HOPS"] = "1";
process.env["DOTENV_CONFIG_QUIET"] = "true";
process.env["GCP_PROJECT_ID"] = "test-project";
process.env["FIRESTORE_DATABASE_ID"] = "(default)";
process.env["FIREBASE_CLIENT_EMAIL"] = "firebase-adminsdk@test-project.iam.gserviceaccount.com";
process.env["FIREBASE_PRIVATE_KEY"] = "test-private-key";
process.env["PAYPAL_MODE"] = "sandbox";
process.env["PAYPAL_CLIENT_ID"] = "test-paypal-client-id";
process.env["PAYPAL_CLIENT_SECRET"] = "test-paypal-client-secret";
process.env["PAYPAL_WEBHOOK_ID"] = "test-paypal-webhook-id";
process.env["PAYPAL_PRODUCT_ID"] = "PROD-TEST";
process.env["PAYPAL_PREMIUM_MONTHLY_PLAN_ID"] = "P-TEST-PREMIUM";
process.env["BILLING_PREMIUM_MONTHLY_AMOUNT"] = "99.99";
process.env["BILLING_PREMIUM_MONTHLY_CURRENCY"] = "EUR";
process.env["PUBLIC_BOOKING_POLICY_ENFORCEMENT"] = "off";

const paypalClientMocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  createSubscription: vi.fn(),
  getSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}));

export { paypalClientMocks };

type FirebaseUserRecord = {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  password?: string;
  disabled?: boolean;
  tokensRevoked?: boolean;
};

type FirebaseTokenRecord = {
  uid: string;
  authTime?: number;
};

type TestState = {
  users: Map<string, UserType>;
  billingAccounts: Map<string, BillingAccountRecord>;
  firebaseUsers: Map<string, FirebaseUserRecord>;
  firebaseTokens: Map<string, FirebaseTokenRecord>;
  stores: Map<string, StoreType>;
  serviceCategories: Map<string, ShopServiceCategoryDocumentType>;
  services: Map<string, ShopServiceType>;
  expenses: Map<string, ShopExpenseType>;
  attendances: Map<string, ShopAttendanceType>;
  employeeWorkDayClosings: Map<string, ShopEmployeeWorkDayClosingType>;
  employeeTimeTracking: Map<string, ShopEmployeeTimeTrackingType>;
  closings: Map<string, ShopClosedWorkDaySettlementType>;
  workDaySettlements: Map<string, ShopWorkDaySettlementType>;
  weeklyReports: Map<string, WeeklyReportType>;
  leaveRequests: Map<string, ShopEmployeeLeaveRequestType>;
  auditLogs: ShopAuditLogType[];
  customers: Map<string, ShopCustomerType>;
  bookings: Map<string, Record<string, unknown>>;
  slotReservations: Map<string, Record<string, unknown>>;
  storageUploads: Array<Record<string, unknown>>;
  storeReadCount: number;
  lastOtpCode?: string;
  nextIds: {
    user: number;
    shop: number;
    branch: number;
    service: number;
    expense: number;
    attendance: number;
    closing: number;
    weeklyReport: number;
    leave: number;
    audit: number;
  };
};

const hoistedState = vi.hoisted<TestState>(() => ({
  users: new Map(),
  billingAccounts: new Map(),
  firebaseUsers: new Map(),
  firebaseTokens: new Map(),
  stores: new Map(),
  serviceCategories: new Map(),
  services: new Map(),
  expenses: new Map(),
  attendances: new Map(),
  employeeWorkDayClosings: new Map(),
  employeeTimeTracking: new Map(),
  closings: new Map(),
  workDaySettlements: new Map(),
  weeklyReports: new Map(),
  leaveRequests: new Map(),
  auditLogs: [],
  customers: new Map(),
  bookings: new Map(),
  slotReservations: new Map(),
  storageUploads: [],
  storeReadCount: 0,
  nextIds: {
    user: 0,
    shop: 0,
    branch: 0,
    service: 0,
    expense: 0,
    attendance: 0,
    closing: 0,
    weeklyReport: 0,
    leave: 0,
    audit: 0,
  },
}));

export const state = hoistedState;

export const seedClosedWorkDaySettlement = (
  input: ShopWorkDaySettlementClosingType & {
    ownerId?: string;
    storeId: string;
    workDate: string;
    serviceSummaries?: ShopWorkDayServiceSummaryType[];
  },
): ShopWorkDaySettlementType => {
  const ownerId = input.ownerId ?? "shop-1";
  const settlement: ShopWorkDaySettlementType = {
    id: input.workDate,
    ownerId,
    storeId: input.storeId,
    workDate: input.workDate,
    settlementEligibleAt: Date.parse(`${input.workDate}T23:59:59.999Z`),
    status: "closed",
    attendance: {
      totalCount: input.summary.totalEntries,
      openCount: 0,
      closedCount: input.summary.totalEntries,
      incompleteCount: 0,
      employeeTotalCount: input.employeeSummaries.length,
      employeeClosedCount: input.employeeSummaries.length,
    },
    employees: input.employeeSummaries.map((employeeSummary) => ({
      employeeUserId: employeeSummary.employeeUserId,
      employeeName: employeeSummary.employeeName,
      attendanceCount: 1,
      closedCount: 1,
      totalRevenue: employeeSummary.totalRevenue,
    })),
    totalRevenue: input.summary.subtotalAmount,
    totalDiscount: input.summary.totalDiscountAmount,
    totalNetAmount: input.summary.totalNetAmount,
    totalOwnerNetAfterDiscount:
      input.summary.totalOwnerCommission - (input.summary.totalOwnerDiscountAmount ?? 0),
    attendanceVersion: `closed-settlement-${input.id}`,
    previewOwnerDiscountCoverageRate: input.ownerDiscountCoverageRate,
    preview: {
      employeeSummaries: input.employeeSummaries,
      compensationConfigurationErrors: [],
      totalRevenue: input.summary.subtotalAmount,
      totalDiscount: input.summary.totalDiscountAmount,
      totalEmployeeDiscount: input.summary.totalEmployeeDiscountAmount ?? 0,
      totalOwnerDiscount: input.summary.totalOwnerDiscountAmount ?? 0,
      totalOwnerDiscountAbsorbed: input.summary.totalOwnerDiscountAmount ?? 0,
      totalEmployeeDiscountAllocated: input.summary.totalEmployeeDiscountAmount ?? 0,
      totalUnallocatedDiscount: 0,
      totalNetAmount: input.summary.totalNetAmount,
      totalOwnerCommission: input.summary.totalOwnerCommission,
      totalOwnerNetAfterDiscount:
        input.summary.totalOwnerCommission - (input.summary.totalOwnerDiscountAmount ?? 0),
      totalEmployeeEarning: input.summary.totalEmployeeEarning,
      allocationSource: "workday",
      discountTargetEmployeeUserIds: input.employeeSummaries
        .filter((employeeSummary) => employeeSummary.isSelectedForDiscount)
        .map((employeeSummary) => employeeSummary.employeeUserId),
      discountEligibleEmployeeUserIds: input.employeeSummaries
        .filter((employeeSummary) => employeeSummary.compensationModel === "commission")
        .map((employeeSummary) => employeeSummary.employeeUserId),
      submittedEmployeeUserIds: input.employeeSummaries.map(
        (employeeSummary) => employeeSummary.employeeUserId,
      ),
      incompleteAttendanceIds: [],
    },
    pendingEmployees: [],
    serviceSummaries: input.serviceSummaries ?? [],
    closing: {
      id: input.id,
      closedAt: input.closedAt,
      closedByUserId: input.closedByUserId,
      ownerDiscountCoverageRate: input.ownerDiscountCoverageRate,
      discountAllocationMethod: input.discountAllocationMethod,
      employeeSummaries: input.employeeSummaries,
      summary: input.summary,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      ...(input.storeTimezone !== undefined && { storeTimezone: input.storeTimezone }),
    },
    revision: 1,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };

  state.workDaySettlements.set(`${input.storeId}__${input.workDate}`, settlement);

  const attendanceVersionsByEmployee = new Map<string, Record<string, number>>();

  for (const attendance of state.attendances.values()) {
    if (
      attendance.storeId !== input.storeId ||
      attendance.workDate !== input.workDate ||
      !isSettlementAttendance(attendance)
    ) {
      continue;
    }

    for (const employeeUserId of getResponsibleEmployeeUserIdsForAttendance(attendance)) {
      const attendanceVersions = attendanceVersionsByEmployee.get(employeeUserId) ?? {};
      attendanceVersions[attendance.id] = attendance.updatedAt;
      attendanceVersionsByEmployee.set(employeeUserId, attendanceVersions);
    }
  }

  for (const [employeeUserId, attendanceVersions] of attendanceVersionsByEmployee) {
    const employeeClosingId = `${employeeUserId}__${input.workDate}`;
    state.employeeWorkDayClosings.set(employeeClosingId, {
      id: employeeClosingId,
      ownerId,
      storeId: input.storeId,
      workDate: input.workDate,
      employeeUserId,
      attendanceIds: Object.keys(attendanceVersions).sort(),
      attendanceVersions,
      closedAt: input.closedAt,
      closedByUserId: employeeUserId,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
  }

  return settlement;
};

vi.mock("../../src/helpers/password-reset-mailer.js", () => ({
  sendPasswordResetOtpEmail: (_email: string, otpCode: string) => {
    state.lastOtpCode = otpCode;
    return Promise.resolve(false);
  },
}));

vi.mock("../../src/repository/firebase-storage/index.js", () => ({
  firebaseStorageRepository: {
    uploadShopServiceImage: ({
      ownerId,
      fileName,
      contentType,
      buffer,
    }: {
      ownerId: string;
      fileName: string;
      contentType: string;
      buffer: Buffer;
    }) => {
      state.storageUploads.push({
        kind: "service-image",
        ownerId,
        fileName,
        contentType,
        size: buffer.length,
      });
      return Promise.resolve(`https://storage.test/shops/${ownerId}/services/${fileName}`);
    },
    uploadShopExpenseReceiptImage: ({
      ownerId,
      storeId,
      workDate,
      fileName,
      contentType,
      buffer,
    }: {
      ownerId: string;
      storeId: string;
      workDate: string;
      fileName: string;
      contentType: string;
      buffer: Buffer;
    }) => {
      const storagePath = `expense-receipts/${ownerId}/${storeId}/${workDate}/${fileName}`;

      state.storageUploads.push({
        kind: "expense-receipt",
        ownerId,
        storeId,
        workDate,
        fileName,
        contentType,
        size: buffer.length,
        storagePath,
      });

      return Promise.resolve({
        imageUrl: `https://storage.test/${storagePath}`,
        storagePath,
      });
    },
  },
}));

vi.mock("../../src/repository/firebase-auth/index.js", () => ({
  firebaseAuthRepository: {
    auth: {
      verifyIdToken: (token: string) => {
        const tokenRecord = state.firebaseTokens.get(token);

        if (tokenRecord) {
          const user = state.users.get(tokenRecord.uid);
          const claims: Record<string, unknown> = {
            uid: tokenRecord.uid,
            auth_time: tokenRecord.authTime,
          };

          // Firebase-only: idToken mang custom claims đã sync từ user (admin không có claims store).
          if (user && user.role !== "admin") {
            claims["role"] = user.role;
            claims["ownerId"] = user.ownerId;
            const storeId = (user as { storeId?: string }).storeId;

            if (storeId !== undefined) {
              claims["storeId"] = storeId;
            }
          }

          return Promise.resolve(claims);
        }

        // Token do ownerSessionHeader mint: JWT mang sẵn custom claims (role/ownerId/storeId),
        // mô phỏng Firebase ID token đã sync claims. Mock decode payload (không verify chữ ký).
        const decoded = jwt.decode(token);

        if (decoded && typeof decoded === "object" && typeof decoded["user_id"] === "string") {
          return Promise.resolve({
            uid: decoded["user_id"],
            role: decoded["role"],
            ownerId: decoded["ownerId"],
            storeId: decoded["storeId"],
          });
        }

        return Promise.reject(new Error("Invalid Firebase token"));
      },
      createCustomToken: (uid: string) => Promise.resolve(`firebase-custom-token-${uid}`),
      setCustomUserClaims: () => Promise.resolve(),
      getUser: (uid: string) => {
        const user = state.firebaseUsers.get(uid);

        if (!user) {
          return Promise.reject(new Error("Firebase user not found"));
        }

        return Promise.resolve(toFirebaseUserResponse(user));
      },
      getUserByEmail: (email: string) => {
        const user = findFirebaseUserByEmail(email);

        if (!user) {
          return Promise.reject(new Error("Firebase user not found"));
        }

        return Promise.resolve(toFirebaseUserResponse(user));
      },
      createUser: ({
        email,
        password,
        displayName,
        disabled,
      }: {
        email: string;
        password: string;
        displayName?: string;
        disabled?: boolean;
      }) => {
        if (findFirebaseUserByEmail(email)) {
          return Promise.reject({ code: "auth/email-already-exists" });
        }

        const uid = `created-user-${++state.nextIds.user}`;
        const firebaseUser: FirebaseUserRecord = {
          uid,
          email: email.trim().toLowerCase(),
          password,
          ...(displayName !== undefined && { displayName }),
          ...(disabled !== undefined && { disabled }),
        };

        state.firebaseUsers.set(uid, firebaseUser);
        state.firebaseTokens.set(`firebase-${uid}`, {
          uid,
          authTime: Math.floor(Date.now() / 1000),
        });

        return Promise.resolve(toFirebaseUserResponse(firebaseUser));
      },
      deleteUser: (uid: string) => {
        state.firebaseUsers.delete(uid);
        return Promise.resolve();
      },
      updateUserPassword: (uid: string, password: string) => {
        const user = getFirebaseUserOrThrow(uid);
        state.firebaseUsers.set(uid, {
          ...user,
          password,
        });
        return Promise.resolve();
      },
      revokeRefreshTokens: (uid: string) => {
        const user = getFirebaseUserOrThrow(uid);
        state.firebaseUsers.set(uid, {
          ...user,
          tokensRevoked: true,
        });
        return Promise.resolve();
      },
      updateUserProfile: (
        uid: string,
        profile: {
          displayName?: string;
          photoURL?: string;
          disabled?: boolean;
        },
      ) => {
        const user = getFirebaseUserOrThrow(uid);
        state.firebaseUsers.set(uid, {
          ...user,
          ...(profile.displayName !== undefined && { displayName: profile.displayName }),
          ...(profile.photoURL !== undefined && { photoURL: profile.photoURL }),
          ...(profile.disabled !== undefined && { disabled: profile.disabled }),
        });
        return Promise.resolve(toFirebaseUserResponse(state.firebaseUsers.get(uid)!));
      },
    },
    appCheck: {
      verifyToken: (token: string) => {
        if (token === "valid-app-check") {
          return Promise.resolve();
        }

        return Promise.reject(new Error("Invalid App Check token"));
      },
    },
  },
}));

vi.mock("../../src/repository/firestore/index.js", () => ({
  firestoreAuth: {
    runTransaction: async (callback: (transaction: {
      get: (reference: { get: () => Promise<unknown> }) => Promise<unknown>;
      set: (reference: { set: (value: unknown) => Promise<void> }, value: unknown) => void;
      delete: (reference: { delete: () => Promise<void> }) => void;
    }) => Promise<unknown>) => {
      const pendingWrites: Array<() => Promise<void>> = [];
      const result = await callback({
        get: (reference) => reference.get(),
        set: (reference, value) => { pendingWrites.push(() => reference.set(value)); },
        delete: (reference) => { pendingWrites.push(() => reference.delete()); },
      });
      for (const write of pendingWrites) await write();
      return result;
    },
    collection: (collectionName: string) => {
      if (collectionName !== "stores") {
        throw new Error(`Unsupported direct Firestore collection: ${collectionName}`);
      }

      return {
        where: (fieldPath: string, operator: string, value: unknown) => ({
          limit: () => ({
            get: () => {
              const stores = Array.from(state.stores.values()).filter((store) =>
                operator === "==" && (store as unknown as Record<string, unknown>)[fieldPath] === value,
              );
              return Promise.resolve({
                empty: stores.length === 0,
                docs: stores.map((store) => ({
                  id: store.id,
                  exists: true,
                  data: () => clone(store),
                })),
              });
            },
          }),
        }),
        doc: (storeId: string) => ({
          get: () => {
            const store = state.stores.get(storeId);

            return Promise.resolve({
              id: storeId,
              exists: store !== undefined,
              ref: { path: `stores/${storeId}` },
              data: () => (store === undefined ? undefined : clone(store)),
            });
          },
          collection: (subcollectionName: string) => {
            const queryDocuments = (fieldPath: string, operator: string, value: unknown) => {
              const source = subcollectionName === "attendances"
                ? Array.from(state.attendances.values()).filter((item) => item.storeId === storeId)
                : subcollectionName === "employee_leave_requests"
                  ? Array.from(state.leaveRequests.values()).filter((item) => item.storeId === storeId)
                  : [];
              return source.filter((item) => {
                const fieldValue = (item as unknown as Record<string, unknown>)[fieldPath];
                if (operator === "==") return fieldValue === value;
                if (operator === "<=") return typeof fieldValue === "string" && typeof value === "string" && fieldValue <= value;
                return false;
              }).map((item) => ({
                id: item.id,
                exists: true,
                data: () => clone(item),
              }));
            };
            return {
              where: (fieldPath: string, operator: string, value: unknown) => ({
                get: () => Promise.resolve({ docs: queryDocuments(fieldPath, operator, value) }),
              }),
              doc: (documentId: string) => {
                const key = `${storeId}__${documentId}`;
                const targetMap = subcollectionName === "bookings"
                  ? state.bookings
                  : state.slotReservations;
                return {
                  get: () => {
                    const value = targetMap.get(key);
                    return Promise.resolve({
                      id: documentId,
                      exists: value !== undefined,
                      data: () => value === undefined ? undefined : clone(value),
                    });
                  },
                  set: (value: unknown) => {
                    targetMap.set(key, clone(value as Record<string, unknown>));
                    return Promise.resolve();
                  },
                  update: (value: Record<string, unknown>) => {
                    targetMap.set(key, { ...(targetMap.get(key) ?? {}), ...clone(value) });
                    return Promise.resolve();
                  },
                  delete: () => {
                    targetMap.delete(key);
                    return Promise.resolve();
                  },
                };
              },
            };
          },
        }),
      };
    },
  },
  firestoreRepository: {
    maintenance: {
      updateOwnerDataRetentionPolicy: async (
        uid: string,
        patch: Partial<UserType>,
        options: {
          onCommitted?: () => void;
          runSigninCacheInvalidation?: (invalidate: () => Promise<void>) => Promise<void>;
        } = {},
      ) => {
        const existingUser = getUserOrThrow(uid);
        const updatedUser = { ...existingUser, ...patch } as UserType;

        if (
          "dataRetentionStandardEligibleAt" in patch &&
          patch.dataRetentionStandardEligibleAt === undefined &&
          updatedUser.role === "owner"
        ) {
          delete updatedUser.dataRetentionStandardEligibleAt;
        }

        state.users.set(uid, updatedUser);
        options.onCommitted?.();

        if (options.runSigninCacheInvalidation !== undefined) {
          await options.runSigninCacheInvalidation(() => Promise.resolve());
        }
      },
    },
    billing: {
      getBillingAccount: (ownerUserId: string) => {
        const account = state.billingAccounts.get(ownerUserId);
        return Promise.resolve(account === undefined ? undefined : clone(account));
      },
      getBillingAccountByProviderSubscription: (providerSubscriptionId: string) => {
        const account = Array.from(state.billingAccounts.values()).find(
          (candidate) => candidate.providerSubscriptionId === providerSubscriptionId,
        );
        return Promise.resolve(account === undefined ? undefined : clone(account));
      },
      upsertBillingAccount: (account: BillingAccountRecord) => {
        state.billingAccounts.set(account.ownerUserId, clone(account));
        return Promise.resolve();
      },
    },
    user: {
      insertUser: (user: UserType) => {
        state.users.set(user.uid, clone(user));
        return Promise.resolve(clone(user));
      },
      getUser: (uid: string) => {
        const user = state.users.get(uid);

        if (!user) {
          return Promise.reject(new FirestoreDataNotFoundError());
        }

        return Promise.resolve(clone(user));
      },
      getSigninUser: (uid: string) => {
        const user = state.users.get(uid);

        if (!user) {
          return Promise.reject(new FirestoreDataNotFoundError());
        }

        return Promise.resolve(toSigninUserRecord(user));
      },
      touchLastLoginAt: (uid: string, lastLoginAt: number) => {
        const user = state.users.get(uid);

        if (!user) {
          return Promise.reject(new FirestoreDataNotFoundError());
        }

        state.users.set(uid, clone({ ...user, lastLoginAt }));
        return Promise.resolve();
      },
      getUserByEmail: (email: string) => {
        const user = findUserByEmail(email);

        if (!user) {
          return Promise.reject(new Error("User not found"));
        }

        return Promise.resolve(clone(user));
      },
      isCorrectRole: (uid: string, role: UserType["role"]) =>
        Promise.resolve(getUserOrThrow(uid).role === role),
      isExisting: (email: string) => Promise.resolve(findUserByEmail(email) !== undefined),
      listActiveShopEmployees: (ownerId: string) =>
        Promise.resolve(
          Array.from(state.users.values())
            .filter((user) => user.ownerId === ownerId && user.active && isEmployeeRole(user.role))
            .map(clone),
        ),
      listShopEmployees: (ownerId: string, options: { storeId?: string; active?: boolean } = {}) =>
        Promise.resolve(
          Array.from(state.users.values())
            .filter(
              (user) =>
                user.ownerId === ownerId &&
                isEmployeeRole(user.role) &&
                (options.storeId === undefined || user.storeId === options.storeId) &&
                (options.active === undefined || user.active === options.active),
            )
            .map(clone),
        ),
      countShopEmployees: (ownerId: string, options: { storeId?: string; active?: boolean } = {}) =>
        Promise.resolve(
          Array.from(state.users.values()).filter(
            (user) =>
              user.ownerId === ownerId &&
              isEmployeeRole(user.role) &&
              (options.storeId === undefined || user.storeId === options.storeId) &&
              (options.active === undefined || user.active === options.active),
          ).length,
        ),
      updateUser: (uid: string, patch: Partial<UserType>) => {
        const existingUser = getUserOrThrow(uid);
        const updatedUser = {
          ...existingUser,
          ...patch,
        } as UserType;

        if (
          "dataRetentionStandardEligibleAt" in patch &&
          patch.dataRetentionStandardEligibleAt === undefined &&
          updatedUser.role === "owner"
        ) {
          delete updatedUser.dataRetentionStandardEligibleAt;
        }

        state.users.set(uid, updatedUser);
        return Promise.resolve();
      },
    },
    shop: {
      settlement: {
        getWorkDaySettlement: (ownerId: string, storeId: string, workDate: string) => {
          const settlement = state.workDaySettlements.get(`${storeId}__${workDate}`);

          if (settlement?.ownerId === ownerId) {
            return Promise.resolve(clone(settlement));
          }

          const closing = Array.from(state.closings.values()).find(
            (candidate) =>
              candidate.ownerId === ownerId &&
              candidate.storeId === storeId &&
              candidate.workDate === workDate,
          );

          if (!closing) {
            return Promise.resolve(null);
          }

          return Promise.resolve({
            id: workDate,
            ownerId,
            storeId,
            workDate,
            settlementEligibleAt: closing.closedAt,
            status: "closed" as const,
            attendance: {
              totalCount: closing.summary.totalEntries,
              openCount: 0,
              closedCount: closing.summary.totalEntries,
              incompleteCount: 0,
              employeeTotalCount: closing.employeeSummaries.length,
              employeeClosedCount: closing.employeeSummaries.length,
            },
            employees: closing.employeeSummaries.map((employeeSummary) => ({
              employeeUserId: employeeSummary.employeeUserId,
              employeeName: employeeSummary.employeeName,
              attendanceCount: 1,
              closedCount: 1,
              totalRevenue: employeeSummary.totalRevenue,
            })),
            totalRevenue: closing.summary.subtotalAmount,
            totalDiscount: closing.summary.totalDiscountAmount,
            totalNetAmount: closing.summary.totalNetAmount,
            totalOwnerNetAfterDiscount:
              closing.summary.totalOwnerCommission -
              (closing.summary.totalOwnerDiscountAmount ?? 0),
            attendanceVersion: `closing:${closing.updatedAt}`,
            previewOwnerDiscountCoverageRate: closing.ownerDiscountCoverageRate,
            preview: {
              employeeSummaries: clone(closing.employeeSummaries),
              compensationConfigurationErrors: [],
              totalRevenue: closing.summary.subtotalAmount,
              totalDiscount: closing.summary.totalDiscountAmount,
              totalEmployeeDiscount: closing.summary.totalEmployeeDiscountAmount ?? 0,
              totalOwnerDiscount: closing.summary.totalOwnerDiscountAmount ?? 0,
              totalOwnerDiscountAbsorbed: closing.summary.totalOwnerDiscountAmount ?? 0,
              totalEmployeeDiscountAllocated: closing.summary.totalEmployeeDiscountAmount ?? 0,
              totalUnallocatedDiscount: 0,
              totalNetAmount: closing.summary.totalNetAmount,
              totalOwnerCommission: closing.summary.totalOwnerCommission,
              totalOwnerNetAfterDiscount:
                closing.summary.totalOwnerCommission -
                (closing.summary.totalOwnerDiscountAmount ?? 0),
              totalEmployeeEarning: closing.summary.totalEmployeeEarning,
              allocationSource: "workday" as const,
              discountTargetEmployeeUserIds: [],
              discountEligibleEmployeeUserIds: [],
              submittedEmployeeUserIds: closing.employeeSummaries.map(
                (employeeSummary) => employeeSummary.employeeUserId,
              ),
              incompleteAttendanceIds: [],
            },
            pendingEmployees: [],
            serviceSummaries: clone(closing.serviceSummaries ?? []),
            closing: {
              id: closing.id,
              closedAt: closing.closedAt,
              closedByUserId: closing.closedByUserId,
              ownerDiscountCoverageRate: closing.ownerDiscountCoverageRate,
              discountAllocationMethod: closing.discountAllocationMethod,
              employeeSummaries: clone(closing.employeeSummaries),
              summary: clone(closing.summary),
              createdAt: closing.createdAt,
              updatedAt: closing.updatedAt,
              ...(closing.storeTimezone !== undefined && {
                storeTimezone: closing.storeTimezone,
              }),
            },
            revision: closing.revision ?? 1,
            createdAt: closing.createdAt,
            updatedAt: closing.updatedAt,
          });
        },
        listWorkDaySettlementAttendanceItems: (
          ownerId: string,
          storeId: string,
          workDate: string,
        ) => {
          const settlement = state.workDaySettlements.get(`${storeId}__${workDate}`);

          if (!settlement || settlement.ownerId !== ownerId) {
            return Promise.resolve(null);
          }

          return Promise.resolve(clone(settlement.attendanceItems ?? []));
        },
        markWorkDaySettlementEmployeeClosed: (
          ownerId: string,
          storeId: string,
          workDate: string,
          employeeUserId: string,
          options: { onCommitted?: WorkDaySettlementCommitObserver } = {},
        ) => {
          const key = `${storeId}__${workDate}`;
          const existingSettlement = state.workDaySettlements.get(key);

          if (!existingSettlement || existingSettlement.ownerId !== ownerId) {
            return Promise.resolve(null);
          }

          const employees = existingSettlement.employees.map((employee) =>
            employee.employeeUserId === employeeUserId ? { ...employee, closedCount: 1 } : employee,
          );
          const employeeClosedCount = employees.filter(
            (employee) => employee.closedCount > 0,
          ).length;
          const submittedEmployeeUserIds = new Set(
            existingSettlement.preview.submittedEmployeeUserIds,
          );
          submittedEmployeeUserIds.add(employeeUserId);
          const settlement: ShopWorkDaySettlementType = {
            ...existingSettlement,
            status:
              employeeClosedCount === existingSettlement.attendance.employeeTotalCount &&
              existingSettlement.attendance.incompleteCount === 0
                ? "ready"
                : "open",
            attendance: {
              ...existingSettlement.attendance,
              employeeClosedCount,
            },
            employees,
            preview: {
              ...existingSettlement.preview,
              submittedEmployeeUserIds: Array.from(submittedEmployeeUserIds).sort(),
            },
            pendingEmployees: existingSettlement.pendingEmployees.filter(
              (employee) => employee.id !== employeeUserId,
            ),
            revision: existingSettlement.revision + 1,
            updatedAt: Date.now(),
          };
          state.workDaySettlements.set(key, settlement);
          options.onCommitted?.({
            stage: "aggregate_mark",
            persistAction: "overwrite",
            statusBefore: existingSettlement.status,
            statusAfter: settlement.status,
            revisionBefore: existingSettlement.revision,
            revisionAfter: settlement.revision,
          });
          return Promise.resolve(clone(settlement));
        },
        countOpenWorkDaySettlementsByStore: (ownerId: string, storeId: string) =>
          Promise.resolve(
            Array.from(state.workDaySettlements.values()).filter(
              (settlement) =>
                settlement.ownerId === ownerId &&
                settlement.storeId === storeId &&
                (settlement.status === "open" || settlement.status === "ready"),
            ).length,
          ),
        listClosedWorkDaySettlementFinancialProjectionByStoreDateRange: (
          ownerId: string,
          storeId: string,
          fromWorkDate: string,
          toWorkDate: string,
        ) =>
          Promise.resolve(
            Array.from(state.workDaySettlements.values())
              .filter(
                (settlement) =>
                  settlement.ownerId === ownerId &&
                  settlement.storeId === storeId &&
                  settlement.status === "closed" &&
                  settlement.workDate >= fromWorkDate &&
                  settlement.workDate <= toWorkDate,
              )
              .sort((left, right) => left.workDate.localeCompare(right.workDate))
              .map(
                (settlement): ShopWorkDaySettlementFinancialProjectionType => ({
                  id: settlement.id,
                  ownerId: settlement.ownerId,
                  storeId: settlement.storeId,
                  workDate: settlement.workDate,
                  status: "closed",
                  updatedAt: settlement.updatedAt,
                  attendance: {
                    totalCount: settlement.attendance.totalCount,
                  },
                  employees: settlement.employees.map((employee) => ({
                    employeeUserId: employee.employeeUserId,
                    attendanceCount: employee.attendanceCount,
                  })),
                  preview: {
                    employeeSummaries: clone(settlement.preview.employeeSummaries),
                    totalEmployeeEarning: settlement.preview.totalEmployeeEarning,
                    totalOwnerCommission: settlement.preview.totalOwnerCommission,
                  },
                  serviceSummaries: clone(settlement.serviceSummaries),
                  closing: {
                    id: settlement.closing?.id ?? settlement.id,
                    closedAt: settlement.closing?.closedAt ?? settlement.updatedAt,
                    closedByUserId: settlement.closing?.closedByUserId ?? settlement.ownerId,
                    ownerDiscountCoverageRate:
                      settlement.closing?.ownerDiscountCoverageRate ??
                      settlement.previewOwnerDiscountCoverageRate,
                    discountAllocationMethod:
                      settlement.closing?.discountAllocationMethod ?? "revenue_share",
                    summary: {
                      totalEntries:
                        settlement.closing?.summary.totalEntries ??
                        settlement.attendance.totalCount,
                      subtotalAmount:
                        settlement.closing?.summary.subtotalAmount ??
                        settlement.preview.totalRevenue,
                      totalDiscountAmount:
                        settlement.closing?.summary.totalDiscountAmount ??
                        settlement.preview.totalDiscount,
                      totalNetAmount:
                        settlement.closing?.summary.totalNetAmount ??
                        settlement.preview.totalNetAmount,
                      totalOwnerCommission:
                        settlement.closing?.summary.totalOwnerCommission ??
                        settlement.preview.totalOwnerCommission,
                      totalEmployeeEarning:
                        settlement.closing?.summary.totalEmployeeEarning ??
                        settlement.preview.totalEmployeeEarning,
                      ...(settlement.closing?.summary.totalEmployeeDiscountAmount !== undefined && {
                        totalEmployeeDiscountAmount:
                          settlement.closing.summary.totalEmployeeDiscountAmount,
                      }),
                      ...(settlement.closing?.summary.totalOwnerDiscountAmount !== undefined && {
                        totalOwnerDiscountAmount:
                          settlement.closing.summary.totalOwnerDiscountAmount,
                      }),
                    },
                  },
                }),
              ),
          ),
        listWorkDaySettlementsByStatusPaginated: (
          ownerId: string,
          storeId: string,
          statuses: ShopWorkDaySettlementType["status"][],
          options: {
            limit: number;
            cursorWorkDate?: string;
            cursorSettlementEligibleAt?: number;
            toWorkDate?: string;
            toSettlementEligibleAt?: number;
          },
        ) => {
          const orderedSettlements = Array.from(state.workDaySettlements.values())
            .filter(
              (settlement) =>
                settlement.ownerId === ownerId &&
                settlement.storeId === storeId &&
                statuses.includes(settlement.status) &&
                (options.cursorWorkDate === undefined ||
                  (options.toSettlementEligibleAt !== undefined &&
                  options.cursorSettlementEligibleAt !== undefined
                    ? settlement.settlementEligibleAt < options.cursorSettlementEligibleAt ||
                      (settlement.settlementEligibleAt === options.cursorSettlementEligibleAt &&
                        settlement.workDate < options.cursorWorkDate)
                    : settlement.workDate < options.cursorWorkDate)) &&
                (options.toWorkDate === undefined || settlement.workDate <= options.toWorkDate) &&
                (options.toSettlementEligibleAt === undefined ||
                  settlement.settlementEligibleAt <= options.toSettlementEligibleAt),
            )
            .sort((left, right) => {
              if (options.toSettlementEligibleAt !== undefined) {
                const eligibilityComparison =
                  right.settlementEligibleAt - left.settlementEligibleAt;

                if (eligibilityComparison !== 0) {
                  return eligibilityComparison;
                }
              }

              return right.workDate.localeCompare(left.workDate);
            });
          const fetchedSettlements = orderedSettlements.slice(0, options.limit + 1);
          const hasMore = fetchedSettlements.length > options.limit;
          const settlements = (
            hasMore ? fetchedSettlements.slice(0, options.limit) : fetchedSettlements
          ).map(clone);
          const lastSettlement = settlements[settlements.length - 1];

          return Promise.resolve({
            settlements,
            nextCursor:
              hasMore && lastSettlement
                ? {
                    workDate: lastSettlement.workDate,
                    ...(options.toSettlementEligibleAt !== undefined && {
                      settlementEligibleAt: lastSettlement.settlementEligibleAt,
                    }),
                  }
                : null,
            hasMore,
          });
        },
        upsertWorkDaySettlement: (
          ownerId: string,
          input: Omit<
            ShopWorkDaySettlementType,
            "id" | "ownerId" | "revision" | "createdAt" | "updatedAt"
          >,
          options: { onCommitted?: WorkDaySettlementCommitObserver; commitStage?: string } = {},
        ) => {
          const key = `${input.storeId}__${input.workDate}`;
          const existingSettlement = state.workDaySettlements.get(key);
          const timestamp = Date.now();
          const settlement: ShopWorkDaySettlementType = {
            id: input.workDate,
            ownerId,
            ...input,
            revision: (existingSettlement?.revision ?? 0) + 1,
            createdAt: existingSettlement?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          state.workDaySettlements.set(key, settlement);
          if (input.status !== "closed") {
            state.closings.delete(key);
          }
          options.onCommitted?.({
            stage:
              options.commitStage === "closed_recalculation"
                ? "closed_recalculation"
                : "aggregate_prepared",
            persistAction: existingSettlement ? "overwrite" : "create",
            ...(existingSettlement && { statusBefore: existingSettlement.status }),
            statusAfter: settlement.status,
            ...(existingSettlement && { revisionBefore: existingSettlement.revision }),
            revisionAfter: settlement.revision,
          });
          return Promise.resolve(clone(settlement));
        },
        createClosedWorkDaySettlement: (
          ownerId: string,
          input: Omit<
            ShopWorkDaySettlementType,
            "id" | "ownerId" | "revision" | "createdAt" | "updatedAt"
          >,
          options: { onCommitted?: WorkDaySettlementCommitObserver } = {},
        ) => {
          const key = `${input.storeId}__${input.workDate}`;
          const existingSettlement = state.workDaySettlements.get(key);

          if (existingSettlement?.status === "closed") {
            return Promise.reject(new FirestoreDataExistingError());
          }

          const timestamp = Date.now();
          const settlement: ShopWorkDaySettlementType = {
            id: input.workDate,
            ownerId,
            ...input,
            revision: (existingSettlement?.revision ?? 0) + 1,
            createdAt: existingSettlement?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          state.workDaySettlements.set(key, settlement);
          state.closings.set(settlement.closing?.id ?? key, {
            id: settlement.closing?.id ?? key,
            ownerId,
            storeId: input.storeId,
            workDate: input.workDate,
            closedAt: settlement.closing?.closedAt ?? timestamp,
            closedByUserId: settlement.closing?.closedByUserId ?? ownerId,
            ownerDiscountCoverageRate:
              settlement.closing?.ownerDiscountCoverageRate ??
              input.previewOwnerDiscountCoverageRate,
            discountAllocationMethod:
              settlement.closing?.discountAllocationMethod ?? "revenue_share",
            employeeSummaries: clone(input.preview.employeeSummaries),
            serviceSummaries: clone(input.serviceSummaries),
            summary: clone(
              settlement.closing?.summary ?? {
                totalEntries: input.attendance.totalCount,
                subtotalAmount: input.totalRevenue,
                totalDiscountAmount: input.totalDiscount,
                totalNetAmount: input.totalNetAmount,
                totalOwnerCommission: input.preview.totalOwnerCommission,
                totalEmployeeEarning: input.preview.totalEmployeeEarning,
              },
            ),
            createdAt: settlement.closing?.createdAt ?? timestamp,
            updatedAt: settlement.closing?.updatedAt ?? timestamp,
            ...(settlement.closing?.storeTimezone !== undefined && {
              storeTimezone: settlement.closing.storeTimezone,
            }),
          });
          options.onCommitted?.({
            stage: "store_closing",
            persistAction: existingSettlement ? "overwrite" : "create",
            ...(existingSettlement && { statusBefore: existingSettlement.status }),
            statusAfter: settlement.status,
            ...(existingSettlement && { revisionBefore: existingSettlement.revision }),
            revisionAfter: settlement.revision,
          });
          return Promise.resolve(clone(settlement));
        },
        deleteWorkDaySettlement: (ownerId: string, storeId: string, workDate: string) => {
          const key = `${storeId}__${workDate}`;
          const settlement = state.workDaySettlements.get(key);

          if (settlement?.ownerId === ownerId) {
            state.workDaySettlements.delete(key);
          }

          return Promise.resolve();
        },
      },
      session: {
        getEmployeeWorkDayClosing: (
          ownerId: string,
          storeId: string,
          workDate: string,
          employeeUserId: string,
        ) =>
          Promise.resolve(
            clone(
              Array.from(state.employeeWorkDayClosings.values()).find(
                (closing) =>
                  closing.ownerId === ownerId &&
                  closing.storeId === storeId &&
                  closing.workDate === workDate &&
                  closing.employeeUserId === employeeUserId,
              ) ?? null,
            ),
          ),
        listEmployeeWorkDayClosingsByStoreWorkDate: (
          ownerId: string,
          storeId: string,
          workDate: string,
        ) =>
          Promise.resolve(
            Array.from(state.employeeWorkDayClosings.values())
              .filter(
                (closing) =>
                  closing.ownerId === ownerId &&
                  closing.storeId === storeId &&
                  closing.workDate === workDate,
              )
              .map(clone),
          ),
        listEmployeeWorkDayClosingsByStoreDateRange: (
          ownerId: string,
          storeId: string,
          fromWorkDate: string,
          toWorkDate: string,
        ) =>
          Promise.resolve(
            Array.from(state.employeeWorkDayClosings.values())
              .filter(
                (closing) =>
                  closing.ownerId === ownerId &&
                  closing.storeId === storeId &&
                  closing.workDate >= fromWorkDate &&
                  closing.workDate <= toWorkDate,
              )
              .map(clone),
          ),
        closeEmployeeWorkDay: (
          ownerId: string,
          input: Omit<ShopEmployeeWorkDayClosingType, "id" | "ownerId" | "createdAt" | "updatedAt">,
          options: {
            onCommitted?: WorkDaySettlementCommitObserver;
            persistAction?: WorkDaySettlementPersistAction;
          } = {},
        ) => {
          const id = `${input.employeeUserId}__${input.workDate}`;
          const existing = state.employeeWorkDayClosings.get(id);

          if (options.persistAction === "create" && existing !== undefined) {
            return Promise.reject(
              new FirestoreDataExistingError("Employee work-day closing already exists"),
            );
          }

          const closing: ShopEmployeeWorkDayClosingType = {
            id,
            ownerId,
            ...input,
            createdAt: existing?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
          };
          state.employeeWorkDayClosings.set(id, closing);
          options.onCommitted?.({
            stage: "employee_closing",
            persistAction: options.persistAction ?? "overwrite",
          });
          return Promise.resolve(clone(closing));
        },
        deleteEmployeeWorkDayClosing: (
          ownerId: string,
          storeId: string,
          workDate: string,
          employeeUserId: string,
        ) => {
          const id = `${employeeUserId}__${workDate}`;
          const closing = state.employeeWorkDayClosings.get(id);

          if (
            closing?.ownerId === ownerId &&
            closing.storeId === storeId &&
            closing.workDate === workDate &&
            closing.employeeUserId === employeeUserId
          ) {
            state.employeeWorkDayClosings.delete(id);
          }

          return Promise.resolve();
        },
        getWorkDayClosing: (ownerId: string, storeId: string, workDate: string) =>
          Promise.resolve(
            clone(
              Array.from(state.closings.values()).find(
                (closing) =>
                  closing.ownerId === ownerId &&
                  closing.storeId === storeId &&
                  closing.workDate === workDate,
              ) ?? null,
            ),
          ),
        listWorkDayClosingsByDate: (ownerId: string, workDate: string) =>
          Promise.resolve(
            Array.from(state.closings.values())
              .filter((closing) => closing.ownerId === ownerId && closing.workDate === workDate)
              .map(clone),
          ),
        listWorkDayClosingsByStoreDateRange: (
          ownerId: string,
          storeId: string,
          fromWorkDate: string,
          toWorkDate: string,
        ) =>
          Promise.resolve(
            Array.from(state.closings.values())
              .filter(
                (closing) =>
                  closing.ownerId === ownerId &&
                  closing.storeId === storeId &&
                  closing.workDate >= fromWorkDate &&
                  closing.workDate <= toWorkDate,
              )
              .map(clone),
          ),
        listWorkDayClosingsByStorePaginated: (
          ownerId: string,
          storeId: string,
          options: { limit: number; cursorWorkDate?: string },
        ) => {
          const ordered = Array.from(state.closings.values())
            .filter(
              (closing) =>
                closing.ownerId === ownerId &&
                closing.storeId === storeId &&
                (options.cursorWorkDate === undefined || closing.workDate < options.cursorWorkDate),
            )
            .sort((left, right) => right.workDate.localeCompare(left.workDate));
          const fetched = ordered.slice(0, options.limit + 1);
          const hasMore = fetched.length > options.limit;
          const closings = (hasMore ? fetched.slice(0, options.limit) : fetched).map(clone);
          const nextCursor = hasMore ? (closings[closings.length - 1]?.workDate ?? null) : null;

          return Promise.resolve({ closings, nextCursor, hasMore });
        },
        closeWorkDay: (
          ownerId: string,
          input: Omit<
            ShopClosedWorkDaySettlementType,
            "id" | "ownerId" | "createdAt" | "updatedAt"
          >,
        ) => {
          const closingId = `closing-${++state.nextIds.closing}`;
          state.closings.set(closingId, {
            id: closingId,
            ownerId,
            ...input,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          return Promise.resolve(closingId);
        },
      },
      store: {
        adjustEmployeeCounts: (
          ownerId: string,
          storeId: string,
          delta: {
            employeeCount?: number;
            activeEmployeeCount?: number;
            inactiveEmployeeCount?: number;
          },
        ) => {
          const branch = getStoreOrThrow(storeId);

          if (branch.ownerId !== ownerId) {
            return Promise.reject(new Error("Store not found"));
          }

          state.stores.set(storeId, {
            ...branch,
            employeeCount: (branch.employeeCount ?? 0) + (delta.employeeCount ?? 0),
            activeEmployeeCount:
              (branch.activeEmployeeCount ?? 0) + (delta.activeEmployeeCount ?? 0),
            inactiveEmployeeCount:
              (branch.inactiveEmployeeCount ?? 0) + (delta.inactiveEmployeeCount ?? 0),
            updatedAt: Date.now(),
          });

          return Promise.resolve();
        },
        createStore: (
          ownerId: string,
          input: Omit<StoreType, "id" | "ownerId" | "createdAt" | "updatedAt">,
        ) => {
          const storeId = `branch-created-${++state.nextIds.branch}`;
          state.stores.set(storeId, {
            id: storeId,
            ownerId,
            code: `S-${Array.from(state.stores.values()).filter((branch) => branch.ownerId === ownerId).length + 1}`,
            ...input,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          return Promise.resolve(storeId);
        },
        getStore: (ownerId: string, storeId: string) => {
          state.storeReadCount += 1;
          const branch =
            state.stores.get(storeId) ??
            Array.from(state.stores.values()).find((candidate) => candidate.code === storeId);

          if (!branch) {
            return Promise.reject(new FirestoreDataNotFoundError());
          }

          if (branch.ownerId !== ownerId) {
            return Promise.reject(new FirestoreDataNotFoundError());
          }

          return Promise.resolve(clone(branch));
        },
        getStoreList: (ownerId: string) =>
          Promise.resolve(
            Array.from(state.stores.values())
              .filter((branch) => branch.ownerId === ownerId)
              .map(clone),
          ),
        getStoreSummaryList: (ownerId: string) =>
          Promise.resolve(
            Array.from(state.stores.values())
              .filter((branch) => branch.ownerId === ownerId)
              .map(clone),
          ),
        updateStore: (ownerId: string, storeId: string, patch: Partial<StoreType>) => {
          const branch = getStoreOrThrow(storeId);

          if (branch.ownerId !== ownerId) {
            return Promise.reject(new Error("Store not found"));
          }

          state.stores.set(storeId, {
            ...branch,
            ...patch,
            updatedAt: Date.now(),
          });
          return Promise.resolve();
        },
      },
      service: {
        createShopServiceCategory: (
          ownerId: string,
          input: {
            storeId: string;
            name: string;
            label?: string;
            category: ShopServiceType["category"];
          },
        ) => {
          const name = input.name.trim();
          const categoryId = resolveServiceCategoryId(name, input.category);
          const existingCategory = state.serviceCategories.get(categoryId);
          const timestamp = Date.now();

          if (
            existingCategory &&
            existingCategory.ownerId === ownerId &&
            existingCategory.storeId === input.storeId
          ) {
            const updatedCategory = {
              ...existingCategory,
              updatedAt: timestamp,
            };
            state.serviceCategories.set(categoryId, updatedCategory);
            return Promise.resolve({ category: clone(updatedCategory), created: false });
          }

          const category: ShopServiceCategoryDocumentType = {
            id: categoryId,
            ownerId,
            storeId: input.storeId,
            name,
            label: input.label ?? name,
            category: input.category,
            sortOrder:
              Array.from(state.serviceCategories.values()).filter(
                (candidate) => candidate.ownerId === ownerId && candidate.storeId === input.storeId,
              ).length + 1,
            serviceCount: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          };

          state.serviceCategories.set(categoryId, category);
          return Promise.resolve({ category: clone(category), created: true });
        },
        createShopService: (
          ownerId: string,
          input: Omit<ShopServiceType, "id" | "ownerId" | "createdAt" | "updatedAt">,
        ) => {
          const serviceId = `service-created-${++state.nextIds.service}`;
          const service = {
            id: serviceId,
            serviceCode: `DV-${state.nextIds.service}`,
            ownerId,
            ...input,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          state.services.set(serviceId, service);
          return Promise.resolve(clone(service));
        },
        getShopServiceFactory: (ownerId: string, storeId: string) =>
          Promise.resolve(
            Array.from(state.services.values())
              .filter(
                (service) =>
                  service.ownerId === ownerId &&
                  service.storeId === storeId &&
                  service.type === "predefined",
              )
              .map(clone),
          ),
        getShopServiceCatalog: (ownerId: string, storeId: string) => {
          const services = Array.from(state.services.values())
            .filter(
              (service) =>
                service.ownerId === ownerId &&
                service.storeId === storeId &&
                service.type === "predefined",
            )
            .sort((left, right) => left.name.localeCompare(right.name, "vi"))
            .map(clone);
          const groupsById = new Map<string, ShopServiceCatalogType["groups"][number]>();
          const categoryLabels: Record<ShopServiceType["category"], string> = {
            nail: "Nail",
            pedicure: "Pedicure",
            manicure: "Manicure",
            design: "Design",
            other: "Other",
          };

          Array.from(state.serviceCategories.values())
            .filter((category) => category.ownerId === ownerId && category.storeId === storeId)
            .sort((left, right) => left.sortOrder - right.sortOrder)
            .forEach((category) => {
              groupsById.set(category.id, {
                id: category.id,
                name: category.name,
                label: category.label,
                category: category.category,
                sortOrder: category.sortOrder,
                serviceCount: 0,
                services: [],
              });
            });

          for (const service of services) {
            const name = service.groupService ?? categoryLabels[service.category];
            const groupId = resolveServiceCategoryId(name, service.category);
            const existingGroup = groupsById.get(groupId);

            if (existingGroup) {
              existingGroup.services.push(service);
              existingGroup.serviceCount = existingGroup.services.length;
              continue;
            }

            groupsById.set(groupId, {
              id: groupId,
              name,
              label: name,
              category: service.category,
              sortOrder: groupsById.size + 1,
              serviceCount: 1,
              services: [service],
            });
          }

          const groups = Array.from(groupsById.values()).map((group, index) => ({
            ...group,
            sortOrder: index + 1,
          }));
          const catalogUpdatedAt = Math.max(
            ...services.map((service) => service.updatedAt ?? 0),
            ...Array.from(state.serviceCategories.values())
              .filter((category) => category.ownerId === ownerId && category.storeId === storeId)
              .map((category) => category.updatedAt ?? 0),
            0,
          );

          return Promise.resolve({
            id: storeId,
            ownerId,
            storeId,
            version: `${services.length}:${services.map((service) => service.updatedAt ?? 0).join(",")}`,
            groupCount: groups.length,
            serviceCount: services.length,
            groups,
            createdAt: Date.now(),
            updatedAt: catalogUpdatedAt,
          });
        },
        getShopService: (ownerId: string, serviceId: string) => {
          const service = getServiceOrThrow(serviceId);

          if (service.ownerId !== ownerId) {
            return Promise.reject(new Error("Service not found"));
          }

          return Promise.resolve(clone(service));
        },
        updateShopService: (
          ownerId: string,
          serviceId: string,
          patch: Partial<ShopServiceType>,
        ) => {
          const service = getServiceOrThrow(serviceId);

          if (service.ownerId !== ownerId) {
            return Promise.reject(new Error("Service not found"));
          }

          const updatedService = {
            ...service,
            ...patch,
            updatedAt: Date.now(),
          };
          state.services.set(serviceId, updatedService);
          return Promise.resolve(clone(updatedService));
        },
        deleteShopService: (ownerId: string, serviceId: string) => {
          const service = getServiceOrThrow(serviceId);

          if (service.ownerId !== ownerId) {
            return Promise.reject(new Error("Service not found"));
          }

          state.services.delete(serviceId);
          return Promise.resolve();
        },
      },
      expense: {
        createShopExpenses: (
          ownerId: string,
          expenses: Array<Omit<ShopExpenseType, "id" | "ownerId" | "createdAt" | "updatedAt">>,
        ) => {
          const timestamp = Date.now();
          const createdExpenses = expenses.map((expense) => {
            const expenseId = `expense-created-${++state.nextIds.expense}`;
            const createdExpense: ShopExpenseType = {
              id: expenseId,
              ownerId,
              ...expense,
              createdAt: timestamp,
              updatedAt: timestamp,
            };

            state.expenses.set(expenseId, createdExpense);
            return clone(createdExpense);
          });

          return Promise.resolve(createdExpenses);
        },
        getShopExpense: (ownerId: string, storeId: string, expenseId: string) => {
          const expense = state.expenses.get(expenseId);

          if (!expense || expense.ownerId !== ownerId || expense.storeId !== storeId) {
            return Promise.reject(
              new FirestoreDataNotFoundError("Expense not found", "/database/expense-not-found"),
            );
          }

          return Promise.resolve(clone(expense));
        },
        listShopExpenses: (
          ownerId: string,
          filters: { storeId: string; fromWorkDate: string; toWorkDate: string },
        ) =>
          Promise.resolve(
            Array.from(state.expenses.values())
              .filter(
                (expense) =>
                  expense.ownerId === ownerId &&
                  expense.storeId === filters.storeId &&
                  expense.workDate >= filters.fromWorkDate &&
                  expense.workDate <= filters.toWorkDate,
              )
              .sort((left, right) => {
                if (left.workDate !== right.workDate) {
                  return right.workDate.localeCompare(left.workDate);
                }

                return right.createdAt - left.createdAt;
              })
              .map(clone),
          ),
        updateShopExpense: (
          ownerId: string,
          storeId: string,
          expenseId: string,
          patch: Partial<
            Omit<ShopExpenseType, "id" | "ownerId" | "storeId" | "createdAt" | "updatedAt">
          >,
        ) => {
          const expense = state.expenses.get(expenseId);

          if (!expense || expense.ownerId !== ownerId || expense.storeId !== storeId) {
            return Promise.reject(
              new FirestoreDataNotFoundError("Expense not found", "/database/expense-not-found"),
            );
          }

          const updatedExpense = {
            ...expense,
            ...patch,
            updatedAt: Date.now(),
          };
          state.expenses.set(expenseId, updatedExpense);

          return Promise.resolve(clone(updatedExpense));
        },
        deleteShopExpense: (ownerId: string, storeId: string, expenseId: string) => {
          const expense = state.expenses.get(expenseId);

          if (!expense || expense.ownerId !== ownerId || expense.storeId !== storeId) {
            return Promise.reject(
              new FirestoreDataNotFoundError("Expense not found", "/database/expense-not-found"),
            );
          }

          state.expenses.delete(expenseId);
          return Promise.resolve(clone(expense));
        },
      },
      attendance: {
        createShopAttendance: (
          ownerId: string,
          input: Omit<
            ShopAttendanceType,
            "id" | "ownerId" | "createdAt" | "updatedAt"
          >,
        ) => {
          const attendanceId = `attendance-created-${++state.nextIds.attendance}`;
          const createdAttendance: ShopAttendanceType = {
            id: attendanceId,
            ownerId,
            ...input,
            attendanceCode: input.attendanceCode ?? `CC-${state.nextIds.attendance}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          state.attendances.set(attendanceId, createdAttendance);
          return Promise.resolve(clone(createdAttendance));
        },
        getShopAttendance: (ownerId: string, storeId: string, attendanceId: string) => {
          const attendance = getAttendanceOrThrow(attendanceId);

          if (attendance.ownerId !== ownerId || attendance.storeId !== storeId) {
            return Promise.reject(new FirestoreDataNotFoundError());
          }

          return Promise.resolve(clone(attendance));
        },
        updateShopAttendance: (
          ownerId: string,
          storeId: string,
          attendanceId: string,
          patch: Partial<ShopAttendanceType>,
          _existingAttendance?: ShopAttendanceType,
          options: { deleteFields?: readonly (keyof ShopAttendanceType)[] } = {},
        ) => {
          const attendance = getAttendanceOrThrow(attendanceId);

          if (attendance.ownerId !== ownerId || attendance.storeId !== storeId) {
            return Promise.reject(new Error("Attendance not found"));
          }

          const updatedAttendance: ShopAttendanceType = {
            ...attendance,
            ...patch,
            updatedAt: Date.now(),
          };
          for (const field of options.deleteFields ?? []) {
            delete updatedAttendance[field];
          }
          state.attendances.set(attendanceId, updatedAttendance);
          return Promise.resolve();
        },
        deleteShopAttendance: (ownerId: string, storeId: string, attendanceId: string) => {
          const attendance = getAttendanceOrThrow(attendanceId);

          if (attendance.ownerId !== ownerId || attendance.storeId !== storeId) {
            return Promise.reject(new Error("Attendance not found"));
          }

          state.attendances.delete(attendanceId);
          return Promise.resolve();
        },
        listShopAttendanceByStoreWorkDateKey: (
          ownerId: string,
          storeId: string,
          workDate: string,
        ) =>
          Promise.resolve(
            Array.from(state.attendances.values())
              .filter(
                (attendance) =>
                  attendance.ownerId === ownerId &&
                  attendance.storeId === storeId &&
                  attendance.workDate === workDate,
              )
              .map(clone),
          ),
        listShopAttendanceByWorkDateRange: (ownerId: string, startDate: string, endDate: string) =>
          Promise.resolve(
            Array.from(state.attendances.values())
              .filter(
                (attendance) =>
                  attendance.ownerId === ownerId &&
                  attendance.workDate >= startDate &&
                  attendance.workDate <= endDate,
              )
              .map(clone),
          ),
        listShopAttendanceByStoreDateRange: (
          ownerId: string,
          storeId: string,
          fromWorkDate: string,
          toWorkDate: string,
        ) =>
          Promise.resolve(
            Array.from(state.attendances.values())
              .filter(
                (attendance) =>
                  attendance.ownerId === ownerId &&
                  attendance.storeId === storeId &&
                  attendance.workDate >= fromWorkDate &&
                  attendance.workDate <= toWorkDate,
              )
              .map(clone),
          ),
        listShopAttendanceCalendarByStoreDateRange: (
          ownerId: string,
          storeId: string,
          fromWorkDate: string,
          toWorkDate: string,
        ) =>
          Promise.resolve(
            Array.from(state.attendances.values())
              .filter(
                (attendance) =>
                  attendance.ownerId === ownerId &&
                  attendance.storeId === storeId &&
                  attendance.workDate >= fromWorkDate &&
                  attendance.workDate <= toWorkDate,
              )
              .map(clone),
          ),
        listShopAttendanceByEmployeeDateRange: (
          ownerId: string,
          storeId: string,
          employeeUserId: string,
          fromWorkDate: string,
          toWorkDate: string,
        ) =>
          Promise.resolve(
            Array.from(state.attendances.values())
              .filter(
                (attendance) =>
                  attendance.ownerId === ownerId &&
                  attendance.storeId === storeId &&
                  attendance.workDate >= fromWorkDate &&
                  attendance.workDate <= toWorkDate &&
                  ((attendance.assigneeUserIds ?? []).includes(employeeUserId) ||
                    attendance.assignees.some(
                      (assignee) => assignee.employeeUserId === employeeUserId,
                    )),
              )
              .sort((left, right) =>
                left.workDate === right.workDate
                  ? left.startTime - right.startTime
                  : left.workDate.localeCompare(right.workDate),
              )
              .map(clone),
          ),
        listShopAttendanceSummaryByStoreDateRange: (
          ownerId: string,
          storeId: string,
          fromWorkDate: string,
          toWorkDate: string,
        ) =>
          Promise.resolve(
            Array.from(state.attendances.values())
              .filter(
                (attendance) =>
                  attendance.ownerId === ownerId &&
                  attendance.storeId === storeId &&
                  attendance.workDate >= fromWorkDate &&
                  attendance.workDate <= toWorkDate,
              )
              .map(clone),
          ),
        listShopAttendanceCancellationsByStoreDateRange: (
          ownerId: string,
          storeId: string,
          fromWorkDate: string,
          toWorkDate: string,
        ) => {
          const cancelledCountsByWorkDate = new Map<string, number>();

          for (const attendance of state.attendances.values()) {
            if (
              attendance.ownerId !== ownerId ||
              attendance.storeId !== storeId ||
              attendance.workDate < fromWorkDate ||
              attendance.workDate > toWorkDate ||
              attendance.bookingStatus !== "cancelled"
            ) {
              continue;
            }

            const currentCancelledCount = cancelledCountsByWorkDate.get(attendance.workDate) ?? 0;
            cancelledCountsByWorkDate.set(attendance.workDate, currentCancelledCount + 1);
          }

          return Promise.resolve(
            Array.from(cancelledCountsByWorkDate, ([workDate, cancelledCount]) => ({
              workDate,
              cancelledCount,
            })),
          );
        },
      },
      timeTracking: {
        getEmployeeTimeTracking: (
          ownerId: string,
          storeId: string,
          employeeUserId: string,
          workDate: string,
        ) =>
          Promise.resolve(
            clone(
              Array.from(state.employeeTimeTracking.values()).find(
                (session) =>
                  session.ownerId === ownerId &&
                  session.storeId === storeId &&
                  session.employeeUserId === employeeUserId &&
                  session.workDate === workDate,
              ) ?? null,
            ),
          ),
        listOpenEmployeeTimeTracking: (
          ownerId: string,
          storeId: string,
          employeeUserId: string,
          beforeWorkDate?: string,
        ) =>
          Promise.resolve(
            Array.from(state.employeeTimeTracking.values())
              .filter(
                (session) =>
                  session.ownerId === ownerId &&
                  session.storeId === storeId &&
                  session.employeeUserId === employeeUserId &&
                  session.status === "working" &&
                  (beforeWorkDate === undefined || session.workDate < beforeWorkDate),
              )
              .sort((left, right) => right.workDate.localeCompare(left.workDate))
              .map(clone),
          ),
        upsertEmployeeTimeTracking: async (
          ownerId: string,
          data: Omit<ShopEmployeeTimeTrackingType, "id" | "ownerId" | "createdAt" | "updatedAt">,
          options: { onCommitted?: EmployeeTimeTrackingCommitObserver } = {},
        ) => {
          const id = `${data.employeeUserId}__${data.workDate}`;
          const existing = state.employeeTimeTracking.get(id);
          const timestamp = Date.now();
          const session: ShopEmployeeTimeTrackingType = {
            id,
            ownerId,
            ...data,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          const action = session.status === "working" ? "check_in" : "check_out";
          const persistAction = existing === undefined ? "create" : "update";
          const statusBefore = existing?.status ?? "missing";

          await withEmployeeTimeTrackingSpan(
            EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.sessionPersist,
            {
              "app.store_id": session.storeId,
              "time_tracking.action": action,
              "time_tracking.work_date": session.workDate,
              "time_tracking.status.before": statusBefore,
              "time_tracking.status.after": session.status,
              "time_tracking.persist_action": persistAction,
            },
            async () => {
              state.employeeTimeTracking.set(id, session);
            },
          );
          notifyEmployeeTimeTrackingCommit(options.onCommitted, {
            action,
            persistAction,
            statusBefore,
            statusAfter: session.status,
            storeId: session.storeId,
            workDate: session.workDate,
          });
          await withEmployeeTimeTrackingSpan(
            EMPLOYEE_TIME_TRACKING_TRACE_CHILD_SPANS.cacheInvalidate,
            {
              "app.store_id": session.storeId,
              "time_tracking.work_date": session.workDate,
              "time_tracking.post_write_phase": "cache_invalidation",
              "cache.group_count": 2,
            },
            async () => undefined,
          );
          return clone(session);
        },
      },
      customer: {
        createShopCustomer: (
          ownerId: string,
          input: { storeId: string; phone?: string; name?: string },
        ) => {
          const phone = normalizeCustomerPhone(input.phone);
          const normalizedName = normalizeCustomerName(input.name);
          if (!phone && !normalizedName) return Promise.resolve(undefined);
          const existing = Array.from(state.customers.values()).find(
            (customer) =>
              customer.storeId === input.storeId &&
              ((phone !== undefined && customer.phone === phone) ||
                (normalizedName !== undefined &&
                  normalizeCustomerName(customer.name) === normalizedName &&
                  canMergeCustomerByName(customer.phone, phone))),
          );
          const id =
            existing?.id ??
            (phone !== undefined
              ? getCustomerDocumentId(phone)
              : getCustomerNameDocumentId(normalizedName as string));
          const timestamp = Date.now();
          if (existing?.blocked === true) {
            return Promise.resolve(clone(existing));
          }
          const customer: ShopCustomerType = {
            id,
            ownerId,
            storeId: input.storeId,
            ...(phone !== undefined && { phone }),
            ...(input.name?.trim() && { name: input.name.trim() }),
            blocked: existing?.blocked ?? false,
            ...(existing?.blockedReason !== undefined && { blockedReason: existing.blockedReason }),
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
          };
          state.customers.set(id, customer);
          return Promise.resolve(clone(customer));
        },
        getShopCustomer: (ownerId: string, storeId: string, customerId: string) => {
          const customer = state.customers.get(customerId);
          if (!customer || customer.ownerId !== ownerId || customer.storeId !== storeId) {
            return Promise.reject(new FirestoreDataNotFoundError());
          }
          return Promise.resolve(clone(customer));
        },
        listShopCustomers: (ownerId: string, storeId: string, options: { limit: number }) => {
          const customers = Array.from(state.customers.values())
            .filter((customer) => customer.ownerId === ownerId && customer.storeId === storeId)
            .sort((left, right) => right.createdAt - left.createdAt)
            .slice(0, options.limit)
            .map(clone);
          return Promise.resolve({ customers, nextCursor: null, hasMore: false });
        },
        listShopCustomerAttendances: (
          ownerId: string,
          storeId: string,
          customerId: string,
          options: { limit: number },
        ) => {
          const attendances = Array.from(state.attendances.values())
            .filter(
              (attendance) =>
                attendance.ownerId === ownerId &&
                attendance.storeId === storeId &&
                attendance.customerId === customerId,
            )
            .slice(0, options.limit)
            .map((attendance) => ({
              id: attendance.id,
              ...(attendance.attendanceCode !== undefined && {
                attendanceCode: attendance.attendanceCode,
              }),
              workDate: attendance.workDate,
              startTime: attendance.startTime,
              endTime: attendance.endTime,
              status: attendance.status,
              bookingStatus: attendance.bookingStatus,
              services: attendance.services.map((service) => ({
                id: service.id,
                name: service.name,
              })),
            }));
          return Promise.resolve({ attendances, nextCursor: null, hasMore: false });
        },
        getShopCustomerAttendanceSummary: (
          ownerId: string,
          storeId: string,
          customerId: string,
        ) => {
          const attendances = Array.from(state.attendances.values()).filter(
            (attendance) =>
              attendance.ownerId === ownerId &&
              attendance.storeId === storeId &&
              attendance.customerId === customerId,
          );
          const count = (status: string) =>
            attendances.filter((attendance) => attendance.bookingStatus === status).length;
          const requestedAppointments = count("requested");
          const processingAppointments = count("processing");
          const cancelledAppointments = count("cancelled");
          const noShowAppointments = count("no_show");
          const confirmedAppointments = Math.max(
            attendances.length -
              requestedAppointments -
              processingAppointments -
              cancelledAppointments -
              noShowAppointments,
            0,
          );
          return Promise.resolve({
            totalAppointments: attendances.length,
            requestedAppointments,
            confirmedAppointments,
            processingAppointments,
            cancelledAppointments,
            noShowAppointments,
            total: attendances.length,
            pending_approval: requestedAppointments + processingAppointments,
            confirmed: confirmedAppointments,
            completed: attendances.filter((attendance) => attendance.status === "closed").length,
            cancelled: cancelledAppointments,
            no_show: noShowAppointments,
          });
        },
        blockShopCustomer: (
          ownerId: string,
          storeId: string,
          customerId: string,
          input: { reason: string; userId: string; role: "owner" | "manager" },
        ) => {
          const customer = state.customers.get(customerId);
          if (!customer || customer.ownerId !== ownerId || customer.storeId !== storeId) {
            return Promise.reject(new FirestoreDataNotFoundError());
          }
          const updated = {
            ...customer,
            blocked: true,
            blockedReason: input.reason,
            blockedByUserId: input.userId,
            blockedByRole: input.role,
            blockedAt: Date.now(),
            updatedAt: Date.now(),
          };
          state.customers.set(customerId, updated);
          return Promise.resolve(clone(updated));
        },
        unblockShopCustomer: (
          ownerId: string,
          storeId: string,
          customerId: string,
          input: { userId: string; role: "owner" | "manager" },
        ) => {
          const customer = state.customers.get(customerId);
          if (!customer || customer.ownerId !== ownerId || customer.storeId !== storeId) {
            return Promise.reject(new FirestoreDataNotFoundError());
          }
          const updated = {
            ...customer,
            blocked: false,
            unblockedByUserId: input.userId,
            unblockedByRole: input.role,
            unblockedAt: Date.now(),
            updatedAt: Date.now(),
          };
          state.customers.set(customerId, updated);
          return Promise.resolve(clone(updated));
        },
      },
      audit: {
        createShopAuditLog: (
          ownerId: string,
          input: Omit<ShopAuditLogType, "id" | "ownerId" | "createdAt">,
        ) => {
          const auditId = `audit-${++state.nextIds.audit}`;
          state.auditLogs.push({
            id: auditId,
            ownerId,
            ...input,
            createdAt: Date.now(),
          });
          return Promise.resolve(auditId);
        },
        listShopAuditLogs: (ownerId: string, limit: number) =>
          Promise.resolve(
            state.auditLogs
              .filter((auditLog) => auditLog.ownerId === ownerId)
              .sort((left, right) => right.createdAt - left.createdAt)
              .slice(0, limit)
              .map(clone),
          ),
      },
      weeklyReport: {
        createWeeklyReport: (
          ownerId: string,
          input: Omit<WeeklyReportType, "id" | "ownerId" | "createdAt" | "updatedAt">,
        ) => {
          const reportId = `${input.storeId}__${input.weekStartDate}`;
          const timestamp = Date.now();
          state.weeklyReports.set(reportId, {
            id: reportId,
            ownerId,
            ...input,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          return Promise.resolve(reportId);
        },
        getWeeklyReport: (ownerId: string, storeId: string, weekStartDate: string) =>
          Promise.resolve(
            clone(
              Array.from(state.weeklyReports.values()).find(
                (report) =>
                  report.ownerId === ownerId &&
                  report.storeId === storeId &&
                  report.weekStartDate === weekStartDate,
              ) ?? null,
            ),
          ),
        listWeeklyReports: (ownerId: string, storeId: string, fromWeek: string, toWeek: string) =>
          Promise.resolve(
            Array.from(state.weeklyReports.values())
              .filter(
                (report) =>
                  report.ownerId === ownerId &&
                  report.storeId === storeId &&
                  report.weekStartDate >= fromWeek &&
                  report.weekStartDate <= toWeek,
              )
              .sort((left, right) => left.weekStartDate.localeCompare(right.weekStartDate))
              .map(clone),
          ),
      },
      employeeLeave: {
        createEmployeeLeaveRequest: (
          ownerId: string,
          data: Omit<ShopEmployeeLeaveRequestType, "id" | "ownerId" | "createdAt" | "updatedAt">,
        ) => {
          state.nextIds.leave += 1;
          const timestamp = Date.now();
          const leaveRequest: ShopEmployeeLeaveRequestType = {
            id: `leave-${state.nextIds.leave}`,
            ownerId,
            ...data,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          state.leaveRequests.set(leaveRequest.id, leaveRequest);
          return Promise.resolve(clone(leaveRequest));
        },
        listEmployeeLeaveRequests: (
          ownerId: string,
          filters: {
            storeId: string;
            employeeUserId: string;
            limit: number;
            beforeCreatedAt?: number;
          },
        ) =>
          Promise.resolve(
            Array.from(state.leaveRequests.values())
              .filter(
                (leaveRequest) =>
                  leaveRequest.ownerId === ownerId &&
                  leaveRequest.storeId === filters.storeId &&
                  leaveRequest.employeeUserId === filters.employeeUserId &&
                  (filters.beforeCreatedAt === undefined ||
                    leaveRequest.createdAt < filters.beforeCreatedAt),
              )
              .sort((left, right) => right.createdAt - left.createdAt)
              .slice(0, filters.limit)
              .map(clone),
          ),
        deleteEmployeeLeaveRequest: (
          ownerId: string,
          filters: { storeId: string; employeeUserId: string; leaveRequestId: string },
        ) => {
          const leaveRequest = state.leaveRequests.get(filters.leaveRequestId);

          if (
            !leaveRequest ||
            leaveRequest.ownerId !== ownerId ||
            leaveRequest.storeId !== filters.storeId ||
            leaveRequest.employeeUserId !== filters.employeeUserId
          ) {
            return Promise.reject(new FirestoreDataNotFoundError());
          }

          state.leaveRequests.delete(filters.leaveRequestId);
          return Promise.resolve(clone(leaveRequest));
        },
      },
    },
  },
}));

vi.mock("../../src/business/billing/paypal-client.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/business/billing/paypal-client.js")
  >("../../src/business/billing/paypal-client.js");

  return {
    ...actual,
    paypalClient: paypalClientMocks,
  };
});

export let app: Express;
let nextIpOctet = 1;

beforeAll(async () => {
  const appModule = await import("../../src/app.js");
  app = appModule.default;
});

beforeEach(async () => {
  resetState();
  await cacheDeleteByPrefix("ratelimit:");
  await cacheDeleteByPrefix("idempotency:");
  await cacheDeleteByPrefix("auth:");
  await cacheDeleteByPrefix("shop:");
  await cacheDeleteByPrefix("store:");
  await cacheDeleteByPrefix("employee:");
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const slugifyServiceGroupName = (name: string, fallback: ShopServiceType["category"]) => {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || fallback;
};

const resolveServiceCategoryId = (name: string, category: ShopServiceType["category"]) =>
  `category_${slugifyServiceGroupName(name, category)}`;

export const getTestTodayWorkDate = () => {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = dateParts.find((part) => part.type === "year")?.value ?? "1970";
  const month = dateParts.find((part) => part.type === "month")?.value ?? "01";
  const day = dateParts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
};

export const getTestCurrentMinutes = () => {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(dateParts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(dateParts.find((part) => part.type === "minute")?.value ?? 0);

  return hour * 60 + minute;
};

const findUserByEmail = (email: string) =>
  Array.from(state.users.values()).find(
    (user) => user.email.toLowerCase() === email.trim().toLowerCase(),
  );

const findFirebaseUserByEmail = (email: string) =>
  Array.from(state.firebaseUsers.values()).find(
    (user) => user.email.toLowerCase() === email.trim().toLowerCase(),
  );

const toSigninUserRecord = (user: NonNullable<ReturnType<typeof findUserByEmail>>) =>
  clone({
    uid: user.uid,
    email: user.email,
    ownerId: user.ownerId,
    role: user.role,
    active: user.active,
    ...(user.storeId !== undefined && { storeId: user.storeId }),
    ...(user.name !== undefined && { name: user.name }),
    ...(user.displayName !== undefined && { displayName: user.displayName }),
    ...(user.lastLoginAt !== undefined && { lastLoginAt: user.lastLoginAt }),
  });

export const getUserOrThrow = (uid: string) => {
  const user = state.users.get(uid);

  if (!user) {
    throw new Error(`Missing test user ${uid}`);
  }

  return user;
};

const getFirebaseUserOrThrow = (uid: string) => {
  const user = state.firebaseUsers.get(uid);

  if (!user) {
    throw new Error(`Missing Firebase test user ${uid}`);
  }

  return user;
};

const getStoreOrThrow = (storeId: string) => {
  const branch =
    state.stores.get(storeId) ??
    Array.from(state.stores.values()).find((candidate) => candidate.code === storeId);

  if (!branch) {
    throw new Error(`Missing test branch ${storeId}`);
  }

  return branch;
};

export const getServiceOrThrow = (serviceId: string) => {
  const service = state.services.get(serviceId);

  if (!service) {
    throw new Error(`Missing test service ${serviceId}`);
  }

  return service;
};

export const getAttendanceOrThrow = (attendanceId: string) => {
  const attendance = state.attendances.get(attendanceId);

  if (!attendance) {
    throw new Error(`Missing test attendance ${attendanceId}`);
  }

  return attendance;
};

const toFirebaseUserResponse = (user: FirebaseUserRecord) => ({
  uid: user.uid,
  email: user.email,
  displayName: user.displayName,
  photoURL: user.photoURL,
  disabled: user.disabled ?? false,
});

export const firebaseHeader = (token: string) => `Bearer ${token}`;

export const firebaseSigninBody = (token: string) => {
  return { idToken: token };
};

export const ownerSessionHeader = (
  overrides: Partial<{
    uid: string;
    role: UserType["role"];
    ownerId: string;
    storeId: string;
    sessionId: string;
  }> = {},
) => {
  const uid = overrides.uid ?? "owner-1";
  const payload: Record<string, unknown> = {
    user_id: uid,
    sub: uid,
    role: overrides.role ?? "owner",
    ownerId: overrides.ownerId ?? "shop-1",
  };

  if (overrides.storeId !== undefined) {
    payload["storeId"] = overrides.storeId;
  }

  // Firebase-only: token gửi lên là Firebase ID token (custom claims). Chữ ký không quan trọng —
  // mock verifyIdToken decode payload không verify. Sign bằng secret bất kỳ cho ra JWT hợp lệ dạng.
  return `Bearer ${jwt.sign(payload, "test-firebase-id-token")}`;
};

export const withRequestDefaults = (testRequest: Test) => {
  nextIpOctet += 1;
  return testRequest.set("X-Forwarded-For", `203.0.113.${nextIpOctet}`);
};

export const withRequestIp = (testRequest: Test, ipAddress: string) => {
  return testRequest.set("X-Forwarded-For", ipAddress);
};

const resetState = () => {
  state.users.clear();
  state.billingAccounts.clear();
  state.firebaseUsers.clear();
  state.firebaseTokens.clear();
  state.stores.clear();
  state.serviceCategories.clear();
  state.services.clear();
  state.expenses.clear();
  state.attendances.clear();
  state.employeeWorkDayClosings.clear();
  state.employeeTimeTracking.clear();
  state.closings.clear();
  state.workDaySettlements.clear();
  state.weeklyReports.clear();
  state.customers.clear();
  state.bookings.clear();
  state.slotReservations.clear();
  state.auditLogs = [];
  state.storageUploads = [];
  state.storeReadCount = 0;
  delete state.lastOtpCode;
  state.nextIds = {
    user: 0,
    shop: 0,
    branch: 0,
    service: 0,
    expense: 0,
    attendance: 0,
    closing: 0,
    weeklyReport: 0,
    audit: 0,
  };

  const now = Date.now();
  const branchOne: StoreType = {
    id: "branch-1",
    ownerId: "shop-1",
    name: "District 1",
    phone: "0901000000",
    manager: "Nguyen Van A",
    settlementCutoffTime: "23:00",
    address: {
      line1: "123 Main",
      city: "District 1",
      state: "HCMC",
      zipCode: "700000",
      country: "Vietnam",
    },
    status: "active",
    employeeCount: 2,
    activeEmployeeCount: 2,
    inactiveEmployeeCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const branchTwo: StoreType = {
    id: "branch-2",
    ownerId: "shop-1",
    name: "District 2",
    settlementCutoffTime: "23:00",
    status: "active",
    employeeCount: 1,
    activeEmployeeCount: 1,
    inactiveEmployeeCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const service: ShopServiceType = {
    id: "service-1",
    ownerId: "shop-1",
    storeId: "branch-1",
    type: "predefined",
    name: "Classic Manicure",
    description: "Classic nail service",
    category: "nail",
    price: 50,
    durationMin: 45,
    durationMax: 60,
    imageUrls: ["https://cdn.test/service.png"],
    createdAt: now,
    updatedAt: now,
  };
  const branchTwoService: ShopServiceType = {
    ...service,
    id: "service-2",
    storeId: "branch-2",
    name: "Classic Pedicure",
    category: "pedicure",
  };
  const attendance: ShopAttendanceType = {
    id: "attendance-1",
    ownerId: "shop-1",
    employeeUserId: "staff-1",
    storeId: "branch-1",
    storeName: "District 1",
    storeWorkDateKey: "branch-1__2026-05-05",
    workDate: "2026-05-05",
    startTime: 540,
    endTime: 600,
    customerName: "Seed Customer",
    assignees: [
      {
        employeeUserId: "staff-1",
        employeeName: "Staff One",
        percentage: 50,
        shareAmount: 25,
      },
      {
        employeeUserId: "staff-lead-1",
        employeeName: "Lead One",
        percentage: 50,
        shareAmount: 25,
      },
    ],
    services: [
      {
        ...service,
        employees: [
          {
            employeeUserId: "staff-1",
            employeeName: "Staff One",
            percentage: 50,
            shareAmount: 25,
          },
          {
            employeeUserId: "staff-lead-1",
            employeeName: "Lead One",
            percentage: 50,
            shareAmount: 25,
          },
        ],
      },
    ],
    subtotalAmount: 50,
    totalAmount: 50,
    status: "open",
    createdAt: now,
    updatedAt: now,
    createdBy: "staff-lead-1",
    updatedBy: "staff-lead-1",
  };
  const otherAttendance: ShopAttendanceType = {
    ...attendance,
    id: "attendance-2",
    employeeUserId: "staff-2",
    storeId: "branch-2",
    storeName: "District 2",
    storeWorkDateKey: "branch-2__2026-05-05",
    assignees: [
      {
        employeeUserId: "staff-2",
        employeeName: "Staff Two",
        percentage: 100,
        shareAmount: 50,
      },
    ],
    services: [
      {
        ...branchTwoService,
        employees: [
          {
            employeeUserId: "staff-2",
            employeeName: "Staff Two",
            percentage: 100,
            shareAmount: 50,
          },
        ],
      },
    ],
  };

  state.stores.set(branchOne.id, branchOne);
  state.stores.set(branchTwo.id, branchTwo);
  state.services.set(service.id, service);
  state.services.set(branchTwoService.id, branchTwoService);
  state.attendances.set(attendance.id, attendance);
  state.attendances.set(otherAttendance.id, otherAttendance);
  seedUser({
    uid: "admin-1",
    email: "admin@example.com",
    ownerId: "",
    role: "admin",
    active: true,
    name: "Platform Admin",
  });
  seedUser(
    {
      uid: "owner-1",
      email: "owner@example.com",
      ownerId: "shop-1",
      role: "owner",
      active: true,
      name: "Owner One",
      displayName: "Owner One",
    },
    {
      photoURL: "https://cdn.test/owner-profile.png",
    },
  );
  seedUser({
    uid: "disabled-owner",
    email: "disabled.owner@example.com",
    ownerId: "shop-1",
    role: "owner",
    active: false,
    name: "Disabled Owner",
  });
  seedUser({
    uid: "staff-lead-1",
    email: "lead@example.com",
    ownerId: "shop-1",
    role: "employee",
    active: true,
    storeId: "branch-1",
    name: "Lead One",
    employeeStatus: "active",
    compensationModel: "commission",
    ownerCommissionRate: 70,
  });
  seedUser({
    uid: "unscoped-staff",
    email: "unscoped.staff@example.com",
    ownerId: "shop-1",
    role: "employee",
    active: true,
    name: "Unscoped Staff",
  });
  seedUser({
    uid: "staff-1",
    email: "staff@example.com",
    ownerId: "shop-1",
    role: "employee",
    active: true,
    storeId: "branch-1",
    name: "Staff One",
    employeeStatus: "active",
    compensationModel: "commission",
    ownerCommissionRate: 60,
  });
  seedUser({
    uid: "staff-2",
    email: "staff.two@example.com",
    ownerId: "shop-1",
    role: "employee",
    active: true,
    storeId: "branch-2",
    name: "Staff Two",
    employeeStatus: "active",
    compensationModel: "commission",
    ownerCommissionRate: 60,
  });

  const authTime = Math.floor(Date.now() / 1000);
  state.firebaseTokens.set("firebase-admin", { uid: "admin-1", authTime });
  state.firebaseTokens.set("firebase-owner", { uid: "owner-1", authTime });
  state.firebaseTokens.set("firebase-owner-stale", {
    uid: "owner-1",
    authTime: authTime - 3600,
  });
  state.firebaseTokens.set("firebase-disabled-owner", { uid: "disabled-owner", authTime });
  state.firebaseTokens.set("firebase-unscoped-staff", { uid: "unscoped-staff", authTime });
};

const seedUser = (user: UserType, firebaseOverrides: Partial<FirebaseUserRecord> = {}) => {
  state.users.set(user.uid, user);
  const displayName = user.displayName ?? user.name;
  state.firebaseUsers.set(user.uid, {
    uid: user.uid,
    email: user.email,
    ...(displayName !== undefined && { displayName }),
    disabled: !user.active,
    password: "initial-password",
    ...firebaseOverrides,
  });
};
