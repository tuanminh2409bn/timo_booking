// Seeds deterministic employee work-day closing snapshots in the development database.
// Dry-run by default. Example:
// node scripts/seed-employee-work-day-closings.mjs --storeId=S-1 --workDate=2026-07-22 --employeeId=<uid> --confirm
import { Firestore } from "@google-cloud/firestore";
import dotenv from "dotenv";

dotenv.config();

const getArgument = (name) =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);

const projectId = process.env.GCP_PROJECT_ID;
const databaseId = process.env.FIRESTORE_DATABASE_ID;
const storeId = getArgument("storeId");
const workDate = getArgument("workDate");
const requestedEmployeeId = getArgument("employeeId");
const confirmWrite = process.argv.includes("--confirm");
const overwriteExisting = process.argv.includes("--overwrite");

if (projectId !== "aqueous-thought-498514-m3" || databaseId !== "timmo-hrm-dev") {
  console.error(
    `Refusing to seed project=${projectId ?? "-"} database=${databaseId ?? "-"}. This script only targets timmo-hrm-dev.`,
  );
  process.exit(1);
}

if (!storeId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate ?? "")) {
  console.error(
    "Usage: --storeId=<store-id> --workDate=YYYY-MM-DD [--employeeId=<uid>] [--confirm] [--overwrite]",
  );
  process.exit(1);
}

const firestore = new Firestore({
  databaseId,
  projectId,
  credentials: {
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
});

const storeDocument = await firestore.collection("stores").doc(storeId).get();
const store = storeDocument.data();

if (!storeDocument.exists || typeof store?.ownerId !== "string" || store.ownerId.length === 0) {
  console.error(`Store ${storeId} does not exist or has no ownerId.`);
  process.exit(1);
}

const attendanceSnapshot = await storeDocument.ref
  .collection("attendances")
  .where("workDate", "==", workDate)
  .get();
const attendanceIdsByEmployeeId = new Map();

for (const attendanceDocument of attendanceSnapshot.docs) {
  const attendance = attendanceDocument.data();
  const hasSettlementValue =
    (Array.isArray(attendance.services) && attendance.services.length > 0) ||
    (typeof attendance.subtotalAmount === "number" && attendance.subtotalAmount !== 0) ||
    (typeof attendance.totalAmount === "number" && attendance.totalAmount !== 0);

  if (
    attendance.bookingStatus === "cancelled" ||
    attendance.bookingStatus === "no_show" ||
    !hasSettlementValue
  ) {
    continue;
  }

  const responsibleEmployeeIds = new Set();

  if (Array.isArray(attendance.assignees)) {
    for (const assignee of attendance.assignees) {
      if (
        assignee !== null &&
        typeof assignee === "object" &&
        typeof assignee.employeeUserId === "string" &&
        assignee.employeeUserId.length > 0
      ) {
        responsibleEmployeeIds.add(assignee.employeeUserId);
      }
    }
  }

  if (responsibleEmployeeIds.size === 0 && typeof attendance.employeeUserId === "string") {
    responsibleEmployeeIds.add(attendance.employeeUserId);
  }

  for (const employeeId of responsibleEmployeeIds) {
    const employeeAttendances = attendanceIdsByEmployeeId.get(employeeId) ?? [];
    employeeAttendances.push({
      id: attendanceDocument.id,
      updatedAt:
        typeof attendance.updatedAt === "number" ? attendance.updatedAt : attendanceDocument.updateTime.toMillis(),
    });
    attendanceIdsByEmployeeId.set(employeeId, employeeAttendances);
  }
}

const responsibleEmployeeIds = Array.from(attendanceIdsByEmployeeId.keys()).sort();
const employeeIdsToSeed = requestedEmployeeId ? [requestedEmployeeId] : responsibleEmployeeIds;

if (employeeIdsToSeed.length === 0) {
  console.error(`No responsible employees found for store=${storeId} workDate=${workDate}.`);
  process.exit(1);
}

const plannedClosings = [];

for (const employeeId of employeeIdsToSeed) {
  const employeeAttendances = attendanceIdsByEmployeeId.get(employeeId);

  if (!employeeAttendances || employeeAttendances.length === 0) {
    console.error(
      `Employee ${employeeId} has no settlement attendance for store=${storeId} workDate=${workDate}.`,
    );
    process.exit(1);
  }

  employeeAttendances.sort((left, right) => left.id.localeCompare(right.id));
  const attendanceIds = employeeAttendances.map((attendance) => attendance.id);
  const attendanceVersions = Object.fromEntries(
    employeeAttendances.map((attendance) => [attendance.id, attendance.updatedAt]),
  );
  const closedAt = Math.max(...employeeAttendances.map((attendance) => attendance.updatedAt));
  const closingDocument = storeDocument.ref
    .collection("employee_work_day_closings")
    .doc(`${employeeId}__${workDate}`);
  const existingClosing = await closingDocument.get();

  plannedClosings.push({
    reference: closingDocument,
    exists: existingClosing.exists,
    data: {
      id: closingDocument.id,
      ownerId: store.ownerId,
      storeId,
      workDate,
      employeeUserId: employeeId,
      attendanceIds,
      attendanceVersions,
      closedAt,
      closedByUserId: employeeId,
      createdAt:
        existingClosing.exists && typeof existingClosing.data()?.createdAt === "number"
          ? existingClosing.data().createdAt
          : Date.now(),
      updatedAt: Date.now(),
    },
  });
}

console.log(`project=${projectId} database=${databaseId}`);
console.log(`store=${storeId} workDate=${workDate} attendanceCount=${attendanceSnapshot.size}`);

for (const closing of plannedClosings) {
  console.log(
    `${closing.exists ? "existing" : "new"} ${closing.reference.path} attendanceIds=${closing.data.attendanceIds.join(",")}`,
  );
}

if (!confirmWrite) {
  console.log("Dry-run only. Pass --confirm to write the closing documents.");
  process.exit(0);
}

const batch = firestore.batch();
let writeCount = 0;

for (const closing of plannedClosings) {
  if (closing.exists && !overwriteExisting) {
    console.log(`Skipped existing ${closing.reference.path}. Pass --overwrite to replace it.`);
    continue;
  }

  batch.set(closing.reference, closing.data);
  writeCount += 1;
}

if (writeCount === 0) {
  console.log("No documents required writing.");
  process.exit(0);
}

await batch.commit();
console.log(`Seeded ${writeCount} employee work-day closing document(s).`);
