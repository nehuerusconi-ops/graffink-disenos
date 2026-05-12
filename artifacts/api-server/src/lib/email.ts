import { Resend } from "resend";
import { count, lt, sql } from "drizzle-orm";
import { db, webhookAlertLogTable, type Order } from "@workspace/db";
import { logger } from "./logger";
import { buildInvoicePdf, formatPaypalRateLine } from "./pdfInvoice";

const RESEND_API_KEY = process.env["RESEND_API_KEY"];
const ADMIN_EMAIL = process.env["ADMIN_EMAIL"] ?? process.env["GMAIL_USER"] ?? "";
const DOMAIN = (process.env["REPLIT_DOMAINS"] ?? "localhost:5174").split(",")[0];
const FROM_EMAIL = `GraffInk Diseños <onboarding@resend.dev>`;

function getResend(): Resend | null {
  if (!RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY no configurado — emails desactivados");
    return null;
  }
  return new Resend(RESEND_API_KEY);
}

function buildDownloadLinks(items: Order["items"]): string {
  return items.map((item) => {
    const downloadPath = item.filePath ?? item.imagePath;
    const downloadUrl = `https://${DOMAIN}/api/storage${downloadPath}`;
    return `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#fff; font-size:14px;">${item.name}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#aaa; font-size:14px; text-align:center;">${item.quantity}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; text-align:right;">
          <a href="${downloadUrl}" style="display:inline-block; background:#3b82f6; color:#fff; font-weight:700; padding:6px 14px; border-radius:4px; text-decoration:none; font-size:13px;">
            Descargar PNG
          </a>
        </td>
      </tr>`;
  }).join("");
}

function buildPlanchaPendingItemRows(items: Order["items"]): string {
  return items.map((item) => `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#fff; font-size:14px;">${item.name}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#aaa; font-size:14px; text-align:center;">${item.quantity}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; text-align:right;">
          <span style="display:inline-block; background:#1e3a5f; color:#3b82f6; font-weight:700; padding:6px 14px; border-radius:4px; font-size:12px; letter-spacing:1px; text-transform:uppercase;">
            En preparación
          </span>
        </td>
      </tr>`).join("");
}

function buildPlanchaServiceRow(items: Order["items"], total: number): string {
  const itemsSubtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
  const planchaFee = Math.max(0, total - itemsSubtotal);
  const cnt = items.length;
  return `
      <tr>
        <td style="padding:14px 16px; background:#0a1628; border-top:1px solid #1e3a5f; color:#fff; font-size:14px;">
          <div style="font-weight:700;">Armar plancha</div>
          <div style="color:#aaa; font-size:12px; margin-top:2px;">${cnt} diseño${cnt > 1 ? "s" : ""} agrupados en una sola plancha imprimible</div>
        </td>
        <td style="padding:14px 16px; background:#0a1628; border-top:1px solid #1e3a5f; color:#aaa; font-size:14px; text-align:center;">—</td>
        <td style="padding:14px 16px; background:#0a1628; border-top:1px solid #1e3a5f; color:#3b82f6; font-size:14px; text-align:right; font-weight:700;">
          +$${planchaFee.toLocaleString("es-AR")}
        </td>
      </tr>`;
}

function isLegacyPlanchaOrder(order: Order): boolean {
  if (!order.isPlanchaGrouped) return false;
  const itemsSubtotal = order.items.reduce((s, it) => s + it.price * it.quantity, 0);
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
// Rate limiting para alertas de seguridad
// ---------------------------------------------------------------------------
function resolveMaxAlertsPerHour(): number {
  const raw = process.env["WEBHOOK_ALERT_MAX_PER_HOUR"];
  if (raw === undefined || raw === "") return 5;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid WEBHOOK_ALERT_MAX_PER_HOUR value: "${raw}"`);
  }
  return parsed;
}

const MAX_ALERTS_PER_HOUR = resolveMaxAlertsPerHour();
const ALERT_LEDGER_ADVISORY_LOCK_KEY = 0x57414c52n;

async function tryConsumeAlertSlot(logCtx: Record<string, unknown>, source: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ALERT_LEDGER_ADVISORY_LOCK_KEY})`);
      await tx.delete(webhookAlertLogTable).where(lt(webhookAlertLogTable.sentAt, oneHourAgo));
      const [row] = await tx.select({ value: count() }).from(webhookAlertLogTable);
      const sent = row?.value ?? 0;
      if (sent >= MAX_ALERTS_PER_HOUR) {
        logger.warn(logCtx, `${source} alert rate limit reached — skipping admin email`);
        return false;
      }
      await tx.insert(webhookAlertLogTable).values({ source, sentAt: sql`now()` });
      return true;
    });
  } catch (err) {
    logger.error({ ...logCtx, err }, `${source} alert rate limit ledger failed — skipping admin email`);
    return false;
  }
}

export async function pruneOldWebhookAlertLogs(): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  try {
    const deleted = await db.delete(webhookAlertLogTable).where(lt(webhookAlertLogTable.sentAt, oneHourAgo)).returning({ id: webhookAlertLogTable.id });
    if (deleted.length > 0) logger.info({ deleted: deleted.length }, "Pruned old webhook_alert_log rows");
    return deleted.length;
  } catch (err) {
    logger.error({ err }, "Failed to prune webhook_alert_log");
    return 0;
  }
}

const ALERT_LEDGER_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startWebhookAlertLogCleanupJob(): { stop: () => void } {
  void pruneOldWebhookAlertLogs();
  const handle = setInterval(() => { void pruneOldWebhookAlertLogs(); }, ALERT_LEDGER_CLEANUP_INTERVAL_MS);
  handle.unref();
  return { stop: () => clearInterval(handle) };
}

// ---------------------------------------------------------------------------
// Alertas de seguridad
// ---------------------------------------------------------------------------
export async function sendWebhookSignatureAlertEmail(opts: { ip: string; xRequestId: string | undefined; timestamp: string }): Promise<void> {
  const resend = getResend();
  if (!resend || !ADMIN_EMAIL) return;
  if (!(await tryConsumeAlertSlot({ ip: opts.ip }, "MP webhook"))) return;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `🚨 GraffInk Diseños — Firma inválida en webhook de Mercado Pago (IP: ${opts.ip})`,
      html: `<p>Firma inválida en webhook MP. IP: ${opts.ip}, x-request-id: ${opts.xRequestId ?? "(no enviado)"}, timestamp: ${opts.timestamp}</p>`,
    });
    logger.info({ ip: opts.ip }, "Webhook signature alert email sent");
  } catch (err) {
    logger.error({ err }, "Failed to send webhook signature alert email");
  }
}

function describePaypalReason(reason: "order_mismatch" | "reference_mismatch" | "amount_mismatch" | "missing_amount"): string {
  switch (reason) {
    case "order_mismatch": return "El ppOrderId enviado no coincide con el externalPaymentId guardado.";
    case "reference_mismatch": return "El reference_id de PayPal no coincide con nuestro orderId.";
    case "amount_mismatch": return "El monto capturado en USD no coincide con el monto registrado.";
    case "missing_amount": return "No hay monto en USD registrado para esta orden.";
  }
}

export async function sendPaypalSecurityAlertEmail(opts: { reason: "order_mismatch" | "reference_mismatch" | "amount_mismatch" | "missing_amount"; orderId: string; ppOrderId: string; ip: string; detail: string | null }): Promise<void> {
  const resend = getResend();
  if (!resend || !ADMIN_EMAIL) return;
  if (!(await tryConsumeAlertSlot({ reason: opts.reason, orderId: opts.orderId }, "PayPal capture"))) return;

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `🚨 GraffInk Diseños — Captura de PayPal rechazada (${opts.reason}, IP: ${opts.ip})`,
      html: `<p>Captura PayPal rechazada. Motivo: ${describePaypalReason(opts.reason)}<br>orderId: ${opts.orderId}<br>ppOrderId: ${opts.ppOrderId}<br>IP: ${opts.ip}</p>`,
    });
    logger.info({ reason: opts.reason, orderId: opts.orderId }, "PayPal security alert email sent");
  } catch (err) {
    logger.error({ err }, "Failed to send PayPal security alert email");
  }
}

// ---------------------------------------------------------------------------
// Email de confirmación al comprador + BCC al admin
// ---------------------------------------------------------------------------
export async function sendOrderConfirmationEmail(order: Order): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const invoiceStr = String(order.invoiceNumber).padStart(6, "0");
  const totalFormatted = `$${order.total.toLocaleString("es-AR")} ARS`;
  const paypalRateLine = formatPaypalRateLine(order.paymentMethod, order.arsToUsdRate, order.total);
  const isManualPrep = order.requiresManualPrep && !isLegacyPlanchaOrder(order);
  const isPlancha = isManualPrep;

  const introHtml = isPlancha
    ? `<p style="color:#aaa;font-size:15px;margin:0 0 8px 0;">Hola <strong style="color:#fff;">${order.customerName.split(" ")[0]}</strong>,</p>
       <p style="color:#aaa;font-size:15px;margin:0 0 16px 0;">Recibimos tu pago. Tu plancha está siendo armada manualmente.</p>
       <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628;border:1px solid #1e3a5f;border-radius:8px;margin-bottom:24px;">
         <tr><td style="padding:14px 18px;">
           <div style="color:#3b82f6;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">Entrega</div>
           <div style="color:#fff;font-size:15px;font-weight:700;">Te enviaremos la plancha lista por email dentro de las próximas 24 horas hábiles.</div>
         </td></tr>
       </table>`
    : `<p style="color:#aaa;font-size:15px;margin:0 0 8px 0;">Hola <strong style="color:#fff;">${order.customerName.split(" ")[0]}</strong>,</p>
       <p style="color:#aaa;font-size:15px;margin:0 0 32px 0;">Tu compra fue confirmada. Descargá tus diseños desde los botones de abajo.</p>`;

  const itemsTableBody = isPlancha
    ? `${buildPlanchaPendingItemRows(order.items)}${buildPlanchaServiceRow(order.items, order.total)}`
    : buildDownloadLinks(order.items);

  const misComprasCallout = isPlancha ? "" : `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628;border:1px solid #1e3a5f;border-radius:8px;margin-bottom:32px;">
      <tr><td style="padding:16px 20px;">
        <p style="color:#aaa;font-size:13px;margin:0 0 10px 0;">Podés volver a descargar tus diseños en cualquier momento desde <strong style="color:#fff;">Mis Compras</strong>.</p>
        <a href="https://${DOMAIN}/mis-compras" style="color:#3b82f6;text-decoration:none;font-size:13px;font-weight:700;border-bottom:1px solid #3b82f6;">Ir a Mis Compras →</a>
      </td></tr>
    </table>`;

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:#111;border-radius:12px 12px 0 0;padding:32px 40px;border-bottom:2px solid #3b82f6;">
          <table width="100%"><tr>
            <td><h1 style="margin:0;color:#fff;font-size:22px;font-weight:900;letter-spacing:2px;">GraffInk Diseños</h1></td>
            <td align="right">
              <div style="color:#3b82f6;font-size:13px;font-weight:700;">COMPROBANTE N°</div>
              <div style="color:#fff;font-size:22px;font-weight:900;font-family:monospace;">${invoiceStr}</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#111;padding:32px 40px;">
          ${introHtml}
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #222;border-radius:8px;overflow:hidden;margin-bottom:32px;">
            <thead><tr style="background:#1a1a1a;">
              <th style="padding:10px 16px;text-align:left;color:#666;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Diseño</th>
              <th style="padding:10px 16px;text-align:center;color:#666;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Cant.</th>
              <th style="padding:10px 16px;text-align:right;color:#666;font-size:11px;letter-spacing:2px;text-transform:uppercase;">${isPlancha ? "Estado" : "Descarga"}</th>
            </tr></thead>
            <tbody>${itemsTableBody}</tbody>
          </table>
          ${misComprasCallout}
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="color:#666;font-size:14px;padding:4px 0;">Método de pago</td><td style="color:#fff;font-size:14px;text-align:right;font-weight:600;">${formatMethod(order.paymentMethod)}</td></tr>
            <tr><td style="color:#666;font-size:14px;padding:4px 0;">DNI / CUIT</td><td style="color:#fff;font-size:14px;text-align:right;">${order.customerDni || "—"}</td></tr>
            <tr><td style="color:#666;font-size:14px;padding:4px 0;">Total pagado</td><td style="color:#3b82f6;font-size:18px;text-align:right;font-weight:900;">${totalFormatted}</td></tr>
            ${paypalRateLine ? `<tr><td colspan="2" style="color:#888;font-size:12px;padding:8px 0 0 0;text-align:right;">${paypalRateLine}</td></tr>` : ""}
          </table>
          <p style="color:#444;font-size:12px;margin:16px 0 0 0;border-top:1px solid #222;padding-top:16px;">
            Este comprobante NO tiene validez fiscal ante AFIP. Se emite únicamente como constancia interna de la transacción realizada en GraffInk Diseños.
          </p>
        </td></tr>
        <tr><td style="background:#0a0a0a;border-radius:0 0 12px 12px;padding:20px 40px;border-top:1px solid #1a1a1a;text-align:center;">
          <p style="color:#444;font-size:12px;margin:0;">GraffInk Diseños — Diseños de alta calidad para impresión DTF</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // Generar PDF adjunto
  const attachments: Array<{ filename: string; content: Buffer }> = [];
  try {
    const pdfBuffer = await buildInvoicePdf(order);
    attachments.push({ filename: `comprobante-N${invoiceStr}.pdf`, content: pdfBuffer });
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Failed to build invoice PDF");
  }

  try {
    // Email al comprador
    await resend.emails.send({
      from: FROM_EMAIL,
      to: order.customerEmail,
      subject: isPlancha
        ? `🎨 GraffInk Diseños — Tu plancha N° ${invoiceStr} se está armando (24hs)`
        : `✅ GraffInk Diseños — Comprobante N° ${invoiceStr} confirmado`,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    // Email al admin con datos del cliente
    if (ADMIN_EMAIL) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject: `💰 Nueva venta — N° ${invoiceStr} — ${order.customerName} — ${order.total.toLocaleString("es-AR")} ARS`,
        html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:32px;">
          <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;">
            <h2 style="margin:0 0 16px;">💰 Nueva venta confirmada</h2>
            <table width="100%" cellpadding="6">
              <tr><td style="color:#666;">Comprobante</td><td><strong>N° ${invoiceStr}</strong></td></tr>
              <tr><td style="color:#666;">Cliente</td><td><strong>${order.customerName}</strong></td></tr>
              <tr><td style="color:#666;">Email</td><td>${order.customerEmail}</td></tr>
              <tr><td style="color:#666;">DNI / CUIT</td><td>${order.customerDni || "—"}</td></tr>
              <tr><td style="color:#666;">Método de pago</td><td>${formatMethod(order.paymentMethod)}</td></tr>
              <tr><td style="color:#666;">Total</td><td><strong style="color:#2563eb;font-size:18px;">$${order.total.toLocaleString("es-AR")} ARS</strong></td></tr>
              <tr><td style="color:#666;">Requiere prep. manual</td><td>${order.requiresManualPrep ? "✅ SÍ" : "No"}</td></tr>
            </table>
            <h3 style="margin:24px 0 12px;">Detalle del pedido</h3>
            <table width="100%" cellpadding="6" style="border-collapse:collapse;">
              <thead><tr style="background:#f0f0f0;">
                <th style="text-align:left;padding:8px;">Diseño</th>
                <th style="text-align:center;padding:8px;">Medida</th>
                <th style="text-align:center;padding:8px;">Cant.</th>
                <th style="text-align:right;padding:8px;">Precio</th>
                <th style="text-align:right;padding:8px;">Subtotal</th>
              </tr></thead>
              <tbody>
                ${order.items.map(it => `<tr style="border-bottom:1px solid #eee;">
                  <td style="padding:8px;">${it.name}</td>
                  <td style="padding:8px;text-align:center;">${it.selectedSize || "Original"}</td>
                  <td style="padding:8px;text-align:center;">${it.quantity}</td>
                  <td style="padding:8px;text-align:right;">$${it.price.toLocaleString("es-AR")}</td>
                  <td style="padding:8px;text-align:right;">$${(it.price * it.quantity).toLocaleString("es-AR")}</td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </body></html>`,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
    }

    logger.info({ orderId: order.id, to: order.customerEmail }, "Order confirmation emails sent");
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Failed to send order confirmation email");
  }
}

// ---------------------------------------------------------------------------
// Alerta al admin para órdenes con preparación manual
// ---------------------------------------------------------------------------
export async function sendPlanchaAssemblyAlertEmail(order: Order): Promise<void> {
  if (!order.requiresManualPrep) return;
  if (order.isPlanchaGrouped && isLegacyPlanchaOrder(order)) return;

  const resend = getResend();
  if (!resend || !ADMIN_EMAIL) return;

  const invoiceStr = String(order.invoiceNumber).padStart(6, "0");
  const sourceFilesRows = order.items.map(item => {
    const downloadPath = item.filePath ?? item.imagePath;
    const downloadUrl = `https://${DOMAIN}/api/storage${downloadPath}`;
    return `<tr>
      <td style="padding:8px;">${item.name}</td>
      <td style="padding:8px;text-align:center;">x${item.quantity}</td>
      <td style="padding:8px;text-align:right;"><a href="${downloadUrl}" style="color:#3b82f6;">Descargar fuente</a></td>
    </tr>`;
  }).join("");

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `🎨 NUEVA plancha para armar — Factura N° ${invoiceStr} (${order.customerName})`,
      html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:32px;">
        <h2>🎨 Nueva plancha para armar — N° ${invoiceStr}</h2>
        <p>El comprador espera la plancha dentro de 24hs hábiles.</p>
        <table cellpadding="6">
          <tr><td>Cliente</td><td><strong>${order.customerName}</strong></td></tr>
          <tr><td>Email</td><td><a href="mailto:${order.customerEmail}">${order.customerEmail}</a></td></tr>
          <tr><td>DNI/CUIT</td><td>${order.customerDni || "—"}</td></tr>
          <tr><td>Total cobrado</td><td><strong>$${order.total.toLocaleString("es-AR")} ARS</strong></td></tr>
        </table>
        <h3>Diseños a incluir (${order.items.length})</h3>
        <table width="100%" cellpadding="6" style="border-collapse:collapse;">
          <thead><tr style="background:#f0f0f0;">
            <th style="text-align:left;">Diseño</th><th>Cant.</th><th>Fuente</th>
          </tr></thead>
          <tbody>${sourceFilesRows}</tbody>
        </table>
      </body></html>`,
    });
    logger.info({ orderId: order.id }, "Plancha assembly alert sent");
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Failed to send plancha assembly alert");
  }
}
