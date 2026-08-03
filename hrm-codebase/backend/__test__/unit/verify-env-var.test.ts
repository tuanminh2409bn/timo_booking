import { afterAll, beforeEach, describe, expect, it } from "vitest";
import verifyEnvVars from "../../src/helpers/verify-env-var.js";

const managedEnvironmentVariableNames = [
  "APP_CHECK_MODE",
  "CORS_ALLOWED_ORIGINS",
  "FIREBASE_STORAGE_BUCKET",
  "FIRESTORE_DATABASE_ID",
  "GCP_PROJECT_ID",
  "JWT_SECRET",
  "NODE_ENV",
  "SERVICE_PORT",
  "SMTP_FROM",
  "SMTP_HOST",
  "SMTP_PASS",
  "SMTP_PORT",
  "SMTP_USER",
] as const;

const originalEnvironmentVariableValues = new Map(
  managedEnvironmentVariableNames.map((variableName) => [
    variableName,
    process.env[variableName],
  ]),
);

const setValidProductionEnvironment = () => {
  process.env["NODE_ENV"] = "production";
  process.env["SERVICE_PORT"] = "8080";
  process.env["JWT_SECRET"] = "test-secret";
  process.env["CORS_ALLOWED_ORIGINS"] = "https://example.com";
  process.env["GCP_PROJECT_ID"] = "test-project";
  process.env["FIRESTORE_DATABASE_ID"] = "test-database";
  process.env["FIREBASE_STORAGE_BUCKET"] = "test-bucket";
  process.env["SMTP_HOST"] = "smtp.example.com";
  process.env["SMTP_PORT"] = "587";
  process.env["SMTP_USER"] = "test-user";
  process.env["SMTP_PASS"] = "test-password";
  process.env["SMTP_FROM"] = "test@example.com";
};

describe("verifyEnvVars", () => {
  beforeEach(() => {
    for (const variableName of managedEnvironmentVariableNames) {
      delete process.env[variableName];
    }

    setValidProductionEnvironment();
  });

  afterAll(() => {
    for (const variableName of managedEnvironmentVariableNames) {
      const originalValue = originalEnvironmentVariableValues.get(variableName);

      if (originalValue === undefined) {
        delete process.env[variableName];
      } else {
        process.env[variableName] = originalValue;
      }
    }
  });

  it("requires APP_CHECK_MODE in production", () => {
    expect(() => verifyEnvVars()).toThrow(
      "Missing required environment variables: APP_CHECK_MODE",
    );
  });

  it.each(["off", "monitor"])(
    "rejects APP_CHECK_MODE=%s in production",
    (appCheckMode) => {
      process.env["APP_CHECK_MODE"] = appCheckMode;

      expect(() => verifyEnvVars()).toThrow(
        "APP_CHECK_MODE must be required when NODE_ENV=production",
      );
    },
  );

  it("accepts required App Check enforcement in production", () => {
    process.env["APP_CHECK_MODE"] = "required";

    expect(() => verifyEnvVars()).not.toThrow();
  });

  it("keeps monitor mode available outside production", () => {
    process.env["NODE_ENV"] = "develop";
    process.env["APP_CHECK_MODE"] = "monitor";

    expect(() => verifyEnvVars()).not.toThrow();
  });
});
