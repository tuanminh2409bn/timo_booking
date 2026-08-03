// Moves store-level service docs into the canonical category-owned shape:
// stores/{storeId}/services/{serviceId}
//   -> stores/{storeId}/service_categories/{categoryId}/services/{serviceId}
//
// Dry-run by default. Pass --confirm to write. Add --deleteLegacy to remove the
// old sibling stores/{storeId}/services collection after the copy is verified.
import dotenv from "dotenv";
import { Firestore } from "@google-cloud/firestore";

dotenv.config();

const args = new Set(process.argv.slice(2));
const CONFIRM = args.has("--confirm");
const DELETE_LEGACY = args.has("--deleteLegacy");

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(
  /\\n/g,
  "\n",
);

const db = new Firestore({
  projectId: process.env.GCP_PROJECT_ID,
  databaseId: process.env.FIRESTORE_DATABASE_ID,
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: privateKey,
  },
});

const CATEGORY_LABELS = {
  nail: "Nail",
  manicure: "Manicure",
  pedicure: "Pedicure",
  design: "Design",
  other: "Other",
};

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

const normalizeCategory = (value) =>
  ["nail", "manicure", "pedicure", "design", "other"].includes(value) ? value : "other";

const getGroupName = (service) => {
  const category = normalizeCategory(service.category);
  return service.groupService?.trim() || CATEGORY_LABELS[category];
};

const getCategoryId = (service) => {
  const category = normalizeCategory(service.category);
  return `category_${slugify(getGroupName(service), category)}`;
};

const stores = await db.collection("stores").get();
const summary = {
  mode: CONFIRM ? "write" : "dry-run",
  deleteLegacy: DELETE_LEGACY,
  stores: stores.size,
  legacyServices: 0,
  copiedServices: 0,
  deletedLegacyCollections: 0,
  categoryCountsUpdated: 0,
};

for (const storeDoc of stores.docs) {
  const storeId = storeDoc.id;
  const legacyServicesRef = db.collection("stores").doc(storeId).collection("services");
  const legacyServices = await legacyServicesRef.get();
  summary.legacyServices += legacyServices.size;

  const categoriesSeen = new Set();

  for (const serviceDoc of legacyServices.docs) {
    const service = serviceDoc.data();
    const category = normalizeCategory(service.category);
    const categoryId = getCategoryId(service);
    const groupName = getGroupName(service);
    categoriesSeen.add(categoryId);

    if (CONFIRM) {
      const categoryRef = db
        .collection("stores")
        .doc(storeId)
        .collection("service_categories")
        .doc(categoryId);
      const categoryDoc = await categoryRef.get();
      const timestamp = Date.now();

      await categoryRef.set(
        {
          id: categoryId,
          ownerId: service.ownerId ?? storeDoc.data().ownerId,
          storeId,
          name: groupName,
          label: groupName,
          category,
          sortOrder: categoryDoc.exists ? categoryDoc.data()?.sortOrder ?? 999 : categoriesSeen.size,
          serviceCount: 0,
          ...(categoryDoc.exists ? {} : { createdAt: service.createdAt ?? timestamp }),
          updatedAt: timestamp,
        },
        { merge: true },
      );

      await categoryRef.collection("services").doc(serviceDoc.id).set(
        {
          ...service,
          id: service.id ?? serviceDoc.id,
          ownerId: service.ownerId ?? storeDoc.data().ownerId,
          storeId,
          category,
          groupService: groupName,
          serviceCategoryId: categoryId,
        },
        { merge: true },
      );
    }

    summary.copiedServices += 1;
  }

  const categories = await db
    .collection("stores")
    .doc(storeId)
    .collection("service_categories")
    .get();

  for (const categoryDoc of categories.docs) {
    const services = await categoryDoc.ref.collection("services").where("type", "==", "predefined").get();
    if (CONFIRM) {
      await categoryDoc.ref.set({ serviceCount: services.size, updatedAt: Date.now() }, { merge: true });
    }
    summary.categoryCountsUpdated += 1;
  }

  if (CONFIRM && DELETE_LEGACY && !legacyServices.empty) {
    await db.recursiveDelete(legacyServicesRef);
    summary.deletedLegacyCollections += 1;
  }
}

console.log(JSON.stringify(summary, null, 2));
if (!CONFIRM) {
  console.log("Dry-run complete. Re-run with --confirm, then --confirm --deleteLegacy after reviewing counts.");
}
