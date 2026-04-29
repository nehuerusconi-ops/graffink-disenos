import nodemailer from "nodemailer";
import type { Order } from "@workspace/db";
import { logger } from "./logger";

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
      (item) => `
      <tr>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#fff; font-size:14px;">${item.name}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; color:#aaa; font-size:14px; text-align:center;">${item.quantity}</td>
        <td style="padding:10px 16px; border-bottom:1px solid #222; text-align:right;">
          <a href="https://${DOMAIN}/api/storage${item.imagePath}"
             style="display:inline-block; background:#3b82f6; color:#fff; font-weight:700; padding:6px 14px; border-radius:4px; text-decoration:none; font-size:13px;">
            Descargar PNG
          </a>
        </td>
      </tr>`,
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
                  <span style="font-size:28px; font-weight:900; color:#fff; letter-spacing:-1px;">DTF <span style="background:#3b82f6; color:#fff; padding:2px 10px; border-radius:4px; font-size:16px; letter-spacing:2px; vertical-align:middle; margin-left:4px;">LAB</span></span>
                  <div style="font-size:11px; color:#666; letter-spacing:3px; margin-top:4px; text-transform:uppercase;">Diseños DTF</div>
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

  try {
    await transporter.sendMail({
      from: `"DTF LAB" <${GMAIL_USER}>`,
      to: order.customerEmail,
      subject: `✅ DTF LAB — Factura N° ${invoiceStr} confirmada`,
      html,
    });
    logger.info({ orderId: order.id, to: order.customerEmail }, "Order confirmation email sent");
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Failed to send order confirmation email");
  }
}
