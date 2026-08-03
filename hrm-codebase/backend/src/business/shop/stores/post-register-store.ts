import type { Request, Response } from "express";

export const registerOwner = async (_req: Request, res: Response) => {
  return res.status(200).json({ message: "Store registered successfully" });
};
