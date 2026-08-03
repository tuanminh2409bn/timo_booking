// Audit employee Firestore fields and optionally delete fields proven unused.
// Dry-run by default.
//
//   node scripts/audit-employee-fields.mjs
//   node scripts/audit-employee-fields.mjs --execute --backup-confirmed
//   node scripts/audit-employee-fields.mjs --execute --exportUri=gs://bucket/export-path
import { FieldValue, Firestore } from "@google-cloud/firestore";
import dotenv from "dotenv";

dotenv.config();

const args = new Set(process.argv.slice(2));
const getArg = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const EXECUTE = args.has("--execute");
const BACKUP_CONFIRMED = args.has("--backup-confirmed") || Boolean(getArg("exportUri"));
const INCLUDE_OWNER_COMMISSION = args.has("--include-owner-commission-rate");

const DELETE_FIELDS = ["kpi", "shiftsCompleted", "salary", "absent", "label", "value"];
const REPORT_ONLY_FIELDS = ["ownerCommissionRate"];
const deleteFields = INCLUDE_OWNER_COMMISSION
  ? [...DELETE_FIELDS, "ownerCommissionRate"]
  : DELETE_FIELDS;
const auditFields = [...new Set([...deleteFields, ...REPORT_ONLY_FIELDS])];

const db = new Firestore({
  databaseId: process.env.FIRESTORE_DATABASE_ID,
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n",
    ),
  },
});

const getSample = (samples, value) => {
  if (samples.length < 5) {
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

const run = async () => {
  if (EXECUTE && !BACKUP_CONFIRMED) {
    throw new Error("Execute requires --backup-confirmed or --exportUri=gs://...");
  }

  const snapshot = await db.collection("users").where("role", "==", "employee").get();
  const summary = Object.fromEntries(
    auditFields.map((field) => [
      field,
      {
        action: deleteFields.includes(field) ? (EXECUTE ? "delete" : "dry-run-delete") : "report-only",
        count: 0,
        samples: [],
      },
    ]),
  );
  const updates = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const fieldsToDelete = [];

    for (const field of auditFields) {
      if (!(field in data)) {
        continue;
      }

      summary[field].count += 1;
      getSample(summary[field].samples, doc.ref.path);

      if (deleteFields.includes(field)) {
        fieldsToDelete.push(field);
      }
    }

    if (fieldsToDelete.length > 0) {
      updates.push({ ref: doc.ref, fieldsToDelete });
    }
  }

  if (EXECUTE) {
    for (const batchItems of chunk(updates, 450)) {
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
  }

  console.log(
    JSON.stringify(
      {
        mode: EXECUTE ? "execute" : "dry-run",
        projectId: process.env.GCP_PROJECT_ID,
        databaseId: process.env.FIRESTORE_DATABASE_ID,
        employeeDocsScanned: snapshot.size,
        deleteFields,
        reportOnlyFields: REPORT_ONLY_FIELDS,
        documentsToUpdate: updates.length,
        summary,
      },
      null,
      2,
    ),
  );
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("AUDIT EMPLOYEE FIELDS FAILED:", error.message);
    process.exit(1);
  });
