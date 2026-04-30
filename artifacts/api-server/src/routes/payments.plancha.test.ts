/**
 * Integration tests for the "armar plancha" service-fee pricing model.
 *
 *   POST /api/payments/mercadopago/preference
 *   POST /api/payments/paypal/create-order
 *
 * Regression guard for the contract documented in
 * `applyPlanchaModeIfRequested` (see payments.ts):
 *
 *   total_final = sum(items.price * items.quantity) + planchaPrice
 *
 * The plancha price is ADDITIVE, not a replacement. If anyone changes the
 * route back to "replace the items total with the plancha price" the buyer
 * would be undercharged and we'd lose money silently. These tests fail
 * loudly in CI before that lands.
 *
 * Covered:
 *   1. MP preference with `groupAsPlancha: true`
 *      - persisted order.total === sum(items) + planchaPrice
 *      - persisted order.isPlanchaGrouped === true
 *      - the items[] sent to Mercado Pago sum to exactly that total
 *        (one line per design + one "armar-plancha" service line)
 *   2. PayPal create-order with `groupAsPlancha: true`
 *      - persisted order.total === sum(items) + planchaPrice
 *      - persisted order.isPlanchaGrouped === true
 *      - PayPal purchase_units total matches in USD using the configured rate
 *   3. Sanity: same payloads with `groupAsPlancha: false` (or omitted) must
 *      NOT include the plancha price — proves the additive logic is gated
 *      on the flag and won't double-charge regular carts.
 *
 * Mocking strategy:
 *   - `./settings.getPlanchaPriceArs` returns a fixed PLANCHA_PRICE.
 *   - `@workspace/db` is replaced with an in-memory stub that:
 *       * `select().from(productsTable).where(...)` → returns the test catalog
 *       * `insert(ordersTable).values(...).returning()` → captures the row
 *         we'd persist and returns it as the order with a stable id
 *       * `update(ordersTable).set(...).where(...)` → no-op
 *   - `mercadopago` SDK is replaced so `Preference.create({body})` captures
 *     `body.items` instead of calling MP's API.
 *   - `globalThis.fetch` is replaced so PayPal oauth + create-order calls
 *     return canned responses and we capture the request body.
 *   - `../lib/email` is stubbed so no email is attempted.
 *
 * Setting `PAYPAL_ARS_TO_USD_RATE` before importing the route forces a
 * deterministic ARS→USD rate (no network call to dolarapi.com).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ─── Env that MUST be set before importing the payments router ─────────────
process.env["MERCADOPAGO_ACCESS_TOKEN"] = "TEST-mp-token";
process.env["MERCADOPAGO_WEBHOOK_SECRET"] = "test-secret";
process.env["PAYPAL_CLIENT_ID"] = "test-pp-client";
process.env["PAYPAL_CLIENT_SECRET"] = "test-pp-secret";
// Force a deterministic ARS→USD rate (no network call to dolarapi.com).
process.env["PAYPAL_ARS_TO_USD_RATE"] = "1000";

const PLANCHA_PRICE = 1500;

// ─── Mock the plancha-price setter at the source ───────────────────────────
// `applyPlanchaModeIfRequested` calls `getPlanchaPriceArs()` from ./settings
// to look up the current price in app_settings. Mocking that import means
// we never need to set up the appSettings table in the DB stub.
vi.mock("./settings", () => ({
  getPlanchaPriceArs: () => Promise.resolve(PLANCHA_PRICE),
  default: undefined,
}));

// ─── In-memory product catalog used by resolveCartItems ────────────────────
const products = [
  {
    id: "p1",
    name: "Diseño 1",
    price: 2000,
    isPublished: true,
    imagePath: "/img/p1.png",
    filePath: "/file/p1.png",
  },
  {
    id: "p2",
    name: "Diseño 2",
    price: 3500,
    isPublished: true,
    imagePath: "/img/p2.png",
    filePath: null,
  },
  {
    id: "p3",
    name: "Diseño 3",
    price: 1750,
    isPublished: true,
    imagePath: "/img/p3.png",
    filePath: null,
  },
];

// ─── DB mock — captures the insert payload and serves products on select ──
// The payments routes use:
//   db.select().from(productsTable).where(...)             → products
//   db.insert(ordersTable).values(...).returning()         → [order]
//   db.update(ordersTable).set(...).where(...)             → no-op
let lastInsertedOrder: Record<string, unknown> | null = null;
vi.mock("@workspace/db", async () => {
  const real =
    await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...real,
    db: {
      select: () => ({
        from: (_table: unknown) => ({
          where: () => Promise.resolve(products),
        }),
      }),
      insert: (_table: unknown) => ({
        values: (vals: Record<string, unknown>) => ({
          returning: () => {
            const order = { id: "order-uuid-test", ...vals };
            lastInsertedOrder = order;
            return Promise.resolve([order]);
          },
        }),
      }),
      update: (_table: unknown) => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    },
  };
});

// ─── Mercado Pago SDK mock — captures the items[] body sent to MP ─────────
let lastMpBody: { items?: Array<Record<string, unknown>> } | null = null;
vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {
    constructor(_: unknown) {}
  },
  Preference: class {
    constructor(_: unknown) {}
    async create({ body }: { body: { items?: Array<Record<string, unknown>> } }) {
      lastMpBody = body;
      return {
        id: "pref-1",
        init_point: "https://mp.test/init",
        sandbox_init_point: "https://mp.test/sandbox",
      };
    }
  },
  Payment: class {
    constructor(_: unknown) {}
    async get() {
      return {};
    }
  },
}));

// ─── Email mock — never send anything ─────────────────────────────────────
vi.mock("../lib/email", () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendWebhookSignatureAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

// ─── PayPal HTTP mock — captures /v2/checkout/orders payload ──────────────
let lastPaypalCreateBody: {
  purchase_units?: Array<{ amount?: { value?: string; currency_code?: string } }>;
} | null = null;

let app: Express;
beforeAll(async () => {
  const paymentsRouter = (await import("./payments")).default;
  app = express();
  app.use(express.json());
  // The payments route uses `req.log` (provided in production by pino-http).
  // In the test app we attach a noop logger so route handlers don't crash.
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
  lastInsertedOrder = null;
  lastMpBody = null;
  lastPaypalCreateBody = null;

  globalThis.fetch = vi.fn(async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.includes("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "ppt-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v2/checkout/orders")) {
      const body = (init as { body?: string } | undefined)?.body;
      if (body) lastPaypalCreateBody = JSON.parse(body);
      return new Response(JSON.stringify({ id: "PP-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200 });
  }) as typeof globalThis.fetch;
});

const cartPayload = {
  customerName: "Comprador AR",
  customerEmail: "comprador@example.com",
  customerDni: "12345678",
  items: [
    { productId: "p1", quantity: 2 }, // 2 * 2000 = 4000
    { productId: "p2", quantity: 1 }, // 1 * 3500 = 3500
    { productId: "p3", quantity: 3 }, // 3 * 1750 = 5250
  ],
};
// sum(items) = 4000 + 3500 + 5250 = 12750
const ITEMS_SUM = 12750;
const EXPECTED_TOTAL_WITH_PLANCHA = ITEMS_SUM + PLANCHA_PRICE; // 14250

describe("Mercado Pago preference — armar plancha is ADDITIVE", () => {
  it("persists total = sum(items) + planchaPrice and MP lines sum to that total", async () => {
    const res = await request(app)
      .post("/api/payments/mercadopago/preference")
      .send({ ...cartPayload, groupAsPlancha: true });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe("order-uuid-test");

    // 1) Persistence: total stored on the order row matches the additive contract
    expect(lastInsertedOrder).not.toBeNull();
    expect(lastInsertedOrder!["total"]).toBe(EXPECTED_TOTAL_WITH_PLANCHA);
    expect(lastInsertedOrder!["isPlanchaGrouped"]).toBe(true);
    expect(lastInsertedOrder!["paymentMethod"]).toBe("mercadopago");

    // The original per-design line items must be preserved on the order row
    // (not flattened into a single plancha line) so the PDF/email/admin can
    // still reference each design that was grouped onto the plancha.
    const persistedItems = lastInsertedOrder!["items"] as Array<{
      productId: string;
      quantity: number;
      price: number;
    }>;
    expect(persistedItems).toHaveLength(3);
    const persistedSum = persistedItems.reduce(
      (s, i) => s + i.price * i.quantity,
      0,
    );
    expect(persistedSum).toBe(ITEMS_SUM);

    // 2) Mercado Pago payload: lines sent to the gateway must sum to total
    //    (one line per design + one "armar-plancha" service line).
    expect(lastMpBody).not.toBeNull();
    const mpItems = lastMpBody!.items as Array<{
      id: string;
      quantity: number;
      unit_price: number;
    }>;
    expect(mpItems).toHaveLength(4); // 3 designs + 1 plancha service line

    const mpSum = mpItems.reduce(
      (s, i) => s + i.unit_price * i.quantity,
      0,
    );
    expect(mpSum).toBe(EXPECTED_TOTAL_WITH_PLANCHA);

    // The plancha line is identified by id="armar-plancha" with quantity 1.
    const planchaLine = mpItems.find((i) => i.id === "armar-plancha");
    expect(planchaLine).toBeDefined();
    expect(planchaLine!.quantity).toBe(1);
    expect(planchaLine!.unit_price).toBe(PLANCHA_PRICE);
  });

  it("does NOT add the plancha price when groupAsPlancha is false", async () => {
    const res = await request(app)
      .post("/api/payments/mercadopago/preference")
      .send({ ...cartPayload, groupAsPlancha: false });

    expect(res.status).toBe(200);
    expect(lastInsertedOrder!["total"]).toBe(ITEMS_SUM);
    expect(lastInsertedOrder!["isPlanchaGrouped"]).toBe(false);

    const mpItems = lastMpBody!.items as Array<{
      id: string;
      quantity: number;
      unit_price: number;
    }>;
    expect(mpItems).toHaveLength(3);
    expect(mpItems.find((i) => i.id === "armar-plancha")).toBeUndefined();
    const mpSum = mpItems.reduce(
      (s, i) => s + i.unit_price * i.quantity,
      0,
    );
    expect(mpSum).toBe(ITEMS_SUM);
  });
});

describe("PayPal create-order — armar plancha is ADDITIVE", () => {
  it("persists total = sum(items) + planchaPrice and PayPal USD amount matches", async () => {
    const res = await request(app)
      .post("/api/payments/paypal/create-order")
      .send({ ...cartPayload, groupAsPlancha: true });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe("order-uuid-test");
    expect(res.body.ppOrderId).toBe("PP-1");

    // 1) Persistence: same additive contract as MP path.
    expect(lastInsertedOrder).not.toBeNull();
    expect(lastInsertedOrder!["total"]).toBe(EXPECTED_TOTAL_WITH_PLANCHA);
    expect(lastInsertedOrder!["isPlanchaGrouped"]).toBe(true);
    expect(lastInsertedOrder!["paymentMethod"]).toBe("paypal");

    // 2) PayPal payload: the amount sent to PayPal is the USD equivalent of
    //    the additive total, computed with the env-pinned rate (1000).
    expect(lastPaypalCreateBody).not.toBeNull();
    const unit = lastPaypalCreateBody!.purchase_units![0]!;
    expect(unit.amount!.currency_code).toBe("USD");
    const sentUsd = parseFloat(unit.amount!.value!);
    const expectedUsd = parseFloat(
      (EXPECTED_TOTAL_WITH_PLANCHA / 1000).toFixed(2),
    );
    expect(sentUsd).toBe(expectedUsd);

    // Cross-check: convert back to ARS and confirm we charged the right total.
    const reconstructedArs = Math.round(sentUsd * 1000);
    expect(reconstructedArs).toBe(EXPECTED_TOTAL_WITH_PLANCHA);
  });

  it("does NOT add the plancha price when groupAsPlancha is omitted", async () => {
    const res = await request(app)
      .post("/api/payments/paypal/create-order")
      .send(cartPayload); // no groupAsPlancha flag

    expect(res.status).toBe(200);
    expect(lastInsertedOrder!["total"]).toBe(ITEMS_SUM);
    expect(lastInsertedOrder!["isPlanchaGrouped"]).toBe(false);

    const unit = lastPaypalCreateBody!.purchase_units![0]!;
    const sentUsd = parseFloat(unit.amount!.value!);
    expect(sentUsd).toBe(parseFloat((ITEMS_SUM / 1000).toFixed(2)));
  });
});
