import { describe, expect, it } from "vitest";
import { redactSensitive } from "../../src/helpers/redact-sensitive.js";

describe("redactSensitive", () => {
  it("redacts sensitive keys in nested objects and arrays", () => {
    const redacted = redactSensitive({
      Authorization: "Bearer secret",
      authorization: "Bearer lower-case-secret",
      password: "secret-password",
      keep: "visible",
      nested: {
        newPassword: "new-secret",
        otp: "123456",
        taxCode: "tax-secret",
        list: [
          {
            jwtToken: "jwt-secret",
            firebaseToken: "firebase-secret",
            idToken: "id-secret",
            token: "generic-secret",
            base64: "image-secret",
            bankAccount: "bank-secret",
          },
          {
            safe: "value",
          },
        ],
      },
    });

    expect(redacted).toEqual({
      Authorization: "[REDACTED]",
      authorization: "[REDACTED]",
      password: "[REDACTED]",
      keep: "visible",
      nested: {
        newPassword: "[REDACTED]",
        otp: "[REDACTED]",
        taxCode: "[REDACTED]",
        list: [
          {
            jwtToken: "[REDACTED]",
            firebaseToken: "[REDACTED]",
            idToken: "[REDACTED]",
            token: "[REDACTED]",
            base64: "[REDACTED]",
            bankAccount: "[REDACTED]",
          },
          {
            safe: "value",
          },
        ],
      },
    });
  });

  it("leaves primitive values unchanged", () => {
    expect(redactSensitive("token-looking-string")).toBe("token-looking-string");
    expect(redactSensitive(123)).toBe(123);
    expect(redactSensitive(null)).toBeNull();
  });
});
