import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// ADMIN_USER_IDS: comma-separated list of Clerk user IDs allowed to use admin endpoints.
// Example: "user_2abc123,user_2xyz456"
// Set this in the Replit environment secrets as a non-sensitive env var.
const ADMIN_USER_IDS = (process.env["ADMIN_USER_IDS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (ADMIN_USER_IDS.length > 0 && !ADMIN_USER_IDS.includes(userId)) {
    logger.warn({ userId }, "Non-admin user attempted admin action");
    res.status(403).json({ error: "Forbidden: se requiere rol de administrador" });
    return;
  }
  next();
}
