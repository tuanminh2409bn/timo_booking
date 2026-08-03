// READ-ONLY Firestore inspection for the canonical owner/store schema.
// Usage: node scripts/inspect-firestore.mjs
import { Firestore } from "@google-cloud/firestore";
import dotenv from "dotenv";

dotenv.config();

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(
  /\\n/g,
  "\n",
);

const db = new Firestore({
  databaseId: process.env.FIRESTORE_DATABASE_ID,
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: privateKey,
  },
});

// Nested model: only a few collections remain top-level; operational data lives in
// stores/{storeId}/<name> and is inspected via collection group.
const TOP_LEVEL_COLLECTIONS = ["admin", "users", "stores", "audit_logs"];
const NESTED_SUBCOLLECTIONS = [
  "services",
  "attendances",
  "employee_work_day_closings",
  "work_day_settlements",
  "expenses",
  "attendance_correction_requests",
  "service_categories",
  "weekly_reports",
];

const LEGACY_FIELDS = ["shopId", "branchId", "branchName", "branchWorkDateKey"];
const STORE_SCOPED = new Set(NESTED_SUBCOLLECTIONS);

const summarizeIssues = async (collectionId, query) => {
  const snap = await query.limit(5000).get();
  let legacyFields = 0;
  let missingOwnerId = 0;
  let missingStoreId = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (LEGACY_FIELDS.some((field) => field in data)) legacyFields += 1;
    if (STORE_SCOPED.has(collectionId) && !data.ownerId) missingOwnerId += 1;
    if (STORE_SCOPED.has(collectionId) && !data.storeId) missingStoreId += 1;
  }

  return { count: snap.size, legacyFields, missingOwnerId, missingStoreId };
};

const run = async () => {
  console.log("project:", process.env.GCP_PROJECT_ID, "db:", process.env.FIRESTORE_DATABASE_ID);
  console.log("\n=== TOP-LEVEL COLLECTIONS ===");
  for (const collectionId of TOP_LEVEL_COLLECTIONS) {
    const summary = await summarizeIssues(collectionId, db.collection(collectionId));
    console.log(
      `- ${collectionId}: ${summary.count} doc(s), legacy=${summary.legacyFields}, missingOwner=${summary.missingOwnerId}, missingStore=${summary.missingStoreId}`,
    );
  }

  console.log("\n=== NESTED SUBCOLLECTIONS (collection group) ===");
  for (const collectionId of NESTED_SUBCOLLECTIONS) {
    if (collectionId === "services") {
      const snap = await db.collectionGroup(collectionId).limit(5000).get();
      const categoryScopedDocs = snap.docs.filter((doc) => doc.ref.path.split("/").includes("service_categories"));
      const legacySiblingDocs = snap.docs.filter((doc) => !doc.ref.path.split("/").includes("service_categories"));
      const summary = await summarizeIssues(collectionId, {
        limit: () => ({ get: async () => ({ docs: categoryScopedDocs, size: categoryScopedDocs.length }) }),
      });
      console.log(
        `- ${collectionId}: ${summary.count} doc(s), legacySibling=${legacySiblingDocs.length}, legacy=${summary.legacyFields}, missingOwner=${summary.missingOwnerId}, missingStore=${summary.missingStoreId}`,
      );
      continue;
    }

    const summary = await summarizeIssues(collectionId, db.collectionGroup(collectionId));
    console.log(
      `- ${collectionId}: ${summary.count} doc(s), legacy=${summary.legacyFields}, missingOwner=${summary.missingOwnerId}, missingStore=${summary.missingStoreId}`,
    );
  }

  const legacyShopSnap = await db.collection("shop").limit(1).get();
  console.log(`\nlegacy shop docs: ${legacyShopSnap.size}`);

  const oldServiceCatalogFlatSnap = await db.collection("service_catalogs").limit(1).get();
  const oldServiceCatalogGroupSnap = await db.collectionGroup("service_catalogs").limit(1).get();
  console.log(`legacy service_catalogs docs: flat=${oldServiceCatalogFlatSnap.size} group=${oldServiceCatalogGroupSnap.size}`);

  const stores = await db.collection("stores").limit(20).get();
  console.log(`\n=== stores (${stores.size}) ===`);
  stores.docs.forEach((doc) => {
    const store = doc.data();
    console.log(
      `  ${doc.id}: ownerId=${store.ownerId ?? "-"} code=${store.code ?? "-"} name=${store.name ?? "-"} hours=${store.openTime ?? "-"}-${store.closeTime ?? "-"}`,
    );
  });

  const users = await db.collection("users").limit(50).get();
  console.log(`\n=== user (${users.size}) ===`);
  users.docs.forEach((doc) => {
    const user = doc.data();
    console.log(
      `  ${doc.id}: role=${user.role ?? "-"} ownerId=${user.ownerId ?? "-"} storeId=${user.storeId ?? "-"} name=${user.name ?? user.displayName ?? "-"} comp=${user.compensationModel ?? "-"}`,
    );
  });
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("INSPECT FAILED:", error.message);
    process.exit(1);
  });
