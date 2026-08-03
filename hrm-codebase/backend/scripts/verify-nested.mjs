// READ-ONLY: directly counts each store's subcollections (not collection group) and
// compares to the old flat top-level collections, so we can confirm the nested copy is
// complete before deleting flat data.
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

const SUBS = [
  "services",
  "attendances",
  "expenses",
  "employee_work_day_closings",
  "work_day_settlements",
  "attendance_correction_requests",
  "weekly_reports",
  "service_categories",
];

const stores = await db.collection("stores").get();
console.log(`stores: ${stores.size}`);

const countCategoryServices = async (storeId) => {
  const categories = await db.collection("stores").doc(storeId).collection("service_categories").get();
  let total = 0;

  for (const category of categories.docs) {
    total += (await category.ref.collection("services").get()).size;
  }

  return total;
};

for (const sub of SUBS) {
  let nested = 0;
  let legacySibling = 0;
  for (const store of stores.docs) {
    if (sub === "services") {
      nested += await countCategoryServices(store.id);
      legacySibling += (await db.collection("stores").doc(store.id).collection("services").get()).size;
    } else {
      const snap = await db.collection("stores").doc(store.id).collection(sub).get();
      nested += snap.size;
    }
  }
  const flat = (await db.collection(sub).get()).size;
  const ok = nested >= flat && legacySibling === 0 ? "OK" : "INCOMPLETE";
  console.log(`- ${sub}: nested=${nested}  flat=${flat}  legacySibling=${legacySibling}  [${ok}]`);
}

const usersNew = (await db.collection("users").get()).size;
const usersOld = (await db.collection("user").get()).size;
console.log(`- users: new=${usersNew}  old=${usersOld}  [${usersNew >= usersOld ? "OK" : "INCOMPLETE"}]`);
