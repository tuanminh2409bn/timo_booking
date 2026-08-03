const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_KEYS = new Set(
  [
    "authorization",
    "password",
    "newPassword",
    "otp",
    "resetToken",
    "jwtToken",
    "firebaseToken",
    "idToken",
    "token",
    "base64",
    "bankAccount",
    "taxCode",
  ].map((key) => key.toLowerCase()),
);

const shouldRedactKey = (key: string) => SENSITIVE_KEYS.has(key.toLowerCase());

export const redactSensitive = (value: unknown): unknown => {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      shouldRedactKey(key) ? REDACTED_VALUE : redactSensitive(entryValue),
    ]),
  );
};

export const redactSensitiveRecord = (value: Record<string, unknown>) =>
  redactSensitive(value) as Record<string, unknown>;
