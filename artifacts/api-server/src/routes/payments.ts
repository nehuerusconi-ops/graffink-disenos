import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { db, ordersTable, productsTable, webhookSecurityEventsTable } from "@workspace/db";
import type { OrderItem } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  sendOrderConfirmationEmail,
  sendPaypalSecurityAlertEmail,
  sendWebhookSignatureAlertEmail,
} from "../lib/email";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAdmin";
import { isValidDniOrCuit } from "../lib/dniCuit";
import { getPlanchaPriceArs } from "./settings";
import { z } from "zod";

const router: IRouter = Router();

// Resolve the public-facing domain used for MP back_urls and notification_url.
// Priority:
//   1. REPLIT_DOMAINS (set when the app is published) — first comma-separated value
//   2. REPLIT_DEV_DOMAIN (set in the development workspace)
//   3. null (no public domain available — back_urls will be omitted)
// MP requires that back_urls / notification_url use a domain that is whitelisted
// in the developer panel, so the merchant must register both the prod and dev
// domains in mercadopago.com.ar/developers/panel/app.
function resolvePublicDomain(): string | null {
  const prod = process.env["REPLIT_DOMAINS"];
  if (prod && prod.trim().length > 0) {
    const first = prod.split(",")[0]?.trim();
    if (first && first !== "localhost:80" && !first.startsWith("localhost")) {
      return first;
    }
  }
  const dev = process.env["REPLIT_DEV_DOMAIN"];
  if (dev && dev.trim().length > 0 && !dev.startsWith("localhost")) {
    return dev.trim();
  }
  return null;
}
const MP_ACCESS_TOKEN = process.env["MERCADOPAGO_ACCESS_TOKEN"] ?? "";
const MP_WEBHOOK_SECRET = process.env["MERCADOPAGO_WEBHOOK_SECRET"] ?? "";
const PAYPAL_CLIENT_ID = process.env["PAYPAL_CLIENT_ID"] ?? "";
const PAYPAL_CLIENT_SECRET = process.env["PAYPAL_CLIENT_SECRET"] ?? "";
// Bank transfer (Transferencia bancaria) — manual payment method.
// CVU + holder displayed to the buyer in the checkout dialog. Hardcoded
// because the operator (one-person shop) has a single bank account; if
// they ever switch banks, just edit these two constants.
const TRANSFERENCIA_CVU = "0000003100035081223734";
const TRANSFERENCIA_HOLDER = "Nehuen Rusconi";

// ---------------------------------------------------------------------------
// PayPal environment selection — SAFE BY DEFAULT
// ---------------------------------------------------------------------------
// Live mode is opt-in only via the explicit PAYPAL_MODE secret. Anything else
// (unset, invalid value, sandbox-looking client ID) resolves to sandbox so we
// never charge real money by accident — for example, if the wrong client ID
// is pasted, or if PAYPAL_MODE is removed during a config edit.
//
// To switch to live, the operator must:
//   1. Replace PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and VITE_PAYPAL_CLIENT_ID
//      with the values from developer.paypal.com → My Apps & Credentials → Live.
//   2. Set the secret PAYPAL_MODE=live.
//   3. Restart the API server.
type PaypalMode = "live" | "sandbox";
function resolvePaypalMode(): PaypalMode {
  const rawMode = process.env["PAYPAL_MODE"] ?? "";
  const explicit = rawMode.trim().toLowerCase();
  if (explicit === "live") {
    // Belt-and-suspenders: even with PAYPAL_MODE=live, refuse to actually
    // hit production if the client ID still looks like a sandbox value.
    const id = PAYPAL_CLIENT_ID.trim().toLowerCase();
    if (id && !id.startsWith("sb-") && !id.includes("sandbox")) {
      return "live";
    }
    logger.warn(
      "PAYPAL_MODE=live but the configured PAYPAL_CLIENT_ID looks like a sandbox value; staying on sandbox",
    );
    return "sandbox";
  }
  return "sandbox";
}

// Log resolved PayPal config at module load so operators can see in workflow
// logs which mode is active and quickly diagnose typos in PAYPAL_MODE.
{
  const rawMode = process.env["PAYPAL_MODE"] ?? "";
  const idLen = PAYPAL_CLIENT_ID.length;
  const idPrefix = PAYPAL_CLIENT_ID.slice(0, 4);
  const resolved = resolvePaypalMode();
  logger.info(
    {
      paypalMode: resolved,
      paypalModeEnvLength: rawMode.length,
      paypalModeEnvLower: rawMode.trim().toLowerCase() || "(unset)",
      paypalClientIdLength: idLen,
      paypalClientIdPrefix: idLen > 0 ? idPrefix : "(empty)",
    },
    "PayPal config resolved at startup",
  );
}

// ---------------------------------------------------------------------------
// ARS→USD conversion rate for PayPal
// Priority: PAYPAL_ARS_TO_USD_RATE env var > live rate from dolarapi.com (1h cache) > 1200 default
// Set PAYPAL_ARS_TO_USD_RATE to override the automatic rate at any time without redeploy.
// PAYPAL_ARS_USD_RATE is also accepted for backward compatibility.
// ---------------------------------------------------------------------------
const _rawRateEnv =
  process.env["PAYPAL_ARS_TO_USD_RATE"] ?? process.env["PAYPAL_ARS_USD_RATE"];
const PAYPAL_ARS_TO_USD_RATE_STATIC: number =
  _rawRateEnv && Number(_rawRateEnv) > 0 ? Number(_rawRateEnv) : 1200;
const PAYPAL_RATE_FROM_ENV = Boolean(_rawRateEnv && Number(_rawRateEnv) > 0);

interface DolarApiResponse {
  venta?: number;
}
let _dolarApiCache: { rate: number; fetchedAt: number } | null = null;
const DOLAR_API_CACHE_MS = 60 * 60 * 1000; // 1 hour

// Short-lived map: PayPal order ID → USD amount used at order creation.
// Prevents rate drift between create-order and capture-order calls.
// Entries are removed after successful capture or after 2 hours.
const _paypalOrderUsd = new Map<string, { usd: number; createdAt: number }>();
const PAYPAL_ORDER_USD_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

type RateSource = "env" | "dolarapi" | "default";

async function getArsToUsdRate(): Promise<{ rate: number; source: RateSource; cachedAt: string | null }> {
  if (PAYPAL_RATE_FROM_ENV) {
    return { rate: PAYPAL_ARS_TO_USD_RATE_STATIC, source: "env", cachedAt: null };
  }

  const now = Date.now();
  if (_dolarApiCache && now - _dolarApiCache.fetchedAt < DOLAR_API_CACHE_MS) {
    return {
      rate: _dolarApiCache.rate,
      source: "dolarapi",
      cachedAt: new Date(_dolarApiCache.fetchedAt).toISOString(),
    };
  }
  try {
    const resp = await fetch("https://dolarapi.com/v1/dolares/blue", {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as DolarApiResponse;
      if (data.venta && data.venta > 0) {
        _dolarApiCache = { rate: data.venta, fetchedAt: now };
        logger.info({ rate: data.venta }, "ARS/USD rate fetched from dolarapi.com");
        return {
          rate: data.venta,
          source: "dolarapi",
          cachedAt: new Date(now).toISOString(),
        };
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to fetch ARS/USD rate from dolarapi.com, using fallback");
  }
  logger.warn(
    { rate: PAYPAL_ARS_TO_USD_RATE_STATIC },
    "Using fallback ARS/USD rate — set PAYPAL_ARS_TO_USD_RATE env var or ensure dolarapi.com is reachable",
  );
  return { rate: PAYPAL_ARS_TO_USD_RATE_STATIC, source: "default", cachedAt: null };
}

const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

// ---------------------------------------------------------------------------
// Shared: cart input schema (only productId + quantity from client)
// ---------------------------------------------------------------------------

const CartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(50),
});

const CustomerInfoSchema = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerDni: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => isValidDniOrCuit(v ?? null),
      "DNI/CUIT inválido (DNI 7-8 dígitos o CUIT 11 dígitos)",
    ),
  items: z.array(CartItemSchema).min(1).max(50),
  groupAsPlancha: z.boolean().optional(),
});

/**
 * Apply the "armar plancha" service-fee to a resolved cart when requested.
 *
 * Pricing model: the plancha price is now ADDITIVE — it is added on top of
 * the per-design subtotal as a single service fee for arming all designs
 * onto one printable plancha. It does NOT replace the items total.
 *
 *   total_final = sum(items.price * items.quantity) + planchaPrice
 *
 * The original orderItems are kept untouched (clients still pay each design
 * at its individual price) so that the PDF/email/admin can reference them
 * as the snapshot of designs included in the plancha. The extra service
 * line is rendered separately by the PDF/email when `isPlanchaGrouped` is
 * true (using the order's `planchaPrice` field).
 *
 * Returns `planchaPrice` separately so callers (MP/PayPal payload builders,
 * PDF, email) can render the service line consistently and never have to
 * re-fetch the setting.
 */
async function applyPlanchaModeIfRequested(
  resolved: { orderItems: OrderItem[]; total: number },
  groupAsPlancha: boolean | undefined,
): Promise<{
  orderItems: OrderItem[];
  total: number;
  isPlanchaGrouped: boolean;
  planchaPrice: number;
}> {
  if (!groupAsPlancha) {
    return { ...resolved, isPlanchaGrouped: false, planchaPrice: 0 };
  }
  const planchaPrice = await getPlanchaPriceArs();
  return {
    orderItems: resolved.orderItems,
    total: resolved.total + planchaPrice,
    isPlanchaGrouped: true,
    planchaPrice,
  };
}

// Resolve cart items from DB, returning authoritative products with server-side prices.
// Rejects unknown productIds and unpublished products.
async function resolveCartItems(
  cartItems: z.infer<typeof CartItemSchema>[],
): Promise<{ orderItems: OrderItem[]; total: number } | { error: string }> {
  const ids = cartItems.map((c) => c.productId);
  const products = await db
    .select()
    .from(productsTable)
    .where(inArray(productsTable.id, ids));

  const productMap = new Map(products.map((p) => [p.id, p]));

  const orderItems: OrderItem[] = [];
  for (const cartItem of cartItems) {
    const product = productMap.get(cartItem.productId);
    if (!product) return { error: `Producto no encontrado: ${cartItem.productId}` };
    if (!product.isPublished) return { error: `Producto no disponible: ${product.name}` };
    orderItems.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: cartItem.quantity,
      imagePath: product.imagePath,
      filePath: product.filePath ?? null,
    });
  }

  const total = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);
  return { orderItems, total };
}

// ---------------------------------------------------------------------------
// Mercado Pago — create preference
// ---------------------------------------------------------------------------

router.post("/payments/mercadopago/preference", async (req, res): Promise<void> => {
  const parsed = CustomerInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { customerName, customerEmail, customerDni, items: cartItems, groupAsPlancha } = parsed.data;

  try {
    const resolvedRaw = await resolveCartItems(cartItems);
    if ("error" in resolvedRaw) {
      res.status(422).json({ error: resolvedRaw.error });
      return;
    }
    const { orderItems, total, isPlanchaGrouped, planchaPrice } =
      await applyPlanchaModeIfRequested(resolvedRaw, groupAsPlancha);

    // Create a pending order first to store orderId in MP external_reference
    const [order] = await db
      .insert(ordersTable)
      .values({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        customerDni: customerDni && customerDni.length > 0 ? customerDni : null,
        items: orderItems,
        total,
        isPlanchaGrouped,
        paymentMethod: "mercadopago",
        status: "pending",
      })
      .returning();

    const preference = new Preference(mpClient);

    // Item lines sent to MP must sum to `total`. Since plancha grouping is
    // now an additive service fee (designs + plancha service), we send each
    // design as its own line and append a single "Armar plancha" service
    // line when isPlanchaGrouped, so the gateway charges sum(designs) +
    // planchaPrice and the webhook amount-check passes.
    // We deliberately use the store name ("GraffInk Diseños") instead of the
    // per-design product name as the line title shown on the Mercado Pago
    // checkout. The buyer should see the store name on their statement / MP
    // checkout, not the internal design name. We still keep one MP line per
    // design (with the real productId, quantity and unit_price) so the
    // gateway charges the right total and the webhook amount-check passes.
    const mpItems: Array<{
      id: string;
      title: string;
      quantity: number;
      unit_price: number;
      currency_id: "ARS";
    }> = orderItems.map((it) => ({
      id: it.productId,
      title: "GraffInk Diseños",
      quantity: it.quantity,
      unit_price: it.price,
      currency_id: "ARS",
    }));
    if (isPlanchaGrouped && planchaPrice > 0) {
      mpItems.push({
        id: "armar-plancha",
        title: "GraffInk Diseños",
        quantity: 1,
        unit_price: planchaPrice,
        currency_id: "ARS",
      });
    }

    const prefBody: Parameters<typeof preference.create>[0]["body"] = {
      external_reference: order.id,
      items: mpItems,
    };

    // back_urls / auto_return / notification_url require the domain to be
    // whitelisted in the Mercado Pago developer panel
    // (mercadopago.com.ar/developers/panel/app). We send them whenever a public
    // domain is available — in production from REPLIT_DOMAINS, in development
    // from REPLIT_DEV_DOMAIN. If MP rejects with `back_url.*` invalid, that
    // means the domain is not yet registered in the panel.
    const publicDomain = resolvePublicDomain();
    const isProduction = !!process.env["REPLIT_DEPLOYMENT"];
    if (publicDomain) {
      prefBody.back_urls = {
        success: `https://${publicDomain}/checkout/success`,
        pending: `https://${publicDomain}/checkout/pending`,
        failure: `https://${publicDomain}/checkout/failure`,
      };
      prefBody.auto_return = "approved";
      prefBody.notification_url = `https://${publicDomain}/api/webhooks/mercadopago`;
      req.log.info(
        { publicDomain, isProduction, orderId: order.id },
        "Creating MP preference with back_urls",
      );
    } else {
      req.log.warn(
        { orderId: order.id },
        "No REPLIT_DOMAINS or REPLIT_DEV_DOMAIN available — MP preference will be created without back_urls/notification_url",
      );
    }

    const pref = await preference.create({ body: prefBody });

    res.json({
      init_point: pref.init_point,
      sandbox_init_point: pref.sandbox_init_point,
      orderId: order.id,
    });
  } catch (err) {
    const mpErr = err as Record<string, unknown>;
    const mpCode = typeof mpErr?.code === "string" ? mpErr.code : undefined;
    req.log.error({ err, mpCode }, "Failed to create MP preference");

    // Provide a specific message for the common misconfiguration error.
    // PA_UNAUTHORIZED_RESULT_FROM_POLICIES means the MP application associated
    // with this access token has not enabled Checkout Pro or has account
    // restrictions. The merchant must activate the application in the
    // Mercado Pago developer panel (mercadopago.com.ar/developers/panel/app).
    if (mpCode === "PA_UNAUTHORIZED_RESULT_FROM_POLICIES") {
      res.status(503).json({
        error: "La aplicación de Mercado Pago no está activada. Activá Checkout Pro en mercadopago.com.ar/developers/panel/app",
        code: mpCode,
      });
      return;
    }

    // Detect MP errors caused by an unauthorized back_url domain. MP returns
    // either an HTTP 400 with cause code 2063 or a message mentioning
    // "back_url" / "auto_return". This happens when the domain we send is not
    // yet registered in the developer panel. Common in development the first
    // time the dev domain is used.
    const mpMessage =
      typeof mpErr?.message === "string" ? mpErr.message.toLowerCase() : "";
    const mpCause = Array.isArray(mpErr?.cause) ? mpErr.cause : [];
    const causeCodes = mpCause
      .map((c) => (c && typeof c === "object" ? (c as { code?: unknown }).code : undefined))
      .map((c) => (typeof c === "number" || typeof c === "string" ? String(c) : ""));
    const looksLikeBackUrlError =
      causeCodes.includes("2063") ||
      mpMessage.includes("back_url") ||
      mpMessage.includes("auto_return") ||
      mpMessage.includes("invalid_back_url");
    if (looksLikeBackUrlError) {
      const usedDomain = resolvePublicDomain();
      res.status(503).json({
        error: usedDomain
          ? `Mercado Pago rechazó el dominio "${usedDomain}". Cargalo en mercadopago.com.ar/developers/panel/app dentro de "URLs de redirección".`
          : "Mercado Pago rechazó las back_urls. Cargá tu dominio en mercadopago.com.ar/developers/panel/app dentro de \"URLs de redirección\".",
        code: "INVALID_BACK_URL",
      });
      return;
    }

    res.status(500).json({ error: "No se pudo crear la preferencia de pago" });
  }
});

// ---------------------------------------------------------------------------
// Mercado Pago — webhook signature validation
// ---------------------------------------------------------------------------

/**
 * Validates the x-signature header sent by Mercado Pago on every webhook.
 *
 * MP format: x-signature: ts=<timestamp>,v1=<hmac-sha256>
 * Manifest:  id:<data_id>;request-id:<x-request-id>;ts:<timestamp>
 *
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 */
function validateMPSignature(
  xSignature: string | undefined,
  xRequestId: string | undefined,
  dataId: string | undefined,
  secret: string,
): boolean {
  if (!xSignature || !secret) return false;

  // Parse "ts=<timestamp>,v1=<hash>" into a map
  const parts: Record<string, string> = {};
  for (const chunk of xSignature.split(",")) {
    const eqIdx = chunk.indexOf("=");
    if (eqIdx === -1) continue;
    parts[chunk.slice(0, eqIdx).trim()] = chunk.slice(eqIdx + 1).trim();
  }

  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  // Manifest string exactly as MP specifies — trailing semicolon is required
  // Format: id:<data_id>;request-id:<x-request-id>;ts:<ts>;
  const manifest = `id:${dataId ?? ""};request-id:${xRequestId ?? ""};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(v1, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mercado Pago — webhook
// ---------------------------------------------------------------------------

router.post("/webhooks/mercadopago", async (req, res): Promise<void> => {
  // --- Signature validation (must happen before any processing) ---
  const xSigRaw = req.headers["x-signature"];
  const xReqIdRaw = req.headers["x-request-id"];
  const xSignature = Array.isArray(xSigRaw) ? xSigRaw[0] : xSigRaw;
  const xRequestId = Array.isArray(xReqIdRaw) ? xReqIdRaw[0] : xReqIdRaw;
  // MP may send the payment ID as ?data.id= (newer format) or ?id= (legacy), or in the JSON body
  const dataId = (req.query["data.id"] ?? req.query["id"] ?? req.body?.data?.id) as string | undefined;

  if (!validateMPSignature(xSignature, xRequestId, dataId, MP_WEBHOOK_SECRET)) {
    logger.warn({ xSignature, xRequestId, dataId }, "MP webhook: invalid signature — rejected");

    // Extract the timestamp from x-signature (ts=<value>,v1=<hash>) for the alert email
    const tsMatch = xSignature ? /ts=([^,]+)/.exec(xSignature) : null;
    const sigTimestamp = tsMatch ? tsMatch[1] : new Date().toISOString();

    // Use req.ip (resolved by Express against the configured trust-proxy hop
    // count) so the value can't be forged by an attacker stuffing extra IPs
    // into x-forwarded-for. Falls back to socket address if Express returns
    // undefined for any reason.
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

    // Persist the rejected attempt for the admin security log. Fire-and-forget
    // so a DB hiccup never delays the 401 response back to the caller.
    void db
      .insert(webhookSecurityEventsTable)
      .values({
        source: "mercadopago",
        reason: "invalid_signature",
        ip,
        xRequestId: xRequestId ?? null,
        signatureTs: sigTimestamp ?? null,
        detail: dataId ? `data.id=${String(dataId)}` : null,
      })
      .catch((err) => {
        logger.error({ err }, "Failed to persist webhook security event");
      });

    // Fire-and-forget alert to the admin (rate-limited internally)
    void sendWebhookSignatureAlertEmail({
      ip,
      xRequestId,
      timestamp: sigTimestamp ?? new Date().toISOString(),
    });

    res.sendStatus(401);
    return;
  }

  // Acknowledge immediately after signature is confirmed valid
  res.sendStatus(200);

  const topic = req.query["topic"] ?? req.body?.type;
  const paymentId = dataId;

  if (topic !== "payment" && req.body?.type !== "payment") return;
  if (!paymentId) return;

  try {
    const payment = new Payment(mpClient);
    const paymentData = await payment.get({ id: String(paymentId) });

    if (paymentData.status !== "approved") return;

    const orderId = paymentData.external_reference;
    if (!orderId) return;

    const [existing] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!existing || existing.status === "paid") return;

    // Verify the gateway-reported amount matches the stored order total (fraud protection)
    const paidAmount = paymentData.transaction_amount ?? 0;
    const expectedAmount = existing.total;
    if (Math.abs(paidAmount - expectedAmount) > 1) {
      logger.error(
        { orderId, paidAmount, expectedAmount },
        "MP webhook: amount mismatch — order NOT marked paid",
      );
      return;
    }

    const [updated] = await db
      .update(ordersTable)
      .set({ status: "paid", externalPaymentId: String(paymentId), confirmationSource: "webhook" })
      .where(eq(ordersTable.id, orderId))
      .returning();

    if (updated) {
      await sendOrderConfirmationEmail(updated);
    }
  } catch (err) {
    logger.error({ err }, "MP webhook processing error");
  }
});

// ---------------------------------------------------------------------------
// PayPal — exchange rate info (public)
// Buyers need this to see the USD equivalent of their cart before confirming a
// PayPal payment. Data is non-sensitive (rate value, its source, cache time).
// ---------------------------------------------------------------------------

router.get("/payments/paypal/rate", async (_req, res): Promise<void> => {
  const { rate, source, cachedAt } = await getArsToUsdRate();
  res.json({ arsToUsd: rate, source, cachedAt, mode: resolvePaypalMode() });
});

// ---------------------------------------------------------------------------
// PayPal — create order
// ---------------------------------------------------------------------------


function paypalBase(): string {
  return resolvePaypalMode() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPaypalAccessToken(): Promise<string> {
  const creds = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const base = paypalBase();
  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = (await resp.json()) as { access_token: string };
  if (!data.access_token) {
    throw new Error(`PayPal auth failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

router.post("/payments/paypal/create-order", async (req, res): Promise<void> => {
  const parsed = CustomerInfoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { customerName, customerEmail, customerDni, items: cartItems, groupAsPlancha } = parsed.data;

  try {
    const resolvedRaw = await resolveCartItems(cartItems);
    if ("error" in resolvedRaw) {
      res.status(422).json({ error: resolvedRaw.error });
      return;
    }
    const { orderItems, total, isPlanchaGrouped } =
      await applyPlanchaModeIfRequested(resolvedRaw, groupAsPlancha);

    // Resolve the ARS→USD rate BEFORE creating the order so we can persist it
    // alongside the row. Storing the rate gives an audit trail of which tasa
    // was applied at the moment the order was created (the live rate may
    // change before capture or refund).
    const { rate: arsToUsd } = await getArsToUsdRate();
    const usdAmount = (total / arsToUsd).toFixed(2);

    const [order] = await db
      .insert(ordersTable)
      .values({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        customerDni: customerDni && customerDni.length > 0 ? customerDni : null,
        items: orderItems,
        total,
        isPlanchaGrouped,
        paymentMethod: "paypal",
        status: "pending",
        arsToUsdRate: arsToUsd.toString(),
      })
      .returning();

    const token = await getPaypalAccessToken();
    const base = paypalBase();

    // Buyer-facing description shown on the PayPal checkout. We use the
    // store name only (no per-design product names, no diseño count) so
    // the buyer sees a clean brand label instead of internal details.
    const description = "GraffInk Diseños";

    const ppResp = await fetch(`${base}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: order.id,
            description,
            amount: {
              currency_code: "USD",
              value: usdAmount,
            },
          },
        ],
      }),
    });

    const ppOrder = (await ppResp.json()) as { id?: string; name?: string; message?: string };

    if (!ppOrder.id) {
      logger.error({ ppOrder }, "PayPal order creation failed — no order ID returned");
      res.status(502).json({ error: "No se pudo crear la orden en PayPal. Intentá nuevamente." });
      return;
    }

    // Persist the PayPal order ID as externalPaymentId for traceability
    await db
      .update(ordersTable)
      .set({ externalPaymentId: ppOrder.id })
      .where(eq(ordersTable.id, order.id));

    // Remember the USD amount used for this order so capture validation uses
    // the same rate even if the live rate changes before capture.
    _paypalOrderUsd.set(ppOrder.id, { usd: parseFloat(usdAmount), createdAt: Date.now() });

    res.json({ ppOrderId: ppOrder.id, orderId: order.id });
  } catch (err) {
    req.log.error({ err }, "Failed to create PayPal order");
    res.status(500).json({ error: "No se pudo crear el pedido en PayPal" });
  }
});

// ---------------------------------------------------------------------------
// PayPal — capture order
// ---------------------------------------------------------------------------

// Persist a PayPal validation failure to the shared webhook security log.
// Fire-and-forget so a DB hiccup never delays the response back to the caller.
// Reasons used:
//   - order_mismatch:     ppOrderId received doesn't match the externalPaymentId
//                         persisted for the orderId (potential replay/forgery).
//   - reference_mismatch: PayPal capture's reference_id doesn't match our orderId.
//   - amount_mismatch:    captured USD amount doesn't match the amount we
//                         registered with PayPal at order creation.
function recordPaypalSecurityEvent(
  reason: "order_mismatch" | "reference_mismatch" | "amount_mismatch",
  ip: string,
  detail: string | null,
  orderId: string,
  ppOrderId: string,
): void {
  void db
    .insert(webhookSecurityEventsTable)
    .values({
      source: "paypal",
      reason,
      ip,
      xRequestId: null,
      signatureTs: null,
      detail,
    })
    .catch((err) => {
      logger.error({ err }, "Failed to persist PayPal webhook security event");
    });

  // Fire-and-forget admin alert (rate-limited internally, shares the per-hour
  // bucket with the MP invalid-signature alert so the admin inbox is bounded
  // even if both channels are probed at once).
  void sendPaypalSecurityAlertEmail({
    reason,
    orderId,
    ppOrderId,
    ip,
    detail,
  });
}

router.post("/payments/paypal/capture-order", async (req, res): Promise<void> => {
  const { ppOrderId, orderId } = req.body as { ppOrderId?: string; orderId?: string };
  if (!ppOrderId || !orderId) {
    res.status(400).json({ error: "ppOrderId y orderId son requeridos" });
    return;
  }

  // Use req.ip (resolved by Express against the configured trust-proxy hop
  // count) so the value can't be forged by an attacker stuffing extra IPs
  // into x-forwarded-for. Falls back to socket address if Express returns
  // undefined for any reason.
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

  try {
    // First verify the DB order exists and has the expected externalPaymentId (binding check)
    const [dbOrder] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));

    if (!dbOrder) {
      res.status(404).json({ error: "Pedido no encontrado" });
      return;
    }
    if (dbOrder.externalPaymentId !== ppOrderId) {
      req.log.warn({ orderId, ppOrderId, stored: dbOrder.externalPaymentId }, "PayPal order ID mismatch");
      recordPaypalSecurityEvent(
        "order_mismatch",
        ip,
        `orderId=${orderId} ppOrderId=${ppOrderId} stored=${dbOrder.externalPaymentId ?? "null"}`,
        orderId,
        ppOrderId,
      );
      res.status(400).json({ error: "El pedido de PayPal no corresponde a esta orden" });
      return;
    }
    if (dbOrder.status === "paid") {
      res.json(dbOrder);
      return;
    }

    const token = await getPaypalAccessToken();
    const base = paypalBase();

    const captureResp = await fetch(`${base}/v2/checkout/orders/${ppOrderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

    type CaptureUnit = {
      reference_id?: string;
      payments?: {
        captures?: Array<{ amount?: { value?: string; currency_code?: string } }>;
      };
    };
    type CaptureResult = {
      status: string;
      purchase_units?: CaptureUnit[];
    };
    const capture = (await captureResp.json()) as CaptureResult;

    if (capture.status !== "COMPLETED") {
      res.status(400).json({ error: `Pago no completado: ${capture.status}` });
      return;
    }

    // Verify the captured order's reference_id matches our DB order ID
    const capturedUnit = capture.purchase_units?.[0];
    const capturedRef = capturedUnit?.reference_id;
    if (capturedRef && capturedRef !== orderId) {
      req.log.warn({ orderId, capturedRef }, "PayPal reference_id mismatch on capture");
      recordPaypalSecurityEvent(
        "reference_mismatch",
        ip,
        `orderId=${orderId} capturedRef=${capturedRef} ppOrderId=${ppOrderId}`,
        orderId,
        ppOrderId,
      );
      res.status(400).json({ error: "El pago capturado no corresponde a esta orden" });
      return;
    }

    // Verify captured amount against the USD amount set at order creation (fraud protection).
    // We use the stored amount from _paypalOrderUsd rather than recomputing with the current
    // rate to avoid false positives when the exchange rate changes between create and capture.
    const capturedUsd = parseFloat(capturedUnit?.payments?.captures?.[0]?.amount?.value ?? "0");
    const storedEntry = _paypalOrderUsd.get(ppOrderId);
    // Purge stale entries from the map while we're here
    const now = Date.now();
    for (const [key, val] of _paypalOrderUsd.entries()) {
      if (now - val.createdAt > PAYPAL_ORDER_USD_TTL_MS) _paypalOrderUsd.delete(key);
    }
    if (storedEntry) {
      const expectedUsd = storedEntry.usd;
      // Allow 1 USD tolerance for rounding differences
      if (capturedUsd > 0 && Math.abs(capturedUsd - expectedUsd) > 1) {
        req.log.error({ orderId, capturedUsd, expectedUsd }, "PayPal amount mismatch — NOT marking paid");
        recordPaypalSecurityEvent(
          "amount_mismatch",
          ip,
          `orderId=${orderId} capturedUsd=${capturedUsd} expectedUsd=${expectedUsd}`,
          orderId,
          ppOrderId,
        );
        res.status(400).json({ error: "El monto capturado no coincide con el total de la orden" });
        return;
      }
      _paypalOrderUsd.delete(ppOrderId);
    } else {
      req.log.warn({ orderId, ppOrderId }, "PayPal USD amount not in memory (server restart?), skipping amount check");
    }

    const [updated] = await db
      .update(ordersTable)
      .set({ status: "paid", confirmationSource: "paypal-capture" })
      .where(eq(ordersTable.id, orderId))
      .returning();

    if (updated) {
      await sendOrderConfirmationEmail(updated);
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to capture PayPal order");
    res.status(500).json({ error: "Error al capturar el pago de PayPal" });
  }
});

// ---------------------------------------------------------------------------
// Transferencia bancaria — return CVU + holder for manual payment
// ---------------------------------------------------------------------------
// The buyer copies the CVU and transfers the order total from their bank
// app. They send the receipt to the store's email and the admin marks the
// order as paid manually from the admin panel.

router.post("/payments/transferencia/info", (_req, res): void => {
  res.json({ cvu: TRANSFERENCIA_CVU, holder: TRANSFERENCIA_HOLDER });
});

export default router;
