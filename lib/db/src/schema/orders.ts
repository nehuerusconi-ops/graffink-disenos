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
