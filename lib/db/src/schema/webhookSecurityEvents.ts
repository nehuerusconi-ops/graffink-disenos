import { pgTable, text, timestamp, varchar, serial, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const webhookSecurityEventsTable = pgTable(
  "webhook_security_events",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: varchar("source", { length: 32 }).notNull(),
    reason: varchar("reason", { length: 64 }).notNull(),
    ip: text("ip"),
    xRequestId: text("x_request_id"),
    signatureTs: text("signature_ts"),
    detail: text("detail"),
  },
  (t) => [index("webhook_security_events_created_at_idx").on(sql`${t.createdAt} DESC`)],
);

export type WebhookSecurityEvent = typeof webhookSecurityEventsTable.$inferSelect;
export type InsertWebhookSecurityEvent = typeof webhookSecurityEventsTable.$inferInsert;
