import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    const data = HealthCheckResponse.parse({ status: "ok" });
    return res.json(data);
  } catch (error) {
    req.log?.error({ err: error }, "Database health check failed");
    return res.status(503).json({ error: "Database unavailable." });
  }
});

export default router;
