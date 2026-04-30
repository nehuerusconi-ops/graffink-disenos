import PDFDocument from "pdfkit";
import path from "node:path";
import fs from "node:fs";
import type { Order } from "@workspace/db";
import { logger } from "./logger";

const PAGE_MARGIN = 36;
const PAGE_WIDTH = 595.28;
const CONTENT_W = PAGE_WIDTH - PAGE_MARGIN * 2;

const DOMAIN = (process.env["REPLIT_DOMAINS"] ?? "localhost:80").split(",")[0];

function fmtMoney(n: number): string {
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Format the PayPal "Tipo de cambio aplicado" audit line shown on the
 * receipt (PDF and HTML versions). Returns `null` when the order is not
 * a PayPal order, when the rate is missing, or when it does not parse to
 * a positive finite number — callers must omit the line in that case.
 *
 * Exported so the printable HTML in the admin panel and the PDF stay in
 * lockstep, and so tests can assert the exact wording without parsing PDFs.
 */
export function formatPaypalRateLine(
  paymentMethod: string,
  arsToUsdRate: string | null | undefined,
  totalArs: number,
): string | null {
  if (paymentMethod !== "paypal") return null;
  if (arsToUsdRate == null || arsToUsdRate === "") return null;
  const rate = Number(arsToUsdRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const usdEquivalent = totalArs / rate;
  return `Tipo de cambio aplicado: 1 USD = $${fmtMoney(rate)} ARS (≈ USD ${fmtMoney(usdEquivalent)})`;
}

function methodLabel(method: string): string {
  switch (method) {
    case "mercadopago":
      return "Mercado Pago";
    case "transferencia":
      return "Transferencia bancaria";
    case "paypal":
      return "PayPal";
    default:
      return method;
  }
}

function findLogoPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "../dreamstorm/public/logo.png"),
    path.resolve(process.cwd(), "artifacts/dreamstorm/public/logo.png"),
    path.resolve(process.cwd(), "../../artifacts/dreamstorm/public/logo.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Generate a classic Argentine "Factura B/C" style PDF for an order.
 * Returns a Buffer ready to attach to an email.
 *
 * Visual spec: white background, Helvetica, black borders, 3-column header
 * (issuer block | "ORIGINAL" + bordered "X" box | invoice number block),
 * customer data block, items table, totals, non-fiscal disclaimer.
 */
export function buildInvoicePdf(order: Order): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: PAGE_MARGIN,
        info: {
          Title: `Comprobante GraffInk Diseños N° ${String(order.invoiceNumber).padStart(6, "0")}`,
          Author: "GraffInk Diseños",
          Subject: "Comprobante de venta (no válido como factura fiscal)",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ---- ORIGINAL banner ----
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
      doc.text("ORIGINAL", PAGE_MARGIN, PAGE_MARGIN, {
        width: CONTENT_W,
        align: "right",
      });

      // ---- Header (3 columns) ----
      const headerTop = PAGE_MARGIN + 18;
      const headerH = 110;
      const colW = CONTENT_W / 3;
      const leftX = PAGE_MARGIN;
      const midX = PAGE_MARGIN + colW;
      const rightX = PAGE_MARGIN + colW * 2;

      // Outer header borders
      doc
        .lineWidth(1)
        .strokeColor("#000")
        .rect(leftX, headerTop, colW, headerH)
        .stroke();
      doc.rect(midX, headerTop, colW, headerH).stroke();
      doc.rect(rightX, headerTop, colW, headerH).stroke();

      // Left column: issuer block (logo + razón social)
      const logoPath = findLogoPath();
      if (logoPath) {
        try {
          doc.image(logoPath, leftX + 10, headerTop + 10, {
            fit: [colW - 20, 40],
          });
        } catch (err) {
          logger.warn({ err }, "Could not embed logo in PDF");
        }
      }
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor("#000")
        .text("GraffInk Diseños", leftX + 10, headerTop + 56, { width: colW - 20 });
      doc
        .font("Helvetica")
        .fontSize(8)
        .text("Diseños DTF — Argentina", leftX + 10, headerTop + 74, {
          width: colW - 20,
        });
      doc.text(`https://${DOMAIN}`, leftX + 10, headerTop + 86, {
        width: colW - 20,
      });

      // Middle column: bordered "X" box + COMPROBANTE NO FISCAL
      const xBoxSize = 38;
      const xBoxX = midX + (colW - xBoxSize) / 2;
      const xBoxY = headerTop + 10;
      doc.lineWidth(1.5).rect(xBoxX, xBoxY, xBoxSize, xBoxSize).stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(28)
        .text("X", xBoxX, xBoxY + 4, { width: xBoxSize, align: "center" });
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("COMPROBANTE", midX, xBoxY + xBoxSize + 6, {
          width: colW,
          align: "center",
        });
      doc.text("NO FISCAL", midX, xBoxY + xBoxSize + 16, {
        width: colW,
        align: "center",
      });
      doc
        .font("Helvetica")
        .fontSize(7)
        .text(
          "Sin valor tributario.\nSólo a fines informativos.",
          midX + 6,
          xBoxY + xBoxSize + 32,
          { width: colW - 12, align: "center" },
        );

      // Right column: Comprobante number + dates
      const invStr = String(order.invoiceNumber).padStart(8, "0");
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("COMPROBANTE", rightX + 10, headerTop + 10, {
          width: colW - 20,
        });
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(`N° 0001-${invStr}`, rightX + 10, headerTop + 26, {
          width: colW - 20,
        });
      doc
        .font("Helvetica")
        .fontSize(9)
        .text(
          `Fecha de emisión: ${fmtDate(new Date(order.createdAt))}`,
          rightX + 10,
          headerTop + 56,
          { width: colW - 20 },
        );
      doc.text(`Tipo: Comprobante interno`, rightX + 10, headerTop + 70, {
        width: colW - 20,
      });
      doc.text(`Pago: ${methodLabel(order.paymentMethod)}`, rightX + 10, headerTop + 84, {
        width: colW - 20,
      });

      // ---- Customer block ----
      const custTop = headerTop + headerH + 14;
      const custH = 70;
      doc.lineWidth(1).rect(PAGE_MARGIN, custTop, CONTENT_W, custH).stroke();

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor("#000")
        .text("DATOS DEL COMPRADOR", PAGE_MARGIN + 10, custTop + 8);
      doc
        .moveTo(PAGE_MARGIN + 10, custTop + 22)
        .lineTo(PAGE_MARGIN + CONTENT_W - 10, custTop + 22)
        .stroke();

      doc.font("Helvetica-Bold").fontSize(9);
      doc.text("Nombre y Apellido:", PAGE_MARGIN + 10, custTop + 30);
      doc.text("Email:", PAGE_MARGIN + 10, custTop + 46);
      doc.text("DNI / CUIT:", PAGE_MARGIN + 300, custTop + 30);
      doc.text("Condición frente al IVA:", PAGE_MARGIN + 300, custTop + 46);

      doc.font("Helvetica").fontSize(9);
      doc.text(order.customerName, PAGE_MARGIN + 110, custTop + 30, {
        width: 180,
      });
      doc.text(order.customerEmail, PAGE_MARGIN + 110, custTop + 46, {
        width: 180,
      });
      doc.text(order.customerDni ?? "—", PAGE_MARGIN + 388, custTop + 30, {
        width: 150,
      });
      doc.text("Consumidor Final", PAGE_MARGIN + 425, custTop + 46, {
        width: 130,
      });

      // ---- Items table ----
      const tableTop = custTop + custH + 14;
      const tableHeaderH = 22;

      // column widths
      const colCantW = 50;
      const colDescW = 280;
      const colUnitW = 90;
      const colTotalW = CONTENT_W - colCantW - colDescW - colUnitW;

      const cantX = PAGE_MARGIN;
      const descX = cantX + colCantW;
      const unitX = descX + colDescW;
      const totalX = unitX + colUnitW;

      // Page-bottom limit reserved for totals + footer (~180 pts)
      const PAGE_BOTTOM_LIMIT = 720;

      const drawTableHeader = (yPos: number): number => {
        doc
          .lineWidth(1)
          .rect(PAGE_MARGIN, yPos, CONTENT_W, tableHeaderH)
          .fillAndStroke("#f0f0f0", "#000");
        doc.fillColor("#000").font("Helvetica-Bold").fontSize(9);
        const ty = yPos + 7;
        doc.text("CANT.", cantX, ty, { width: colCantW, align: "center" });
        doc.text("DESCRIPCIÓN", descX + 6, ty, { width: colDescW - 12 });
        doc.text("P. UNIT.", unitX, ty, { width: colUnitW, align: "right" });
        doc.text("IMPORTE", totalX, ty, {
          width: colTotalW - 6,
          align: "right",
        });
        return yPos + tableHeaderH;
      };

      // header row (first page)
      let rowY = drawTableHeader(tableTop);
      const rowH = 22;
      doc.font("Helvetica").fontSize(9).fillColor("#000");

      // Detect orders persisted under the OLD replacement-model (legacy):
      // those have `isPlanchaGrouped` true and a `total` lower than the sum
      // of their item prices (because the old code REPLACED the total with
      // a flat plancha price). Render those as a single bundle row to keep
      // the document internally consistent. New orders use the additive
      // model (per-item rows + a "Armar plancha" service row).
      const itemsSubtotal = order.items.reduce(
        (s, it) => s + it.price * it.quantity,
        0,
      );
      const isLegacyPlancha =
        order.isPlanchaGrouped && order.total < itemsSubtotal;

      if (isLegacyPlancha) {
        const headlineText = `Plancha agrupada (${order.items.length} diseño${order.items.length > 1 ? "s" : ""})`;
        const headlineRowH = 28;
        if (rowY + headlineRowH > PAGE_BOTTOM_LIMIT) {
          doc.addPage();
          rowY = drawTableHeader(PAGE_MARGIN);
          doc.font("Helvetica").fontSize(9).fillColor("#000");
        }
        doc
          .lineWidth(0.5)
          .strokeColor("#000")
          .rect(PAGE_MARGIN, rowY, CONTENT_W, headlineRowH)
          .fillAndStroke("#fafafa", "#000")
          .fillColor("#000");
        const headlineY = rowY + 9;
        doc.font("Helvetica").fontSize(9);
        doc.text("1", cantX, headlineY, { width: colCantW, align: "center" });
        doc.font("Helvetica-Bold").fontSize(9);
        doc.text(headlineText, descX + 6, headlineY, { width: colDescW - 12 });
        doc.text(`$ ${fmtMoney(order.total)}`, unitX, headlineY, {
          width: colUnitW - 6,
          align: "right",
        });
        doc.text(`$ ${fmtMoney(order.total)}`, totalX, headlineY, {
          width: colTotalW - 6,
          align: "right",
        });
        rowY += headlineRowH;
        for (const item of order.items) {
          const subDesc = `   ↳ Incluye: ${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ""}`;
          doc.font("Helvetica-Oblique").fontSize(8);
          const subDescH = doc.heightOfString(subDesc, { width: colDescW - 12 });
          const subRowH = Math.max(18, subDescH + 8);
          if (rowY + subRowH > PAGE_BOTTOM_LIMIT) {
            doc.addPage();
            rowY = drawTableHeader(PAGE_MARGIN);
          }
          doc
            .lineWidth(0.5)
            .strokeColor("#000")
            .rect(PAGE_MARGIN, rowY, CONTENT_W, subRowH)
            .stroke();
          const subY = rowY + 5;
          doc.font("Helvetica").fontSize(8).fillColor("#666");
          doc.text("—", cantX, subY, { width: colCantW, align: "center" });
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#333");
          doc.text(subDesc, descX + 6, subY, { width: colDescW - 12 });
          doc.font("Helvetica").fontSize(8).fillColor("#666");
          doc.text("—", unitX, subY, { width: colUnitW - 6, align: "right" });
          doc.text("—", totalX, subY, { width: colTotalW - 6, align: "right" });
          doc.fillColor("#000");
          rowY += subRowH;
        }
        doc.font("Helvetica").fontSize(9).fillColor("#000");
      } else {
        // Render each design row at its individual price. The "armar plancha"
        // mode now ADDS a single service line at the end (instead of replacing
        // the per-design totals like the previous flat-price model did).
        for (const item of order.items) {
          // dynamic row height for long descriptions
          const descHeight = doc.heightOfString(item.name, {
            width: colDescW - 12,
          });
          const thisRowH = Math.max(rowH, descHeight + 10);

          // start a new page if this row would overflow the body area
          if (rowY + thisRowH > PAGE_BOTTOM_LIMIT) {
            doc.addPage();
            rowY = drawTableHeader(PAGE_MARGIN);
            doc.font("Helvetica").fontSize(9).fillColor("#000");
          }

          doc
            .lineWidth(0.5)
            .strokeColor("#000")
            .rect(PAGE_MARGIN, rowY, CONTENT_W, thisRowH)
            .stroke();

          const lineSubtotal = item.price * item.quantity;
          const cellY = rowY + 6;
          doc.text(String(item.quantity), cantX, cellY, {
            width: colCantW,
            align: "center",
          });
          doc.text(item.name, descX + 6, cellY, { width: colDescW - 12 });
          doc.text(`$ ${fmtMoney(item.price)}`, unitX, cellY, {
            width: colUnitW - 6,
            align: "right",
          });
          doc.text(`$ ${fmtMoney(lineSubtotal)}`, totalX, cellY, {
            width: colTotalW - 6,
            align: "right",
          });

          rowY += thisRowH;
        }
      }

      if (order.isPlanchaGrouped && !isLegacyPlancha) {
        // The plancha service is a single additive fee. Derive it from the
        // persisted total minus the sum of items so we never need to refetch
        // the live setting (which may have changed since the order was paid).
        const planchaFee = Math.max(0, order.total - itemsSubtotal);
        const planchaRowH = 22;

        if (rowY + planchaRowH > PAGE_BOTTOM_LIMIT) {
          doc.addPage();
          rowY = drawTableHeader(PAGE_MARGIN);
          doc.font("Helvetica").fontSize(9).fillColor("#000");
        }

        doc
          .lineWidth(0.5)
          .strokeColor("#000")
          .rect(PAGE_MARGIN, rowY, CONTENT_W, planchaRowH)
          .fillAndStroke("#fafafa", "#000")
          .fillColor("#000");

        const py = rowY + 6;
        doc.font("Helvetica").fontSize(9);
        doc.text("1", cantX, py, { width: colCantW, align: "center" });
        doc.font("Helvetica-Bold").fontSize(9);
        doc.text(
          `Armar plancha (${order.items.length} diseño${order.items.length > 1 ? "s" : ""})`,
          descX + 6,
          py,
          { width: colDescW - 12 },
        );
        doc.font("Helvetica").fontSize(9);
        doc.text(`$ ${fmtMoney(planchaFee)}`, unitX, py, {
          width: colUnitW - 6,
          align: "right",
        });
        doc.text(`$ ${fmtMoney(planchaFee)}`, totalX, py, {
          width: colTotalW - 6,
          align: "right",
        });

        rowY += planchaRowH;
      }

      // ensure totals + footer fit on the current page; otherwise paginate
      const TOTALS_FOOTER_H = 180;
      if (rowY + TOTALS_FOOTER_H > PAGE_BOTTOM_LIMIT + 60) {
        doc.addPage();
        rowY = PAGE_MARGIN;
      }

      // ---- Totals block ----
      const totalsTop = rowY + 18;
      const totalsBoxW = 240;
      const totalsBoxX = PAGE_MARGIN + CONTENT_W - totalsBoxW;
      const totalsBoxH = 36;

      doc
        .lineWidth(1.5)
        .rect(totalsBoxX, totalsTop, totalsBoxW, totalsBoxH)
        .stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("IMPORTE TOTAL", totalsBoxX + 10, totalsTop + 11, {
          width: 110,
        });
      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(`$ ${fmtMoney(order.total)}`, totalsBoxX + 120, totalsTop + 10, {
          width: totalsBoxW - 130,
          align: "right",
        });
      doc
        .font("Helvetica")
        .fontSize(8)
        .text("Importes en Pesos Argentinos (ARS)", totalsBoxX, totalsTop + totalsBoxH + 4, {
          width: totalsBoxW,
          align: "right",
        });

      // ---- PayPal exchange rate line (audit trail) ----
      // Only shown for PayPal orders where the ARS→USD rate was persisted at
      // creation time. Older orders without the rate fall through silently.
      const rateLine = formatPaypalRateLine(
        order.paymentMethod,
        order.arsToUsdRate,
        order.total,
      );
      if (rateLine !== null) {
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#000")
          .text(rateLine, PAGE_MARGIN, totalsTop + totalsBoxH + 18, {
            width: CONTENT_W,
            align: "right",
          });
      }

      // ---- Footer disclaimer ----
      const discTop = totalsTop + totalsBoxH + 40;
      doc
        .font("Helvetica-Oblique")
        .fontSize(8)
        .fillColor("#333")
        .text(
          "Este documento es un comprobante interno de operación y NO posee validez como factura fiscal " +
            "(Factura A / B / C). No es válido para descargo de IVA ni para registración contable. " +
            "Se emite únicamente como constancia de la transacción realizada en https://" +
            DOMAIN +
            ".",
          PAGE_MARGIN,
          discTop,
          { width: CONTENT_W, align: "justify" },
        );

      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#000")
        .text(
          `Generado automáticamente el ${fmtDate(new Date())} — GraffInk Diseños`,
          PAGE_MARGIN,
          discTop + 60,
          { width: CONTENT_W, align: "center" },
        );

      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
