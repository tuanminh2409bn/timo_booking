import "../config/load-env.js";
import { runDataRetentionJob } from "./data-retention-runtime.js";

runDataRetentionJob().catch(() => {
  process.exitCode = 1;
});
