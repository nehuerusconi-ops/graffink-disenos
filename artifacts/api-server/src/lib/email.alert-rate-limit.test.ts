/**
 * Unit test for the per-hour cap on admin alert emails sent by
 * `sendWebhookSignatureAlertEmail` in `./email`.
 *
 * Why this exists:
 *   The cap is enforced by an in-memory `alertTimestamps` array gated by
 *   `MAX_ALERTS_PER_HOUR` (resolved from `WEBHOOK_ALERT_MAX_PER_HOUR` at
 *   module load, default 5). If a refactor breaks the prune/skip logic the
 *   admin inbox can be flooded during an attack with no warning. This test
 *   locks the contract in CI:
 *
 *     - With no env override, at most 5 alerts go out per hour even if the
 *       function is called many more times in quick succession.
 *     - With `WEBHOOK_ALERT_MAX_PER_HOUR=2`, at most 2 go out per hour.
 *     - When the timestamps are >1h old they are pruned and a fresh batch
 *       can go out (proves the cap is per-hour, not per-process-lifetime).
 *
 * Mocking strategy:
 *   - `nodemailer.createTransport` is replaced with a `vi.fn()` returning a
 *     stub transporter whose `sendMail` is also a `vi.fn()`. We count the
 *     number of `sendMail` calls instead of dispatching real email.
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

type EmailModule = typeof import("./email");

async function loadEmailModule(): Promise<EmailModule> {
  // Re-evaluate the module so `MAX_ALERTS_PER_HOUR` and the in-memory
  // `alertTimestamps` array are reset to a clean baseline that picks up the
  // env vars set by the current test.
  vi.resetModules();
  return await import("./email");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue({ messageId: "test" });
  createTransportMock.mockClear();

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
});
