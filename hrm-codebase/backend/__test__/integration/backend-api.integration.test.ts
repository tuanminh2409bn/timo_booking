import jwt from "jsonwebtoken";
import request, { Test } from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Express } from "express";
import {
  ShopAttendanceType,
  ShopAuditLogType,
  StoreType,
  ShopServiceType,
  ShopClosedWorkDaySettlementType,
} from "../../src/repository/firestore/shop/shop.types.js";
import { cacheDeleteByPrefix } from "../../src/repository/cache/cache-client.js";
import { FirestoreDataNotFoundError } from "../../src/constants/firestore-error.js";
import { UserType } from "../../src/repository/firestore/user/user.types.js";

process.env["NODE_ENV"] = "test";
process.env["JWT_SECRET"] = "test-jwt-secret";
process.env["AUTH_JWT_ISSUER"] = "nail-api";
process.env["AUTH_JWT_AUDIENCE"] = "nail-web";
process.env["SERVICE_PORT"] = "8080";
process.env["TRUST_PROXY_HOPS"] = "1";

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
  firebaseUsers: Map<string, FirebaseUserRecord>;
  firebaseTokens: Map<string, FirebaseTokenRecord>;
  stores: Map<string, StoreType>;
  services: Map<string, ShopServiceType>;
  attendances: Map<string, ShopAttendanceType>;
  closings: Map<string, ShopClosedWorkDaySettlementType>;
  auditLogs: ShopAuditLogType[];
  storageUploads: Array<Record<string, unknown>>;
  lastOtpCode?: string;
  nextIds: {
    user: number;
    shop: number;
    branch: number;
    service: number;
    attendance: number;
    closing: number;
    audit: number;
  };
};

const state = vi.hoisted<TestState>(() => ({
  users: new Map(),
  firebaseUsers: new Map(),
  firebaseTokens: new Map(),
  stores: new Map(),
  services: new Map(),
  attendances: new Map(),
  closings: new Map(),
  auditLogs: [],
  storageUploads: [],
  nextIds: {
    user: 0,
    shop: 0,
    branch: 0,
    service: 0,
    attendance: 0,
    closing: 0,
    audit: 0,
  },
}));

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

        // Token do ownerSessionHeader mint: JWT mang sẵn custom claims (mô phỏng Firebase idToken).
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
  },
}));

vi.mock("../../src/repository/firestore/index.js", () => ({
  firestoreRepository: {
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

        return Promise.resolve(
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
          }),
        );
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
            .filter((user) => user.ownerId === ownerId && user.active && user.role === "employee")
            .map(clone),
        ),
      listShopEmployees: (ownerId: string, options: { storeId?: string; active?: boolean } = {}) =>
        Promise.resolve(
          Array.from(state.users.values())
            .filter(
              (user) =>
                user.ownerId === ownerId &&
                user.role === "employee" &&
                (options.storeId === undefined || user.storeId === options.storeId) &&
                (options.active === undefined || user.active === options.active),
            )
            .map(clone),
        ),
      updateUser: (uid: string, patch: Partial<UserType>) => {
        const existingUser = getUserOrThrow(uid);
        state.users.set(uid, {
          ...existingUser,
          ...patch,
        });
        return Promise.resolve();
      },
    },
    shop: {
      session: {
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
        closeWorkDay: (
          ownerId: string,
          input: Omit<ShopClosedWorkDaySettlementType, "id" | "ownerId" | "createdAt" | "updatedAt">,
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
          const branch = getStoreOrThrow(storeId);

          if (branch.ownerId !== ownerId) {
            return Promise.reject(new Error("Store not found"));
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
        listShopExpenses: () => Promise.resolve([]),
      },
      attendance: {
        createShopAttendance: (
          ownerId: string,
          input: Omit<ShopAttendanceType, "id" | "ownerId" | "createdAt" | "updatedAt">,
        ) => {
          const attendanceId = `attendance-created-${++state.nextIds.attendance}`;
          const createdAttendance: ShopAttendanceType = {
            id: attendanceId,
            ownerId,
            ...input,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          state.attendances.set(attendanceId, createdAttendance);
          return Promise.resolve(clone(createdAttendance));
        },
        getShopAttendance: (ownerId: string, storeId: string, attendanceId: string) => {
          const attendance = getAttendanceOrThrow(attendanceId);

          if (attendance.ownerId !== ownerId || attendance.storeId !== storeId) {
            return Promise.reject(new Error("Attendance not found"));
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
    },
  },
}));

let app: Express;
let nextIpOctet = 1;

beforeAll(async () => {
  const appModule = await import("../../src/app.js");
  app = appModule.default;
});

beforeEach(async () => {
  resetState();
  await cacheDeleteByPrefix("ratelimit:");
  await cacheDeleteByPrefix("auth:");
  await cacheDeleteByPrefix("shop:");
  await cacheDeleteByPrefix("store:");
});

describe("backend API integration surface", () => {
  it("serves health-style root responses and common HTTP guards", async () => {
    const rootResponse = await withRequestDefaults(request(app).get("/"));

    expect(rootResponse.status).toBe(200);
    expect(rootResponse.text).toContain("Nail Salon Management System");
    expect(rootResponse.headers["x-request-id"]).toEqual(expect.any(String));

    const notFoundResponse = await withRequestDefaults(request(app).get("/missing-route"));
    expect(notFoundResponse.status).toBe(404);
    expect(notFoundResponse.body).toEqual({
      type: "/request/not-found",
      message: "Route not found",
    });

    const unsupportedMediaResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/signin").set("Content-Type", "text/plain").send("not-json"),
    );
    expect(unsupportedMediaResponse.status).toBe(415);
    expect(unsupportedMediaResponse.body.type).toBe("/request/unsupported-media-type");

    const missingAuthResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/profile"),
    );
    expect(missingAuthResponse.status).toBe(401);

    const malformedAuthResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/profile").set("Authorization", "Basic abc"),
    );
    expect(malformedAuthResponse.status).toBe(401);

    const missingCredentialsResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/signin").set("Authorization", "Bearer"),
    );
    expect(missingCredentialsResponse.status).toBe(400);
    expect(missingCredentialsResponse.body.type).toBe("/auth/signin/invalid-request");
  });

  it("signs in, updates account profile, persists avatar, and logs out", async () => {
    const signinResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/signin").send(firebaseSigninBody("firebase-owner")),
    );

    expect(signinResponse.status).toBe(201);
    expect(signinResponse.body.user).toMatchObject({
      uid: "owner-1",
      role: "owner",
      ownerId: "owner-1",
    });
    expect(signinResponse.body.user).not.toHaveProperty("avatarUrl");
    expect(signinResponse.body).toEqual({
      user: expect.objectContaining({
        uid: "owner-1",
        role: "owner",
        ownerId: "owner-1",
      }),
    });

    // Firebase-only: client dùng thẳng Firebase ID token cho request sau (không có JWT app).
    const authHeader = ownerSessionHeader();
    const profileResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/profile").set("Authorization", authHeader),
    );
    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body.user.displayName).toBe("Owner One");

    const patchResponse = await withRequestDefaults(
      request(app).patch("/api/v1/account/profile").set("Authorization", authHeader).send({
        displayName: "Updated Owner",
        phone: "0909000000",
      }),
    );
    expect(patchResponse.status).toBe(200);
    expect(patchResponse.body.user).toMatchObject({
      displayName: "Updated Owner",
      phone: "0909000000",
    });
    expect(patchResponse.body.user).not.toHaveProperty("avatarUrl");

    const invalidPatchResponse = await withRequestDefaults(
      request(app).patch("/api/v1/account/profile").set("Authorization", authHeader).send({}),
    );
    expect(invalidPatchResponse.status).toBe(400);

    const logoutResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/logout").set("Authorization", authHeader),
    );
    expect(logoutResponse.status).toBe(200);

    // Firebase-only: logout không thu hồi phiên server (idToken tự hết hạn ≤1h) → token vẫn dùng được.
    const afterLogoutProfileResponse = await withRequestDefaults(
      request(app).get("/api/v1/account/profile").set("Authorization", authHeader),
    );
    expect(afterLogoutProfileResponse.status).toBe(200);
  });

  it("enforces role, activity, branch, and recent-auth checks for auth routes", async () => {
    const adminAsUserResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/signin").send(firebaseSigninBody("firebase-admin")),
    );
    expect(adminAsUserResponse.status).toBe(403);
    expect(adminAsUserResponse.body.type).toBe("/auth/signin/forbidden-role");

    const disabledSigninResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/signin").send(firebaseSigninBody("firebase-disabled-owner")),
    );
    expect(disabledSigninResponse.status).toBe(403);
    expect(disabledSigninResponse.body.type).toBe("/auth/signin/user-disabled");

    const unscopedEmployeeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/signin")
        .send(firebaseSigninBody("firebase-unscoped-employee")),
    );
    expect(unscopedEmployeeResponse.status).toBe(409);
    expect(unscopedEmployeeResponse.body.type).toBe("/auth/signin/store-not-configured");

    const adminSigninResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/signin")
        .set("Authorization", firebaseHeader("firebase-admin")),
    );
    expect(adminSigninResponse.status).toBe(201);
    expect(adminSigninResponse.body.user.role).toBe("admin");

    const ownerAdminSigninResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/signin")
        .set("Authorization", firebaseHeader("firebase-owner")),
    );
    expect(ownerAdminSigninResponse.status).toBe(403);

    const stalePasswordChangeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/change-password")
        .set("Authorization", firebaseHeader("firebase-owner-stale"))
        .send({ newPassword: "new-password-123" }),
    );
    expect(stalePasswordChangeResponse.status).toBe(401);

    const passwordChangeResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/change-password")
        .set("Authorization", firebaseHeader("firebase-owner"))
        .send({ newPassword: "new-password-123" }),
    );
    expect(passwordChangeResponse.status).toBe(200);
    expect(state.firebaseUsers.get("owner-1")?.password).toBe("new-password-123");
    expect(state.firebaseUsers.get("owner-1")?.tokensRevoked).toBe(true);
  });

  it.skip("registers owner accounts and supports forgot-password OTP reset", async () => { // PARKED customer-journey
    const invalidRegistration = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "not-an-email",
        name: "O",
        password: "123",
      }),
    );
    expect(invalidRegistration.status).toBe(400);

    const registrationResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "new.owner@example.com",
        name: "New Owner",
        password: "secret123",
      }),
    );
    expect(registrationResponse.status).toBe(201);
    expect(registrationResponse.body.uid).toMatch(/^created-user-/);

    const duplicateRegistrationResponse = await withRequestDefaults(
      request(app).post("/api/v1/auth/register-owner").send({
        email: "new.owner@example.com",
        name: "New Owner",
        password: "secret123",
      }),
    );
    expect(duplicateRegistrationResponse.status).toBe(409);

    const adminRegistrationResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/register-owner")
        .set("Authorization", ownerSessionHeader({ uid: "admin-1", role: "admin", ownerId: "" }))
        .send({
          email: "admin.created.owner@example.com",
          name: "Admin Created",
          password: "secret123",
        }),
    );
    expect(adminRegistrationResponse.status).toBe(201);

    const forbiddenAdminRegistrationResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/admin/register-owner")
        .set("Authorization", ownerSessionHeader())
        .send({
          email: "forbidden.owner@example.com",
          name: "Forbidden Owner",
          password: "secret123",
        }),
    );
    expect(forbiddenAdminRegistrationResponse.status).toBe(403);

    const invalidOtpRequest = await withRequestDefaults(
      request(app).post("/api/v1/auth/forgot-password/request-otp").send({ email: "bad" }),
    );
    expect(invalidOtpRequest.status).toBe(400);

    const otpRequest = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/request-otp")
        .send({ email: "OWNER@example.com" }),
    );
    expect(otpRequest.status).toBe(200);
    expect(otpRequest.body).toMatchObject({
      success: true,
      email: "owner@example.com",
      delivery: "debug",
    });
    expect(otpRequest.body.debugOtpCode).toEqual(expect.stringMatching(/^\d{6}$/));

    const invalidOtpVerify = await withRequestDefaults(
      request(app).post("/api/v1/auth/forgot-password/verify-otp").send({
        email: "owner@example.com",
        otp: "000000",
      }),
    );
    expect(invalidOtpVerify.status).toBe(400);

    const otpVerify = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/verify-otp")
        .send({
          email: "owner@example.com",
          otp: otpRequest.body.debugOtpCode as string,
        }),
    );
    expect(otpVerify.status).toBe(200);
    expect(otpVerify.body.resetToken).toEqual(expect.any(String));

    const resetResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/reset-password")
        .send({
          resetToken: otpVerify.body.resetToken as string,
          password: "reset-secret",
        }),
    );
    expect(resetResponse.status).toBe(200);
    expect(state.firebaseUsers.get("owner-1")?.password).toBe("reset-secret");

    const unknownEmailOtpRequest = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/request-otp")
        .send({ email: "missing@example.com" }),
    );
    expect(unknownEmailOtpRequest.status).toBe(200);
    expect(unknownEmailOtpRequest.body.debugOtpCode).toBeUndefined();

    const employeeOtpRequest = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/request-otp")
        .send({ email: "employee@example.com" }),
    );
    expect(employeeOtpRequest.status).toBe(200);

    const resetByOtpResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/auth/forgot-password/reset-password")
        .send({
          email: "employee@example.com",
          otp: employeeOtpRequest.body.debugOtpCode as string,
          password: "employee-reset-secret",
        }),
    );
    expect(resetByOtpResponse.status).toBe(200);
    expect(state.firebaseUsers.get("employee-1")?.password).toBe("employee-reset-secret");
  });

  it("manages shop stores and service catalog through authorized API routes", async () => {
    const ownerAuth = ownerSessionHeader();
    const employeeAuth = ownerSessionHeader({
      uid: "employee-1",
      role: "employee",
      storeId: "branch-1",
    });

    const branchListResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores").set("Authorization", ownerAuth),
    );
    expect(branchListResponse.status).toBe(200);
    expect(branchListResponse.body.stores).toHaveLength(2);
    expect(branchListResponse.body.stores[0]).toMatchObject({
      id: "branch-1",
      name: "District 1",
      status: "active",
      employeeCount: 2,
      addressText: "123 Main, District 1, HCMC, 700000, Vietnam",
    });
    expect(branchListResponse.body.stores[0]).not.toHaveProperty("code");
    expect(branchListResponse.body.stores[0]).not.toHaveProperty("storeId");
    expect(branchListResponse.body.stores[0]).not.toHaveProperty("storeCode");
    expect(branchListResponse.body.stores[0]).not.toHaveProperty("ownerId");
    expect(branchListResponse.body.stores[0]).not.toHaveProperty("label");
    expect(branchListResponse.body.stores[0]).not.toHaveProperty("value");
    expect(branchListResponse.body.stores[0]).not.toHaveProperty("businessType");
    expect(branchListResponse.body.stores[0]).not.toHaveProperty("manager");

    const employeeBranchListResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores").set("Authorization", employeeAuth),
    );
    expect(employeeBranchListResponse.status).toBe(200);
    expect(employeeBranchListResponse.body.stores).toHaveLength(1);

    const forbiddenStoreDetail = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-2").set("Authorization", employeeAuth),
    );
    expect(forbiddenStoreDetail.status).toBe(403);

    const branchDetailResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1").set("Authorization", employeeAuth),
    );
    expect(branchDetailResponse.status).toBe(200);
    expect(branchDetailResponse.body.store.name).toBe("District 1");
    expect(branchDetailResponse.body.store.manager).toBe("Nguyen Van A");
    expect(branchDetailResponse.body.store).not.toHaveProperty("code");
    expect(branchDetailResponse.body.store).not.toHaveProperty("storeId");
    expect(branchDetailResponse.body.store).not.toHaveProperty("storeCode");
    expect(branchDetailResponse.body.store).not.toHaveProperty("ownerId");
    expect(branchDetailResponse.body.store).not.toHaveProperty("businessType");

    const createdBranchResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores")
        .set("Authorization", ownerAuth)
        .send({
          name: "District 3",
          phone: "0903000000",
          manager: "Manager 3",
          address: {
            line1: "9 Third",
            city: "District 3",
          },
          status: "active",
          businessType: "legacy value",
        }),
    );
    expect(createdBranchResponse.status).toBe(201);
    expect(createdBranchResponse.body).not.toHaveProperty("storeId");
    expect(createdBranchResponse.body.store).not.toHaveProperty("code");
    expect(createdBranchResponse.body.store).not.toHaveProperty("storeId");
    expect(createdBranchResponse.body.store).not.toHaveProperty("storeCode");
    expect(createdBranchResponse.body.store).not.toHaveProperty("businessType");
    expect(createdBranchResponse.body.store.manager).toBe("Manager 3");

    const employeeCreateBranchResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores")
        .set("Authorization", employeeAuth)
        .send({ name: "Blocked", status: "active" }),
    );
    expect(employeeCreateBranchResponse.status).toBe(403);

    const updatedBranchResponse = await withRequestDefaults(
      request(app).patch("/api/v1/stores/branch-1").set("Authorization", ownerAuth).send({
        name: "District 1 Updated",
        manager: "Updated Manager",
        status: "active",
        businessType: "ignored legacy update",
      }),
    );
    expect(updatedBranchResponse.status).toBe(200);
    expect(updatedBranchResponse.body.store.name).toBe("District 1 Updated");
    expect(updatedBranchResponse.body.store.manager).toBe("Updated Manager");
    expect(updatedBranchResponse.body).not.toHaveProperty("storeId");
    expect(updatedBranchResponse.body.store).not.toHaveProperty("businessType");

    const invalidBranchUpdateResponse = await withRequestDefaults(
      request(app).patch("/api/v1/stores/branch-1").set("Authorization", ownerAuth).send({}),
    );
    expect(invalidBranchUpdateResponse.status).toBe(400);

    const serviceListResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/services")
        .set("Authorization", ownerAuth),
    );
    expect(serviceListResponse.status).toBe(200);
    expect(serviceListResponse.body).toMatchObject({
      meta: { storeId: "branch-1", totalCount: 1 },
    });
    expect(serviceListResponse.body).not.toHaveProperty("services");
    expect(serviceListResponse.body.items[0]).toMatchObject({
      id: "service-1",
      price: 50,
      durationMinutes: 60,
      groupService: "Nail",
    });
    expect(serviceListResponse.body.items[0]).not.toHaveProperty("storeId");
    expect(serviceListResponse.body.items[0]).not.toHaveProperty("imageUrls");

    const createServiceResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-2/services").set("Authorization", ownerAuth).send({
        name: "Spa Pedicure",
        amount: "$70",
        groupService: "Pedicure",
        duration: "75 minutes",
        image: "https://cdn.test/spa.png",
      }),
    );
    expect(createServiceResponse.status).toBe(201);
    expect(createServiceResponse.body).toMatchObject({
      item: {
        name: "Spa Pedicure",
        groupService: "Pedicure",
        price: 70,
        durationMinutes: 75,
      },
      meta: { storeId: "branch-2" },
    });
    expect(createServiceResponse.body.item).not.toHaveProperty("storeId");
    expect(createServiceResponse.body.item).not.toHaveProperty("imageUrls");
    expect(getServiceOrThrow(createServiceResponse.body.item.id as string)).toMatchObject({
      storeId: "branch-2",
      name: "Spa Pedicure",
    });

    const invalidServiceResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/services").set("Authorization", ownerAuth).send({
        name: "Invalid",
        price: 30,
        category: "nail",
        durationMin: 60,
        durationMax: 30,
      }),
    );
    expect(invalidServiceResponse.status).toBe(400);

    const employeeCreateServiceResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/services").set("Authorization", employeeAuth).send({
        name: "Blocked",
        price: 30,
        category: "nail",
        duration: 30,
      }),
    );
    expect(employeeCreateServiceResponse.status).toBe(403);

    const updateServiceResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/services/service-1")
        .set("Authorization", ownerAuth)
        .send({
          price: "65",
          durationMin: 45,
          durationMax: 60,
          preferredWorkerType: "assistant",
          bookingKind: "add_on",
        }),
    );
    expect(updateServiceResponse.status).toBe(200);
    expect(updateServiceResponse.body).toMatchObject({
      item: {
        id: "service-1",
        price: 65,
        durationMinutes: 60,
        preferredWorkerType: "assistant",
        bookingKind: "add_on",
      },
      meta: { storeId: "branch-1" },
    });
    expect(updateServiceResponse.body.item).not.toHaveProperty("storeId");
    expect(updateServiceResponse.body.item).not.toHaveProperty("imageUrls");
    expect(getServiceOrThrow("service-1")).toMatchObject({
      price: 65,
      preferredWorkerType: "assistant",
      bookingKind: "add_on",
    });

    const deleteServiceResponse = await withRequestDefaults(
      request(app).delete("/api/v1/stores/branch-1/services/service-1").set("Authorization", ownerAuth),
    );
    expect(deleteServiceResponse.status).toBe(204);
    expect(state.services.has("service-1")).toBe(false);
  });

  it("manages employees with branch and role scope enforcement", async () => {
    const ownerAuth = ownerSessionHeader();
    const employeeAuth = ownerSessionHeader({
      uid: "employee-1",
      role: "employee",
      storeId: "branch-1",
    });

    const employeeListResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/employees")
        .query({ search: "employee" })
        .set("Authorization", ownerAuth),
    );
    expect(employeeListResponse.status).toBe(200);
    expect(employeeListResponse.body.meta).toMatchObject({
      storeId: "branch-1",
      totalCount: 1,
      activeCount: 1,
      inactiveCount: 0,
    });
    expect(employeeListResponse.body.items[0]).toMatchObject({
      id: "employee-1",
      compensationModel: "commission",
    });
    expect(employeeListResponse.body).not.toHaveProperty("employees");
    expect(employeeListResponse.body.items[0]).not.toHaveProperty("email");
    expect(employeeListResponse.body.items[0]).not.toHaveProperty("storeName");

    const employeeForbiddenListResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/employees").set("Authorization", employeeAuth),
    );
    expect(employeeForbiddenListResponse.status).toBe(403);

    const employeeDetailResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/employees/employee-1").set("Authorization", employeeAuth),
    );
    expect(employeeDetailResponse.status).toBe(200);
    expect(employeeDetailResponse.body.employee.uid).toBe("employee-1");

    // Employee codes (NV-x) are no longer accepted as a lookup key — only the uid resolves.
    const employeeCodeDetailResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/employees/NV-2").set("Authorization", ownerAuth),
    );
    expect(employeeCodeDetailResponse.status).toBe(404);

    const forbiddenEmployeeDetailResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/employees/employee-2").set("Authorization", employeeAuth),
    );
    expect(forbiddenEmployeeDetailResponse.status).toBe(403);

    const createdEmployeeResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/employees").set("Authorization", ownerAuth).send({
        email: "new.employee@example.com",
        password: "secret123",
        name: "New Employee",
        employeeStatus: "inactive",
        position: "Receptionist",
        compensationModel: "hourly",
        hourlyRate: 20,
      }),
    );
    expect(createdEmployeeResponse.status).toBe(201);
    expect(createdEmployeeResponse.body.item).toMatchObject({
      active: true,
      status: "active",
      compensationModel: "hourly",
      hourlyRate: 20,
    });
    expect(createdEmployeeResponse.body.item).not.toHaveProperty("email");
    const createdEmployee = state.users.get(createdEmployeeResponse.body.item.id);
    expect(createdEmployee?.position).toBeUndefined();
    expect(createdEmployee?.employeeStatus).toBeUndefined();

    const duplicateEmployeeResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/employees").set("Authorization", ownerAuth).send({
        email: "new.employee@example.com",
        password: "secret123",
        name: "Duplicate Employee",
        role: "employee",
      }),
    );
    expect(duplicateEmployeeResponse.status).toBe(409);

    const ownerCreatesUnsupportedRoleResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/employees").set("Authorization", ownerAuth).send({
        email: "blocked.role@example.com",
        password: "secret123",
        name: "Blocked Role",
        role: "owner",
      }),
    );
    expect(ownerCreatesUnsupportedRoleResponse.status).toBe(400);

    const updatedEmployeeResponse = await withRequestDefaults(
      request(app).patch("/api/v1/stores/branch-1/employees/employee-1").set("Authorization", ownerAuth).send({
        name: "Employee Updated",
      }),
    );
    expect(updatedEmployeeResponse.status).toBe(200);
    expect(updatedEmployeeResponse.body.item).toMatchObject({
      name: "Employee Updated",
    });

    const updatedEmployeePasswordResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/employees/employee-1/password")
        .set("Authorization", ownerAuth)
        .send({ password: "changed123" }),
    );
    expect(updatedEmployeePasswordResponse.status).toBe(200);
    expect(state.firebaseUsers.get("employee-1")?.password).toBe("changed123");

    const refreshedEmployeeAuth = ownerSessionHeader({
      uid: "employee-1",
      role: "employee",
      storeId: "branch-1",
    });
    const employeeUpdatesEmployeeResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/employees/employee-1")
        .set("Authorization", refreshedEmployeeAuth)
        .send({ name: "Blocked Update" }),
    );
    expect(employeeUpdatesEmployeeResponse.status).toBe(403);
  });

  it("lists backend notification feed from audit logs and attendance reminders", async () => {
    const ownerAuth = ownerSessionHeader();
    const employeeAuth = ownerSessionHeader({
      uid: "employee-1",
      role: "employee",
      storeId: "branch-1",
    });
    const todayWorkDate = getTestTodayWorkDate();
    const currentMinutes = getTestCurrentMinutes();
    const now = Date.now();

    state.auditLogs.push(
      {
        id: "audit-service-updated",
        ownerId: "shop-1",
        eventType: "service_updated",
        entityType: "service",
        entityId: "service-1",
        actorUserId: "owner-1",
        actorRole: "owner",
        metadata: {
          name: "Classic Manicure",
          price: 70,
        },
        createdAt: now - 1000,
      },
      {
        id: "audit-branch-two",
        ownerId: "shop-1",
        eventType: "store_updated",
        entityType: "store",
        entityId: "branch-2",
        storeId: "branch-2",
        actorUserId: "owner-1",
        actorRole: "owner",
        metadata: {
          name: "District 2",
        },
        createdAt: now - 2000,
      },
    );
    state.attendances.set("attendance-today", {
      ...getAttendanceOrThrow("attendance-1"),
      id: "attendance-today",
      workDate: todayWorkDate,
      storeWorkDateKey: `branch-1__${todayWorkDate}`,
      startTime: currentMinutes,
      endTime: currentMinutes + 60,
      createdAt: now,
      updatedAt: now,
    });

    const ownerNotificationResponse = await withRequestDefaults(
      request(app).get("/api/v1/notifications").set("Authorization", ownerAuth),
    );

    expect(ownerNotificationResponse.status).toBe(200);
    expect(ownerNotificationResponse.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "attendance-reminder:attendance-today:start",
          type: "attendance_reminder",
          route: "/attendance/attendance-today",
        }),
        expect.objectContaining({
          id: "audit:audit-service-updated",
          type: "service_update",
          route: "/services",
        }),
      ]),
    );

    const employeeNotificationResponse = await withRequestDefaults(
      request(app).get("/api/v1/notifications").set("Authorization", employeeAuth),
    );

    expect(employeeNotificationResponse.status).toBe(200);
    expect(employeeNotificationResponse.body.notifications).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          id: "audit:audit-branch-two",
        }),
      ]),
    );
  });

});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const getTestTodayWorkDate = () => {
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

const getTestCurrentMinutes = () => {
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

const getUserOrThrow = (uid: string) => {
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
  const branch = state.stores.get(storeId);

  if (!branch) {
    throw new Error(`Missing test branch ${storeId}`);
  }

  return branch;
};

const getServiceOrThrow = (serviceId: string) => {
  const service = state.services.get(serviceId);

  if (!service) {
    throw new Error(`Missing test service ${serviceId}`);
  }

  return service;
};

const getAttendanceOrThrow = (attendanceId: string) => {
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

const firebaseHeader = (token: string) => `Bearer ${token}`;

const firebaseSigninBody = (token: string) => {
  return {
    idToken: token,
  };
};

const ownerSessionHeader = (
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

  return `Bearer ${jwt.sign(payload, "test-firebase-id-token")}`;
};

const withRequestDefaults = (testRequest: Test) => {
  nextIpOctet += 1;
  return testRequest.set("X-Forwarded-For", `203.0.113.${nextIpOctet}`);
};

const resetState = () => {
  state.users.clear();
  state.firebaseUsers.clear();
  state.firebaseTokens.clear();
  state.stores.clear();
  state.services.clear();
  state.attendances.clear();
  state.closings.clear();
  state.auditLogs = [];
  state.storageUploads = [];
  delete state.lastOtpCode;
  state.nextIds = {
    user: 0,
    shop: 0,
    branch: 0,
    service: 0,
    attendance: 0,
    closing: 0,
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
    employeeUserId: "employee-1",
    storeId: "branch-1",
    storeName: "District 1",
    storeWorkDateKey: "branch-1__2026-05-05",
    workDate: "2026-05-05",
    startTime: 540,
    endTime: 600,
    customerName: "Seed Customer",
    assignees: [
      {
        employeeUserId: "employee-1",
        employeeName: "Employee One",
        percentage: 50,
        shareAmount: 25,
      },
      {
        employeeUserId: "employee-lead-1",
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
            employeeUserId: "employee-1",
            employeeName: "Employee One",
            percentage: 50,
            shareAmount: 25,
          },
          {
            employeeUserId: "employee-lead-1",
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
    createdBy: "employee-lead-1",
    updatedBy: "employee-lead-1",
  };
  const otherAttendance: ShopAttendanceType = {
    ...attendance,
    id: "attendance-2",
    employeeUserId: "employee-2",
    storeId: "branch-2",
    storeName: "District 2",
    storeWorkDateKey: "branch-2__2026-05-05",
    assignees: [
      {
        employeeUserId: "employee-2",
        employeeName: "Employee Two",
        percentage: 100,
        shareAmount: 50,
      },
    ],
    services: [
      {
        ...service,
        employees: [
          {
            employeeUserId: "employee-2",
            employeeName: "Employee Two",
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
    uid: "employee-lead-1",
    email: "lead@example.com",
    ownerId: "shop-1",
    role: "employee",
    active: true,
    storeId: "branch-1",
    name: "Lead One",
    employeeStatus: "active",
    compensationModel: "commission",
    commissionRate: 70,
  });
  seedUser({
    uid: "unscoped-employee",
    email: "unscoped.employee@example.com",
    ownerId: "shop-1",
    role: "employee",
    active: true,
    name: "Unscoped Employee",
  });
  seedUser({
    uid: "employee-1",
    email: "employee@example.com",
    ownerId: "shop-1",
    role: "employee",
    active: true,
    storeId: "branch-1",
    name: "Employee One",
    employeeStatus: "active",
    compensationModel: "commission",
    commissionRate: 60,
  });
  seedUser({
    uid: "employee-2",
    email: "employee.two@example.com",
    ownerId: "shop-1",
    role: "employee",
    active: true,
    storeId: "branch-2",
    name: "Employee Two",
    employeeStatus: "active",
    compensationModel: "commission",
    commissionRate: 60,
  });

  const authTime = Math.floor(Date.now() / 1000);
  state.firebaseTokens.set("firebase-admin", { uid: "admin-1", authTime });
  state.firebaseTokens.set("firebase-owner", { uid: "owner-1", authTime });
  state.firebaseTokens.set("firebase-owner-stale", {
    uid: "owner-1",
    authTime: authTime - 3600,
  });
  state.firebaseTokens.set("firebase-disabled-owner", { uid: "disabled-owner", authTime });
  state.firebaseTokens.set("firebase-unscoped-employee", { uid: "unscoped-employee", authTime });
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
