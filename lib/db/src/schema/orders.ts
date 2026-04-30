import { pgTable, text, integer, timestamp, varchar, jsonb, serial, boolean } from "drizzle-orm/pg-core";
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
    enum: ["mercadopago", "uala", "paypal"],
  }).notNull(),
  status: text("status", { enum: ["pending", "paid", "failed", "refunded"] })
    .notNull()
    .default("paid"),
  externalPaymentId: varchar("external_payment_id", { length: 255 }),
  confirmationSource: text("confirmation_source", {
    enum: ["webhook", "manual", "paypal-capture"],
  }),
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
