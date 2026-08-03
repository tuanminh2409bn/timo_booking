import type {
  NextFunction,
  Request,
  Response,
} from "express";

export const handleErrorFunction =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await Promise.resolve(fn(req, res));
      } catch (error: unknown) {
        next(error);
      }
    };
