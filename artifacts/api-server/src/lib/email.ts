import nodemailer from "nodemailer";
import { count, lt, sql } from "drizzle-orm";
import { db, webhookAlertLogTable, type Order } from "@workspace/db";
import { logger } from "./logger";
import { buildInvoicePdf, formatPaypalRateLine } from "./pdfInvoice";

const GMAIL_USER = process.env["GMAIL_USER"];
const GMAIL_APP_PASSWORD = process.env["GMAIL_APP_PASSWORD"];
const DOMAIN = (process.env["REPLIT_DOMAINS"] ?? "localhost:80").split(",")[0];

function createTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    logger.warn("Gmail credentials not configured — email delivery disabled");
    return null;
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

function buildDownloadLinks(items: Order["items"]): string {
  return items
    .map(
      (item) => {
        // Use filePath (the actual high-res design file) when available; fall back to imagePath (preview).
        // filePath is the product's downloadable DTF file stored in object storage.
        const downloadPath = item.filePath ?? item.imagePath;
        const downloadUrl = `https://${DOMAIN}/api/storage${downloadPath}`;
        return `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#fff; font-size:14px;">${item.name}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#aaa; font-size:14px; text-align:center;">${item.quantity}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; text-align:right;">
          <a href="${downloadUrl}"
             style="display:inline-block; background:#3b82f6; color:#fff; font-weight:700; padding:6px 14px; border-radius:4px; text-decoration:none; font-size:13px;">
            Descargar PNG
          </a>
        </td>
      </tr>`;
      },
    )
    .join("");
}

/**
 * Buyer-facing item rows for "Armar plancha" orders. No download buttons —
 * those would lead nowhere because the deliverable (the assembled plancha PNG)
 * doesn't exist yet. Replaced with a "En preparación" badge so the buyer sees
 * exactly which designs are part of their plancha.
 */
function buildPlanchaPendingItemRows(items: Order["items"]): string {
  return items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#fff; font-size:14px;">${item.name}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#aaa; font-size:14px; text-align:center;">${item.quantity}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; text-align:right;">
          <span style="display:inline-block; background:#1e3a5f; color:#3b82f6; font-weight:700; padding:6px 14px; border-radius:4px; font-size:12px; letter-spacing:1px; text-transform:uppercase;">
            En preparación
          </span>
        </td>
      </tr>`,
    )
    .join("");
}

/**
 * Build a single "Armar plancha" service-fee row appended after the per-design
 * download rows. Used when an order was checked out with the "Armar plancha"
 * toggle (order.isPlanchaGrouped). The fee is derived from the persisted
 * order.total minus the per-item subtotal so the email always shows the exact
 * amount the customer paid, even if the live setting changed later.
 */
function buildPlanchaServiceRow(items: Order["items"], total: number): string {
  const itemsSubtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const planchaFee = Math.max(0, total - itemsSubtotal);
  const count = items.length;
  return `
      <tr>
        <td style="padding:14px 16px; background:#0a1628; border-top:1px solid #1e3a5f; color:#fff; font-size:14px;">
          <div style="font-weight:700;">Armar plancha</div>
          <div style="color:#aaa; font-size:12px; margin-top:2px;">${count} diseño${count > 1 ? "s" : ""} agrupado${count > 1 ? "s" : ""} en una sola plancha imprimible</div>
        </td>
        <td style="padding:14px 16px; background:#0a1628; border-top:1px solid #1e3a5f; color:#aaa; font-size:14px; text-align:center;">—</td>
        <td style="padding:14px 16px; background:#0a1628; border-top:1px solid #1e3a5f; color:#3b82f6; font-size:14px; text-align:right; font-weight:700;">
          +$${planchaFee.toLocaleString("es-AR")}
        </td>
      </tr>`;
}

/**
 * True for orders persisted under the OLD replacement-model (legacy):
 * `isPlanchaGrouped` is true and the persisted total is BELOW the sum of
 * the per-item prices (because the old code REPLACED the total with a flat
 * plancha price). Avoids contradictions in historical invoices/emails.
 */
function isLegacyPlanchaOrder(order: Order): boolean {
  if (!order.isPlanchaGrouped) return false;
  const itemsSubtotal = order.items.reduce(
    (s, it) => s + it.price * it.quantity,
    0,
  );
  return order.total < itemsSubtotal;
}

function formatMethod(method: string): string {
  const map: Record<string, string> = {
    mercadopago: "Mercado Pago",
    transferencia: "Transferencia bancaria",
    paypal: "PayPal",
  };
  return map[method] ?? method;
}

// ---------------------------------------------------------------------------
// Webhook signature alert — rate-limited to MAX_ALERTS_PER_HOUR per hour
// ---------------------------------------------------------------------------

/**
 * Resolve the per-hour cap on admin alert emails. Reads
 * `WEBHOOK_ALERT_MAX_PER_HOUR` from the environment with a fallback of 5.
 * Throws at module load if the override is set but is not a positive integer
 * so the operator notices the misconfiguration immediately instead of silently
 * keeping the old behaviour.
 */
function resolveMaxAlertsPerHour(): number {
  const raw = process.env["WEBHOOK_ALERT_MAX_PER_HOUR"];
  if (raw === undefined || raw === "") return 5;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid WEBHOOK_ALERT_MAX_PER_HOUR value: "${raw}" (must be a positive integer)`,
    );
  }
  return parsed;
}

const MAX_ALERTS_PER_HOUR = resolveMaxAlertsPerHour();
// Single shared bucket: BOTH the MP invalid-signature alert and the PayPal
// security alert consume from the same per-hour quota. Sharing it caps the
// total volume of "security" emails the admin can receive in any given hour
// regardless of how many channels an attacker probes.
//
// State is kept in the `webhook_alert_log` table (NOT a process-local array)
// so the cap survives server restarts (deploy/crash/scaling) and is shared
// across multiple instances. With an in-memory counter an attacker triggering
// a restart loop, or simply hitting two instances in parallel, could exceed
// the configured quota by an arbitrary multiple.

/**
 * Stable advisory-lock key used by `tryConsumeAlertSlot` to serialise the
 * prune/count/insert sequence across ALL instances of the server. Picked
 * arbitrarily; the only requirement is that it stays the same across deploys
 * so concurrent processes contend on the same key. `pg_advisory_xact_lock`
 * auto-releases when the transaction commits or rolls back, so we never need
 * a manual unlock and a crashed worker won't strand the lock.
 */
const ALERT_LEDGER_ADVISORY_LOCK_KEY = 0x57414c52n; // "WALR" in ascii

/**
 * Shared rate-limit gate for admin security alerts. Inside a single
 * transaction, takes a Postgres advisory lock, prunes rows older than 1h,
 * counts what's left, and either inserts a fresh row + returns true (caller
 * should send) or returns false (caller should skip).
 *
 * The advisory lock is what makes this safe under concurrency. Postgres
 * defaults to `READ COMMITTED`, so without serialisation two transactions
 * (on the same instance OR on different instances pointed at the same DB)
 * could both see `sent < cap` at the same time and both insert — letting an
 * attacker exceed the configured per-hour quota by an arbitrary multiple.
 * `pg_advisory_xact_lock` makes every slot decision strictly serial across
 * the whole cluster: any second caller waits until the first transaction
 * commits before it can read the count.
 *
 * Persistence + serialisation together give us the guarantees required by
 * the task: the cap survives server restarts AND scales correctly across
 * multiple instances.
 */
async function tryConsumeAlertSlot(
  logCtx: Record<string, unknown>,
  source: string,
): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  try {
    return await db.transaction(async (tx) => {
      // Serialise across processes/instances. Released automatically when the
      // surrounding transaction commits or aborts.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${ALERT_LEDGER_ADVISORY_LOCK_KEY})`,
      );

      // Prune so the count below reflects only "alerts in the last hour".
      // Keeps the table bounded by MAX_ALERTS_PER_HOUR in steady state.
      await tx
        .delete(webhookAlertLogTable)
        .where(lt(webhookAlertLogTable.sentAt, oneHourAgo));

      const [row] = await tx
        .select({ value: count() })
        .from(webhookAlertLogTable);
      const sent = row?.value ?? 0;

      if (sent >= MAX_ALERTS_PER_HOUR) {
        logger.warn(
          logCtx,
          `${source} alert rate limit reached — skipping admin email`,
        );
        return false;
      }

      await tx
        .insert(webhookAlertLogTable)
        .values({ source, sentAt: sql`now()` });
      return true;
    });
  } catch (err) {
    // If the ledger query/insert itself fails (DB outage, schema drift, etc.)
    // we deliberately FAIL CLOSED — i.e. drop the email — instead of falling
    // back to "send anyway" which could uncap the alerts during a real attack.
    logger.error(
      { ...logCtx, err },
      `${source} alert rate limit ledger failed — skipping admin email`,
    );
    return false;
  }
}

export async function sendWebhookSignatureAlertEmail(opts: {
  ip: string;
  xRequestId: string | undefined;
  timestamp: string;
}): Promise<void> {
  const transporter = createTransporter();
  if (!transporter || !GMAIL_USER) return;

  if (
    !(await tryConsumeAlertSlot(
      { ip: opts.ip, xRequestId: opts.xRequestId },
      "MP webhook",
    ))
  ) {
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <tr>
          <td style="background:#1a0000;border-radius:12px 12px 0 0;padding:32px 40px;border-bottom:2px solid #ef4444;">
            <p style="color:#ef4444;font-size:13px;font-weight:700;letter-spacing:1px;margin:0 0 8px 0;">⚠ ALERTA DE SEGURIDAD</p>
            <h1 style="color:#fff;font-size:20px;font-weight:900;margin:0;">Firma inválida en webhook de Mercado Pago</h1>
          </td>
        </tr>

        <tr>
          <td style="background:#111;padding:32px 40px;">
            <p style="color:#aaa;font-size:15px;margin:0 0 24px 0;">
              Se recibió una solicitud al endpoint de webhook de Mercado Pago con una firma HMAC inválida.
              Esto puede indicar un intento de replay attack o un fraude. Revisá los logs del servidor para más contexto.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2a0000;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#1a0000;">
                <th colspan="2" style="padding:10px 16px;text-align:left;color:#ef4444;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Detalles del intento</th>
              </tr>
              <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#666;font-size:13px;width:40%;">IP de origen</td>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#fff;font-size:13px;font-family:monospace;">${opts.ip}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#666;font-size:13px;">x-request-id</td>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#fff;font-size:13px;font-family:monospace;">${opts.xRequestId ?? "(no enviado)"}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;color:#666;font-size:13px;">Timestamp (ts)</td>
                <td style="padding:10px 16px;color:#fff;font-size:13px;font-family:monospace;">${opts.timestamp}</td>
              </tr>
            </table>

            <p style="color:#555;font-size:12px;margin:0;">
              Este aviso está limitado a ${MAX_ALERTS_PER_HOUR} alertas por hora para evitar spam durante ataques masivos.
            </p>
          </td>
        </tr>

        <tr>
          <td style="background:#0a0a0a;border-radius:0 0 12px 12px;padding:20px 40px;border-top:1px solid #1a1a1a;text-align:center;">
            <p style="color:#444;font-size:12px;margin:0;">GraffInk Diseños — Alerta automática del sistema</p>
            <p style="color:#333;font-size:11px;margin:6px 0 0 0;">https://${DOMAIN}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"GraffInk Diseños Sistema" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `🚨 GraffInk Diseños — Firma inválida en webhook de Mercado Pago (IP: ${opts.ip})`,
      html,
    });
    logger.info(
      { ip: opts.ip, xRequestId: opts.xRequestId },
      "Webhook signature alert email sent to admin",
    );
  } catch (err) {
    logger.error({ err }, "Failed to send webhook signature alert email");
  }
}

// ---------------------------------------------------------------------------
// PayPal capture security alert — same per-hour quota as the MP alert
// ---------------------------------------------------------------------------

/**
 * Map the machine-readable reason emitted by the PayPal capture handler to a
 * human-friendly Spanish description for the admin email.
 */
function describePaypalReason(
  reason:
    | "order_mismatch"
    | "reference_mismatch"
    | "amount_mismatch"
    | "missing_amount",
): string {
  switch (reason) {
    case "order_mismatch":
      return "El ppOrderId enviado no coincide con el externalPaymentId guardado para esta orden.";
    case "reference_mismatch":
      return "El reference_id devuelto por PayPal al capturar no coincide con nuestro orderId.";
    case "amount_mismatch":
      return "El monto capturado en USD no coincide con el monto registrado al crear la orden.";
    case "missing_amount":
      return "No hay un monto en USD registrado para esta orden, así que no se puede verificar la captura (puede pasar si la orden quedó sin el monto persistido tras un reinicio del servidor o si fue creada antes de que existiera la columna).";
  }
}

/**
 * Send an admin alert when `/payments/paypal/capture-order` rejects a
 * capture for one of the documented security reasons. Shares the per-hour
 * bucket with `sendWebhookSignatureAlertEmail` so the admin inbox can never
 * receive more than `MAX_ALERTS_PER_HOUR` security alerts in any hour
 * regardless of which channel triggered them.
 */
export async function sendPaypalSecurityAlertEmail(opts: {
  reason:
    | "order_mismatch"
    | "reference_mismatch"
    | "amount_mismatch"
    | "missing_amount";
  orderId: string;
  ppOrderId: string;
  ip: string;
  detail: string | null;
}): Promise<void> {
  const transporter = createTransporter();
  if (!transporter || !GMAIL_USER) return;

  if (
    !(await tryConsumeAlertSlot(
      {
        reason: opts.reason,
        orderId: opts.orderId,
        ppOrderId: opts.ppOrderId,
        ip: opts.ip,
      },
      "PayPal capture",
    ))
  ) {
    return;
  }

  const reasonLabel = opts.reason;
  const reasonDescription = describePaypalReason(opts.reason);

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <tr>
          <td style="background:#1a0000;border-radius:12px 12px 0 0;padding:32px 40px;border-bottom:2px solid #ef4444;">
            <p style="color:#ef4444;font-size:13px;font-weight:700;letter-spacing:1px;margin:0 0 8px 0;">⚠ ALERTA DE SEGURIDAD — PAYPAL</p>
            <h1 style="color:#fff;font-size:20px;font-weight:900;margin:0;">Captura de PayPal rechazada por validación</h1>
          </td>
        </tr>

        <tr>
          <td style="background:#111;padding:32px 40px;">
            <p style="color:#aaa;font-size:15px;margin:0 0 24px 0;">
              El endpoint <code style="color:#fff;">/api/payments/paypal/capture-order</code> rechazó un intento de capturar
              un pago de PayPal por un motivo de seguridad. Esto puede indicar un intento de forzar la captura
              con un <code style="color:#fff;">ppOrderId</code> ajeno o con un monto distinto al registrado.
              Revisá los logs del servidor para más contexto.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2a0000;border-radius:8px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#1a0000;">
                <th colspan="2" style="padding:10px 16px;text-align:left;color:#ef4444;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">Detalles del intento</th>
              </tr>
              <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#666;font-size:13px;width:40%;">Motivo</td>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#fff;font-size:13px;font-family:monospace;">${reasonLabel}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#666;font-size:13px;">Descripción</td>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#fff;font-size:13px;">${reasonDescription}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#666;font-size:13px;">orderId</td>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#fff;font-size:13px;font-family:monospace;">${opts.orderId}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#666;font-size:13px;">ppOrderId</td>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#fff;font-size:13px;font-family:monospace;">${opts.ppOrderId}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#666;font-size:13px;">IP de origen</td>
                <td style="padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#fff;font-size:13px;font-family:monospace;">${opts.ip}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;color:#666;font-size:13px;">Detalle</td>
                <td style="padding:10px 16px;color:#fff;font-size:13px;font-family:monospace;">${opts.detail ?? "(sin detalle)"}</td>
              </tr>
            </table>

            <p style="color:#555;font-size:12px;margin:0;">
              Este aviso está limitado a ${MAX_ALERTS_PER_HOUR} alertas por hora (cuota compartida con las alertas de Mercado Pago) para evitar spam durante ataques masivos.
            </p>
          </td>
        </tr>

        <tr>
          <td style="background:#0a0a0a;border-radius:0 0 12px 12px;padding:20px 40px;border-top:1px solid #1a1a1a;text-align:center;">
            <p style="color:#444;font-size:12px;margin:0;">GraffInk Diseños — Alerta automática del sistema</p>
            <p style="color:#333;font-size:11px;margin:6px 0 0 0;">https://${DOMAIN}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"GraffInk Diseños Sistema" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `🚨 GraffInk Diseños — Captura de PayPal rechazada (${reasonLabel}, IP: ${opts.ip})`,
      html,
    });
    logger.info(
      {
        reason: opts.reason,
        orderId: opts.orderId,
        ppOrderId: opts.ppOrderId,
        ip: opts.ip,
      },
      "PayPal security alert email sent to admin",
    );
  } catch (err) {
    logger.error({ err }, "Failed to send PayPal security alert email");
  }
}

export async function sendOrderConfirmationEmail(order: Order): Promise<void> {
  const transporter = createTransporter();
  if (!transporter) return;

  const invoiceStr = String(order.invoiceNumber).padStart(6, "0");
  const totalFormatted = `$${order.total.toLocaleString("es-AR")} ARS`;
  const paypalRateLine = formatPaypalRateLine(
    order.paymentMethod,
    order.arsToUsdRate,
    order.total,
  );

  // Plancha-grouped orders are NOT instantly deliverable — the admin has to
  // manually compose the assembled plancha PNG from the selected designs and
  // email it to the buyer. The email below adapts both the intro copy and the
  // per-item rows to communicate this clearly: no download buttons, an
  // explicit "24hs" delivery promise, and the Mis Compras callout is hidden
  // until the assembled file is delivered.
  const isPlancha = order.isPlanchaGrouped && !isLegacyPlanchaOrder(order);
  const introHtml = isPlancha
    ? `<p style="color:#aaa; font-size:15px; margin:0 0 8px 0;">Hola <strong style="color:#fff;">${order.customerName}</strong>,</p>
            <p style="color:#aaa; font-size:15px; margin:0 0 16px 0;">Recibimos tu pago. Tu plancha está siendo armada manualmente con todos los diseños que elegiste.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628; border:1px solid #1e3a5f; border-radius:8px; margin-bottom:24px;">
              <tr><td style="padding:14px 18px;">
                <div style="color:#3b82f6; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin-bottom:4px;">Entrega</div>
                <div style="color:#fff; font-size:15px; font-weight:700;">Te vamos a enviar la plancha lista por email dentro de las próximas 24 horas hábiles.</div>
              </td></tr>
            </table>`
    : `<p style="color:#aaa; font-size:15px; margin:0 0 8px 0;">Hola <strong style="color:#fff;">${order.customerName}</strong>,</p>
            <p style="color:#aaa; font-size:15px; margin:0 0 32px 0;">Tu compra fue confirmada. Descargá tus diseños desde los botones de abajo.</p>`;

  const itemsTableHeaderLabel = isPlancha ? "Estado" : "Descarga";
  const itemsTableBody = isPlancha
    ? `${buildPlanchaPendingItemRows(order.items)}
                ${buildPlanchaServiceRow(order.items, order.total)}`
    : `${
        isLegacyPlanchaOrder(order)
          ? `
                <tr>
                  <td colspan="3" style="padding:14px 16px; background:#0a1628; border-bottom:1px solid #1e3a5f;">
                    <div style="color:#3b82f6; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin-bottom:4px;">Plancha agrupada (precio único)</div>
                    <div style="color:#fff; font-size:15px; font-weight:700;">
                      ${order.items.length} diseño${order.items.length > 1 ? "s" : ""} en una sola plancha
                      <span style="color:#aaa; font-weight:400; font-size:13px;">— $${order.total.toLocaleString("es-AR")} ARS</span>
                    </div>
                    <div style="color:#888; font-size:12px; margin-top:6px;">Descargá cada PNG individual desde los enlaces de abajo.</div>
                  </td>
                </tr>`
          : ""
      }
                ${buildDownloadLinks(order.items)}`;

  const misComprasCalloutHtml = isPlancha
    ? ""
    : `<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628; border:1px solid #1e3a5f; border-radius:8px; margin-bottom:32px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="color:#aaa; font-size:13px; margin:0 0 10px 0; line-height:1.5;">
                    Podés volver a descargar tus diseños en cualquier momento desde nuestra página <strong style="color:#fff;">Mis Compras</strong>.
                  </p>
                  <a href="https://${DOMAIN}/mis-compras"
                     style="display:inline-block; background:transparent; color:#3b82f6; font-weight:700; padding:6px 0; text-decoration:none; font-size:13px; border-bottom:1px solid #3b82f6;">
                    Ir a Mis Compras →
                  </a>
                </td>
              </tr>
            </table>`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0; padding:0; background:#0f0f0f; font-family: Inter, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f; padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#111; border-radius:12px 12px 0 0; padding:32px 40px; border-bottom:2px solid #3b82f6;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <img src="https://${DOMAIN}/logo.png" alt="GraffInk Diseños" width="160" height="40" style="display:block; border:0;" />
                </td>
                <td align="right">
                  <div style="color:#3b82f6; font-size:13px; font-weight:700; letter-spacing:1px;">FACTURA N°</div>
                  <div style="color:#fff; font-size:22px; font-weight:900; font-family:monospace;">${invoiceStr}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#111; padding:32px 40px;">
            ${introHtml}

            <!-- Items table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #222; border-radius:8px; overflow:hidden; margin-bottom:32px;">
              <thead>
                <tr style="background:#1a1a1a;">
                  <th style="padding:10px 16px; text-align:left; color:#666; font-size:11px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">Diseño</th>
                  <th style="padding:10px 16px; text-align:center; color:#666; font-size:11px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">Cant.</th>
                  <th style="padding:10px 16px; text-align:right; color:#666; font-size:11px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">${itemsTableHeaderLabel}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsTableBody}
              </tbody>
            </table>

            ${misComprasCalloutHtml}

            <!-- Summary -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
              <tr>
                <td style="color:#666; font-size:14px; padding:4px 0;">Método de pago</td>
                <td style="color:#fff; font-size:14px; text-align:right; font-weight:600;">${formatMethod(order.paymentMethod)}</td>
              </tr>
              <tr>
                <td style="color:#666; font-size:14px; padding:4px 0;">Total pagado</td>
                <td style="color:#3b82f6; font-size:18px; text-align:right; font-weight:900;">${totalFormatted}</td>
              </tr>
              ${
                paypalRateLine !== null
                  ? `
              <tr>
                <td colspan="2" style="color:#888; font-size:12px; padding:8px 0 0 0; text-align:right;">${paypalRateLine}</td>
              </tr>`
                  : ""
              }
            </table>

            <p style="color:#555; font-size:13px; margin:0;">
              ¿Tenés algún problema con tu compra? Escribinos a <a href="mailto:${GMAIL_USER}" style="color:#3b82f6; text-decoration:none;">${GMAIL_USER}</a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0a0a0a; border-radius:0 0 12px 12px; padding:20px 40px; border-top:1px solid #1a1a1a; text-align:center;">
            <p style="color:#444; font-size:12px; margin:0;">GraffInk Diseños — Diseños de alta calidad para impresión DTF</p>
            <p style="color:#333; font-size:11px; margin:6px 0 0 0;">https://${DOMAIN}</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Try to attach a PDF receipt — never block email if PDF generation fails.
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  try {
    const pdfBuffer = await buildInvoicePdf(order);
    attachments.push({
      filename: `comprobante-N${invoiceStr}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    });
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Failed to build invoice PDF — sending email without attachment");
  }

  try {
    await transporter.sendMail({
      from: `"GraffInk Diseños" <${GMAIL_USER}>`,
      to: order.customerEmail,
      // BCC the store inbox so the admin gets a hidden copy of every paid
      // order (with the same PDF attached). Hidden so the buyer doesn't see
      // the internal address in their email headers.
      bcc: GMAIL_USER,
      subject: isPlancha
        ? `🎨 GraffInk Diseños — Tu plancha N° ${invoiceStr} se está armando (24hs)`
        : `✅ GraffInk Diseños — Factura N° ${invoiceStr} confirmada`,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    logger.info(
      {
        orderId: order.id,
        to: order.customerEmail,
        bccAdmin: true,
        hasPdf: attachments.length > 0,
      },
      "Order confirmation email sent",
    );
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Failed to send order confirmation email");
  }
}

/**
 * Admin-only alert sent when a buyer pays for an "Armar plancha" order.
 * The buyer was promised delivery within 24hs in their confirmation email
 * (see `sendOrderConfirmationEmail`). This email gives the admin everything
 * needed to manually compose the assembled plancha PNG and email it back to
 * the buyer: customer contact info, the list of selected designs with direct
 * download links to the high-res source files, the paid total, and the
 * payment method so the admin can cross-reference the gateway receipt.
 *
 * Fire-and-forget: errors are logged but never thrown, so a failed alert
 * cannot block the buyer-facing confirmation flow.
 */
export async function sendPlanchaAssemblyAlertEmail(order: Order): Promise<void> {
  // Defense in depth: if the order falls back to the legacy plancha pricing
  // model (total replaced rather than added) the buyer email still ships
  // download links, so promising the admin a manual assembly job would
  // contradict what the buyer was just told. No-op in that case.
  if (!order.isPlanchaGrouped || isLegacyPlanchaOrder(order)) return;

  const transporter = createTransporter();
  if (!transporter) return;
  if (!GMAIL_USER) return;

  const invoiceStr = String(order.invoiceNumber).padStart(6, "0");
  const totalFormatted = `$${order.total.toLocaleString("es-AR")} ARS`;
  const itemsSubtotal = order.items.reduce(
    (s, it) => s + it.price * it.quantity,
    0,
  );
  const planchaFee = Math.max(0, order.total - itemsSubtotal);
  const customerDniLine = order.customerDni
    ? `<tr><td style="color:#666; font-size:13px; padding:4px 0;">DNI/CUIT</td><td style="color:#fff; font-size:13px; text-align:right;">${order.customerDni}</td></tr>`
    : "";

  const sourceFilesRows = order.items
    .map((item) => {
      const downloadPath = item.filePath ?? item.imagePath;
      const downloadUrl = `https://${DOMAIN}/api/storage${downloadPath}`;
      return `
      <tr>
        <td style="padding:10px 14px; border-bottom:1px solid #222; color:#fff; font-size:14px;">${item.name}</td>
        <td style="padding:10px 14px; border-bottom:1px solid #222; color:#aaa; font-size:13px; text-align:center;">x${item.quantity}</td>
        <td style="padding:10px 14px; border-bottom:1px solid #222; text-align:right;">
          <a href="${downloadUrl}" style="display:inline-block; background:#3b82f6; color:#fff; font-weight:700; padding:6px 12px; border-radius:4px; text-decoration:none; font-size:12px;">
            Descargar fuente
          </a>
        </td>
      </tr>`;
    })
    .join("");

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/></head>
<body style="margin:0; padding:0; background:#0f0f0f; font-family: Inter, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f; padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">
        <tr>
          <td style="background:#0a1628; border:1px solid #1e3a5f; border-radius:12px 12px 0 0; padding:24px 32px;">
            <div style="color:#3b82f6; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase;">Acción requerida</div>
            <div style="color:#fff; font-size:22px; font-weight:900; margin-top:4px;">Nueva plancha para armar</div>
            <div style="color:#aaa; font-size:13px; margin-top:6px;">Factura N° <span style="color:#fff; font-family:monospace;">${invoiceStr}</span> · El comprador espera la plancha dentro de 24hs hábiles.</div>
          </td>
        </tr>
        <tr>
          <td style="background:#111; padding:24px 32px;">
            <div style="color:#666; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin-bottom:10px;">Comprador</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td style="color:#666; font-size:13px; padding:4px 0;">Nombre</td><td style="color:#fff; font-size:13px; text-align:right;">${order.customerName}</td></tr>
              <tr><td style="color:#666; font-size:13px; padding:4px 0;">Email</td><td style="color:#fff; font-size:13px; text-align:right;"><a href="mailto:${order.customerEmail}" style="color:#3b82f6; text-decoration:none;">${order.customerEmail}</a></td></tr>
              ${customerDniLine}
              <tr><td style="color:#666; font-size:13px; padding:4px 0;">Método de pago</td><td style="color:#fff; font-size:13px; text-align:right;">${formatMethod(order.paymentMethod)}</td></tr>
              <tr><td style="color:#666; font-size:13px; padding:4px 0;">Total cobrado</td><td style="color:#3b82f6; font-size:15px; text-align:right; font-weight:900;">${totalFormatted}</td></tr>
              <tr><td style="color:#666; font-size:13px; padding:4px 0;">Cargo de armado</td><td style="color:#aaa; font-size:13px; text-align:right;">$${planchaFee.toLocaleString("es-AR")} ARS</td></tr>
            </table>

            <div style="color:#666; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; margin-bottom:10px;">Diseños a incluir en la plancha (${order.items.length})</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #222; border-radius:8px; overflow:hidden; margin-bottom:24px;">
              <thead>
                <tr style="background:#1a1a1a;">
                  <th style="padding:10px 14px; text-align:left; color:#666; font-size:11px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">Diseño</th>
                  <th style="padding:10px 14px; text-align:center; color:#666; font-size:11px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">Cant.</th>
                  <th style="padding:10px 14px; text-align:right; color:#666; font-size:11px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">Fuente</th>
                </tr>
              </thead>
              <tbody>${sourceFilesRows}</tbody>
            </table>

            <p style="color:#888; font-size:13px; line-height:1.5; margin:0;">
              Próximo paso: descargá los PNG fuente de arriba, armá la plancha agrupada y enviásela por email a
              <a href="mailto:${order.customerEmail}" style="color:#3b82f6; text-decoration:none;">${order.customerEmail}</a>.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#0a0a0a; border-radius:0 0 12px 12px; padding:14px 32px; text-align:center; color:#444; font-size:11px;">
            Aviso interno automático — GraffInk Diseños
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"GraffInk Diseños" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `🎨 NUEVA plancha para armar — Factura N° ${invoiceStr} (${order.customerName})`,
      html,
    });
    logger.info(
      {
        orderId: order.id,
        invoiceNumber: order.invoiceNumber,
        customerEmail: order.customerEmail,
        itemCount: order.items.length,
      },
      "Plancha assembly alert sent to admin",
    );
  } catch (err) {
    logger.error(
      { err, orderId: order.id },
      "Failed to send plancha assembly alert email",
    );
  }
}
