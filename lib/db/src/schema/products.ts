import { pgTable, text, integer, boolean, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface ProductSpec {
  key: string;
  value: string;
}

export const productsTable = pgTable("products", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  price: integer("price").notNull(),
  imagePath: text("image_path").notNull(),
  filePath: text("file_path"),
  description: text("description"),
  specifications: jsonb("specifications").$type<ProductSpec[]>().notNull().default([]),
  isBestSeller: boolean("is_best_seller").notNull().default(false),
  isPublished: boolean("is_published").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
