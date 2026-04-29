import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

// ADMIN_USER_IDS: comma-separated list of Clerk user IDs allowed to use admin endpoints.
// Example: "user_2abc123,user_2xyz456"
// REQUIRED for production. In development without this set, admin endpoints return 503
// rather than failing open and allowing unauthorized paid-order creation.
const ADMIN_USER_IDS = (process.env["ADMIN_USER_IDS"] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (ADMIN_USER_IDS.length === 0) {
  logger.warn(
    "ADMIN_USER_IDS env var is not set. POST /orders (admin manual entry) will return 503. " +
      "Set ADMIN_USER_IDS to your Clerk user ID to enable admin order creation.",
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  const userId = auth?.userId;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Fail-closed: if no admin IDs configured, block access rather than allowing everyone
  if (ADMIN_USER_IDS.length === 0) {
    res.status(503).json({
      error: "Admin no configurado. Contacte al administrador del sistema.",
    });
    return;
  }

  if (!ADMIN_USER_IDS.includes(userId)) {
    logger.warn({ userId }, "Non-admin user attempted admin action");
    res.status(403).json({ error: "Forbidden: se requiere rol de administrador" });
    return;
  }

  next();
}
