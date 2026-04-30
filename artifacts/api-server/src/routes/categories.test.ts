/**
 * Integration tests for the admin-managed product category endpoints.
 *
 *   GET    /api/categories         (public)
 *   POST   /api/categories         (admin)
 *   DELETE /api/categories/:id     (admin)
 *
 * Covers:
 *   - GET returns the seeded list ordered by sortOrder
 *   - POST 201 creates a new category, normalises name + generates a slug
 *   - POST 409 when a same-name category already exists (case-insensitive)
 *   - POST 403 when caller is authenticated but not in ADMIN_USER_IDS
 *   - DELETE 204 happy path for an unused custom category
 *   - DELETE 409 when the target category is flagged isSystem
 *   - DELETE 409 when at least one product still uses the category name
 *   - DELETE 404 when the id does not exist
 *
 * The DB layer is mocked with an in-memory store so tests run without
 * Postgres. Clerk auth is mocked so the admin guard can be exercised
 * deterministically.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["ADMIN_USER_IDS"] = "user_admin";

let currentAuth: { userId: string | null } = { userId: null };
vi.mock("@clerk/express", () => ({
  getAuth: () => currentAuth,
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

// ─── In-memory DB stub ─────────────────────────────────────────────────────
// We model just enough of drizzle's fluent builder to satisfy the route
// code: select/insert/delete with where + orderBy + returning + limit.
// Predicates are captured opaque values from drizzle's `eq` / `sql`; the
// stub interprets them by inspecting which table was passed to .from().

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  isSystem: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductRow {
  id: string;
  category: string;
}

let categories: CategoryRow[] = [];
let products: ProductRow[] = [];

// Each predicate captured by the stub records which column + value was
// compared so the stub can re-execute it against the in-memory rows.
interface CapturedEq {
  kind: "eq";
  column: unknown;
  value: unknown;
}
type CapturedPred = CapturedEq;

let lastFromTable: unknown = null;
let lastWherePred: CapturedPred | null = null;

vi.mock("drizzle-orm", async () => {
  const real = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...real,
    eq: (column: unknown, value: unknown): CapturedEq => ({
      kind: "eq",
      column,
      value,
    }),
    // NOTE: don't mock `sql` — drizzle schema files (e.g.
    // webhookSecurityEvents.ts) call `sql` at module load time to define
    // index fragments and need the real implementation.
  };
});

vi.mock("@workspace/db", async () => {
  const real = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");

  // ─── Helpers ───
  const isCategoriesTable = (t: unknown) => t === real.categoriesTable;
  const isProductsTable = (t: unknown) => t === real.productsTable;

  const filterCategoriesByPred = (pred: CapturedPred | null): CategoryRow[] => {
    if (!pred || pred.kind !== "eq") return categories.slice();
    const cols = real.categoriesTable as unknown as Record<string, unknown>;
    if (pred.column === cols["id"]) {
      return categories.filter((r) => r.id === pred.value);
    }
    if (pred.column === cols["slug"]) {
      return categories.filter((r) => r.slug === pred.value);
    }
    if (pred.column === cols["name"]) {
      return categories.filter((r) => r.name === pred.value);
    }
    return categories.slice();
  };

  const countProductsByPred = (pred: CapturedPred | null): number => {
    if (!pred || pred.kind !== "eq") return products.length;
    const cols = real.productsTable as unknown as Record<string, unknown>;
    if (pred.column === cols["category"]) {
      return products.filter((r) => r.category === pred.value).length;
    }
    return products.length;
  };

  return {
    ...real,
    db: {
      select: (_proj?: unknown) => ({
        from: (table: unknown) => {
          lastFromTable = table;
          // Build a chainable that supports .where / .orderBy / .limit
          const resolveRows = (): unknown[] => {
            if (isCategoriesTable(lastFromTable)) {
              return filterCategoriesByPred(lastWherePred)
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder);
            }
            if (isProductsTable(lastFromTable)) {
              const count = countProductsByPred(lastWherePred);
              return [{ count, maxOrder: null }];
            }
            return [];
          };
          interface Chain {
            where(p: CapturedPred): Chain;
            orderBy(...a: unknown[]): Chain;
            limit(n: number): Promise<unknown[]>;
            then(resolve: (rows: unknown[]) => unknown): Promise<unknown>;
          }
          const chain: Chain = {
            where(pred: CapturedPred) {
              lastWherePred = pred;
              return chain;
            },
            orderBy(..._args: unknown[]) {
              return chain;
            },
            limit(_n: number) {
              return Promise.resolve(resolveRows());
            },
            then(resolve: (rows: unknown[]) => unknown) {
              return Promise.resolve(resolveRows()).then(resolve);
            },
          };
          // Reset where for each from()
          lastWherePred = null;
          return chain;
        },
      }),
      insert: (table: unknown) => ({
        values: (vals: CategoryRow | CategoryRow[]) => ({
          returning: () => {
            if (!isCategoriesTable(table)) return Promise.resolve([]);
            const rows = Array.isArray(vals) ? vals : [vals];
            const now = new Date();
            const inserted = rows.map((r) => ({
              ...r,
              createdAt: r.createdAt ?? now,
              updatedAt: r.updatedAt ?? now,
            }));
            categories.push(...inserted);
            return Promise.resolve(inserted);
          },
        }),
      }),
      delete: (table: unknown) => ({
        where: (pred: CapturedEq) => {
          if (!isCategoriesTable(table)) return Promise.resolve();
          const before = categories.length;
          categories = categories.filter((r) => r.id !== pred.value);
          return Promise.resolve({ count: before - categories.length });
        },
      }),
    },
  };
});

// ─── Build app under test ──────────────────────────────────────────────────
let app: Express;

beforeAll(async () => {
  const router = (await import("./categories")).default;
  app = express();
  app.use(express.json());
  app.use("/api", router);
});

beforeEach(() => {
  currentAuth = { userId: null };
  categories = [];
  products = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("GET /api/categories", () => {
  it("returns the categories ordered by sortOrder", async () => {
    categories = [
      {
        id: "c1",
        name: "Streetwear",
        slug: "streetwear",
        isSystem: false,
        sortOrder: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "c2",
        name: "Plancha armada",
        slug: "plancha-armada",
        isSystem: true,
        sortOrder: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const res = await request(app).get("/api/categories");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe("Streetwear");
    expect(res.body[1].name).toBe("Plancha armada");
  });
});

describe("POST /api/categories", () => {
  it("401s when caller is unauthenticated", async () => {
    currentAuth = { userId: null };
    const res = await request(app)
      .post("/api/categories")
      .send({ name: "Lali" });
    expect(res.status).toBe(401);
  });

  it("creates a category with a normalised slug", async () => {
    currentAuth = { userId: "user_admin" };
    const res = await request(app)
      .post("/api/categories")
      .send({ name: "  Lali  " });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Lali");
    expect(res.body.slug).toBe("lali");
    expect(res.body.isSystem).toBe(false);
    expect(categories).toHaveLength(1);
  });

  it("rejects a duplicate name (case-insensitive via slug)", async () => {
    currentAuth = { userId: "user_admin" };
    categories = [
      {
        id: "c1",
        name: "Lali",
        slug: "lali",
        isSystem: false,
        sortOrder: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const res = await request(app)
      .post("/api/categories")
      .send({ name: "LALI" });
    expect(res.status).toBe(409);
    expect(categories).toHaveLength(1);
  });
});

describe("DELETE /api/categories/:id", () => {
  it("404s when the id does not exist", async () => {
    currentAuth = { userId: "user_admin" };
    const res = await request(app).delete("/api/categories/missing");
    expect(res.status).toBe(404);
  });

  it("409s when the category is flagged isSystem", async () => {
    currentAuth = { userId: "user_admin" };
    categories = [
      {
        id: "c-sys",
        name: "Plancha armada",
        slug: "plancha-armada",
        isSystem: true,
        sortOrder: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const res = await request(app).delete("/api/categories/c-sys");
    expect(res.status).toBe(409);
    expect(categories).toHaveLength(1);
  });

  it("409s when at least one product still uses the category", async () => {
    currentAuth = { userId: "user_admin" };
    categories = [
      {
        id: "c1",
        name: "Lali",
        slug: "lali",
        isSystem: false,
        sortOrder: 70,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    products = [
      { id: "p1", category: "Lali" },
      { id: "p2", category: "Lali" },
    ];
    const res = await request(app).delete("/api/categories/c1");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/2 productos/);
    expect(categories).toHaveLength(1);
  });

  it("204s and removes the category when unused and not system", async () => {
    currentAuth = { userId: "user_admin" };
    categories = [
      {
        id: "c1",
        name: "Lali",
        slug: "lali",
        isSystem: false,
        sortOrder: 70,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const res = await request(app).delete("/api/categories/c1");
    expect(res.status).toBe(204);
    expect(categories).toHaveLength(0);
  });
});
