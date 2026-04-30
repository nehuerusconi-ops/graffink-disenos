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
