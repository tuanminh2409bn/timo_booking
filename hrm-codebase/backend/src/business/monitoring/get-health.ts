import type { Request, Response } from "express";

const SERVICE_NAME = "nail-salon-backend";
const SERVICE_VERSION = process.env["npm_package_version"] ?? "1.0.0";

export const getHealth = async (_req: Request, res: Response) => {
  return res.status(200).json({
    status: "ok",
    service: SERVICE_NAME,
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version: SERVICE_VERSION,
  });
};
