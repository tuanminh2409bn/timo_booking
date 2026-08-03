import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  app,
  getServiceOrThrow,
  ownerSessionHeader,
  state,
  withRequestDefaults,
} from "./backend-api-fixture.js";

const VALID_PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
  "base64",
);

describe("backend API integration: shop", () => {
  it("manages shop stores and service catalog through authorized API routes", async () => {
    const ownerAuth = ownerSessionHeader();
    const staffAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const managerAuth = ownerSessionHeader({
      uid: "manager-1",
      role: "manager",
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

    const branchListWithCountsResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores")
        .query({ includeEmployeeCounts: "true" })
        .set("Authorization", ownerAuth),
    );
    expect(branchListWithCountsResponse.status).toBe(200);
    expect(branchListWithCountsResponse.body.stores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "branch-1", employeeCount: 2 }),
        expect.objectContaining({ id: "branch-2", employeeCount: 1 }),
      ]),
    );

    const staffBranchListResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores").set("Authorization", staffAuth),
    );
    expect(staffBranchListResponse.status).toBe(200);
    expect(staffBranchListResponse.body.stores).toHaveLength(1);

    const forbiddenStoreDetail = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-2").set("Authorization", staffAuth),
    );
    expect(forbiddenStoreDetail.status).toBe(403);

    const branchDetailResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1")
        .query({ includeEmployeeCounts: "true" })
        .set("Authorization", staffAuth),
    );
    expect(branchDetailResponse.status).toBe(200);
    expect(branchDetailResponse.body.store.name).toBe("District 1");
    expect(branchDetailResponse.body.store.manager).toBe("Nguyen Van A");
    expect(branchDetailResponse.body.store.employeeCount).toBe(2);
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

    const staffCreateBranchResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores")
        .set("Authorization", staffAuth)
        .send({ name: "Blocked", status: "active" }),
    );
    expect(staffCreateBranchResponse.status).toBe(403);

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
      request(app).get("/api/v1/stores/branch-1/services").set("Authorization", ownerAuth),
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

    const staffServiceListResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/services").set("Authorization", staffAuth),
    );
    expect(staffServiceListResponse.status).toBe(200);
    expect(staffServiceListResponse.body.items).toHaveLength(1);
    expect(staffServiceListResponse.body.items[0]).toMatchObject({
      id: "service-1",
      price: 50,
    });
    expect(staffServiceListResponse.body.items[0]).not.toHaveProperty("storeId");

    const staffForbiddenNestedServiceListResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-2/services").set("Authorization", staffAuth),
    );
    expect(staffForbiddenNestedServiceListResponse.status).toBe(403);

    const createServiceGroupResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/service-groups")
        .set("Authorization", ownerAuth)
        .send({ name: "Brows" }),
    );
    expect(createServiceGroupResponse.status).toBe(201);
    expect(createServiceGroupResponse.body).toMatchObject({
      item: {
        name: "Brows",
        label: "Brows",
        category: "other",
        serviceCount: 0,
      },
      meta: { storeId: "branch-1", created: true },
    });

    const duplicateServiceGroupResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/service-groups")
        .set("Authorization", ownerAuth)
        .send({ name: "Brows" }),
    );
    expect(duplicateServiceGroupResponse.status).toBe(200);
    expect(duplicateServiceGroupResponse.body).toMatchObject({
      item: {
        name: "Brows",
        serviceCount: 0,
      },
      meta: { storeId: "branch-1", created: false },
    });

    const staffCreateServiceGroupResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/service-groups")
        .set("Authorization", staffAuth)
        .send({ name: "Blocked" }),
    );
    expect(staffCreateServiceGroupResponse.status).toBe(403);

    const managerCrossStoreServiceGroupResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-2/service-groups")
        .set("Authorization", managerAuth)
        .send({ name: "Blocked cross-store group" }),
    );
    expect(managerCrossStoreServiceGroupResponse.status).toBe(403);

    const serviceCatalogResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/service-catalog").set("Authorization", ownerAuth),
    );
    expect(serviceCatalogResponse.status).toBe(200);
    expect(serviceCatalogResponse.headers["cache-control"]).toBe(
      "private, max-age=300, stale-while-revalidate=600",
    );
    expect(serviceCatalogResponse.body.catalog).toMatchObject({
      storeId: "branch-1",
      groupCount: 2,
      serviceCount: 1,
    });
    expect(serviceCatalogResponse.body.meta.latestUpdatedAt).toEqual(expect.any(Number));
    expect(serviceCatalogResponse.body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Brows",
          serviceCount: 0,
        }),
        expect.objectContaining({
          name: "Nail",
          serviceCount: 1,
        }),
      ]),
    );
    const nailGroup = serviceCatalogResponse.body.groups.find(
      (group: { name: string }) => group.name === "Nail",
    );
    expect(nailGroup.services[0]).toMatchObject({
      id: "service-1",
      storeId: "branch-1",
      serviceGroupName: "Nail",
      price: 50,
      durationMinutes: 60,
    });
    expect(nailGroup.services[0]).not.toHaveProperty("imageUrls");

    const serviceCatalogEtagResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/service-catalog")
        .set("Authorization", ownerAuth)
        .set("If-None-Match", serviceCatalogResponse.headers["etag"] as string),
    );
    expect(serviceCatalogEtagResponse.status).toBe(304);

    const staffForbiddenCatalogResponse = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-2/service-catalog").set("Authorization", staffAuth),
    );
    expect(staffForbiddenCatalogResponse.status).toBe(403);

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
    expect(getServiceOrThrow(createServiceResponse.body.item.id as string)).not.toHaveProperty(
      "imageUrls",
    );

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

    const missingRequiredServiceResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/services").set("Authorization", ownerAuth).send({
        name: "   ",
        category: "nail",
        duration: 30,
      }),
    );
    expect(missingRequiredServiceResponse.status).toBe(400);

    const staffCreateServiceResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-1/services").set("Authorization", staffAuth).send({
        name: "Blocked",
        price: 30,
        category: "nail",
        duration: 30,
      }),
    );
    expect(staffCreateServiceResponse.status).toBe(403);

    const managerCrossStoreServiceResponse = await withRequestDefaults(
      request(app).post("/api/v1/stores/branch-2/services").set("Authorization", managerAuth).send({
        name: "Blocked cross-store service",
        price: 30,
        category: "nail",
        duration: 30,
      }),
    );
    expect(managerCrossStoreServiceResponse.status).toBe(403);

    const managerCrossStoreUpdateResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-2/services/service-2")
        .set("Authorization", managerAuth)
        .send({ price: 80 }),
    );
    expect(managerCrossStoreUpdateResponse.status).toBe(403);

    const updateServiceResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/services/service-1")
        .set("Authorization", ownerAuth)
        .send({ price: "65", durationMin: 45, durationMax: 60 }),
    );
    expect(updateServiceResponse.status).toBe(200);
    expect(updateServiceResponse.body).toMatchObject({
      item: {
        id: "service-1",
        price: 65,
        durationMinutes: 60,
      },
      meta: { storeId: "branch-1" },
    });
    expect(updateServiceResponse.body.item).not.toHaveProperty("storeId");
    expect(updateServiceResponse.body.item).not.toHaveProperty("imageUrls");
    expect(getServiceOrThrow("service-1").price).toBe(65);

    const invalidPartialDurationUpdateResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/services/service-1")
        .set("Authorization", ownerAuth)
        .send({ durationMin: 75 }),
    );
    expect(invalidPartialDurationUpdateResponse.status).toBe(400);
    expect(getServiceOrThrow("service-1")).toMatchObject({
      durationMin: 45,
      durationMax: 60,
    });

    const invalidUpdateServiceResponse = await withRequestDefaults(
      request(app)
        .patch("/api/v1/stores/branch-1/services/service-1")
        .set("Authorization", ownerAuth)
        .send({ price: "not-a-number" }),
    );
    expect(invalidUpdateServiceResponse.status).toBe(400);
    expect(getServiceOrThrow("service-1").price).toBe(65);

    const receiptUploadResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/expense-receipts")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-06-10",
          fileName: "receipt.png",
          contentType: "image/png",
          base64: VALID_PNG_BASE64,
        }),
    );
    expect(receiptUploadResponse.status).toBe(200);
    expect(receiptUploadResponse.body).toMatchObject({
      imageUrl: "https://storage.test/expense-receipts/shop-1/branch-1/2026-06-10/receipt.png",
      storagePath: "expense-receipts/shop-1/branch-1/2026-06-10/receipt.png",
      storageLifecyclePolicy: "expense-receipt-hot-cold-v1",
    });
    expect(state.storageUploads).toContainEqual(
      expect.objectContaining({
        kind: "expense-receipt",
        storeId: "branch-1",
        workDate: "2026-06-10",
        contentType: "image/png",
      }),
    );

    const invalidReceiptUploadResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/expense-receipts")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-06-10",
          fileName: "receipt.txt",
          contentType: "text/plain",
          base64: VALID_PNG_BASE64,
        }),
    );
    expect(invalidReceiptUploadResponse.status).toBe(400);
    expect(invalidReceiptUploadResponse.body.type).toBe(
      "/stores/expenses/invalid-expense-receipt-upload-request",
    );

    const invalidReceiptUploadFileNameResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/expense-receipts")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-06-10",
          fileName: "../receipt.png",
          contentType: "image/png",
          base64: VALID_PNG_BASE64,
        }),
    );
    expect(invalidReceiptUploadFileNameResponse.status).toBe(400);

    const invalidSvgReceiptUploadResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/expense-receipts")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-06-10",
          fileName: "receipt.svg",
          contentType: "image/svg+xml",
          base64: VALID_PNG_BASE64,
        }),
    );
    expect(invalidSvgReceiptUploadResponse.status).toBe(400);

    const staffReceiptUploadResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/expense-receipts")
        .set("Authorization", staffAuth)
        .send({
          workDate: "2026-06-10",
          fileName: "receipt.png",
          contentType: "image/png",
          base64: VALID_PNG_BASE64,
        }),
    );
    expect(staffReceiptUploadResponse.status).toBe(403);

    const invalidReceiptExpenseResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/expenses")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-06-10",
          items: [
            {
              name: "Invalid receipt",
              amount: 1,
              receiptImage: {
                imageUrl: "https://storage.test/receipt.png",
                storagePath: "expense-receipts/../receipt.png",
                fileName: "receipt.png",
                contentType: "image/png",
              },
            },
          ],
        }),
    );
    expect(invalidReceiptExpenseResponse.status).toBe(400);

    const invalidReceiptUrlExpenseResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/expenses")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-06-10",
          items: [
            {
              name: "Invalid receipt URL",
              amount: 1,
              receiptImage: {
                imageUrl: "javascript:alert(1)",
                storagePath: "expense-receipts/shop-1/branch-1/2026-06-10/receipt.png",
                fileName: "receipt.png",
                contentType: "image/png",
              },
            },
          ],
        }),
    );
    expect(invalidReceiptUrlExpenseResponse.status).toBe(400);

    const createExpenseResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/expenses")
        .set("Authorization", ownerAuth)
        .send({
          workDate: "2026-06-10",
          items: [
            {
              name: "Gel polish",
              supplierName: "Supplier A",
              note: "Mua do lam mong",
              amount: 120,
              receiptImage: {
                imageUrl: receiptUploadResponse.body.imageUrl,
                storagePath: receiptUploadResponse.body.storagePath,
                fileName: receiptUploadResponse.body.fileName,
                contentType: receiptUploadResponse.body.contentType,
              },
            },
            {
              name: "Sieu thi B",
              note: "Giay ve sinh",
              amount: 12.5,
            },
            {
              name: "Cua hang C",
              note: "Khan lau",
              amount: 8,
            },
          ],
        }),
    );
    expect(createExpenseResponse.status).toBe(201);
    expect(createExpenseResponse.body).toMatchObject({
      storeId: "branch-1",
      workDate: "2026-06-10",
      count: 3,
      totalAmount: 140.5,
    });
    expect(createExpenseResponse.body.items).toHaveLength(3);
    expect(createExpenseResponse.body.items[0]).toMatchObject({
      storeId: "branch-1",
      workDate: "2026-06-10",
      name: "Gel polish",
      supplierName: "Supplier A",
      amount: 120,
      receiptImage: expect.objectContaining({
        storageLifecyclePolicy: "expense-receipt-hot-cold-v1",
      }),
    });

    const expenseIds = createExpenseResponse.body.items.map((item: { id: string }) => item.id);
    expect(expenseIds).toHaveLength(3);

    const staffCreateExpenseResponse = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/expenses")
        .set("Authorization", staffAuth)
        .send({
          workDate: "2026-06-10",
          items: [{ name: "Blocked", amount: 1 }],
        }),
    );
    expect(staffCreateExpenseResponse.status).toBe(403);

    const listExpenseResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/expenses")
        .query({
          fromWorkDate: "2026-06-10",
          toWorkDate: "2026-06-16",
        })
        .set("Authorization", ownerAuth),
    );
    expect(listExpenseResponse.status).toBe(200);
    expect(listExpenseResponse.body).toMatchObject({
      storeId: "branch-1",
      fromWorkDate: "2026-06-10",
      toWorkDate: "2026-06-16",
      rangeDayCount: 7,
      count: 3,
      totalAmount: 140.5,
    });
    expect(listExpenseResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Gel polish", supplierName: "Supplier A" }),
        expect.objectContaining({ name: "Sieu thi B" }),
        expect.objectContaining({ name: "Cua hang C" }),
      ]),
    );

    const listExpenseByStoreResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/expenses")
        .query({
          fromWorkDate: "2026-06-10",
          toWorkDate: "2026-06-16",
        })
        .set("Authorization", ownerAuth),
    );
    expect(listExpenseByStoreResponse.status).toBe(200);
    expect(listExpenseByStoreResponse.body).toMatchObject({
      storeId: "branch-1",
      count: 3,
      totalAmount: 140.5,
    });
    const expenseEtag = listExpenseByStoreResponse.headers.etag;
    expect(expenseEtag).toBeTypeOf("string");

    if (typeof expenseEtag !== "string") {
      throw new Error("Expected the expense list response to include an ETag");
    }

    const notModifiedExpenseResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/expenses")
        .query({
          fromWorkDate: "2026-06-10",
          toWorkDate: "2026-06-16",
        })
        .set("Authorization", ownerAuth)
        .set("If-None-Match", expenseEtag),
    );
    expect(notModifiedExpenseResponse.status).toBe(304);

    const tooLargeExpenseRangeResponse = await withRequestDefaults(
      request(app)
        .get("/api/v1/stores/branch-1/expenses")
        .query({
          fromWorkDate: "2026-06-01",
          toWorkDate: "2026-07-02",
        })
        .set("Authorization", ownerAuth),
    );
    expect(tooLargeExpenseRangeResponse.status).toBe(400);

    const updateExpenseResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/expenses/${expenseIds[0]}`)
        .set("Authorization", ownerAuth)
        .send({
          name: "Supplier A updated",
          supplierName: "Supplier A updated",
          note: "Mua them bot dipping",
          amount: 135,
        }),
    );
    expect(updateExpenseResponse.status).toBe(200);
    expect(updateExpenseResponse.body.item).toMatchObject({
      id: expenseIds[0],
      name: "Supplier A updated",
      supplierName: "Supplier A updated",
      note: "Mua them bot dipping",
      amount: 135,
    });

    const invalidUpdateExpenseResponse = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/expenses/${expenseIds[0]}`)
        .set("Authorization", ownerAuth)
        .send({ storeId: "branch-2" }),
    );
    expect(invalidUpdateExpenseResponse.status).toBe(400);

    const mismatchedNestedDeleteExpenseResponse = await withRequestDefaults(
      request(app)
        .delete(`/api/v1/stores/branch-2/expenses/${expenseIds[1]}`)
        .set("Authorization", ownerAuth),
    );
    expect(mismatchedNestedDeleteExpenseResponse.status).toBe(404);
    expect(state.expenses.has(expenseIds[1])).toBe(true);

    const deleteExpenseResponse = await withRequestDefaults(
      request(app)
        .delete(`/api/v1/stores/branch-1/expenses/${expenseIds[1]}`)
        .set("Authorization", ownerAuth),
    );
    expect(deleteExpenseResponse.status).toBe(200);
    expect(deleteExpenseResponse.body).toMatchObject({
      id: expenseIds[1],
      storeId: "branch-1",
      workDate: "2026-06-10",
      deleted: true,
    });
    expect(state.expenses.has(expenseIds[1])).toBe(false);

    const deleteServiceResponse = await withRequestDefaults(
      request(app)
        .delete("/api/v1/stores/branch-1/services/service-1")
        .set("Authorization", ownerAuth),
    );
    expect(deleteServiceResponse.status).toBe(204);
    expect(state.services.has("service-1")).toBe(false);
  });

  it("keeps customers store-scoped and enforces manual block and unblock", async () => {
    const ownerAuth = ownerSessionHeader();
    const employeeAuth = ownerSessionHeader({
      uid: "staff-1",
      role: "employee",
      storeId: "branch-1",
    });
    const managerAuth = ownerSessionHeader({
      uid: "manager-1",
      role: "manager",
      storeId: "branch-1",
    });
    const attendancePayload = {
      date: "2099-08-01T09:00:00.000Z",
      endDate: "2099-08-01T09:30:00.000Z",
      customerName: "Blocked Customer",
      customerPhone: "+84123456789",
      employeeUserId: "staff-1",
      services: [
        {
          id: "blocked-customer-service",
          sourceServiceId: "service-1",
          name: "Classic Manicure",
          price: "50",
          duration: "30",
          employees: [{ employeeId: "staff-1", percentage: 100 }],
        },
      ],
    };

    const created = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send(attendancePayload),
    );
    expect(created.status).toBe(201);

    const list = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/customers").set("Authorization", ownerAuth),
    );
    expect(list.status).toBe(200);
    const customerId = list.body.items.find(
      (customer: { name?: string }) => customer.name === "Blocked Customer",
    )?.id as string;
    expect(customerId).toBeTruthy();

    const forbiddenEmployeeList = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/customers").set("Authorization", employeeAuth),
    );
    expect(forbiddenEmployeeList.status).toBe(403);

    const managerList = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/customers").set("Authorization", managerAuth),
    );
    expect(managerList.status).toBe(200);
    const managerOtherStoreList = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-2/customers").set("Authorization", managerAuth),
    );
    expect(managerOtherStoreList.status).toBe(403);

    const missingReason = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/customers/${customerId}/block`)
        .set("Authorization", ownerAuth)
        .send({ reason: "" }),
    );
    expect(missingReason.status).toBe(400);

    const blocked = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/customers/${customerId}/block`)
        .set("Authorization", ownerAuth)
        .send({ reason: "Repeated no-show" }),
    );
    expect(blocked.status).toBe(200);
    expect(blocked.body.item).toMatchObject({ blocked: true, blockedReason: "Repeated no-show" });

    const rejectedBooking = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          ...attendancePayload,
          customerName: "Renamed by rejected booking",
          date: "2099-08-02T09:00:00.000Z",
          endDate: "2099-08-02T09:30:00.000Z",
        }),
    );
    expect(rejectedBooking.status).toBe(403);
    expect(rejectedBooking.body.type).toBe("/stores/attendances/customer-blocked");

    const blockedCustomer = await withRequestDefaults(
      request(app)
        .get(`/api/v1/stores/branch-1/customers/${customerId}`)
        .set("Authorization", ownerAuth),
    );
    expect(blockedCustomer.status).toBe(200);
    expect(blockedCustomer.body.item.name).toBe("Blocked Customer");

    const unblocked = await withRequestDefaults(
      request(app)
        .patch(`/api/v1/stores/branch-1/customers/${customerId}/unblock`)
        .set("Authorization", ownerAuth)
        .send({}),
    );
    expect(unblocked.status).toBe(200);
    expect(unblocked.body.item.blocked).toBe(false);
  });

  it("keeps phone identity primary while enriching name-only profiles", async () => {
    const ownerAuth = ownerSessionHeader();
    const basePayload = {
      employeeUserId: "staff-1",
      services: [
        {
          id: "customer-identity-service",
          sourceServiceId: "service-1",
          name: "Classic Manicure",
          price: "50",
          duration: "30",
          employees: [{ employeeId: "staff-1", percentage: 100 }],
        },
      ],
      customerName: "Same Name",
    };

    const nameOnly = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          ...basePayload,
          date: "2099-08-10T09:00:00.000Z",
          endDate: "2099-08-10T09:30:00.000Z",
        }),
    );
    expect(nameOnly.status).toBe(201);

    const enriched = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          ...basePayload,
          customerPhone: "+84 111 111",
          date: "2099-08-11T09:00:00.000Z",
          endDate: "2099-08-11T09:30:00.000Z",
        }),
    );
    expect(enriched.status).toBe(201);

    const differentPhone = await withRequestDefaults(
      request(app)
        .post("/api/v1/stores/branch-1/attendances")
        .set("Authorization", ownerAuth)
        .send({
          ...basePayload,
          customerPhone: "+84 222 222",
          date: "2099-08-12T09:00:00.000Z",
          endDate: "2099-08-12T09:30:00.000Z",
        }),
    );
    expect(differentPhone.status).toBe(201);

    const list = await withRequestDefaults(
      request(app).get("/api/v1/stores/branch-1/customers").set("Authorization", ownerAuth),
    );
    expect(list.status).toBe(200);
    expect(list.body.items.filter((customer: { name?: string }) => customer.name === "Same Name"))
      .toHaveLength(2);
    expect(list.body.items.filter((customer: { phone?: string }) => customer.phone === "+84111111"))
      .toHaveLength(1);
  });
});
