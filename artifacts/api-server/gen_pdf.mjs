import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

// Replicate buildInvoicePdf inline using same constants as src/lib/pdfInvoice.ts
const PAGE_MARGIN = 36;
const PAGE_WIDTH = 595.28;
const CONTENT_W = PAGE_WIDTH - PAGE_MARGIN * 2;
const DOMAIN = "dtflab.com.ar";

function fmtMoney(n) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function methodLabel(m) {
  return { mercadopago: "Mercado Pago", uala: "Ualá Bis", paypal: "PayPal" }[m] ?? m;
}

const order = {
  id: "test-uuid",
  invoiceNumber: 42,
  customerName: "María Florencia González",
  customerEmail: "maria.gonzalez@gmail.com",
  customerDni: "27345678901",
  items: [
    { productId: "p1", name: "Pack Mariposas Vibrant Colores", price: 1500, quantity: 2, imagePath: "/x.png", filePath: null },
    { productId: "p2", name: "DTF Calaveras Mexicanas Día de los Muertos — Set Premium", price: 2200, quantity: 1, imagePath: "/x.png", filePath: null },
    { productId: "p3", name: "Diseños Anime Edición Limitada", price: 1800, quantity: 3, imagePath: "/x.png", filePath: null },
  ],
  total: 1500 * 2 + 2200 + 1800 * 3,
  paymentMethod: "mercadopago",
  status: "paid",
  confirmationSource: "webhook",
  externalPaymentId: "MP-XXXX",
  createdAt: new Date(),
};

function logoFind() {
  const c = [
    path.resolve("./artifacts/dreamstorm/public/logo.png"),
  ];
  for (const p of c) if (fs.existsSync(p)) return p;
  return null;
}

const doc = new PDFDocument({ size: "A4", margin: PAGE_MARGIN });
const out = fs.createWriteStream("/tmp/sample-invoice.pdf");
doc.pipe(out);

doc.font("Helvetica-Bold").fontSize(9).fillColor("#000")
  .text("ORIGINAL", PAGE_MARGIN, PAGE_MARGIN, { width: CONTENT_W, align: "right" });

const headerTop = PAGE_MARGIN + 18;
const headerH = 110;
const colW = CONTENT_W / 3;
const leftX = PAGE_MARGIN, midX = PAGE_MARGIN + colW, rightX = PAGE_MARGIN + colW * 2;

doc.lineWidth(1).strokeColor("#000")
  .rect(leftX, headerTop, colW, headerH).stroke()
  .rect(midX, headerTop, colW, headerH).stroke()
  .rect(rightX, headerTop, colW, headerH).stroke();

const lp = logoFind();
if (lp) { try { doc.image(lp, leftX + 10, headerTop + 10, { fit: [colW - 20, 40], align: "left" }); } catch {} }
doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text("DTF LAB", leftX + 10, headerTop + 56, { width: colW - 20 });
doc.font("Helvetica").fontSize(8).text("Diseños DTF — Argentina", leftX + 10, headerTop + 74, { width: colW - 20 });
doc.text(`https://${DOMAIN}`, leftX + 10, headerTop + 86, { width: colW - 20 });

const xBoxSize = 38, xBoxX = midX + (colW - xBoxSize) / 2, xBoxY = headerTop + 10;
doc.lineWidth(1.5).rect(xBoxX, xBoxY, xBoxSize, xBoxSize).stroke();
doc.font("Helvetica-Bold").fontSize(28).text("X", xBoxX, xBoxY + 4, { width: xBoxSize, align: "center" });
doc.font("Helvetica-Bold").fontSize(8).text("COMPROBANTE", midX, xBoxY + xBoxSize + 6, { width: colW, align: "center" });
doc.text("NO FISCAL", midX, xBoxY + xBoxSize + 16, { width: colW, align: "center" });
doc.font("Helvetica").fontSize(7).text("Sin valor tributario.\nSólo a fines informativos.", midX + 6, xBoxY + xBoxSize + 32, { width: colW - 12, align: "center" });

const invStr = String(order.invoiceNumber).padStart(8, "0");
doc.font("Helvetica-Bold").fontSize(11).text("COMPROBANTE", rightX + 10, headerTop + 10, { width: colW - 20 });
doc.font("Helvetica-Bold").fontSize(13).text(`N° 0001-${invStr}`, rightX + 10, headerTop + 26, { width: colW - 20 });
doc.font("Helvetica").fontSize(9)
  .text(`Fecha de emisión: ${fmtDate(new Date(order.createdAt))}`, rightX + 10, headerTop + 56, { width: colW - 20 })
  .text(`Tipo: Comprobante interno`, rightX + 10, headerTop + 70, { width: colW - 20 })
  .text(`Pago: ${methodLabel(order.paymentMethod)}`, rightX + 10, headerTop + 84, { width: colW - 20 });

const custTop = headerTop + headerH + 14, custH = 70;
doc.lineWidth(1).rect(PAGE_MARGIN, custTop, CONTENT_W, custH).stroke();
doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text("DATOS DEL COMPRADOR", PAGE_MARGIN + 10, custTop + 8);
doc.moveTo(PAGE_MARGIN + 10, custTop + 22).lineTo(PAGE_MARGIN + CONTENT_W - 10, custTop + 22).stroke();

doc.font("Helvetica-Bold").fontSize(9);
doc.text("Nombre y Apellido:", PAGE_MARGIN + 10, custTop + 30);
doc.text("Email:", PAGE_MARGIN + 10, custTop + 46);
doc.text("DNI / CUIT:", PAGE_MARGIN + 300, custTop + 30);
doc.text("Condición frente al IVA:", PAGE_MARGIN + 300, custTop + 46);
doc.font("Helvetica").fontSize(9);
doc.text(order.customerName, PAGE_MARGIN + 110, custTop + 30, { width: 180 });
doc.text(order.customerEmail, PAGE_MARGIN + 110, custTop + 46, { width: 180 });
doc.text(order.customerDni ?? "—", PAGE_MARGIN + 388, custTop + 30, { width: 150 });
doc.text("Consumidor Final", PAGE_MARGIN + 425, custTop + 46, { width: 130 });

const tableTop = custTop + custH + 14, tableHeaderH = 22;
const colCantW = 50, colDescW = 280, colUnitW = 90, colTotalW = CONTENT_W - colCantW - colDescW - colUnitW;
const cantX = PAGE_MARGIN, descX = cantX + colCantW, unitX = descX + colDescW, totalX = unitX + colUnitW;

doc.lineWidth(1).rect(PAGE_MARGIN, tableTop, CONTENT_W, tableHeaderH).fillAndStroke("#f0f0f0", "#000");
doc.fillColor("#000").font("Helvetica-Bold").fontSize(9);
const hY = tableTop + 7;
doc.text("CANT.", cantX, hY, { width: colCantW, align: "center" });
doc.text("DESCRIPCIÓN", descX + 6, hY, { width: colDescW - 12 });
doc.text("P. UNIT.", unitX, hY, { width: colUnitW, align: "right" });
doc.text("IMPORTE", totalX, hY, { width: colTotalW - 6, align: "right" });

let rowY = tableTop + tableHeaderH;
const rowH = 22;
doc.font("Helvetica").fontSize(9).fillColor("#000");
for (const it of order.items) {
  const dh = doc.heightOfString(it.name, { width: colDescW - 12 });
  const trh = Math.max(rowH, dh + 10);
  doc.lineWidth(0.5).strokeColor("#000").rect(PAGE_MARGIN, rowY, CONTENT_W, trh).stroke();
  const sub = it.price * it.quantity, cellY = rowY + 6;
  doc.text(String(it.quantity), cantX, cellY, { width: colCantW, align: "center" });
  doc.text(it.name, descX + 6, cellY, { width: colDescW - 12 });
  doc.text(`$ ${fmtMoney(it.price)}`, unitX, cellY, { width: colUnitW - 6, align: "right" });
  doc.text(`$ ${fmtMoney(sub)}`, totalX, cellY, { width: colTotalW - 6, align: "right" });
  rowY += trh;
}

const totalsTop = rowY + 18, totalsBoxW = 240, totalsBoxX = PAGE_MARGIN + CONTENT_W - totalsBoxW, totalsBoxH = 36;
doc.lineWidth(1.5).rect(totalsBoxX, totalsTop, totalsBoxW, totalsBoxH).stroke();
doc.font("Helvetica-Bold").fontSize(11).text("IMPORTE TOTAL", totalsBoxX + 10, totalsTop + 11, { width: 110 });
doc.font("Helvetica-Bold").fontSize(13).text(`$ ${fmtMoney(order.total)}`, totalsBoxX + 120, totalsTop + 10, { width: totalsBoxW - 130, align: "right" });
doc.font("Helvetica").fontSize(8).text("Importes en Pesos Argentinos (ARS)", totalsBoxX, totalsTop + totalsBoxH + 4, { width: totalsBoxW, align: "right" });

const discTop = totalsTop + totalsBoxH + 40;
doc.font("Helvetica-Oblique").fontSize(8).fillColor("#333")
  .text("Este documento es un comprobante interno de operación y NO posee validez como factura fiscal (Factura A / B / C). No es válido para descargo de IVA ni para registración contable. Se emite únicamente como constancia de la transacción realizada en https://" + DOMAIN + ".",
    PAGE_MARGIN, discTop, { width: CONTENT_W, align: "justify" });

doc.font("Helvetica").fontSize(8).fillColor("#000")
  .text(`Generado automáticamente el ${fmtDate(new Date())} — DTF LAB`, PAGE_MARGIN, discTop + 60, { width: CONTENT_W, align: "center" });

doc.end();
out.on("finish", () => console.log("OK", fs.statSync("/tmp/sample-invoice.pdf").size, "bytes"));
