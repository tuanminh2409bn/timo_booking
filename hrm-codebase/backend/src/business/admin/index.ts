import express from "express";
import { z } from "zod";
import { verifyFirebaseAuthHeader } from "../../modules/verify-firebase-auth-header.js";
import { firebaseAuthRepository } from "../../repository/firebase-auth/index.js";
import { firestoreAuth, firestoreRepository } from "../../repository/firestore/index.js";

const router = express.Router();

const authorize = async (request: express.Request, response: express.Response) => {
  const { uid } = await verifyFirebaseAuthHeader(request.headers["authorization"]);
  const authContext = await firestoreRepository.user.getUser(uid).catch(() => undefined);
  if (!authContext || authContext.role !== "admin" || !authContext.active) {
    response.status(403).json({ message: "Platform admin access required" });
    return undefined;
  }
  return authContext;
};

router.get("/api/v1/admin/accounts", async (request, response) => {
  if (!await authorize(request, response)) return;
  const snapshot = await firestoreAuth.collection("users").limit(500).get();
  return response.status(200).json({
    items: snapshot.docs.map((document) => {
      const data = document.data();
      return {
        uid: document.id,
        email: data["email"],
        name: data["name"] ?? data["displayName"] ?? data["email"],
        role: data["role"],
        ownerId: data["ownerId"],
        storeId: data["storeId"],
        active: data["active"] !== false,
        createdAt: data["createdAt"],
      };
    }),
  });
});

router.get("/api/v1/admin/summary", async (request, response) => {
  if (!await authorize(request, response)) return;
  const [users, stores, bookings] = await Promise.all([
    firestoreAuth.collection("users").count().get(),
    firestoreAuth.collection("stores").count().get(),
    firestoreAuth.collectionGroup("bookings").count().get(),
  ]);
  return response.status(200).json({
    totalUsers: users.data().count,
    totalStores: stores.data().count,
    totalBookings: bookings.data().count,
  });
});

router.patch("/api/v1/admin/accounts/:uid", async (request, response) => {
  const actor = await authorize(request, response);
  if (!actor) return;
  const parsed = z.object({ active: z.boolean() }).safeParse(request.body);
  const uid = String(request.params["uid"] ?? "");
  if (!parsed.success || !uid || uid === actor.uid) {
    return response.status(400).json({ message: "Invalid account update" });
  }

  const target = await firestoreRepository.user.getUser(uid);
  await Promise.all([
    firestoreRepository.user.updateUser(uid, {
      active: parsed.data.active,
      updatedAt: Date.now(),
      updatedByUserId: actor.uid,
    }),
    firebaseAuthRepository.auth.updateUserProfile(uid, { disabled: !parsed.data.active }),
    !parsed.data.active
      ? firebaseAuthRepository.auth.revokeRefreshTokens(uid)
      : Promise.resolve(),
  ]);
  return response.status(200).json({ uid, active: parsed.data.active, role: target.role });
});

router.get("/api/v1/admin/stores", async (request, response) => {
  if (!await authorize(request, response)) return;
  const snapshot = await firestoreAuth
    .collection("stores")
    .orderBy("createdAt", "desc")
    .limit(500)
    .get();
  return response.status(200).json({
    items: snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
  });
});

router.patch("/api/v1/admin/stores/:storeId", async (request, response) => {
  if (!await authorize(request, response)) return;
  const parsed = z.object({ status: z.enum(["active", "disabled"]) }).safeParse(request.body);
  const storeId = String(request.params["storeId"] ?? "");
  if (!parsed.success || !storeId) {
    return response.status(400).json({ message: "Invalid store update" });
  }
  await firestoreAuth.collection("stores").doc(storeId).update({
    status: parsed.data.status,
    updatedAt: Date.now(),
  });
  return response.status(200).json({ id: storeId, status: parsed.data.status });
});

export default router;
