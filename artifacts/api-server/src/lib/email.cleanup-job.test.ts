/**
 * Unit tests for the periodic cleanup job that prunes old rows from
 * `webhook_alert_log` (`pruneOldWebhookAlertLogs` and
 * `startWebhookAlertLogCleanupJob` in `./email`).
 *
 * Why this exists:
 *   The inline prune inside `tryConsumeAlertSlot` only fires when a new
 *   alert attempt arrives. If the site is quiet for days after a burst of
 *   signature failures, the rows from that burst stay in the table until
 *   the next attempt. The periodic job is the safety net for that case.
 *   These tests lock the contract:
 *
 *     - `pruneOldWebhookAlertLogs` deletes rows whose `sent_at` is older
 *       than 1 hour and leaves rows within the last hour intact.
 *     - It returns the number of rows deleted (0 when nothing matches) and
 *       does not throw on an empty table.
 *     - `startWebhookAlertLogCleanupJob` runs the prune once immediately on
 *       start (so a server that boots after a long quiet period doesn't
 *       have to wait a full day for the first cleanup) and re-runs it on a
 *       fixed interval. The returned `stop()` cancels the timer so the test
 *       can leave the event loop clean.
 *
 * Mocking strategy:
 *   - `@workspace/db` is replaced with an in-memory ledger that mirrors the
 *     subset of Drizzle used by the prune query: `db.delete(...).where(...)
 *     .returning(...)`. The where clause is opaque (a Drizzle SQL
 *     expression) so the stub uses wall-clock time directly: any row older
 *     than 1h at the moment `where` runs is removed. That matches the
 *     production query exactly (`lt(sentAt, now - 1h)`).
 *   - `Date.now` and `setInterval` are controlled with `vi.useFakeTimers`
 *     so we can fast-forward past the 24h interval without slowing the test.
 *   - `vi.resetModules()` is used between cases so each test gets a fresh
 *     module instance and the in-memory ledger is fully isolated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LedgerRow = { id: number; sentAt: Date; source: string };
const ledger: LedgerRow[] = [];
let nextLedgerId = 1;
let webhookAlertLogTableRef: unknown = null;

vi.mock("@workspace/db", async () => {
  const real =
    await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  webhookAlertLogTableRef = real.webhookAlertLogTable;

  const db = {
    delete: (table: unknown) => ({
      where: (_cond: unknown) => ({
        returning: async (_proj: unknown) => {
          if (table !== webhookAlertLogTableRef) return [];
          const cutoff = Date.now() - 60 * 60 * 1000;
          const removed: { id: number }[] = [];
          for (let i = ledger.length - 1; i >= 0; i--) {
            if (ledger[i]!.sentAt.getTime() < cutoff) {
              removed.push({ id: ledger[i]!.id });
              ledger.splice(i, 1);
            }
          }
          return removed;
        },
      }),
    }),
    transaction: async () => {
      throw new Error("not used in cleanup-job tests");
    },
  };

  return { ...real, db };
});

type EmailModule = typeof import("./email");

async function loadEmailModule(): Promise<EmailModule> {
  vi.resetModules();
  return await import("./email");
}

beforeEach(() => {
  ledger.length = 0;
  nextLedgerId = 1;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pruneOldWebhookAlertLogs", () => {
  it("removes rows older than 1 hour and leaves recent rows intact", async () => {
    const now = Date.now();
    ledger.push(
      { id: nextLedgerId++, sentAt: new Date(now - 3 * 60 * 60 * 1000), source: "MP webhook" },
      { id: nextLedgerId++, sentAt: new Date(now - 90 * 60 * 1000), source: "PayPal capture" },
      { id: nextLedgerId++, sentAt: new Date(now - 30 * 60 * 1000), source: "MP webhook" },
      { id: nextLedgerId++, sentAt: new Date(now - 5 * 60 * 1000), source: "PayPal capture" },
    );

    const { pruneOldWebhookAlertLogs } = await loadEmailModule();
    const removed = await pruneOldWebhookAlertLogs();

    expect(removed).toBe(2);
    expect(ledger).toHaveLength(2);
    // Survivors are the rows within the last hour.
    expect(ledger.every((r) => Date.now() - r.sentAt.getTime() < 60 * 60 * 1000)).toBe(
      true,
    );
  });

  it("returns 0 when the table has no rows", async () => {
    const { pruneOldWebhookAlertLogs } = await loadEmailModule();
    const removed = await pruneOldWebhookAlertLogs();
    expect(removed).toBe(0);
    expect(ledger).toHaveLength(0);
  });

  it("returns 0 when all rows are within the last hour", async () => {
    const now = Date.now();
    ledger.push(
      { id: nextLedgerId++, sentAt: new Date(now - 10 * 60 * 1000), source: "MP webhook" },
      { id: nextLedgerId++, sentAt: new Date(now - 50 * 60 * 1000), source: "MP webhook" },
    );

    const { pruneOldWebhookAlertLogs } = await loadEmailModule();
    const removed = await pruneOldWebhookAlertLogs();
    expect(removed).toBe(0);
    expect(ledger).toHaveLength(2);
  });
});

describe("startWebhookAlertLogCleanupJob", () => {
  it("runs the prune immediately on start and again every 24h", async () => {
    const now = Date.now();
    // Three stale rows the job should clear on its first tick.
    ledger.push(
      { id: nextLedgerId++, sentAt: new Date(now - 2 * 60 * 60 * 1000), source: "MP webhook" },
      { id: nextLedgerId++, sentAt: new Date(now - 3 * 60 * 60 * 1000), source: "MP webhook" },
      { id: nextLedgerId++, sentAt: new Date(now - 4 * 60 * 60 * 1000), source: "PayPal capture" },
    );

    const { startWebhookAlertLogCleanupJob } = await loadEmailModule();
    const job = startWebhookAlertLogCleanupJob();

    // The immediate prune is fire-and-forget — let microtasks flush first.
    await vi.runOnlyPendingTimersAsync();
    expect(ledger).toHaveLength(0);

    // Insert a fresh batch that will become stale by the next scheduled tick.
    ledger.push(
      { id: nextLedgerId++, sentAt: new Date(Date.now() - 30 * 60 * 1000), source: "MP webhook" },
      { id: nextLedgerId++, sentAt: new Date(Date.now() - 5 * 60 * 1000), source: "MP webhook" },
    );

    // Advance the clock 24h so both rows are now older than 1h, then let the
    // interval fire.
    vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(ledger).toHaveLength(0);

    job.stop();
  });

  it("stop() cancels future ticks", async () => {
    const { startWebhookAlertLogCleanupJob } = await loadEmailModule();
    const job = startWebhookAlertLogCleanupJob();

    // Drain the immediate prune.
    await vi.runOnlyPendingTimersAsync();

    // Stop the job, then add a row that would be stale by the next scheduled
    // tick and confirm that no prune fires after stop().
    job.stop();
    ledger.push({
      id: nextLedgerId++,
      sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      source: "MP webhook",
    });

    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);

    expect(ledger).toHaveLength(1);
  });
});
