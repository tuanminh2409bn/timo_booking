import { describe, expect, it, vi } from "vitest";

// Listing routes must not boot Firebase/Firestore (the routers import handlers that
// otherwise initialize the Admin SDK at module load). Mock the repository entry points.
vi.mock("../../src/repository/firebase-auth/index.js", () => ({
  firebaseAuthRepository: { auth: {} },
}));
vi.mock("../../src/repository/firestore/index.js", () => ({ firestoreRepository: {} }));
vi.mock("../../src/repository/firebase-storage/index.js", () => ({
  firebaseStorageRepository: {},
}));

type RouteLayer = {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
};

// Recurses into nested routers (sub-routers mounted via router.use(...)), which mount their
// routes at the root path so the full "/api/v1/..." path lives on the leaf route layer.
const listRoutes = (router: { stack: RouteLayer[] }): string[] =>
  router.stack.flatMap((layer) => {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = Object.keys(layer.route.methods)
        .filter((method) => layer.route!.methods[method])
        .map((method) => method.toUpperCase());

      return paths.flatMap((path) => methods.map((method) => `${method} ${path}`));
    }

    if (layer.handle?.stack) {
      return listRoutes({ stack: layer.handle.stack });
    }

    return [];
  });

// Guardrail: snapshots the full set of registered routes so any path/method change
// (intended or accidental) shows up in review. Update the snapshot deliberately when
// routes change (vitest -u).
describe("API route inventory", () => {
  it("matches the registered route snapshot", async () => {
    process.env["NODE_ENV"] = "test";
    process.env["JWT_SECRET"] = "test-secret";
    process.env["GCP_PROJECT_ID"] = "test-project";
    process.env["FIRESTORE_DATABASE_ID"] = "(default)";
    process.env["FIREBASE_CLIENT_EMAIL"] = "test@test.iam.gserviceaccount.com";
    process.env["FIREBASE_PRIVATE_KEY"] = "test-key";
    process.env["FIREBASE_STORAGE_BUCKET"] = "test-bucket";

    const modules = await Promise.all([
      import("../../src/business/authentication/index.js"),
      import("../../src/business/user/index.js"),
      import("../../src/business/employee/index.js"),
      import("../../src/business/notification/index.js"),
      import("../../src/business/shop/index.js"),
      import("../../src/business/shop/weekly-reports/weekly-report-index.js"),
      import("../../src/business/monitoring/index.js"),
      import("../../src/business/billing/index.js"),
      import("../../src/business/billing/paypal-webhook-index.js"),
    ]);

    const routes = modules
      .flatMap((module) => listRoutes(module.default as { stack: RouteLayer[] }))
      .sort();

    expect(routes).toMatchSnapshot();
  });
});
