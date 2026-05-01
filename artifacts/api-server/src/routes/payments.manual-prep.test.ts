/**
 * Unit tests for `computeRequiresManualPrep`.
 *
 * This pure helper is the single source of truth for whether a freshly-paid
 * order should be flagged as needing manual preparation by the admin (and
 * therefore promised to the buyer in 24hs hábiles instead of the immediate
 * download). It is consumed by both Mercado Pago and PayPal capture flows
 * (see `payments.ts`), so a regression here would silently break delivery
 * promises for an entire payment method.
 *
 * The contract under test:
 *   1. `isPlanchaGrouped: true` → ALWAYS manual prep, regardless of items
 *      (the admin still has to compose the final plancha PNG).
 *   2. Any item with `isCustomSize: true` → manual prep (free-form WxH cm,
 *      requires re-export).
 *   3. Any item whose `selectedSize` is a non-empty string different from
 *      `"Original"` → manual prep (catalog standard size like "20x20 cm",
 *      requires re-export to that size).
 *   4. All-default carts (every item Original, no plancha) → NOT manual.
 *   5. Empty/whitespace `selectedSize` is treated as Original — defends
 *      against accidental client-side string normalization issues.
 *
 * NOTE: Importing `payments.ts` would pull in the live Mercado Pago / PayPal
 * SDK and the Drizzle DB. To keep this test fast and dependency-free we
 * stub `@workspace/db` and the SDKs; the route handlers are not exercised
 * here — only the named export. The plancha integration test
 * (`payments.plancha.test.ts`) covers the route wiring end-to-end.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

// Required env so the payments module's top-level checks don't throw on import.
process.env["MERCADOPAGO_ACCESS_TOKEN"] = "TEST-mp-token";
process.env["MERCADOPAGO_WEBHOOK_SECRET"] = "test-secret";
process.env["PAYPAL_CLIENT_ID"] = "test-pp-client";
process.env["PAYPAL_CLIENT_SECRET"] = "test-pp-secret";
process.env["PAYPAL_ARS_TO_USD_RATE"] = "1000";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
  ordersTable: {},
  productsTable: {},
}));

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {},
  Preference: class {
    create() {
      return Promise.resolve({});
    }
  },
  Payment: class {
    get() {
      return Promise.resolve({});
    }
  },
}));

vi.mock("../lib/email", () => ({
  sendOrderConfirmationEmail: vi.fn(),
  sendAdminNewOrderAlert: vi.fn(),
}));

// Helper to build a minimal valid OrderItem for the helper.
type OrderItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imagePath: string;
  filePath: string | null;
  selectedSize?: string;
  isCustomSize?: boolean;
};

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    productId: "p1",
    name: "Diseño X",
    price: 1000,
    quantity: 1,
    imagePath: "img/x.png",
    filePath: "files/x.png",
    selectedSize: "Original",
    isCustomSize: false,
    ...overrides,
  };
}

let computeRequiresManualPrep: (items: OrderItem[], grouped: boolean) => boolean;

beforeAll(async () => {
  const mod = await import("./payments");
  computeRequiresManualPrep = mod.computeRequiresManualPrep;
});

describe("computeRequiresManualPrep", () => {
  it("returns true when groupAsPlancha is true, even with all-Original items", () => {
    expect(
      computeRequiresManualPrep(
        [makeItem(), makeItem({ productId: "p2" })],
        true,
      ),
    ).toBe(true);
  });

  it("returns true when any item has isCustomSize=true", () => {
    expect(
      computeRequiresManualPrep(
        [
          makeItem(),
          makeItem({
            productId: "p2",
            selectedSize: "Personalizado 12x18 cm",
            isCustomSize: true,
          }),
        ],
        false,
      ),
    ).toBe(true);
  });

  it("returns true when any item has a non-Original standard selectedSize", () => {
    expect(
      computeRequiresManualPrep(
        [makeItem(), makeItem({ productId: "p2", selectedSize: "20x20 cm" })],
        false,
      ),
    ).toBe(true);
  });

  it("returns false when every item is Original and grouping is off", () => {
    expect(
      computeRequiresManualPrep(
        [
          makeItem(),
          makeItem({ productId: "p2", selectedSize: "Original" }),
          makeItem({ productId: "p3", selectedSize: undefined }),
        ],
        false,
      ),
    ).toBe(false);
  });

  it("treats empty / whitespace-only selectedSize as Original (no manual prep)", () => {
    expect(
      computeRequiresManualPrep(
        [
          makeItem({ selectedSize: "" }),
          makeItem({ productId: "p2", selectedSize: "   " }),
        ],
        false,
      ),
    ).toBe(false);
  });

  it("returns false for an empty cart with grouping off", () => {
    expect(computeRequiresManualPrep([], false)).toBe(false);
  });

  it("returns true for an empty cart with grouping on (defensive — route layer rejects empty carts before this is reached)", () => {
    expect(computeRequiresManualPrep([], true)).toBe(true);
  });
});
