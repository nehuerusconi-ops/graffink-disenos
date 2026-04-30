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

// Controllable DB mock that supports both
//   db.select().from(table).where(...).orderBy(...)  →  Promise<Row[]>
// and
//   db.select().from(table).orderBy(...)             →  Promise<Row[]>
// The export route uses both shapes depending on whether a paymentMethod
// query parameter was supplied. We capture the last predicate so each test
// can assert that the correct filter was issued.
let allRows: Record<string, unknown>[] = [];
let lastWhereCalled = false;
vi.mock("@workspace/db", async () => {
  const real =
    await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...real,
    db: {
      select: () => ({
        from: () => ({
          where: (_pred: unknown) => {
            lastWhereCalled = true;
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
