import type { Request, Response } from "express";
import { getMetricsText, metricsRegister } from "../../modules/metrics.js";

export const getMetrics = async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", metricsRegister.contentType);
  return res.status(200).send(await getMetricsText());
};
