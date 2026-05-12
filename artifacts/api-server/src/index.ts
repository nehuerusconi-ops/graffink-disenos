import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../.env") });

const [{ default: app }, { logger }, { startWebhookAlertLogCleanupJob }, { seedCategoriesIfEmpty }] =
  await Promise.all([
    import("./app.js"),
    import("./lib/logger.js"),
    import("./lib/email.js"),
    import("./routes/categories.js"),
  ]);

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
