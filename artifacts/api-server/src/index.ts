import app from "./app";
import { logger } from "./lib/logger";
import { startWebhookAlertLogCleanupJob } from "./lib/email";
import { seedCategoriesIfEmpty } from "./routes/categories";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Fire-and-forget: ensure the seven legacy categories exist on first boot
  // so the storefront never renders with an empty category filter row.
  void seedCategoriesIfEmpty();
  // Schedule the periodic prune of `webhook_alert_log` rows older than 1h.
  // Runs once immediately and then every 24h. Required so that during long
  // quiet stretches with no signature failures the table doesn't keep stale
  // rows from the previous burst — the inline prune in `tryConsumeAlertSlot`
  // only fires when a new alert attempt arrives.
  startWebhookAlertLogCleanupJob();
});
