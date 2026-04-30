import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, webhookSecurityEventsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get(
  "/security/webhook-events",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(webhookSecurityEventsTable)
      .orderBy(desc(webhookSecurityEventsTable.createdAt))
      .limit(500);
    res.json(rows);
  },
);

export default router;
