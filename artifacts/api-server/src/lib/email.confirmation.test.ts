/**
 * Unit test for the PayPal "Tipo de cambio aplicado" line in the order
 * confirmation email rendered by `sendOrderConfirmationEmail`.
 *
 * Why this exists:
 *   The PDF receipt already shows the ARS→USD rate, but customers who don't
 *   open the attachment lose that evidence. We mirror the same wording in the
 *   email body for PayPal orders that have `arsToUsdRate` persisted, and
 *   leave the email untouched for other payment methods or orders without
 *   the rate. Locking that contract here prevents a refactor from quietly
 *   dropping the line.
 *
 * Mocking strategy:
 *   - `nodemailer.createTransport` is replaced with a stub whose `sendMail`
 *     captures the rendered HTML so we can assert against it.
 *   - `./pdfInvoice.buildInvoicePdf` is mocked to a no-op so we don't need to
 *     render a real PDF (and to avoid needing the logo file on disk).
 *   - Gmail credentials are set via env so the transporter is created.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Order } from "@workspace/db";

const sendMailMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

vi.mock("./pdfInvoice", async () => {
  const actual =
    await vi.importActual<typeof import("./pdfInvoice")>("./pdfInvoice");
  return {
    ...actual,
    buildInvoicePdf: vi.fn(async () => Buffer.from("%PDF-stub")),
  };
});

type EmailModule = typeof import("./email");

async function loadEmailModule(): Promise<EmailModule> {
  vi.resetModules();
  return await import("./email");
}

const ORIGINAL_ENV = { ...process.env };

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    invoiceNumber: 42,
    customerName: "Test Buyer",
    customerEmail: "buyer@example.com",
    customerDni: "12345678",
    items: [
      {
        productId: "prod-1",
        name: "Diseño DTF de prueba",
        price: 1248,
        quantity: 2,
        imagePath: "fake/path.png",
      },
    ],
    total: 2496,
    isPlanchaGrouped: false,
    paymentMethod: "paypal",
    status: "paid",
    externalPaymentId: null,
    confirmationSource: "paypal-capture",
    arsToUsdRate: "1200",
    createdAt: new Date("2025-01-15T12:00:00Z"),
    ...overrides,
  } as Order;
}

beforeEach(() => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: "test" });
  createTransportMock.mockClear();
  process.env["GMAIL_USER"] = "store@example.com";
  process.env["GMAIL_APP_PASSWORD"] = "test-app-password";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("sendOrderConfirmationEmail — PayPal exchange rate line", () => {
  it("includes the rate line when PayPal order has arsToUsdRate", async () => {
    const { sendOrderConfirmationEmail } = await loadEmailModule();

    await sendOrderConfirmationEmail(baseOrder());

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0]![0] as { html: string };
    expect(call.html).toContain(
      "Tipo de cambio aplicado: 1 USD = $1.200,00 ARS (≈ USD 2,08)",
    );
  });

  it("omits the rate line for non-PayPal orders", async () => {
    const { sendOrderConfirmationEmail } = await loadEmailModule();

    await sendOrderConfirmationEmail(
      baseOrder({
        paymentMethod: "mercadopago",
        confirmationSource: "webhook",
        arsToUsdRate: null,
      }),
    );

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0]![0] as { html: string };
    expect(call.html).not.toContain("Tipo de cambio aplicado");
  });

  it("omits the rate line for older PayPal orders without arsToUsdRate", async () => {
    const { sendOrderConfirmationEmail } = await loadEmailModule();

    await sendOrderConfirmationEmail(
      baseOrder({ arsToUsdRate: null }),
    );

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0]![0] as { html: string };
    expect(call.html).not.toContain("Tipo de cambio aplicado");
  });
});
