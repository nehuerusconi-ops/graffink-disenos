import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const appSettingsTable = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;

export const SETTING_KEY_PLANCHA_PRICE = "plancha_grouping_price";
export const DEFAULT_PLANCHA_PRICE_ARS = 1000;

// Catálogo de medidas estándar que el cliente puede elegir por diseño en el
// carrito. Se persiste como JSON serializado bajo una sola clave para
// reaprovechar la tabla key/value existente sin necesidad de migrar a un
// modelo relacional. La opción "Original" no se persiste — se asume siempre
// disponible y representa "el diseño tal como lo subió el admin", que se
// entrega instantáneamente. Cualquier medida diferente a "Original"
// (incluida la opción "Armar plancha") obliga a re-exportar el PNG y dispara
// el plazo de entrega de 24 horas hábiles.
export const SETTING_KEY_AVAILABLE_SIZES = "available_sizes";
export const DEFAULT_AVAILABLE_SIZES: string[] = [
  "10x10 cm",
  "15x15 cm",
  "20x20 cm",
  "30x30 cm",
];
