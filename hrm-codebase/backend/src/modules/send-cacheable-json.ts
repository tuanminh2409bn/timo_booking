import { createHash } from "node:crypto";
import type { Request, Response } from "express";

type SendCacheableJsonOptions = {
  statusCode?: number;
  cacheControl?: string;
  vary?: string[];
};

const buildEtag = (body: string) =>
  `W/"${createHash("sha1").update(body).digest("hex")}"`;

const requestHasMatchingEtag = (request: Request, etag: string) => {
  const ifNoneMatch = request.headers["if-none-match"];

  if (typeof ifNoneMatch !== "string" || ifNoneMatch.length === 0) {
    return false;
  }

  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .includes(etag);
};

export const sendCacheableJson = (
  request: Request,
  response: Response,
  payload: unknown,
  options: SendCacheableJsonOptions = {},
) => {
  const body = JSON.stringify(payload);
  const etag = buildEtag(body);

  response.setHeader(
    "Cache-Control",
    options.cacheControl ?? "private, no-cache, max-age=0, must-revalidate",
  );
  response.setHeader("ETag", etag);
  response.setHeader("Vary", (options.vary ?? ["Authorization", "Accept-Encoding"]).join(", "));

  if (requestHasMatchingEtag(request, etag)) {
    return response.status(304).end();
  }

  response.type("application/json");
  return response.status(options.statusCode ?? 200).send(body);
};
