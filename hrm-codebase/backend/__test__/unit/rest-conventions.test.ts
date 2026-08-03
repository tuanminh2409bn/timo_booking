import { describe, expect, it, vi } from "vitest";

// Guardrail for the RESTful restructure (2026-06, see docs/rest/rest-conventions.md +
// rest-restructure-plan.md). RATCHET design: it pins the EXACT set of current convention
// violations so (a) no NEW violation can be added, and (b) when a phase fixes one, this test
// fails until the entry is removed from the allowlist below — forcing a deliberate update.
//
// As phases land:
//   - P2 (nesting): remove resources from KNOWN_TOP_LEVEL_STORE_RESOURCES as they move under
//     /stores/:storeId/...
//   - P3 (verb->state): remove paths from KNOWN_VERB_ROUTES as close/cancel/review are dropped.
// When both arrays are empty, the conventions are fully enforced.

// Listing routes must not boot Firebase/Firestore (routers import handlers that init the
// Admin SDK at module load). Mock the repository entry points — same as route-inventory.test.
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
const listPaths = (router: { stack: RouteLayer[] }): string[] =>
  router.stack.flatMap((layer) => {
    if (layer.route) {
      return Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    }

    if (layer.handle?.stack) {
      return listPaths({ stack: layer.handle.stack });
    }

    return [];
  });

const API_PREFIX = "/api/v1";

// First path segment that is NOT a store-scoped resource (owner-level / global / current-user).
const TOP_LEVEL_EXEMPT = new Set(["auth", "account", "notifications", "me", "reports", "stores"]);

// Resources that semantically belong to a store and MUST nest under /stores/:storeId/...
const STORE_SCOPED_RESOURCES = new Set([
  "services",
  "service-catalog",
  "expenses",
  "expense-receipts",
  "attendances",
  "work-days",
  "work-day-settlements",
  "salaries",
  "employees",
  "customers",
  "weekly-reports",
]);

// Action verbs that must never be a path segment (auth endpoints are exempt by prefix).
const ACTION_VERBS = new Set(["close", "cancel", "review", "approve", "reject", "generate"]);

// ---- Known current violations (shrink these as phases land) -------------------------------

// P3 target: verb-in-path routes still present.
const KNOWN_VERB_ROUTES: string[] = [];

// P2 (nesting) landed: all flat store-scoped aliases removed — every store resource is now
// only reachable under /stores/:storeId/... so there are no top-level violations left.
const KNOWN_TOP_LEVEL_STORE_RESOURCES: string[] = [];

const segmentsOf = (path: string) => path.slice(API_PREFIX.length).split("/").filter(Boolean);

describe("REST conventions guardrail", () => {
  let apiPaths: string[] = [];

  const loadPaths = async () => {
    if (apiPaths.length > 0) {
      return apiPaths;
    }

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
    ]);

    apiPaths = [
      ...new Set(
        modules
          .flatMap((module) => listPaths(module.default as { stack: RouteLayer[] }))
          .filter((path) => path.startsWith(API_PREFIX)),
      ),
    ];

    return apiPaths;
  };

  it("finds API routes to validate", async () => {
    const paths = await loadPaths();
    expect(paths.length).toBeGreaterThan(0);
  });

  it("has no action-verb path segments beyond the known (shrinking) allowlist", async () => {
    const paths = await loadPaths();
    const verbRoutes = paths
      .filter((path) => segmentsOf(path).some((segment) => ACTION_VERBS.has(segment)))
      .sort();

    // Exact match: a NEW verb route fails here; a FIXED one fails until removed from the list.
    expect(
      verbRoutes,
      "Verb-in-path routes changed. Per docs/rest/rest-conventions.md §3, model state " +
        "transitions with PATCH/resource nouns. Update KNOWN_VERB_ROUTES deliberately.",
    ).toEqual(KNOWN_VERB_ROUTES);
  });

  it("has no top-level store-scoped resources beyond the known (shrinking) allowlist", async () => {
    const paths = await loadPaths();
    const topLevelStoreResources = [
      ...new Set(
        paths.flatMap((path) => {
          const first = segmentsOf(path)[0];
          return first && !TOP_LEVEL_EXEMPT.has(first) && STORE_SCOPED_RESOURCES.has(first)
            ? [first]
            : [];
        }),
      ),
    ].sort();

    // Exact match: a NEW top-level store resource fails; nesting one (P2) fails until removed.
    expect(
      topLevelStoreResources,
      "Top-level store-scoped resources changed. Per docs/rest/rest-conventions.md §4, nest " +
        "under /stores/:storeId/... Update KNOWN_TOP_LEVEL_STORE_RESOURCES deliberately.",
    ).toEqual(KNOWN_TOP_LEVEL_STORE_RESOURCES);
  });
});
