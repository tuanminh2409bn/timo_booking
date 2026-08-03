import type { Request, Response } from "express";
import checkEnvVars from "../../helpers/verify-env-var.js";
import { getCacheHealthStatus } from "../../repository/cache/cache-client.js";
import { firestoreRepository } from "../../repository/firestore/index.js";

type ReadinessCheckStatus = "ok" | "degraded" | "error";

const checkEnv = (): ReadinessCheckStatus => {
  try {
    checkEnvVars();
    return "ok";
  } catch {
    return "error";
  }
};

const checkFirestore = (): ReadinessCheckStatus => {
  try {
    return typeof firestoreRepository.shop.store.getStore === "function" ? "ok" : "error";
  } catch {
    return "error";
  }
};

export const getReadiness = async (_req: Request, res: Response) => {
  const checks = {
    env: checkEnv(),
    firestore: checkFirestore(),
    cache: await getCacheHealthStatus(),
  };
  const isReady = checks.env === "ok" && checks.firestore === "ok" && checks.cache !== "error";

  return res.status(isReady ? 200 : 503).json({
    status: isReady ? "ready" : "not_ready",
    checks,
    timestamp: new Date().toISOString(),
  });
};
