/**
 * Integration tests for DNI/CUIT validation on the public checkout endpoints.
 *
 *   POST /api/payments/mercadopago/preference
 *   POST /api/payments/paypal/create-order
 *
 * Both endpoints validate the buyer's customerDni against `CustomerInfoSchema`
 * (refinement `isValidDniOrCuit`). This test guards against accidental
 * loosening of that rule — e.g. removing the refine() call or swapping the
 * regex — by asserting:
 *
 *   1. An invalid DNI (9 digits) is rejected with HTTP 400.
 *   2. The rejection happens BEFORE any DB insert into `orders` and
 *      BEFORE the external SDK / HTTP call (Mercado Pago Preference.create
 *      or PayPal /v2/checkout/orders) is invoked.
 *   3. With the same payload but a valid DNI (8 digits), the handler advances
 *      past validation and reaches the external call, returning 200.
 *
 * Mocking strategy mirrors `payments.plancha.test.ts`:
 *   - `./settings.getPlanchaPriceArs` returns a fixed value (unused here but
 *     keeps the module importable).
 *   - `@workspace/db` is replaced with an in-memory stub that records every
 *     `insert(...).values(...)` call, so we can assert NO order is created
 *     when validation fails.
 *   - `mercadopago` SDK is replaced; `Preference.create` records that it was
 *     called.
 *   - `globalThis.fetch` is replaced; PayPal create-order reqs are recorded.
 *   - `../lib/email` is stubbed.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ─── Env that MUST be set before importing the payments router ─────────────
process.env["MERCADOPAGO_ACCESS_TOKEN"] = "TEST-mp-token";
process.env["MERCADOPAGO_WEBHOOK_SECRET"] = "test-secret";
process.env["PAYPAL_CLIENT_ID"] = "test-pp-client";
process.env["PAYPAL_CLIENT_SECRET"] = "test-pp-secret";
process.env["PAYPAL_ARS_TO_USD_RATE"] = "1000";

// ─── Mock the plancha-price setter (unused here but keeps imports clean) ──
vi.mock("./settings", () => ({
  getPlanchaPriceArs: () => Promise.resolve(0),
  readAvailableSizes: () => Promise.resolve([] as string[]),
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
];

// ─── DB mock — records every insert so we can assert it was NOT called ────
const insertedOrders: Array<Record<string, unknown>> = [];
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
            insertedOrders.push(order);
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

// ─── Mercado Pago SDK mock — records that Preference.create was called ────
let mpCreateCallCount = 0;
vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {
    constructor(_: unknown) {}
  },
  Preference: class {
    constructor(_: unknown) {}
    async create(_args: unknown) {
      mpCreateCallCount += 1;
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
  sendPaypalSecurityAlertEmail: vi.fn().mockResolvedValue(undefined),
  sendPlanchaAssemblyAlertEmail: vi.fn().mockResolvedValue(undefined),
}));

// ─── PayPal HTTP mock — records the call to /v2/checkout/orders ───────────
let paypalCreateCallCount = 0;

let app: Express;
beforeAll(async () => {
  const paymentsRouter = (await import("./payments")).default;
  app = express();
  app.use(express.json());
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
  insertedOrders.length = 0;
  mpCreateCallCount = 0;
  paypalCreateCallCount = 0;

  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "ppt-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v2/checkout/orders")) {
      paypalCreateCallCount += 1;
      return new Response(JSON.stringify({ id: "PP-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200 });
  }) as typeof globalThis.fetch;
});

const baseCart = {
  customerName: "Comprador AR",
  customerEmail: "comprador@example.com",
  items: [{ productId: "p1", quantity: 1 }],
};

const INVALID_DNI = "123456789"; // 9 digits — not a valid DNI (7-8) and not a valid CUIT (11)
const VALID_DNI = "12345678"; // 8 digits — valid DNI

describe("POST /api/payments/mercadopago/preference — DNI validation", () => {
  it("rejects an invalid DNI (9 digits) with 400 and does not create an order or call MP", async () => {
    const res = await request(app)
      .post("/api/payments/mercadopago/preference")
      .send({ ...baseCart, customerDni: INVALID_DNI });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dni|cuit/i);

    // No row was inserted into orders
    expect(insertedOrders).toHaveLength(0);
    // Mercado Pago SDK was NOT called
    expect(mpCreateCallCount).toBe(0);
  });

  it("accepts a valid DNI (8 digits) and reaches the Mercado Pago SDK call", async () => {
    const res = await request(app)
      .post("/api/payments/mercadopago/preference")
      .send({ ...baseCart, customerDni: VALID_DNI });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe("order-uuid-test");

    // Order was persisted with the valid DNI
    expect(insertedOrders).toHaveLength(1);
    expect(insertedOrders[0]!["customerDni"]).toBe(VALID_DNI);

    // The handler advanced past validation and invoked the gateway
    expect(mpCreateCallCount).toBe(1);
  });
});

describe("POST /api/payments/paypal/create-order — DNI validation", () => {
  it("rejects an invalid DNI (9 digits) with 400 and does not create an order or call PayPal", async () => {
    const res = await request(app)
      .post("/api/payments/paypal/create-order")
      .send({ ...baseCart, customerDni: INVALID_DNI });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dni|cuit/i);

    // No row was inserted into orders
    expect(insertedOrders).toHaveLength(0);
    // PayPal create-order endpoint was NOT hit
    expect(paypalCreateCallCount).toBe(0);
  });

  it("accepts a valid DNI (8 digits) and reaches the PayPal create-order call", async () => {
    const res = await request(app)
      .post("/api/payments/paypal/create-order")
      .send({ ...baseCart, customerDni: VALID_DNI });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBe("order-uuid-test");
    expect(res.body.ppOrderId).toBe("PP-1");

    // Order was persisted with the valid DNI
    expect(insertedOrders).toHaveLength(1);
    expect(insertedOrders[0]!["customerDni"]).toBe(VALID_DNI);

    // The handler advanced past validation and called PayPal
    expect(paypalCreateCallCount).toBe(1);
  });
});
