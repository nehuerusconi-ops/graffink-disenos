import { pgTable, timestamp, varchar, serial, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Persistent ledger of admin "security alert" emails (MP webhook signature
 * failures, PayPal capture validation failures). Used by `email.ts` to enforce
 * `WEBHOOK_ALERT_MAX_PER_HOUR` across server restarts and across multiple
 * instances. Each row records the moment a single alert email was dispatched.
 *
 * Rows older than 1 hour are pruned by the rate-limit gate itself before each
 * decision, so the table stays small (bounded by `MAX_ALERTS_PER_HOUR`).
 */
export const webhookAlertLogTable = pgTable(
  "webhook_alert_log",
  {
    id: serial("id").primaryKey(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: varchar("source", { length: 32 }).notNull(),
  },
  (t) => [index("webhook_alert_log_sent_at_idx").on(sql`${t.sentAt} DESC`)],
);

export type WebhookAlertLogRow = typeof webhookAlertLogTable.$inferSelect;
export type InsertWebhookAlertLog = typeof webhookAlertLogTable.$inferInsert;
