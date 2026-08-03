// Migrates the flat Firestore model to the canonical nested model:
//   - user/{uid}                       -> users/{uid} (+ public_code_counters)
//   - services/{id}                    -> stores/{storeId}/service_categories/{categoryId}/services/{id}
//   - <name>/{id} (has storeId field)  -> stores/{storeId}/<name>/{id}
//       for attendances, expenses, attendance_correction_requests,
//       weekly_reports (+ legacy weekly-report)
//   - service_catalogs/{storeId}       -> stores/{storeId}/service_categories/{categoryId}
//
// Idempotent. Dry-run by default; pass --confirm to write.
// Does NOT delete source data. Run inspect + verify, then delete old collections separately.
//   node scripts/migrate-to-nested.mjs
//   node scripts/migrate-to-nested.mjs --confirm
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

const tag = CONFIRM ? "WRITE" : "dry-run";

const STORE_SCOPED = [
  ["attendances", "attendances"],
  ["expenses", "expenses"],
  ["attendance_correction_requests", "attendance_correction_requests"],
  ["weekly_reports", "weekly_reports"],
  ["weekly-report", "weekly_reports"],
];

const CATEGORY_LABELS = {
  nail: "Nail",
  manicure: "Manicure",
  pedicure: "Pedicure",
  design: "Design",
  other: "Other",
};

const normalizeCategory = (value) =>
  ["nail", "manicure", "pedicure", "design", "other"].includes(value) ? value : "other";

const slugify = (name, fallback) => {
  const slug = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || fallback;
};

const getServiceGroupName = (service) => {
  const category = normalizeCategory(service.category);
  return service.groupService?.trim() || CATEGORY_LABELS[category];
};

const getServiceCategoryId = (service) => {
  const category = normalizeCategory(service.category);
  return `category_${slugify(getServiceGroupName(service), category)}`;
};

const storeCache = new Map();

const getStoreData = async (storeId) => {
  if (storeCache.has(storeId)) {
    return storeCache.get(storeId);
  }

  const snapshot = await db.collection("stores").doc(storeId).get();
  const data = snapshot.exists ? snapshot.data() : undefined;
  storeCache.set(storeId, data);
  return data;
};

const toCanonicalUserData = (data) => {
  const { shopId, branchId, branchName: _branchName, branchWorkDateKey: _branchWorkDateKey, ...rest } = data;

  return {
    ...rest,
    ownerId: rest.ownerId ?? shopId,
    ...(rest.storeId ?? branchId ? { storeId: rest.storeId ?? branchId } : {}),
  };
};

const toCanonicalStoreScopedData = async (doc, storeId) => {
  const data = doc.data();
  const store = await getStoreData(storeId);
  const { shopId, branchId: _branchId, branchName, branchWorkDateKey, ...rest } = data;
  const workDate = rest.workDate;
  const storeWorkDateKey =
    rest.storeWorkDateKey ??
    (typeof branchWorkDateKey === "string"
      ? branchWorkDateKey.replace(/^.*__/, `${storeId}__`)
      : typeof workDate === "string"
        ? `${storeId}__${workDate}`
        : undefined);

  return {
    ...rest,
    id: typeof rest.id === "string" ? rest.id : doc.id,
    ownerId: rest.ownerId ?? store?.ownerId ?? shopId,
    storeId,
    ...(rest.storeName || branchName || store?.name
      ? { storeName: rest.storeName ?? branchName ?? store?.name }
      : {}),
    ...(typeof storeWorkDateKey === "string" ? { storeWorkDateKey } : {}),
  };
};

const migrateUsers = async () => {
  const snap = await db.collection("user").get();
  let copied = 0;
  let counters = 0;

  for (const doc of snap.docs) {
    if (CONFIRM) {
      await db.collection("users").doc(doc.id).set(toCanonicalUserData(doc.data()));
    }
    copied += 1;

    const counterSnap = await db
      .collection("user")
      .doc(doc.id)
      .collection("public_code_counters")
      .get();
    for (const counter of counterSnap.docs) {
      if (CONFIRM) {
        await db
          .collection("users")
          .doc(doc.id)
          .collection("public_code_counters")
          .doc(counter.id)
          .set(counter.data());
      }
      counters += 1;
    }
  }

  console.log(`[${tag}] user -> users: ${copied} docs, ${counters} counter docs`);
};

const migrateStoreScoped = async (sourceName, targetSub) => {
  const snap = await db.collection(sourceName).get();
  let moved = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const source = doc.data();
    const storeId = source.storeId ?? source.branchId;
    if (typeof storeId !== "string" || storeId.length === 0) {
      skipped += 1;
      console.warn(`  ! ${sourceName}/${doc.id} has no storeId - skipped`);
      continue;
    }

    const nextData = await toCanonicalStoreScopedData(doc, storeId);
    if (CONFIRM) {
      await db
        .collection("stores")
        .doc(storeId)
        .collection(targetSub)
        .doc(doc.id)
        .set(nextData);
    }
    moved += 1;
  }

  console.log(
    `[${tag}] ${sourceName} -> stores/{storeId}/${targetSub}: ${moved} moved${skipped ? `, ${skipped} skipped` : ""}`,
  );
};

const migrateServiceCatalogs = async () => {
  const snap = await db.collection("service_catalogs").get();
  let moved = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const storeId = doc.id;
    const data = doc.data();
    const groups = Array.isArray(data.groups) ? data.groups : [];
    const store = await getStoreData(storeId);

    if (groups.length === 0) {
      skipped += 1;
      continue;
    }

    for (const group of groups) {
      const categoryId = typeof group.id === "string" && group.id ? group.id : `category_${moved + 1}`;

      if (CONFIRM) {
        await db
          .collection("stores")
          .doc(storeId)
          .collection("service_categories")
          .doc(categoryId)
          .set(
            {
              id: categoryId,
              ownerId: data.ownerId ?? store?.ownerId,
              storeId,
              name: group.name ?? group.label ?? categoryId,
              label: group.label ?? group.name ?? categoryId,
              category: normalizeCategory(group.category),
              sortOrder: group.sortOrder ?? moved + 1,
              serviceCount: group.serviceCount ?? 0,
              createdAt: data.createdAt ?? Date.now(),
              updatedAt: data.updatedAt ?? Date.now(),
            },
            { merge: true },
          );
      }

      moved += 1;
    }
  }

  console.log(
    `[${tag}] service_catalogs -> stores/{storeId}/service_categories/{categoryId}: ${moved} moved${skipped ? `, ${skipped} skipped` : ""}`,
  );
};

const migrateServices = async () => {
  const snap = await db.collection("services").get();
  let moved = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const source = doc.data();
    const storeId = source.storeId ?? source.branchId;
    if (typeof storeId !== "string" || storeId.length === 0) {
      skipped += 1;
      console.warn(`  ! services/${doc.id} has no storeId - skipped`);
      continue;
    }

    const nextData = await toCanonicalStoreScopedData(doc, storeId);
    const category = normalizeCategory(nextData.category);
    const categoryId = getServiceCategoryId({ ...nextData, category });
    const groupName = getServiceGroupName({ ...nextData, category });
    const store = await getStoreData(storeId);
    const timestamp = Date.now();

    if (CONFIRM) {
      const categoryRef = db
        .collection("stores")
        .doc(storeId)
        .collection("service_categories")
        .doc(categoryId);
      const categoryDoc = await categoryRef.get();

      await categoryRef.set(
        {
          id: categoryId,
          ownerId: nextData.ownerId ?? store?.ownerId,
          storeId,
          name: groupName,
          label: groupName,
          category,
          sortOrder: categoryDoc.exists ? categoryDoc.data()?.sortOrder ?? 999 : moved + 1,
          serviceCount: 0,
          ...(categoryDoc.exists ? {} : { createdAt: nextData.createdAt ?? timestamp }),
          updatedAt: timestamp,
        },
        { merge: true },
      );

      await categoryRef.collection("services").doc(doc.id).set({
        ...nextData,
        category,
        groupService: groupName,
        serviceCategoryId: categoryId,
      });
    }

    moved += 1;
  }

  console.log(
    `[${tag}] services -> stores/{storeId}/service_categories/{categoryId}/services/{serviceId}: ${moved} moved${skipped ? `, ${skipped} skipped` : ""}`,
  );
};

const syncServiceCategoryCounts = async () => {
  const stores = await db.collection("stores").get();
  let updated = 0;

  for (const store of stores.docs) {
    const categories = await store.ref.collection("service_categories").get();

    for (const category of categories.docs) {
      const services = await category.ref.collection("services").where("type", "==", "predefined").get();
      if (CONFIRM) {
        await category.ref.set({ serviceCount: services.size, updatedAt: Date.now() }, { merge: true });
      }
      updated += 1;
    }
  }

  console.log(`[${tag}] service category counts synced: ${updated}`);
};

console.log(`=== migrate-to-nested (${tag}) ===`);
await migrateUsers();
await migrateServiceCatalogs();
await migrateServices();
await syncServiceCategoryCounts();
for (const [source, target] of STORE_SCOPED) {
  await migrateStoreScoped(source, target);
}
console.log(
  CONFIRM
    ? "Done. Verify with inspect, then delete old flat collections separately."
    : "Dry-run complete. Re-run with --confirm to write.",
);
