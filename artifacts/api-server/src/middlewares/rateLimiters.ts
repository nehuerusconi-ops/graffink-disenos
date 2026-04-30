import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";

// Per-IP limiter for the public buyer "look up my purchases by email" endpoint.
// Without this, anyone could enumerate which emails have made purchases.
//
// Keying: relies on the library default, which uses `req.ip` (normalized for
// IPv6 via ipKeyGenerator). `req.ip` is meaningful because app.ts sets
// `trust proxy = 1` for our single trusted Replit proxy hop, so client-supplied
// X-Forwarded-For headers cannot bypass the limit.
export const ordersByEmailRateLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => {
    req.log.warn(
      { ip: req.ip, route: "GET /orders/by-email" },
      "Rate limit exceeded for orders by-email lookup",
    );
    res.status(429).json({
      error: "Demasiadas solicitudes. Intentá de nuevo en un minuto.",
    });
  },
});
