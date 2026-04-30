import { lt } from "drizzle-orm";
import { db, pool, webhookSecurityEventsTable } from "@workspace/db";

const DEFAULT_RETENTION_DAYS = 90;

function resolveRetentionDays(): number {
  const raw = process.env["WEBHOOK_SECURITY_EVENT_RETENTION_DAYS"];
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid WEBHOOK_SECURITY_EVENT_RETENTION_DAYS="${raw}". ` +
        `Must be a positive integer (days).`,
    );
  }
  return parsed;
}

async function main(): Promise<void> {
  const retentionDays = resolveRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  console.log(
    JSON.stringify({
      level: "info",
      msg: "cleanup-webhook-security-events: starting",
      retentionDays,
      cutoff: cutoff.toISOString(),
    }),
  );

  const result = await db
    .delete(webhookSecurityEventsTable)
    .where(lt(webhookSecurityEventsTable.createdAt, cutoff));

  const deletedCount = result.rowCount ?? 0;

  console.log(
    JSON.stringify({
      level: "info",
      msg: "cleanup-webhook-security-events: done",
      retentionDays,
      cutoff: cutoff.toISOString(),
      deletedCount,
    }),
  );
}

main()
  .catch((err: unknown) => {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "cleanup-webhook-security-events: failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
