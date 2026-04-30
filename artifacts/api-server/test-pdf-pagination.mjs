import { buildInvoicePdf } from "./src/lib/pdfInvoice.ts";
import fs from "node:fs";

const items = Array.from({ length: 35 }, (_, i) => ({
  productId: `p${i}`,
  name: `Diseño DTF de prueba número ${i + 1} con descripción larga para forzar pagebreak`,
  price: 1500 + i * 25,
  quantity: 1 + (i % 4),
  imagePath: "/x.png",
  filePath: null,
}));

const total = items.reduce((s, it) => s + it.price * it.quantity, 0);

const order = {
  id: "test-id-12345",
  invoiceNumber: 42,
  customerName: "Juan Pérez",
  customerEmail: "juan@test.com",
  customerDni: "20123456786",
  items,
  total,
  paymentMethod: "mercadopago",
  status: "paid",
  confirmationSource: "webhook",
  createdAt: new Date(),
};

const pdf = await buildInvoicePdf(order);
fs.writeFileSync("/tmp/sample-invoice-paginated.pdf", pdf);
console.log("PDF size:", pdf.length, "bytes");
