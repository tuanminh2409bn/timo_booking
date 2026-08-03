// Deletes the OLD flat top-level collections after the nested migration is verified.
// These collide with the nested collection-group queries (same collection id at the
// top level), so they must be removed for the nested model to read correctly.
//
// Run scripts/verify-nested.mjs FIRST and confirm every collection shows [OK].
// Idempotent. Dry-run by default; pass --confirm to delete. IRREVERSIBLE.
//   node scripts/delete-flat-collections.mjs
//   node scripts/delete-flat-collections.mjs --confirm
import { Firestore } from "@google-cloud/firestore";
import dotenv from "dotenv";

dotenv.config();

const CONFIRM = process.argv.includes("--confirm");
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

// Old flat collections that are now nested under stores/{storeId} (or renamed).
// NEVER includes the live top-level collections: stores, users, admin, audit_logs.
const DELETE_TARGETS = [
  "services",
  "attendances",
  "expenses",
  "attendance_correction_requests",
  "weekly_reports",
  "weekly-report",
  "shop",
  "service_catalog",
  "service_catalogs",
  "service_categories",
  "user", // renamed to users (recursiveDelete also removes its public_code_counters)
];

const tag = CONFIRM ? "DELETE" : "dry-run";
console.log(`=== delete-flat-collections (${tag}) on db=${process.env.FIRESTORE_DATABASE_ID} ===`);

for (const name of DELETE_TARGETS) {
  const ref = db.collection(name);
  const size = (await ref.get()).size;

  if (CONFIRM) {
    await db.recursiveDelete(ref);
    console.log(`[DELETE] ${name}: removed ${size} doc(s) (+ subcollections)`);
  } else {
    console.log(`[dry-run] ${name}: would remove ${size} doc(s) (+ subcollections)`);
  }
}

console.log(CONFIRM ? "Done." : "Dry-run complete. Re-run with --confirm to delete.");
