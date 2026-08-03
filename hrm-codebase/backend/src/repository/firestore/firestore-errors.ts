export const isMissingCompositeIndexError = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(candidate.code ?? "").toLowerCase();
  const message = String(candidate.message ?? candidate.details ?? "").toLowerCase();

  return (
    (candidate.code === 9 || code === "9" || code === "failed-precondition") &&
    (message.includes("requires an index") ||
      message.includes("the query requires an index") ||
      message.includes("create_composite"))
  );
};
