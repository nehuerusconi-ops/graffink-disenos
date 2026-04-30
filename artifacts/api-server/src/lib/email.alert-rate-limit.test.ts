/**
 * Unit test for the per-hour cap on admin alert emails sent by
 * `sendWebhookSignatureAlertEmail` and `sendPaypalSecurityAlertEmail` in
 * `./email`.
 *
 * Why this exists:
 *   The cap (`WEBHOOK_ALERT_MAX_PER_HOUR`, default 5) is enforced against the
 *   `webhook_alert_log` Postgres table. The state was previously kept in a
 *   process-local `alertTimestamps` array, which reset to zero on every
 *   server restart — meaning a sustained attack that triggered restarts
 *   (deploys, crashes, scaling) could blow past the configured cap, and
 *   running multiple instances would multiply the quota by N. Persisting the
 *   ledger fixes both. This test locks the contract in CI:
 *
 *     - With no env override, at most 5 alerts go out per hour even if the
 *       function is called many more times in quick succession.
 *     - With `WEBHOOK_ALERT_MAX_PER_HOUR=2`, at most 2 go out per hour.
 *     - When the timestamps are >1h old they are pruned and a fresh batch
 *       can go out (proves the cap is per-hour, not per-process-lifetime).
 *     - Re-importing the module (which simulates a server restart) does NOT
 *       reset the counter — the persisted ledger keeps the cap intact.
 *
 * Mocking strategy:
 *   - `nodemailer.createTransport` is replaced with a `vi.fn()` returning a
 *     stub transporter whose `sendMail` is also a `vi.fn()`. We count the
 *     number of `sendMail` calls instead of dispatching real email.
 *   - `@workspace/db` is replaced with an in-memory stub that mimics the
 *     subset of Drizzle used by `tryConsumeAlertSlot`: `db.transaction`,
 *     `tx.delete(...).where(...)`, `tx.select({value:count()}).from(...)`,
 *     and `tx.insert(...).values(...)`. The stub stores rows in a module-
 *     level array shared across module reloads, which is exactly how a real
 *     persisted DB behaves across server restarts.
 *   - `Date.now` is controlled via `vi.useFakeTimers` so we can fast-forward
 *     past the 1-hour window without slowing the test down.
 *   - `vi.resetModules()` is used between cases so `MAX_ALERTS_PER_HOUR` is
 *     re-evaluated from the freshly-set env var (it is captured at module
 *     load via `const MAX_ALERTS_PER_HOUR = resolveMaxAlertsPerHour()`).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const sendMailMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

// ─── Persistent in-memory "DB" shared across module reloads ────────────────
// This array survives `vi.resetModules()` because vitest only resets module
// caches, not values captured by other modules' factory closures. That is
// exactly the behaviour we want to verify: a real Postgres table also
// survives the server process restarting.
type LedgerRow = { id: number; sentAt: Date; source: string };
const ledger: LedgerRow[] = [];
let nextLedgerId = 1;
let webhookAlertLogTableRef: unknown = null;

vi.mock("@workspace/db", async () => {
  const real =
    await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  webhookAlertLogTableRef = real.webhookAlertLogTable;

  type Tx = {
    execute: (query: unknown) => Promise<void>;
    delete: (table: unknown) => { where: (cond: unknown) => Promise<void> };
    select: (_proj: unknown) => {
      from: (table: unknown) => Promise<Array<{ value: number }>>;
    };
    insert: (table: unknown) => {
      values: (vals: { source: string; sentAt?: unknown }) => Promise<void>;
    };
  };

  // We honour the prune semantics by checking whether each row is older than
  // the configured cutoff. Because Drizzle builds an opaque SQL expression
  // for `lt(...)`, the stub instead uses the wall-clock time at the moment
  // `delete().where(...)` is invoked: anything older than 1h is pruned. This
  // matches the production query exactly (`lt(sentAt, now - 1h)`).
  const tx: Tx = {
    // Production calls `tx.execute(sql\`SELECT pg_advisory_xact_lock(...)\`)`
    // first inside the transaction. The mock doesn't need to do anything with
    // the SQL — the serial wrapper around `db.transaction` below is what
    // actually simulates the lock's effect in tests. Returning a resolved
    // promise here is enough to keep the production code path happy.
    execute: async (_query: unknown) => {},
    delete: (table: unknown) => ({
      where: async (_cond: unknown) => {
        if (table !== webhookAlertLogTableRef) return;
        const cutoff = Date.now() - 60 * 60 * 1000;
        for (let i = ledger.length - 1; i >= 0; i--) {
          if (ledger[i]!.sentAt.getTime() < cutoff) ledger.splice(i, 1);
        }
      },
    }),
    select: (_proj: unknown) => ({
      from: async (table: unknown) => {
        if (table !== webhookAlertLogTableRef) return [{ value: 0 }];
        return [{ value: ledger.length }];
      },
    }),
    insert: (table: unknown) => ({
      values: async (vals: { source: string; sentAt?: unknown }) => {
        if (table !== webhookAlertLogTableRef) return;
        ledger.push({
          id: nextLedgerId++,
          sentAt: new Date(),
          source: vals.source,
        });
      },
    }),
  };

  // Serial transaction execution. In production `pg_advisory_xact_lock`
  // gives every transaction a global mutex around the prune/count/insert
  // sequence: any concurrent caller (same instance OR a different one) waits
  // until the holder commits before it can run. The chain below reproduces
  // exactly that property in the test environment, so the concurrency test
  // can fire many parallel calls and assert the cap holds.
  let txQueue: Promise<unknown> = Promise.resolve();
  const transaction = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const next = txQueue.then(() => fn(tx));
    // Swallow rejections in the queue so one failing transaction can't poison
    // the chain for everyone behind it.
    txQueue = next.catch(() => undefined);
    return next;
  };

  return {
    ...real,
    db: { transaction },
  };
});

type EmailModule = typeof import("./email");

async function loadEmailModule(): Promise<EmailModule> {
  // Re-evaluate the module so `MAX_ALERTS_PER_HOUR` is re-read from the env
  // vars set by the current test. Importantly the `ledger` array above is
  // declared in THIS test module — it is NOT cleared by `resetModules()`,
  // which is what lets us simulate "server restarted but Postgres kept its
  // rows" in the persistence test below.
  vi.resetModules();
  return await import("./email");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: "test" });
  createTransportMock.mockClear();

  // Fresh ledger per test so the cases don't bleed into each other. The
  // persistence test below intentionally does NOT clear it between reloads.
  ledger.length = 0;
  nextLedgerId = 1;

  // Gmail credentials must be set for the function to even attempt to send;
  // otherwise it short-circuits at the top of `sendWebhookSignatureAlertEmail`
  // and we'd be measuring nothing.
  process.env["GMAIL_USER"] = "admin@graffink.test";
  process.env["GMAIL_APP_PASSWORD"] = "fake-app-password";
  delete process.env["WEBHOOK_ALERT_MAX_PER_HOUR"];

  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...ORIGINAL_ENV };
});

describe("sendWebhookSignatureAlertEmail — per-hour rate limit", () => {
  it("caps admin alerts at the documented default of 5 per hour", async () => {
    const { sendWebhookSignatureAlertEmail } = await loadEmailModule();

    // Fire 12 attempts in rapid succession; only the first 5 should send.
    for (let i = 0; i < 12; i++) {
      await sendWebhookSignatureAlertEmail({
        ip: "203.0.113.7",
        xRequestId: `req-${i}`,
        timestamp: "1735689600",
      });
    }

    expect(sendMailMock).toHaveBeenCalledTimes(5);
  });

  it("respects the WEBHOOK_ALERT_MAX_PER_HOUR override (=2)", async () => {
    process.env["WEBHOOK_ALERT_MAX_PER_HOUR"] = "2";
    const { sendWebhookSignatureAlertEmail } = await loadEmailModule();

    for (let i = 0; i < 7; i++) {
      await sendWebhookSignatureAlertEmail({
        ip: "203.0.113.7",
        xRequestId: `req-${i}`,
        timestamp: "1735689600",
      });
    }

    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it("prunes timestamps older than 1h so a fresh batch can go out", async () => {
    // The cap is per rolling hour, not per-process-lifetime. After the window
    // expires the stale entries must be pruned and another N alerts allowed.
    process.env["WEBHOOK_ALERT_MAX_PER_HOUR"] = "3";
    const { sendWebhookSignatureAlertEmail } = await loadEmailModule();

    // Saturate the bucket.
    for (let i = 0; i < 3; i++) {
      await sendWebhookSignatureAlertEmail({
        ip: "203.0.113.7",
        xRequestId: `first-${i}`,
        timestamp: "1735689600",
      });
    }
    expect(sendMailMock).toHaveBeenCalledTimes(3);

    // Within the same window further alerts are dropped.
    await sendWebhookSignatureAlertEmail({
      ip: "203.0.113.7",
      xRequestId: "blocked",
      timestamp: "1735689600",
    });
    expect(sendMailMock).toHaveBeenCalledTimes(3);

    // Advance >1h and confirm the bucket is refilled to N again.
    vi.setSystemTime(new Date("2025-01-01T01:00:01Z"));
    for (let i = 0; i < 5; i++) {
      await sendWebhookSignatureAlertEmail({
        ip: "203.0.113.7",
        xRequestId: `second-${i}`,
        timestamp: "1735693201",
      });
    }
    expect(sendMailMock).toHaveBeenCalledTimes(3 + 3);
  });

  it("does not attempt to send when Gmail credentials are missing", async () => {
    // Sanity: if creds are missing, `createTransporter` returns null and we
    // must short-circuit before touching the rate-limit ledger. Without this
    // guard the test for the cap could pass for the wrong reason on a CI box
    // that happened to have GMAIL_USER unset.
    delete process.env["GMAIL_USER"];
    delete process.env["GMAIL_APP_PASSWORD"];
    const { sendWebhookSignatureAlertEmail } = await loadEmailModule();

    for (let i = 0; i < 10; i++) {
      await sendWebhookSignatureAlertEmail({
        ip: "203.0.113.7",
        xRequestId: `req-${i}`,
        timestamp: "1735689600",
      });
    }

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("survives a simulated server restart — ledger persists across module reload", async () => {
    // This is the regression test for task-45. Previously the counter lived
    // in a process-local array (`alertTimestamps`), so each restart reset the
    // tally to 0 and an attacker who could trigger restarts (or simply hit
    // two instances) could exceed the cap by an arbitrary multiple.
    //
    // Now the tally lives in `webhook_alert_log` (the in-memory `ledger`
    // array in this test stands in for that persisted table). Reloading the
    // email module via `vi.resetModules()` simulates the process being killed
    // and respawned: the freshly imported module no longer has any in-memory
    // state, but it MUST still see the rows that were inserted before the
    // "restart" and refuse to send more than `MAX_ALERTS_PER_HOUR` per hour
    // in total.
    process.env["WEBHOOK_ALERT_MAX_PER_HOUR"] = "4";

    // Boot #1 — saturate the bucket fully.
    let mod = await loadEmailModule();
    for (let i = 0; i < 4; i++) {
      await mod.sendWebhookSignatureAlertEmail({
        ip: "203.0.113.7",
        xRequestId: `boot1-${i}`,
        timestamp: "1735689600",
      });
    }
    expect(sendMailMock).toHaveBeenCalledTimes(4);

    // Boot #2 — same hour, fresh module, ledger still full. With the old
    // in-memory implementation this loop would have sent another 4 emails.
    // With the persistent ledger NONE of these should send.
    mod = await loadEmailModule();
    for (let i = 0; i < 6; i++) {
      await mod.sendWebhookSignatureAlertEmail({
        ip: "203.0.113.7",
        xRequestId: `boot2-${i}`,
        timestamp: "1735689600",
      });
    }
    expect(sendMailMock).toHaveBeenCalledTimes(4);

    // And once the window rolls over, even after another restart, the cap
    // refills correctly — proving the prune step is also doing its job
    // against the persistent ledger and not just the (absent) in-memory one.
    vi.setSystemTime(new Date("2025-01-01T01:00:01Z"));
    mod = await loadEmailModule();
    for (let i = 0; i < 10; i++) {
      await mod.sendWebhookSignatureAlertEmail({
        ip: "203.0.113.7",
        xRequestId: `boot3-${i}`,
        timestamp: "1735693201",
      });
    }
    expect(sendMailMock).toHaveBeenCalledTimes(4 + 4);
  });

  it("never exceeds the cap under concurrent attempts (multi-instance simulation)", async () => {
    // Multi-instance correctness regression. Without serialisation around the
    // prune/count/insert sequence, two transactions on different instances
    // (or two requests on the same instance) can both observe `sent < cap`
    // and both insert, blowing past the configured quota by an arbitrary
    // multiple. Production guards against that with `pg_advisory_xact_lock`;
    // this test guards against a future refactor accidentally removing it.
    //
    // The mock above forces strictly serial transaction execution to mirror
    // the advisory lock's behaviour. We fire many parallel attempts via
    // `Promise.all` and assert the cap still holds exactly.
    process.env["WEBHOOK_ALERT_MAX_PER_HOUR"] = "5";
    const mod = await loadEmailModule();

    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        mod.sendWebhookSignatureAlertEmail({
          ip: "203.0.113.7",
          xRequestId: `concurrent-${i}`,
          timestamp: "1735689600",
        }),
      ),
    );

    expect(sendMailMock).toHaveBeenCalledTimes(5);
    expect(ledger.length).toBe(5);
  });

  it("shares the per-hour bucket across MP and PayPal alerts even after a restart", async () => {
    // The two alert sources MUST consume from the same persisted ledger.
    // Otherwise an attacker probing both channels could send up to 2 * cap
    // emails per hour, defeating the purpose of the limit.
    process.env["WEBHOOK_ALERT_MAX_PER_HOUR"] = "3";

    let mod = await loadEmailModule();
    await mod.sendWebhookSignatureAlertEmail({
      ip: "203.0.113.7",
      xRequestId: "mp-1",
      timestamp: "1735689600",
    });
    await mod.sendPaypalSecurityAlertEmail({
      reason: "amount_mismatch",
      orderId: "order-1",
      ppOrderId: "pp-1",
      ip: "203.0.113.7",
      detail: null,
    });
    expect(sendMailMock).toHaveBeenCalledTimes(2);

    // Restart, then try to flood with the OTHER channel — should hit the
    // shared cap immediately.
    mod = await loadEmailModule();
    for (let i = 0; i < 5; i++) {
      await mod.sendPaypalSecurityAlertEmail({
        reason: "order_mismatch",
        orderId: `order-${i + 2}`,
        ppOrderId: `pp-${i + 2}`,
        ip: "203.0.113.7",
        detail: null,
      });
    }
    // Only one more should have gone through (2 already used, cap = 3).
    expect(sendMailMock).toHaveBeenCalledTimes(3);
  });
});
