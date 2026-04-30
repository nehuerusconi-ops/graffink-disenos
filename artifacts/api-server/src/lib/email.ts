import nodemailer from "nodemailer";
import type { Order } from "@workspace/db";
import { logger } from "./logger";
import { buildInvoicePdf } from "./pdfInvoice";

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

function formatMethod(method: string): string {
  const map: Record<string, string> = {
    mercadopago: "Mercado Pago",
    uala: "Ualá Bis",
    paypal: "PayPal",
  };
  return map[method] ?? method;
}

// ---------------------------------------------------------------------------
// Webhook signature alert — rate-limited to MAX_ALERTS_PER_HOUR per hour
// ---------------------------------------------------------------------------

const MAX_ALERTS_PER_HOUR = 5;
const alertTimestamps: number[] = [];

export async function sendWebhookSignatureAlertEmail(opts: {
  ip: string;
  xRequestId: string | undefined;
  timestamp: string;
}): Promise<void> {
  const transporter = createTransporter();
  if (!transporter || !GMAIL_USER) return;

  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // Prune timestamps older than 1 hour
  while (alertTimestamps.length > 0 && alertTimestamps[0]! < oneHourAgo) {
    alertTimestamps.shift();
  }

  if (alertTimestamps.length >= MAX_ALERTS_PER_HOUR) {
    logger.warn(
      { ip: opts.ip, xRequestId: opts.xRequestId },
      "MP webhook alert rate limit reached — skipping admin email",
    );
    return;
  }

  alertTimestamps.push(now);

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
            <p style="color:#444;font-size:12px;margin:0;">DTF LAB — Alerta automática del sistema</p>
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
      from: `"DTF LAB Sistema" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `🚨 DTF LAB — Firma inválida en webhook de Mercado Pago (IP: ${opts.ip})`,
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

export async function sendOrderConfirmationEmail(order: Order): Promise<void> {
  const transporter = createTransporter();
  if (!transporter) return;

  const invoiceStr = String(order.invoiceNumber).padStart(6, "0");
  const totalFormatted = `$${order.total.toLocaleString("es-AR")} ARS`;

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
                  <img src="https://${DOMAIN}/logo.png" alt="DTF LAB" width="160" height="40" style="display:block; border:0;" />
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
            <p style="color:#aaa; font-size:15px; margin:0 0 8px 0;">Hola <strong style="color:#fff;">${order.customerName}</strong>,</p>
            <p style="color:#aaa; font-size:15px; margin:0 0 32px 0;">Tu compra fue confirmada. Descargá tus diseños desde los botones de abajo.</p>

            <!-- Items table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #222; border-radius:8px; overflow:hidden; margin-bottom:32px;">
              <thead>
                <tr style="background:#1a1a1a;">
                  <th style="padding:10px 16px; text-align:left; color:#666; font-size:11px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">Diseño</th>
                  <th style="padding:10px 16px; text-align:center; color:#666; font-size:11px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">Cant.</th>
                  <th style="padding:10px 16px; text-align:right; color:#666; font-size:11px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">Descarga</th>
                </tr>
              </thead>
              <tbody>
                ${buildDownloadLinks(order.items)}
              </tbody>
            </table>

            <!-- Mis Compras callout -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628; border:1px solid #1e3a5f; border-radius:8px; margin-bottom:32px;">
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
            </table>

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
            </table>

            <p style="color:#555; font-size:13px; margin:0;">
              ¿Tenés algún problema con tu compra? Escribinos a <a href="mailto:${GMAIL_USER}" style="color:#3b82f6; text-decoration:none;">${GMAIL_USER}</a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0a0a0a; border-radius:0 0 12px 12px; padding:20px 40px; border-top:1px solid #1a1a1a; text-align:center;">
            <p style="color:#444; font-size:12px; margin:0;">DTF LAB — Diseños de alta calidad para impresión DTF</p>
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
      from: `"DTF LAB" <${GMAIL_USER}>`,
      to: order.customerEmail,
      subject: `✅ DTF LAB — Factura N° ${invoiceStr} confirmada`,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    logger.info(
      { orderId: order.id, to: order.customerEmail, hasPdf: attachments.length > 0 },
      "Order confirmation email sent",
    );
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Failed to send order confirmation email");
  }
}
