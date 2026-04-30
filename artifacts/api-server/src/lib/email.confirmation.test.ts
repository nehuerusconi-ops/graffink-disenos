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

/**
 * Plancha-grouped orders are NOT auto-deliverable — the admin assembles the
 * combined PNG by hand and emails it back to the buyer within 24hs. The buyer
 * confirmation email must reflect that promise instead of pretending the
 * download is ready, otherwise customers chase a broken link.
 */
describe("sendOrderConfirmationEmail — plancha-grouped behavior", () => {
  it("replaces the download buttons with an 'in preparation' badge and a 24hs delivery promise", async () => {
    const { sendOrderConfirmationEmail } = await loadEmailModule();

    await sendOrderConfirmationEmail(
      baseOrder({
        isPlanchaGrouped: true,
        // Plancha fee included so the persisted total is above the per-item
        // subtotal (i.e. NOT a legacy replacement-model order).
        total: 2496 + 1500,
      }),
    );

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0]![0] as {
      html: string;
      subject: string;
    };

    expect(call.html).toContain("24 horas hábiles");
    expect(call.html).toContain("siendo armada manualmente");
    expect(call.html).toContain("En preparación");
    // No download buttons must leak through for plancha orders.
    expect(call.html).not.toContain("Descargar PNG");
    expect(call.html).not.toContain("/mis-compras");
    // Subject must signal the delayed-delivery flow so the buyer doesn't
    // expect an instant download attachment.
    expect(call.subject).toContain("se está armando");
  });

  it("keeps the download buttons for non-plancha orders (regression guard)", async () => {
    const { sendOrderConfirmationEmail } = await loadEmailModule();

    await sendOrderConfirmationEmail(baseOrder());

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0]![0] as {
      html: string;
      subject: string;
    };
    expect(call.html).toContain("Descargar PNG");
    expect(call.html).toContain("/mis-compras");
    expect(call.html).not.toContain("siendo armada manualmente");
    expect(call.subject).toContain("confirmada");
  });
});

/**
 * The admin alert is what makes the manual fulfillment flow safe: without it
 * the buyer would be promised a 24hs delivery that nobody knows to start. The
 * test pins the contract so a refactor cannot silently drop the alert or its
 * source-file links.
 */
describe("sendPlanchaAssemblyAlertEmail", () => {
  it("emails the admin with customer info and source-file download links", async () => {
    const { sendPlanchaAssemblyAlertEmail } = await loadEmailModule();

    await sendPlanchaAssemblyAlertEmail(
      baseOrder({
        isPlanchaGrouped: true,
        total: 2496 + 1500,
      }),
    );

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const call = sendMailMock.mock.calls[0]![0] as {
      to: string;
      subject: string;
      html: string;
    };

    expect(call.to).toBe("store@example.com");
    expect(call.subject).toContain("NUEVA plancha para armar");
    expect(call.subject).toContain("Test Buyer");
    // Customer details the admin needs to send the assembled plancha back.
    expect(call.html).toContain("buyer@example.com");
    expect(call.html).toContain("Test Buyer");
    expect(call.html).toContain("12345678");
    // Direct link to the per-design source file the admin will compose with.
    expect(call.html).toContain("/api/storage");
    expect(call.html).toContain("Diseño DTF de prueba");
  });

  it("is a no-op for legacy plancha orders (total below per-item subtotal)", async () => {
    // Legacy pricing model: total was REPLACED with a flat plancha price
    // instead of being added on top. The buyer email still sends download
    // links in this case, so the admin must NOT receive an "assemble this
    // manually" alert that would contradict the buyer's expectation.
    const { sendPlanchaAssemblyAlertEmail } = await loadEmailModule();

    await sendPlanchaAssemblyAlertEmail(
      baseOrder({
        isPlanchaGrouped: true,
        // items subtotal = 2 * 1248 = 2496; total below it triggers legacy.
        total: 1500,
      }),
    );

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("is a no-op for non-plancha orders (defense-in-depth guard)", async () => {
    const { sendPlanchaAssemblyAlertEmail } = await loadEmailModule();

    await sendPlanchaAssemblyAlertEmail(
      baseOrder({ isPlanchaGrouped: false }),
    );

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("is a no-op when Gmail credentials are not configured", async () => {
    delete process.env["GMAIL_USER"];
    delete process.env["GMAIL_APP_PASSWORD"];

    const { sendPlanchaAssemblyAlertEmail } = await loadEmailModule();

    await sendPlanchaAssemblyAlertEmail(
      baseOrder({ isPlanchaGrouped: true, total: 4000 }),
    );

    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
