import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__test__/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: [
        "src/app.ts",
        "src/business/**/*.ts",
        "src/helpers/auth-session.ts",
        "src/helpers/cache-keys.ts",
        "src/helpers/password-reset-otp.ts",
        "src/helpers/role-access.ts",
        "src/helpers/verify-work-date.ts",
        "src/helpers/work-date-utils.ts",
        "src/modules/**/*.ts",
      ],
      exclude: [
        "src/business/employee/attendance-presentation.ts",
        "src/business/employee/attendance-shared.ts",
        "src/business/employee/employee-shared.ts",
        "src/business/shop/post-register-store.ts",
        "src/helpers/attendance-discount.ts",
        "src/helpers/password-reset-mailer.ts",
        "src/helpers/work-day-settlement.ts",
        "src/index.ts",
        "src/repository/**",
        "src/scripts/**",
        "src/types/**",
        "**/*.d.ts",
      ],
      thresholds: {
        branches: 65,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
