/**
 * Integration test for the rejected-webhook security event log.
 *
 *   POST /api/webhooks/mercadopago     (with invalid signature → 401)
 *   GET  /api/security/webhook-events  (admin-only listing)
 *
 * Manually we already verified with `curl` + `psql` that an MP webhook with
 * an invalid x-signature returns 401 and writes one row into
 * `webhook_security_events`. This regression test locks that contract in CI
 * so an accidental refactor (e.g. someone removing the `db.insert` call,
 * changing the reason/source string, or returning 200 by mistake) fails
 * loudly instead of silently breaking our security audit log.
 *
 * Asserted contract:
 *   1. POST /api/webhooks/mercadopago with a bogus x-signature returns 401
 *   2. Exactly one row is inserted into webhook_security_events with
 *      reason = 'invalid_signature' and source = 'mercadopago'
 *   3. The admin endpoint GET /api/security/webhook-events lists that row
 *
 * Mocking strategy:
 *   - `@workspace/db` is replaced with an in-memory stub that records inserts
 *     into webhook_security_events and serves them back on select. This avoids
 *     needing a live postgres connection.
 *   - `@clerk/express` is mocked so the admin endpoint sees a configured
 *     admin userId without a real Clerk session.
 *   - `../lib/email` is stubbed so the alert email is not actually sent.
 *
 * The MP webhook handler dispatches the DB insert as fire-and-forget
 * (`void db.insert(...).values(...).catch(...)`) so we flush microtasks
 * with `setImmediate` after the request resolves before asserting.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ─── Env that MUST be set before importing routers ─────────────────────────
process.env["MERCADOPAGO_ACCESS_TOKEN"] = "TEST-mp-token";
process.env["MERCADOPAGO_WEBHOOK_SECRET"] = "test-secret";
process.env["PAYPAL_CLIENT_ID"] = "test-pp-client";
process.env["PAYPAL_CLIENT_SECRET"] = "test-pp-secret";
process.env["PAYPAL_ARS_TO_USD_RATE"] = "1000";
process.env["ADMIN_USER_IDS"] = "user_admin";

// ─── Clerk auth mock — the admin endpoint relies on getAuth(req) ───────────
let currentAuth: { userId: string | null } = { userId: null };
vi.mock("@clerk/express", () => ({
  getAuth: () => currentAuth,
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// ─── Email mock — never send anything ──────────────────────────────────────
vi.mock("../lib/email", () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendWebhookSignatureAlertEmail: vi.fn().mockResolvedValue(undefined),
  sendPaypalSecurityAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

// ─── In-memory DB mock ─────────────────────────────────────────────────────
// Tracks webhook_security_events inserts and serves them back on select.
// We identify the table by reference equality with the real
// webhookSecurityEventsTable export so other table writes (e.g. the alert
// rate-limit ledger) never accidentally land in this list.
type WebhookSecurityEventRow = {
  id: number;
  createdAt: Date;
  source: string;
  reason: string;
  ip: string | null;
  xRequestId: string | null;
  signatureTs: string | null;
  detail: string | null;
};
const webhookSecurityEvents: WebhookSecurityEventRow[] = [];
let nextEventId = 1;

let webhookSecurityEventsTableRef: unknown = null;

vi.mock("@workspace/db", async () => {
  const real =
    await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  webhookSecurityEventsTableRef = real.webhookSecurityEventsTable;
  return {
    ...real,
    db: {
      // Used by both:
      //   - GET /security/webhook-events  (select.from.orderBy.limit)
      //   - the alert-rate-limit query inside payments (select.from.where[.orderBy])
      // We only need to serve a useful response for the security listing —
      // any other select can safely return an empty array.
      select: () => ({
        from: (table: unknown) => {
          if (table === webhookSecurityEventsTableRef) {
            return {
              where: () => ({
                orderBy: () => Promise.resolve([]),
                limit: () =>
                  Promise.resolve(
                    [...webhookSecurityEvents].sort(
                      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
                    ),
                  ),
              }),
              orderBy: () => ({
                limit: () =>
                  Promise.resolve(
                    [...webhookSecurityEvents].sort(
                      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
                    ),
                  ),
              }),
            };
          }
          return {
            where: () => ({
              orderBy: () => Promise.resolve([]),
              limit: () => Promise.resolve([]),
            }),
            orderBy: () => ({
              limit: () => Promise.resolve([]),
            }),
          };
        },
      }),
      insert: (table: unknown) => ({
        values: (vals: Record<string, unknown>) => {
          if (table === webhookSecurityEventsTableRef) {
            const row: WebhookSecurityEventRow = {
              id: nextEventId++,
              createdAt: new Date(),
              source: String(vals["source"] ?? ""),
              reason: String(vals["reason"] ?? ""),
              ip: (vals["ip"] as string | null) ?? null,
              xRequestId: (vals["xRequestId"] as string | null) ?? null,
              signatureTs: (vals["signatureTs"] as string | null) ?? null,
              detail: (vals["detail"] as string | null) ?? null,
            };
            webhookSecurityEvents.push(row);
            const promise: Promise<void> & {
              catch: (fn: (e: unknown) => unknown) => Promise<void>;
              returning: () => Promise<WebhookSecurityEventRow[]>;
            } = Object.assign(Promise.resolve(), {
              catch: (_fn: (e: unknown) => unknown) => Promise.resolve(),
              returning: () => Promise.resolve([row]),
            });
            return promise;
          }
          // Fallback for any other table (e.g. alert ledger): no-op chain
          const noop: Promise<void> & {
            catch: (fn: (e: unknown) => unknown) => Promise<void>;
            returning: () => Promise<unknown[]>;
          } = Object.assign(Promise.resolve(), {
            catch: (_fn: (e: unknown) => unknown) => Promise.resolve(),
            returning: () => Promise.resolve([]),
          });
          return noop;
        },
      }),
      update: (_table: unknown) => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
      delete: (_table: unknown) => ({
        where: () => Promise.resolve(),
      }),
    },
  };
});

let app: Express;
beforeAll(async () => {
  const paymentsRouter = (await import("./payments")).default;
  const securityRouter = (await import("./security")).default;
  app = express();
  app.use(express.json());
  // Production attaches `req.log` via pino-http; the route handlers call it
  // directly so we provide a noop logger to avoid undefined errors in tests.
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, (...a: unknown[]) => void> }).log =
      {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      };
    next();
  });
  app.use("/api", paymentsRouter);
  app.use("/api", securityRouter);
});

beforeEach(() => {
  webhookSecurityEvents.length = 0;
  nextEventId = 1;
  currentAuth = { userId: null };
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Helper: yield the event loop once so fire-and-forget DB inserts
// (`void db.insert(...).catch(...)`) settle before we assert on them.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("Mercado Pago webhook — invalid signature is logged for the admin", () => {
  it("returns 401, persists exactly one webhook_security_events row, and the admin endpoint lists it", async () => {
    // 1) Send a webhook with a clearly bogus signature
    const res = await request(app)
      .post("/api/webhooks/mercadopago?data.id=PAYMENT-123")
      .set("x-signature", "ts=1700000000,v1=deadbeef")
      .set("x-request-id", "req-test-1")
      .send({ data: { id: "PAYMENT-123" }, type: "payment" });

    expect(res.status).toBe(401);

    // The DB insert is fire-and-forget; let microtasks settle before reading.
    await flushMicrotasks();

    // 2) Exactly one event was logged, with the documented reason+source
    expect(webhookSecurityEvents).toHaveLength(1);
    const event = webhookSecurityEvents[0]!;
    expect(event.reason).toBe("invalid_signature");
    expect(event.source).toBe("mercadopago");
    expect(event.xRequestId).toBe("req-test-1");
    expect(event.signatureTs).toBe("1700000000");
    expect(event.detail).toBe("data.id=PAYMENT-123");

    // 3) Admin endpoint lists the row.
    //    a) Without auth → 401 (sanity, proves the endpoint is gated)
    const unauth = await request(app).get("/api/security/webhook-events");
    expect(unauth.status).toBe(401);

    //    b) With an admin session → 200 and the rejected attempt shows up
    currentAuth = { userId: "user_admin" };
    const listed = await request(app).get("/api/security/webhook-events");
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body)).toBe(true);
    expect(listed.body).toHaveLength(1);
    const listedEvent = listed.body[0] as Record<string, unknown>;
    expect(listedEvent["reason"]).toBe("invalid_signature");
    expect(listedEvent["source"]).toBe("mercadopago");
    expect(listedEvent["xRequestId"]).toBe("req-test-1");
  });

  it("logs one row per rejected attempt when the same forged payload is replayed", async () => {
    // Replays of the same forged payload should each log a separate attempt
    // — that's how the admin sees the rate of attacks — but each individual
    // rejected request must insert exactly ONE row, never zero (silent drop)
    // and never two (double-insert from an accidental retry).
    const send = (xReqId: string) =>
      request(app)
        .post("/api/webhooks/mercadopago?data.id=PAYMENT-456")
        .set("x-signature", "ts=1700000001,v1=cafebabe")
        .set("x-request-id", xReqId)
        .send({ data: { id: "PAYMENT-456" }, type: "payment" });

    const first = await send("req-test-2a");
    const second = await send("req-test-2b");
    expect(first.status).toBe(401);
    expect(second.status).toBe(401);

    await flushMicrotasks();
    expect(webhookSecurityEvents).toHaveLength(2);
    expect(webhookSecurityEvents.map((e) => e.xRequestId)).toEqual([
      "req-test-2a",
      "req-test-2b",
    ]);
    // Both rows still carry the documented reason+source — proving the
    // contract holds across replays, not just on the first attempt.
    expect(
      webhookSecurityEvents.every(
        (e) => e.reason === "invalid_signature" && e.source === "mercadopago",
      ),
    ).toBe(true);
  });
});
