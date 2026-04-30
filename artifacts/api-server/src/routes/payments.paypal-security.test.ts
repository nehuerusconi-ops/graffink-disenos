/**
 * Integration test for the PayPal capture-order fraud-detection security log.
 *
 *   POST /api/payments/paypal/capture-order
 *
 * The capture handler has THREE distinct rejection paths that each persist
 * a row into `webhook_security_events` (source = 'paypal') so the admin can
 * spot suspicious capture attempts. This test locks each one down so an
 * accidental refactor (e.g. deleting a `recordPaypalSecurityEvent(...)` call,
 * changing the reason string, or returning 200 by mistake) fails loudly
 * instead of silently breaking our fraud-detection audit trail.
 *
 * Asserted contract for each of `order_mismatch`, `reference_mismatch` and
 * `amount_mismatch`:
 *   1. The HTTP response rejects the capture (status 400).
 *   2. The order is NOT marked as paid (no `db.update` with `status: "paid"`).
 *   3. Exactly ONE row is inserted into `webhook_security_events` with
 *      `source = "paypal"` and the documented `reason`.
 *
 * Mocking strategy:
 *   - `@workspace/db` is replaced with an in-memory stub that:
 *       - returns a configurable order row when select(ordersTable) is queried
 *       - serves a single fake product when select(productsTable) is queried
 *         (only used by the create-order step that primes the in-memory
 *         _paypalOrderUsd map for the amount_mismatch case)
 *       - records every `db.update(ordersTable).set(values)` call so the
 *         test can assert no path mutated the order to status="paid"
 *       - records inserts into webhook_security_events
 *   - `@clerk/express` is mocked (the routes don't use it but the existing
 *     test infra mocks it so we keep the same pattern).
 *   - `../lib/email` is stubbed so the alert email is not actually sent.
 *   - `global.fetch` is replaced per test with a router that responds to
 *     PayPal's OAuth + capture endpoints with the payload each scenario
 *     needs (no real network calls).
 *
 * The capture handler dispatches the security-event insert as fire-and-forget
 * (`void db.insert(...).values(...).catch(...)`) so we flush microtasks with
 * `setImmediate` after the request resolves before asserting on the log.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ─── Env that MUST be set before importing routers ─────────────────────────
process.env["MERCADOPAGO_ACCESS_TOKEN"] = "TEST-mp-token";
process.env["MERCADOPAGO_WEBHOOK_SECRET"] = "test-secret";
process.env["PAYPAL_CLIENT_ID"] = "test-pp-client";
process.env["PAYPAL_CLIENT_SECRET"] = "test-pp-secret";
// 1 USD = 1000 ARS makes the math obvious: a 5000 ARS product is 5.00 USD.
process.env["PAYPAL_ARS_TO_USD_RATE"] = "1000";
process.env["ADMIN_USER_IDS"] = "user_admin";

// ─── Clerk auth mock — capture-order does not gate on auth, but the routes
//     module pulls in middlewares that touch @clerk/express at import time. ─
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null }),
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

// Every db.update(ordersTable).set(values) call is captured here so each test
// can assert that the failed-capture path never mutated the order to "paid".
type UpdateSetCall = { values: Record<string, unknown> };
const orderUpdateSetCalls: UpdateSetCall[] = [];

// The row returned by db.select().from(ordersTable).where(...). Set by each
// test before issuing the capture-order request.
let nextOrderRow: Record<string, unknown> | null = null;

let webhookSecurityEventsTableRef: unknown = null;
let ordersTableRef: unknown = null;
let productsTableRef: unknown = null;

vi.mock("@workspace/db", async () => {
  const real =
    await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  webhookSecurityEventsTableRef = real.webhookSecurityEventsTable;
  ordersTableRef = real.ordersTable;
  productsTableRef = real.productsTable;

  // We identify each table by reference equality with the real export so
  // unrelated reads/writes (e.g. the alert-rate-limit ledger) don't pollute
  // the assertions for any one test scenario.
  const fromRouter = (table: unknown) => {
    if (table === ordersTableRef) {
      return {
        where: () =>
          Promise.resolve(nextOrderRow ? [nextOrderRow] : []),
      };
    }
    if (table === productsTableRef) {
      // The amount_mismatch case primes the in-memory _paypalOrderUsd map
      // by going through POST /payments/paypal/create-order, which calls
      // resolveCartItems → select(productsTable). One published product
      // priced at 5000 ARS is enough to land a 5.00 USD entry in the map.
      return {
        where: () =>
          Promise.resolve([
            {
              id: "PROD-1",
              name: "Diseño test",
              price: 5000,
              imagePath: "/img.png",
              filePath: null,
              isPublished: true,
            },
          ]),
      };
    }
    if (table === webhookSecurityEventsTableRef) {
      const sorted = (): WebhookSecurityEventRow[] =>
        [...webhookSecurityEvents].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
      return {
        where: () => ({
          orderBy: () => Promise.resolve([]),
          limit: () => Promise.resolve(sorted()),
        }),
        orderBy: () => ({ limit: () => Promise.resolve(sorted()) }),
      };
    }
    // Fallback: any other table read returns empty.
    return {
      where: () => ({
        orderBy: () => Promise.resolve([]),
        limit: () => Promise.resolve([]),
      }),
      orderBy: () => ({ limit: () => Promise.resolve([]) }),
    };
  };

  return {
    ...real,
    db: {
      select: () => ({ from: fromRouter }),
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
          if (table === ordersTableRef) {
            // The amount_mismatch test calls create-order, which inserts
            // a pending order. Echo a stable id so the subsequent capture
            // call can target it.
            const inserted = { id: "ORDER-CREATED", ...vals };
            const promise: Promise<void> & {
              catch: (fn: (e: unknown) => unknown) => Promise<void>;
              returning: () => Promise<Record<string, unknown>[]>;
            } = Object.assign(Promise.resolve(), {
              catch: (_fn: (e: unknown) => unknown) => Promise.resolve(),
              returning: () => Promise.resolve([inserted]),
            });
            return promise;
          }
          // Fallback for any other table (e.g. alert ledger): no-op chain.
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
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          if (table === ordersTableRef) {
            orderUpdateSetCalls.push({ values });
          }
          return {
            // create-order awaits update(...).set(...).where(...) directly,
            // capture-order success would chain .returning() on top — both
            // shapes work because the returned promise also exposes .returning().
            where: () => {
              const p: Promise<void> & {
                returning: () => Promise<Record<string, unknown>[]>;
              } = Object.assign(Promise.resolve(), {
                returning: () => Promise.resolve([{ id: "x", ...values }]),
              });
              return p;
            },
          };
        },
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
  app = express();
  app.use(express.json());
  // Production attaches `req.log` via pino-http; route handlers call it
  // directly so we provide a noop logger to avoid undefined errors.
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
});

beforeEach(() => {
  webhookSecurityEvents.length = 0;
  nextEventId = 1;
  orderUpdateSetCalls.length = 0;
  nextOrderRow = null;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Yield the event loop once so fire-and-forget DB inserts
// (`void db.insert(...).catch(...)`) settle before we assert on them.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// Replace global.fetch with a tiny URL-pattern router. Each test only needs
// PayPal's OAuth + capture endpoints; an unmatched URL throws so a missing
// mock is loud instead of silently hitting the network.
type FetchHandler = { match: RegExp; respond: () => unknown };
function mockPaypalFetch(handlers: FetchHandler[]): void {
  const fn = vi.fn(async (input: unknown): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as { url?: unknown })?.url ?? input);
    for (const h of handlers) {
      if (h.match.test(url)) {
        return new Response(JSON.stringify(h.respond()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    throw new Error(`Unexpected fetch in PayPal security test: ${url}`);
  });
  globalThis.fetch = fn as unknown as typeof fetch;
}

describe("PayPal capture-order — fraud attempts are logged for the admin", () => {
  it("order_mismatch: ppOrderId differs from the stored externalPaymentId → 400, no paid update, one paypal event", async () => {
    // No fetch mock: the handler returns BEFORE making any PayPal call when
    // the binding check fails. If a future refactor moved the PayPal call
    // before the binding check, the unmocked `fetch` would throw and this
    // test would fail loudly — which is exactly what we want.
    nextOrderRow = {
      id: "ORDER-1",
      externalPaymentId: "PP-EXPECTED",
      status: "pending",
    };

    const res = await request(app)
      .post("/api/payments/paypal/capture-order")
      .send({ ppOrderId: "PP-FORGED", orderId: "ORDER-1" });

    expect(res.status).toBe(400);

    await flushMicrotasks();

    expect(webhookSecurityEvents).toHaveLength(1);
    const event = webhookSecurityEvents[0]!;
    expect(event.source).toBe("paypal");
    expect(event.reason).toBe("order_mismatch");

    // The order must NOT be marked paid by any update on the failure path.
    expect(
      orderUpdateSetCalls.find((c) => c.values["status"] === "paid"),
    ).toBeUndefined();
  });

  it("reference_mismatch: PayPal capture returns reference_id ≠ orderId → 400, no paid update, one paypal event", async () => {
    nextOrderRow = {
      id: "ORDER-2",
      externalPaymentId: "PP-OK-REF",
      status: "pending",
    };
    mockPaypalFetch([
      { match: /\/v1\/oauth2\/token/, respond: () => ({ access_token: "tk" }) },
      {
        match: /\/v2\/checkout\/orders\/PP-OK-REF\/capture/,
        respond: () => ({
          status: "COMPLETED",
          purchase_units: [
            {
              // PayPal claims this capture belongs to a different order.
              reference_id: "SOMEONE-ELSES-ORDER",
              payments: {
                captures: [{ amount: { value: "5.00", currency_code: "USD" } }],
              },
            },
          ],
        }),
      },
    ]);

    const res = await request(app)
      .post("/api/payments/paypal/capture-order")
      .send({ ppOrderId: "PP-OK-REF", orderId: "ORDER-2" });

    expect(res.status).toBe(400);

    await flushMicrotasks();

    expect(webhookSecurityEvents).toHaveLength(1);
    const event = webhookSecurityEvents[0]!;
    expect(event.source).toBe("paypal");
    expect(event.reason).toBe("reference_mismatch");

    expect(
      orderUpdateSetCalls.find((c) => c.values["status"] === "paid"),
    ).toBeUndefined();
  });

  it("amount_mismatch: captured USD differs from the amount registered at create-order → 400, no paid update, one paypal event", async () => {
    // Step A — prime the in-memory _paypalOrderUsd map by going through
    // create-order. The map is module-private to payments.ts, so the only
    // supported way to populate it is via the real create-order route.
    // The product priced at 5000 ARS / 1000 rate = 5.00 USD baseline.
    const PP_ORDER_ID = "PP-AMOUNT-TEST";
    mockPaypalFetch([
      { match: /\/v1\/oauth2\/token/, respond: () => ({ access_token: "tk" }) },
      // The trailing $ ensures we match the create-order endpoint and not
      // /v2/checkout/orders/<id>/capture.
      { match: /\/v2\/checkout\/orders$/, respond: () => ({ id: PP_ORDER_ID }) },
    ]);

    const created = await request(app)
      .post("/api/payments/paypal/create-order")
      .send({
        customerName: "Tester",
        customerEmail: "tester@example.com",
        items: [{ productId: "PROD-1", quantity: 1 }],
      });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ ppOrderId: PP_ORDER_ID });

    // Reset side effects from the create-order setup so the assertions
    // below only reflect the capture-order call.
    orderUpdateSetCalls.length = 0;

    // Step B — capture with an amount far away from the 5.00 USD baseline
    // (the handler tolerates a 1 USD rounding diff, so 100 USD is clearly
    // outside that band).
    nextOrderRow = {
      id: "ORDER-CREATED",
      externalPaymentId: PP_ORDER_ID,
      status: "pending",
    };
    mockPaypalFetch([
      { match: /\/v1\/oauth2\/token/, respond: () => ({ access_token: "tk" }) },
      {
        match: new RegExp(`/v2/checkout/orders/${PP_ORDER_ID}/capture`),
        respond: () => ({
          status: "COMPLETED",
          purchase_units: [
            {
              reference_id: "ORDER-CREATED",
              payments: {
                captures: [
                  { amount: { value: "100.00", currency_code: "USD" } },
                ],
              },
            },
          ],
        }),
      },
    ]);

    const res = await request(app)
      .post("/api/payments/paypal/capture-order")
      .send({ ppOrderId: PP_ORDER_ID, orderId: "ORDER-CREATED" });

    expect(res.status).toBe(400);

    await flushMicrotasks();

    expect(webhookSecurityEvents).toHaveLength(1);
    const event = webhookSecurityEvents[0]!;
    expect(event.source).toBe("paypal");
    expect(event.reason).toBe("amount_mismatch");

    expect(
      orderUpdateSetCalls.find((c) => c.values["status"] === "paid"),
    ).toBeUndefined();
  });
});
