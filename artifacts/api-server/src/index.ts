import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";

async function closePool() {
  try {
    await pool.end();
  } catch (error) {
    logger.error({ err: error }, "Error closing database pool");
    process.exitCode = 1;
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer() {
  pool.on("error", (error: Error) => logger.error({ err: error }, "Idle database client error"));
  await pool.query("SELECT 1");
  const server = app.listen(port, () => logger.info({ port }, "Server listening"));
  server.on("error", (error) => {
    logger.error({ err: error }, "Error listening on port");
    process.exitCode = 1;
    void closePool();
  });

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "Shutting down server");
    server.close((error) => {
      if (error) {
        logger.error({ err: error }, "Error closing HTTP server");
        process.exitCode = 1;
      }
      void closePool();
    });
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

startServer().catch((error: unknown) => {
  logger.error({ err: error }, "Could not start API server");
  process.exitCode = 1;
  void closePool();
});
