/**
 * Integration tests for the admin "download invoice PDF" endpoint.
 *
 *   GET /api/orders/:id/invoice-pdf
 *
 * Covers:
 *   - 401 when no Clerk session is present
 *   - 403 when the authenticated user is not in ADMIN_USER_IDS
 *   - 404 when the order does not exist
 *   - 404 when the order exists but is not paid
 *   - 200 + application/pdf body when an admin downloads a paid order
 *
 * The DB and Clerk auth layers are mocked so the test runs without
 * requiring postgres or a real Clerk session.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

// ─── Setup that MUST happen before importing the orders router ─────────────
// requireAdmin reads ADMIN_USER_IDS at module load.
process.env["ADMIN_USER_IDS"] = "user_admin";
// pdfInvoice reads REPLIT_DOMAINS at module load.
process.env["REPLIT_DOMAINS"] = "test.example.com";

// Controllable Clerk mock — each test sets `currentAuth` to dictate what
// `getAuth(req)` returns inside requireAdmin.
let currentAuth: { userId: string | null } = { userId: null };
vi.mock("@clerk/express", () => ({
  getAuth: () => currentAuth,
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// Controllable DB mock — each test sets `currentRow` to control what the
// select chain returns. We mimic the drizzle chain shape used by the route:
//
//   db.select().from(table).where(predicate)  →  Promise<Row[]>
let currentRow: Record<string, unknown> | null = null;
vi.mock("@workspace/db", async () => {
  // Re-export the real schema (so `ordersTable`, `OrderItem` types still work)
  // but replace `db` with a stub. The route never inspects ordersTable beyond
  // passing it to `from()`, so the real schema export is fine.
  const real =
    await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...real,
    db: {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve(currentRow == null ? [] : [currentRow]),
        }),
      }),
    },
  };
});

// Now it's safe to import the router (which transitively imports the mocked
// modules above).
let app: Express;
beforeAll(async () => {
  const ordersRouter = (await import("./orders")).default;
  app = express();
  app.use(express.json());
  app.use("/api", ordersRouter);
});

beforeEach(() => {
  currentAuth = { userId: null };
  currentRow = null;
});

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

function paidOrderRow(): Record<string, unknown> {
  return {
    id: VALID_UUID,
    invoiceNumber: 42,
    customerName: "Test Buyer",
    customerEmail: "buyer@example.com",
    customerDni: "12345678",
    items: [
      {
        productId: "prod-1",
        name: "Diseño DTF de prueba",
        price: 1500,
        quantity: 2,
        imagePath: "fake/path.png",
      },
    ],
    total: 3000,
    isPlanchaGrouped: false,
    paymentMethod: "mercadopago",
    status: "paid",
    externalPaymentId: null,
    confirmationSource: "manual",
    arsToUsdRate: null,
    createdAt: new Date("2025-01-15T12:00:00Z"),
  };
}

describe("GET /api/orders/:id/invoice-pdf", () => {
  it("returns 401 when no Clerk session is present", async () => {
    currentAuth = { userId: null };
    currentRow = paidOrderRow();

    const res = await request(app).get(`/api/orders/${VALID_UUID}/invoice-pdf`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when the user is authenticated but not an admin", async () => {
    currentAuth = { userId: "user_not_admin" };
    currentRow = paidOrderRow();

    const res = await request(app).get(`/api/orders/${VALID_UUID}/invoice-pdf`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/administrador/i);
  });

  it("returns 404 when the order does not exist", async () => {
    currentAuth = { userId: "user_admin" };
    currentRow = null;

    const res = await request(app).get(`/api/orders/${VALID_UUID}/invoice-pdf`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no encontrado/i);
  });

  it("returns 404 when the order exists but is not paid", async () => {
    currentAuth = { userId: "user_admin" };
    currentRow = { ...paidOrderRow(), status: "pending" };

    const res = await request(app).get(`/api/orders/${VALID_UUID}/invoice-pdf`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/pagados/i);
  });

  it("returns 200 + application/pdf for an admin downloading a paid order", async () => {
    currentAuth = { userId: "user_admin" };
    currentRow = paidOrderRow();

    const res = await request(app)
      .get(`/api/orders/${VALID_UUID}/invoice-pdf`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="comprobante-N000042\.pdf"/,
    );
    // PDF files always start with "%PDF-"
    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(100);
    expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
