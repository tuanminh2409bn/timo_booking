// Remove deprecated service image fields from canonical nested services.
// Dry-run by default.
//
//   node scripts/cleanup-service-image-fields.mjs
//   node scripts/cleanup-service-image-fields.mjs --execute --backup-confirmed
//   node scripts/cleanup-service-image-fields.mjs --execute --exportUri=gs://bucket/export-path
import { FieldValue, Firestore } from "@google-cloud/firestore";
import dotenv from "dotenv";

dotenv.config();

const args = new Set(process.argv.slice(2));
const getArg = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const EXECUTE = args.has("--execute");
const BACKUP_CONFIRMED = args.has("--backup-confirmed") || Boolean(getArg("exportUri"));
const IMAGE_FIELDS = ["imageUrls", "images", "image"];
const LEGACY_CATALOG_COLLECTIONS = ["service_catalog", "service_catalogs"];

const db = new Firestore({
  databaseId: process.env.FIRESTORE_DATABASE_ID,
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const getSample = (samples, value) => {
  if (samples.length < 10) {
    samples.push(value);
  }
};

const chunk = (values, size) => {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

const catalogHasImageFields = (catalog) => {
  const groups = Array.isArray(catalog.groups) ? catalog.groups : [];

  return groups.some((group) =>
    (Array.isArray(group?.services) ? group.services : []).some((service) =>
      service && typeof service === "object" && IMAGE_FIELDS.some((field) => hasOwn(service, field)),
    ),
  );
};

const scanCanonicalServices = async () => {
  const stores = await db.collection("stores").get();
  const serviceUpdates = [];
  const summary = {
    storesScanned: stores.size,
    categoriesScanned: 0,
    servicesScanned: 0,
    documentsToUpdate: 0,
    fieldCounts: Object.fromEntries(IMAGE_FIELDS.map((field) => [field, 0])),
    samples: [],
  };

  for (const store of stores.docs) {
    const categories = await store.ref.collection("service_categories").get();
    summary.categoriesScanned += categories.size;

    for (const category of categories.docs) {
      const services = await category.ref.collection("services").get();
      summary.servicesScanned += services.size;

      for (const doc of services.docs) {
        const data = doc.data();
        const fieldsToDelete = IMAGE_FIELDS.filter((field) => hasOwn(data, field));

        if (fieldsToDelete.length === 0) {
          continue;
        }

        for (const field of fieldsToDelete) {
          summary.fieldCounts[field] += 1;
        }

        summary.documentsToUpdate += 1;
        getSample(summary.samples, {
          path: doc.ref.path,
          ownerId: data.ownerId,
          storeId: data.storeId,
          serviceCategoryId: data.serviceCategoryId,
          fields: fieldsToDelete,
        });
        serviceUpdates.push({ ref: doc.ref, fieldsToDelete });
      }
    }
  }

  return { serviceUpdates, summary };
};

const scanLegacyCatalogs = async () => {
  const catalogDeletes = [];
  const summary = {
    collections: LEGACY_CATALOG_COLLECTIONS,
    scanned: 0,
    documentsToDelete: 0,
    samples: [],
  };

  for (const collectionName of LEGACY_CATALOG_COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();
    summary.scanned += snapshot.size;

    for (const doc of snapshot.docs) {
      const data = doc.data();

      if (!catalogHasImageFields(data)) {
        continue;
      }

      summary.documentsToDelete += 1;
      getSample(summary.samples, {
        path: doc.ref.path,
        ownerId: data.ownerId,
        storeId: data.storeId ?? doc.id,
      });
      catalogDeletes.push(doc.ref);
    }
  }

  return { catalogDeletes, summary };
};

const run = async () => {
  if (EXECUTE && !BACKUP_CONFIRMED) {
    throw new Error("Execute requires --backup-confirmed or --exportUri=gs://...");
  }

  const [{ serviceUpdates, summary: services }, { catalogDeletes, summary: legacyServiceCatalogs }] =
    await Promise.all([scanCanonicalServices(), scanLegacyCatalogs()]);

  if (EXECUTE) {
    for (const batchItems of chunk(serviceUpdates, 450)) {
      const batch = db.batch();

      for (const item of batchItems) {
        batch.set(
          item.ref,
          Object.fromEntries(item.fieldsToDelete.map((field) => [field, FieldValue.delete()])),
          { merge: true },
        );
      }

      await batch.commit();
    }

    for (const batchItems of chunk(catalogDeletes, 450)) {
      const batch = db.batch();

      for (const ref of batchItems) {
        batch.delete(ref);
      }

      await batch.commit();
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: EXECUTE ? "execute" : "dry-run",
        projectId: process.env.GCP_PROJECT_ID,
        databaseId: process.env.FIRESTORE_DATABASE_ID,
        deleteFields: IMAGE_FIELDS,
        action: EXECUTE
          ? "deleted service image fields from canonical nested services and removed stale legacy catalog docs"
          : "dry-run only",
        summary: {
          services,
          legacyServiceCatalogs,
        },
      },
      null,
      2,
    ),
  );
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("CLEANUP SERVICE IMAGE FIELDS FAILED:", error.message);
    process.exit(1);
  });
