// READ-ONLY audit for the canonical nested read path used by the frontend.
// Counts canonical paths, flags old flat collections, and samples missing ownerId/storeId.
// Usage:
//   npm run audit:firestore-read-path
//   npm run audit:firestore-read-path -- --storeId=S-1 --sampleLimit=20
import { Firestore } from "@google-cloud/firestore";
import dotenv from "dotenv";

dotenv.config();

const getArg = (name, fallback = undefined) => {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const databaseId = getArg("databaseId", process.env.FIRESTORE_DATABASE_ID || "timmo");
const storeFilter = getArg("storeId", undefined);
const sampleLimit = Number(getArg("sampleLimit", "50"));
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(
  /\\n/g,
  "\n",
);

const db = new Firestore({
  databaseId,
  projectId: process.env.GCP_PROJECT_ID,
  ...(process.env.FIREBASE_CLIENT_EMAIL && privateKey
    ? {
        credentials: {
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          private_key: privateKey,
        },
      }
    : {}),
});

const LEGACY_FLAT_COLLECTIONS = [
  "shop",
  "user",
  "services",
  "service_categories",
  "service_catalogs",
  "attendances",
  "expenses",
  "employee_work_day_closings",
  "work_day_settlements",
  "attendance_correction_requests",
  "weekly_reports",
  "weekly-report",
  "audit_logs",
];

const STORE_SUBCOLLECTIONS = [
  "attendances",
  "expenses",
  "employee_work_day_closings",
  "work_day_settlements",
  "attendance_correction_requests",
  "weekly_reports",
  "daily_summaries",
  "monthly_summaries",
];

const addAnomaly = (anomalies, anomaly) => {
  if (anomalies.length < sampleLimit) {
    anomalies.push(anomaly);
  }
};

const countCollection = async (collectionRef) => (await collectionRef.get()).size;

const getStores = async () => {
  if (storeFilter) {
    const doc = await db.collection("stores").doc(storeFilter).get();
    return doc.exists ? [doc] : [];
  }

  return (await db.collection("stores").get()).docs;
};

const auditRequiredScope = async (collectionRef, pathLabel, anomalies) => {
  const snapshot = await collectionRef.get();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const missing = [];

    if (typeof data.ownerId !== "string" || data.ownerId.length === 0) {
      missing.push("ownerId");
    }

    if (typeof data.storeId !== "string" || data.storeId.length === 0) {
      missing.push("storeId");
    }

    if (missing.length > 0) {
      addAnomaly(anomalies, `${pathLabel}/${doc.id} missing ${missing.join(",")}`);
    }
  });

  return snapshot.size;
};

const auditStoreServices = async (store, anomalies) => {
  const categories = await store.ref.collection("service_categories").get();
  let serviceCount = 0;

  categories.docs.forEach((category) => {
    const data = category.data();
    const missing = [];

    if (typeof data.ownerId !== "string" || data.ownerId.length === 0) {
      missing.push("ownerId");
    }

    if (typeof data.storeId !== "string" || data.storeId.length === 0) {
      missing.push("storeId");
    }

    if (missing.length > 0) {
      addAnomaly(
        anomalies,
        `stores/${store.id}/service_categories/${category.id} missing ${missing.join(",")}`,
      );
    }
  });

  for (const category of categories.docs) {
    serviceCount += await auditRequiredScope(
      category.ref.collection("services"),
      `stores/${store.id}/service_categories/${category.id}/services`,
      anomalies,
    );
  }

  return {
    categoryCount: categories.size,
    serviceCount,
  };
};

const audit = async () => {
  const stores = await getStores();
  const anomalies = [];
  const pathCounts = [];
  const legacyCounts = [];
  let totalServiceCategories = 0;
  let totalServices = 0;

  for (const name of LEGACY_FLAT_COLLECTIONS) {
    const count = await countCollection(db.collection(name));
    legacyCounts.push({ path: name, count });
  }

  for (const store of stores) {
    const storeData = store.data();

    if (typeof storeData.ownerId !== "string" || storeData.ownerId.length === 0) {
      addAnomaly(anomalies, `stores/${store.id} missing ownerId`);
    }

    const services = await auditStoreServices(store, anomalies);
    totalServiceCategories += services.categoryCount;
    totalServices += services.serviceCount;

    pathCounts.push({
      path: `stores/${store.id}/service_categories`,
      count: services.categoryCount,
    });
    pathCounts.push({
      path: `stores/${store.id}/service_categories/*/services`,
      count: services.serviceCount,
    });

    for (const subcollection of STORE_SUBCOLLECTIONS) {
      const path = `stores/${store.id}/${subcollection}`;
      const count = await auditRequiredScope(store.ref.collection(subcollection), path, anomalies);
      pathCounts.push({ path, count });
    }
  }

  const users = await db.collection("users").get();
  users.docs.forEach((doc) => {
    const data = doc.data();
    const missing = [];

    if (typeof data.ownerId !== "string" || data.ownerId.length === 0) {
      missing.push("ownerId");
    }

    if (data.role === "employee" && (typeof data.storeId !== "string" || data.storeId.length === 0)) {
      missing.push("employee.storeId");
    }

    if (missing.length > 0) {
      addAnomaly(anomalies, `users/${doc.id} missing ${missing.join(",")}`);
    }
  });

  const legacyWithDocs = legacyCounts.filter((item) => item.count > 0);

  console.log(`Firestore read-path audit (${databaseId})`);
  console.log(`stores=${stores.length} users=${users.size} service_categories=${totalServiceCategories} services=${totalServices}`);
  console.log("\nCanonical path counts:");
  pathCounts.forEach((item) => console.log(`- ${item.path}: ${item.count}`));
  console.log("\nLegacy flat collections with docs:");
  if (legacyWithDocs.length === 0) {
    console.log("- none");
  } else {
    legacyWithDocs.forEach((item) => console.log(`- ${item.path}: ${item.count}`));
  }
  console.log("\nScope anomalies:");
  if (anomalies.length === 0) {
    console.log("- none");
  } else {
    anomalies.forEach((item) => console.log(`- ${item}`));
    if (anomalies.length === sampleLimit) {
      console.log(`- sample limit reached (${sampleLimit})`);
    }
  }
};

await audit();
