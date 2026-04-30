/**
 * Integration tests for the admin "export orders as CSV" endpoint.
 *
 *   GET /api/orders/export
 *
 * Covers:
 *   - 401 when no Clerk session is present
 *   - 403 when the authenticated user is not in ADMIN_USER_IDS
 *   - 400 when paymentMethod query has an unknown value
 *   - 200 + text/csv body listing all orders, including the persisted
 *     ARS→USD rate and computed USD equivalent for PayPal orders
 *   - 200 + text/csv body filtered to a single payment method
 *
 * The DB and Clerk auth layers are mocked so the test runs without
 * requiring postgres or a real Clerk session.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["ADMIN_USER_IDS"] = "user_admin";
process.env["REPLIT_DOMAINS"] = "test.example.com";

let currentAuth: { userId: string | null } = { userId: null };
vi.mock("@clerk/express", () => ({
  getAuth: () => currentAuth,
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// Spy on drizzle-orm's date comparison helpers so tests can assert the
// EXACT boundary `Date` values the route passes to the DB layer. This is
// the strongest available regression guard: it proves that
//   ?from=2026-01-01  →  WHERE createdAt >= 2026-01-01T00:00:00.000Z
//   ?to=2026-01-31    →  WHERE createdAt <= 2026-01-31T23:59:59.999Z
// so a future refactor cannot silently break the inclusive day boundary.
let lastGteArgs: unknown[] | null = null;
let lastLteArgs: unknown[] | null = null;
vi.mock("drizzle-orm", async () => {
  const real = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...real,
    gte: (...args: unknown[]) => {
      lastGteArgs = args;
      // @ts-expect-error — passthrough preserves real SQL fragment shape.
      return real.gte(...args);
    },
    lte: (...args: unknown[]) => {
      lastLteArgs = args;
      // @ts-expect-error — passthrough preserves real SQL fragment shape.
      return real.lte(...args);
    },
  };
});

// Controllable DB mock that supports both
//   db.select().from(table).where(...).orderBy(...)  →  Promise<Row[]>
// and
//   db.select().from(table).orderBy(...)             →  Promise<Row[]>
// The export route uses both shapes depending on whether any filter
// (paymentMethod / from / to) was supplied. We capture the last predicate
// SQL fragment so each test can assert that the correct filter was issued
// — drizzle's `eq`, `gte`, `lte` and `and` helpers return tagged objects
// rather than running real SQL, so the predicate is just the captured value.
let allRows: Record<string, unknown>[] = [];
let lastWhereCalled = false;
let lastWherePredicate: unknown = null;
vi.mock("@workspace/db", async () => {
  const real =
    await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...real,
    db: {
      select: () => ({
        from: () => ({
          where: (pred: unknown) => {
            lastWhereCalled = true;
            lastWherePredicate = pred;
            return {
              orderBy: () => Promise.resolve(allRows),
            };
          },
          orderBy: () => Promise.resolve(allRows),
        }),
      }),
    },
  };
});

let app: Express;
beforeAll(async () => {
  const ordersRouter = (await import("./orders")).default;
  app = express();
  app.use(express.json());
  app.use("/api", ordersRouter);
});

beforeEach(() => {
  currentAuth = { userId: null };
  allRows = [];
  lastWhereCalled = false;
  lastWherePredicate = null;
  lastGteArgs = null;
  lastLteArgs = null;
});

function paypalRow(): Record<string, unknown> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    invoiceNumber: 7,
    customerName: "Buyer, USA",
    customerEmail: "buyer@example.com",
    customerDni: "12345678",
    items: [],
    total: 11855,
    isPlanchaGrouped: false,
    paymentMethod: "paypal",
    status: "paid",
    confirmationSource: "paypal-capture",
    arsToUsdRate: "1185.5000",
    createdAt: new Date("2025-01-15T12:00:00Z"),
  };
}

function mpRow(): Record<string, unknown> {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    invoiceNumber: 8,
    customerName: "Comprador AR",
    customerEmail: "ar@example.com",
    customerDni: null,
    items: [],
    total: 5000,
    isPlanchaGrouped: false,
    paymentMethod: "mercadopago",
    status: "paid",
    confirmationSource: "webhook",
    arsToUsdRate: null,
    createdAt: new Date("2025-01-16T12:00:00Z"),
  };
}

describe("GET /api/orders/export", () => {
  it("returns 401 when no Clerk session is present", async () => {
    currentAuth = { userId: null };
    const res = await request(app).get("/api/orders/export");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the user is authenticated but not an admin", async () => {
    currentAuth = { userId: "user_not_admin" };
    const res = await request(app).get("/api/orders/export");
    expect(res.status).toBe(403);
  });

  it("returns 400 when paymentMethod query param is unknown", async () => {
    currentAuth = { userId: "user_admin" };
    const res = await request(app).get(
      "/api/orders/export?paymentMethod=bitcoin",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inválido/i);
  });

  it("exports all orders as CSV with header, rate and USD equivalent for PayPal", async () => {
    currentAuth = { userId: "user_admin" };
    allRows = [paypalRow(), mpRow()];

    const res = await request(app).get("/api/orders/export");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="ordenes-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    // Without paymentMethod query, .where should not be called.
    expect(lastWhereCalled).toBe(false);

    const text = res.text;
    // BOM for Excel UTF-8 detection
    expect(text.charCodeAt(0)).toBe(0xfeff);
    // Header matches the task spec exactly: 7 columns, no separate Email.
    const headerLine = text.replace(/^\uFEFF/, "").split("\r\n")[0];
    expect(headerLine).toBe(
      "N° factura,Fecha,Cliente,Total ARS,Método,Tipo de cambio aplicado,USD equivalente",
    );
    // PayPal row: padded invoice, persisted rate, computed USD equivalent
    expect(text).toContain("000007");
    expect(text).toContain("1185.5000");
    expect(text).toContain("10.00"); // 11855 / 1185.5 = 10.00
    expect(text).toContain("PayPal");
    // MP row has no rate / USD column (empty cells)
    expect(text).toContain("000008");
    expect(text).toContain("Mercado Pago");
    // Customer name + email folded into the "Cliente" cell, comma triggers
    // RFC-4180 quoting.
    expect(text).toContain('"Buyer, USA <buyer@example.com>"');
  });

  it("filters server-side when paymentMethod is supplied", async () => {
    currentAuth = { userId: "user_admin" };
    allRows = [paypalRow()];

    const res = await request(app).get(
      "/api/orders/export?paymentMethod=paypal",
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(
      /filename="ordenes-paypal-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    // .where should have been invoked when filtering server-side.
    expect(lastWhereCalled).toBe(true);
    expect(res.text).toContain("PayPal");
  });

  it("returns 400 when `from` is not a valid ISO date", async () => {
    currentAuth = { userId: "user_admin" };
    const res = await request(app).get("/api/orders/export?from=ayer");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fecha/i);
  });

  it("returns 400 when `from` is later than `to`", async () => {
    currentAuth = { userId: "user_admin" };
    const res = await request(app).get(
      "/api/orders/export?from=2026-02-01&to=2026-01-01",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rango/i);
  });

  it("filters server-side by date range and reflects it in the filename", async () => {
    // The endpoint must hand the range straight to the DB layer (not just
    // post-filter in JS) so admins can safely export a year's worth of
    // orders without pulling them all into memory. We verify both that
    // a WHERE was issued AND that the filename encodes the period.
    currentAuth = { userId: "user_admin" };
    allRows = [paypalRow()];

    const res = await request(app).get(
      "/api/orders/export?from=2026-01-01&to=2026-01-31",
    );

    expect(res.status).toBe(200);
    expect(lastWhereCalled).toBe(true);
    expect(lastWherePredicate).not.toBeNull();
    expect(res.headers["content-disposition"]).toMatch(
      /filename="ordenes-2026-01-01_2026-01-31\.csv"/,
    );

    // Strict boundary assertion: ?from=2026-01-01 must snap to start-of-day
    // UTC and ?to=2026-01-31 to end-of-day UTC so the range is inclusive
    // on both edges regardless of the admin's local timezone. A regression
    // here (e.g. dropping the end-of-day adjustment) would silently exclude
    // every order placed on the final day of an accounting period.
    expect(lastGteArgs).not.toBeNull();
    expect(lastLteArgs).not.toBeNull();
    const fromDate = lastGteArgs![1] as Date;
    const toDate = lastLteArgs![1] as Date;
    expect(fromDate).toBeInstanceOf(Date);
    expect(toDate).toBeInstanceOf(Date);
    expect(fromDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(toDate.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });

  it("combines paymentMethod and date range in the filename", async () => {
    currentAuth = { userId: "user_admin" };
    allRows = [paypalRow()];

    const res = await request(app).get(
      "/api/orders/export?paymentMethod=paypal&from=2026-01-01&to=2026-01-31",
    );

    expect(res.status).toBe(200);
    expect(lastWhereCalled).toBe(true);
    expect(res.headers["content-disposition"]).toMatch(
      /filename="ordenes-paypal-2026-01-01_2026-01-31\.csv"/,
    );
  });

  it("supports an open-ended `from` only range with `inicio` placeholder", async () => {
    currentAuth = { userId: "user_admin" };
    allRows = [paypalRow()];

    const res = await request(app).get("/api/orders/export?to=2026-01-31");

    expect(res.status).toBe(200);
    expect(lastWhereCalled).toBe(true);
    expect(res.headers["content-disposition"]).toMatch(
      /filename="ordenes-inicio_2026-01-31\.csv"/,
    );
    // Only `lte` should fire when `from` is omitted — sanity check that we
    // are not sneaking in an unintended lower bound.
    expect(lastGteArgs).toBeNull();
    expect(lastLteArgs).not.toBeNull();
  });

  it("supports an open-ended `to` only range with `hoy` placeholder", async () => {
    // Mirror of the previous test: when only `from` is supplied, the
    // filename uses `hoy` as the upper-bound placeholder and only `gte`
    // should be issued at the DB layer.
    currentAuth = { userId: "user_admin" };
    allRows = [paypalRow()];

    const res = await request(app).get("/api/orders/export?from=2026-01-01");

    expect(res.status).toBe(200);
    expect(lastWhereCalled).toBe(true);
    expect(res.headers["content-disposition"]).toMatch(
      /filename="ordenes-2026-01-01_hoy\.csv"/,
    );
    expect(lastLteArgs).toBeNull();
    expect(lastGteArgs).not.toBeNull();
    const fromDate = lastGteArgs![1] as Date;
    expect(fromDate.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("neutralizes spreadsheet formula injection from user-controlled fields", async () => {
    // Regression guard: a malicious customer who sets their name to
    // "=cmd|'/c calc'!A0" would otherwise be executed as a formula by
    // Excel/Sheets when the admin opens the CSV. The export must prefix
    // such cells with a leading apostrophe so the value renders as text.
    currentAuth = { userId: "user_admin" };
    allRows = [
      {
        ...paypalRow(),
        customerName: "=cmd|'/c calc'!A0",
        customerEmail: "+evil@example.com",
      },
    ];

    const res = await request(app).get("/api/orders/export");

    expect(res.status).toBe(200);
    // The cell now starts with a single quote, neutralizing the formula.
    // The cell value has no comma/quote/newline, so RFC-4180 quoting does
    // not wrap it.
    expect(res.text).toContain(`,'=cmd|'/c calc'!A0 <+evil@example.com>,`);
    // No cell may begin with =, +, - or @ at a column boundary.
    expect(res.text).not.toMatch(/(^|,)[=+\-@]/m);
  });
});
