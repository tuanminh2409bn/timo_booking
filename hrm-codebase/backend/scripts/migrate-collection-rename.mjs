// Copies all docs from one Firestore collection to another (preserving doc ids).
// Idempotent (set overwrites). Dry-run by default; pass --confirm to write.
//   node scripts/migrate-collection-rename.mjs --from=weekly-report --to=weekly_reports
//   node scripts/migrate-collection-rename.mjs --from=weekly-report --to=weekly_reports --confirm
import { Firestore } from "@google-cloud/firestore";
import dotenv from "dotenv";

dotenv.config();

const getArg = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const CONFIRM = process.argv.includes("--confirm");
const fromCollection = getArg("from");
const toCollection = getArg("to");

if (!fromCollection || !toCollection) {
  console.error("Usage: --from=<collection> --to=<collection> [--confirm]");
  process.exit(1);
}

const db = new Firestore({
  databaseId: process.env.FIRESTORE_DATABASE_ID,
  projectId: process.env.GCP_PROJECT_ID,
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
});

const snapshot = await db.collection(fromCollection).get();
console.log(
  `${fromCollection} -> ${toCollection}: ${snapshot.size} docs ${CONFIRM ? "copying" : "(dry-run, pass --confirm)"}`,
);

if (CONFIRM) {
  let copied = 0;
  for (const doc of snapshot.docs) {
    await db.collection(toCollection).doc(doc.id).set(doc.data());
    copied += 1;
  }
  console.log(`Copied ${copied} docs to ${toCollection}.`);
}
