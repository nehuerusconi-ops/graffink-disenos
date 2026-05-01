import { pgTable, text, integer, timestamp, varchar, jsonb, serial, boolean, numeric } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imagePath: string;
  filePath?: string | null;
  // Medida elegida por el cliente para este diseño en el carrito. Cuando es
  // "Original" (o falta — pedidos viejos previos a este campo) significa que
  // el cliente quiere el archivo tal como lo subió el admin y la entrega es
  // instantánea. Cualquier otro valor (medida estándar como "20x20 cm" o un
  // tamaño personalizado) implica que el admin tiene que re-exportar el PNG
  // y la entrega pasa a ser diferida — ese estado se resume en el flag
  // `requiresManualPrep` a nivel orden.
  selectedSize?: string;
  // True cuando el cliente eligió un tamaño no listado entre las medidas
  // estándar (ej. una medida ad-hoc cargada en el carrito). El valor textual
  // queda en `selectedSize`; este boolean lo expone separado para que el
  // panel admin y el email pueden destacarlo sin tener que parsear strings.
  isCustomSize?: boolean;
}

export const ordersTable = pgTable("orders", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  invoiceNumber: serial("invoice_number").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerDni: text("customer_dni"),
  items: jsonb("items").$type<OrderItem[]>().notNull(),
  total: integer("total").notNull(),
  isPlanchaGrouped: boolean("is_plancha_grouped").notNull().default(false),
  // True cuando el pedido requiere preparación manual antes de poder
  // entregarse. Se setea en true si: (a) el cliente activó "Armar plancha"
  // (el admin tiene que componer el PNG final) o (b) algún ítem tiene una
  // medida distinta de "Original" — estándar o personalizada — que obliga a
  // re-exportar el archivo. Cuando es true el frontend muestra "En
  // preparación · 24hs" en lugar del botón de descarga, el email al cliente
  // promete entrega en 24hs hábiles, y el admin recibe un mail de aviso.
  // Reemplaza a futuro la dependencia exclusiva de `isPlanchaGrouped` para
  // gatear la entrega diferida; éste último se conserva porque sigue siendo
  // útil en factura/PDF para distinguir el cargo del servicio de armado.
  requiresManualPrep: boolean("requires_manual_prep").notNull().default(false),
  paymentMethod: text("payment_method", {
    enum: ["mercadopago", "transferencia", "paypal"],
  }).notNull(),
  status: text("status", { enum: ["pending", "paid", "failed", "refunded"] })
    .notNull()
    .default("paid"),
  externalPaymentId: varchar("external_payment_id", { length: 255 }),
  confirmationSource: text("confirmation_source", {
    enum: ["webhook", "manual", "paypal-capture"],
  }),
  arsToUsdRate: numeric("ars_to_usd_rate", { precision: 12, scale: 4 }),
  // USD amount agreed at PayPal create-order time. Persisted (instead of
  // kept only in an in-memory map) so the anti-fraud amount check at
  // capture-order time still works after a server restart between the
  // create-order and capture-order calls. Nullable because non-PayPal
  // orders never set it.
  paypalUsdAmount: numeric("paypal_usd_amount", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  invoiceNumber: true,
  createdAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
