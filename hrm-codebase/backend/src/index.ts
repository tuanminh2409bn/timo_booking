import "./config/load-env.js";
import { initTracing } from "./config/tracing.js";
import checkEnvVars from "./helpers/verify-env-var.js";
import { logger } from "./modules/logger.js";

type ListenError = Error & {
  code?: string;
};

const main = async () => {
  const tracing = initTracing();

  try {
    checkEnvVars();
    const port = Number(process.env["SERVICE_PORT"]);

    if (!Number.isInteger(port) || port <= 0) {
      throw new Error("SERVICE_PORT must be a positive integer");
    }

    const host = process.env["SERVICE_HOST"] ?? "0.0.0.0";
    const { default: app } = await import("./app.js");
    const server = app.listen(port, host, () => {
      logger.info({ host, port }, "server started");
    });

    const shutdown = async (signal: NodeJS.Signals) => {
      logger.info({ signal, tracingEnabled: tracing.enabled }, "server shutdown requested");

      server.close(async (error) => {
        if (error) {
          logger.error(
            { errorName: error.name, errorMessage: error.message },
            "server shutdown failed",
          );
          process.exit(1);
        }

        await tracing.shutdown();
        logger.info("server shutdown completed");
        process.exit(0);
      });
    };

    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);

    server.on("error", (error: ListenError) => {
      if (error.code === "EADDRINUSE") {
        logger.error({ port }, "server port already in use");
      } else {
        logger.error(
          { errorName: error.name, errorMessage: error.message, stack: error.stack },
          "server failed to start",
        );
      }

      process.exit(1);
    });
  } catch (error) {
    logger.error(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack !== undefined && { stack: error.stack }),
      },
      "server bootstrap failed",
    );
    await tracing.shutdown();
    process.exit(1);
  }
};

main();
