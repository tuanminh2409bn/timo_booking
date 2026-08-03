import dotenv from "dotenv";

dotenv.config({ quiet: true });
const verifyEnvVars = () => {
  const isProduction = process.env["NODE_ENV"] === "production";
  const requiredVars =
    isProduction
      ? [
        "SERVICE_PORT",
        "JWT_SECRET",
        "CORS_ALLOWED_ORIGINS",
        "GCP_PROJECT_ID",
        "FIRESTORE_DATABASE_ID",
        "FIREBASE_STORAGE_BUCKET",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USER",
        "SMTP_PASS",
        "SMTP_FROM",
        "APP_CHECK_MODE",
      ]
      : [
        "SERVICE_PORT",
        "JWT_SECRET",
        "GCP_PROJECT_ID",
        "FIRESTORE_DATABASE_ID",
      ];

  const missingVars = requiredVars.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(", ")}`);
  }

  const appCheckMode = process.env["APP_CHECK_MODE"];

  if (isProduction && appCheckMode !== "required") {
    throw new Error("APP_CHECK_MODE must be required when NODE_ENV=production");
  }

  if (
    appCheckMode !== undefined &&
    appCheckMode !== "off" &&
    appCheckMode !== "monitor" &&
    appCheckMode !== "required"
  ) {
    throw new Error("APP_CHECK_MODE must be one of: off, monitor, required");
  }
};

export default verifyEnvVars;
