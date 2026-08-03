import type { Request } from "express";

export const getStoreIdFromUrlPath = (req: Request): string | undefined => {
  const fromParams = req.params?.["storeId"];

  return typeof fromParams === "string" && fromParams.length > 0 ? fromParams : undefined;
};

// Store-scoped resources live under the nested path `/stores/:storeId/...`. This injects that
// path `:storeId` into the object handed to a schema parser, so handlers validating a flat
// `{ storeId, ...fields }` shape pick the store up from the route.
export const mergeUrlPathStoreId = <T extends object>(req: Request, source: T): T => ({
  ...source,
  storeId: getStoreIdFromUrlPath(req),
});
