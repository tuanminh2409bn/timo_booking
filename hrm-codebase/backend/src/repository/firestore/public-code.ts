import type { Firestore } from "@google-cloud/firestore";
import {
  formatPublicCode,
  PUBLIC_CODE_CONFIG,
  type PublicCodeType,
} from "../../helpers/public-code.js";

type PublicCodeCounter = {
  type: PublicCodeType;
  prefix: string;
  scope: "global" | "owner";
  scopeId: string;
  current: number;
  createdAt?: number;
  updatedAt: number;
};

const GLOBAL_SCOPE_ID = "global";

const getCounterReference = (
  firestoreDB: Firestore,
  type: PublicCodeType,
  ownerId?: string,
) => {
  if (type === "shop") {
    return firestoreDB.collection("admin").doc("public_code_counters").collection("global").doc(type);
  }

  if (!ownerId) {
    throw new Error(`Owner-scoped public code '${type}' requires ownerId`);
  }

  return firestoreDB.collection("users").doc(ownerId).collection("public_code_counters").doc(type);
};

export const reservePublicCode = async (
  firestoreDB: Firestore,
  type: PublicCodeType,
  ownerId?: string,
): Promise<string> => {
  const [code] = await reservePublicCodeRange(firestoreDB, type, 1, ownerId);
  if (!code) {
    throw new Error(`Unable to reserve public code for '${type}'`);
  }

  return code;
};

export const reservePublicCodeRange = async (
  firestoreDB: Firestore,
  type: PublicCodeType,
  count: number,
  ownerId?: string,
): Promise<string[]> => {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Public code range count must be a positive integer");
  }

  const counterRef = getCounterReference(firestoreDB, type, ownerId);

  return firestoreDB.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const data = snapshot.exists ? (snapshot.data() as Partial<PublicCodeCounter>) : undefined;
    const currentValue = data?.current;
    const current =
      typeof currentValue === "number" && Number.isInteger(currentValue) && currentValue > 0
        ? currentValue
        : 0;
    const nextCurrent = current + count;
    const timestamp = Date.now();
    const scope = type === "shop" ? "global" : "owner";
    const scopeId = type === "shop" ? GLOBAL_SCOPE_ID : ownerId;

    if (scopeId === undefined) {
      throw new Error(`Owner-scoped public code '${type}' requires ownerId`);
    }

    transaction.set(
      counterRef,
      {
        type,
        prefix: PUBLIC_CODE_CONFIG[type].prefix,
        scope,
        scopeId,
        current: nextCurrent,
        ...(snapshot.exists ? {} : { createdAt: timestamp }),
        updatedAt: timestamp,
      } satisfies PublicCodeCounter,
      { merge: true },
    );

    return Array.from({ length: count }, (_, index) => formatPublicCode(type, current + index + 1));
  });
};
