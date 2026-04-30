# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: Clerk (`@clerk/express` server, `@clerk/react` client v6)
- **Object Storage**: Replit App Storage (Google Cloud bucket)

## Artifacts

- `artifacts/api-server` — Express API: products CRUD, orders (POST public, GET/stats admin-only), and storage signed URLs. Admin endpoints gated by `requireAuth` middleware that uses Clerk session.
- `artifacts/dreamstorm` — Vite React storefront in Argentine Spanish (voseo). Routes: `/` storefront, `/sign-in`, `/sign-up`, `/admin` (Clerk-protected admin panel with three tabs: Diseños / Ganancias / Facturación).

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run test` — run vitest suites across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Notes

- The Clerk frontend proxy at `/api/__clerk` is **production-only**; in development the React client must NOT pass `proxyUrl` (it talks to `*.clerk.accounts.dev` directly via the publishable key).
- Storefront product data is fetched from `GET /api/products` via the generated `useListProducts` hook; the static `PRODUCTS` constant in `src/data/products.ts` is kept only for the `Product`/`Category` types.
- Admin uploads call `POST /api/storage/uploads/request-url` (auth-gated) for a signed PUT URL, then upload directly to GCS. Returned `objectPath` (e.g. `/objects/uploads/xxxx`) is rendered through `/api/storage{objectPath}`.
- Orders: `orders` table has auto-incremented `invoice_number` (`serial`) for facturación, jsonb `items` snapshot, total in ARS pesos (integer), `payment_method` enum (mercadopago | transferencia | paypal), and nullable `customer_dni text` (DNI 7-8 digits or CUIT 11 digits). Checkout collects customer name + email + optional DNI/CUIT then POSTs to `/api/payments/*`. Admin "Ganancias" tab calls `/api/orders/stats` for KPIs + 30-day chart + top products + revenue-by-method. Admin "Facturación" tab lists orders with a printable HTML invoice + a downloadable PDF comprobante (Argentine non-fiscal "Factura B/C" style) for paid orders.
- Transferencia bancaria: `POST /api/payments/transferencia/info` returns the hardcoded CVU + holder shown to the buyer in checkout. The buyer transfers manually from their own bank/wallet, sends the receipt to the store email, and the admin confirms the order from the admin panel (same flow as the deprecated Ualá Bis flow). To change the bank account, edit `TRANSFERENCIA_CVU` / `TRANSFERENCIA_HOLDER` constants in `artifacts/api-server/src/routes/payments.ts`. The legacy `UALA_PAYMENT_LINK` env var is no longer consumed and can be removed from Secrets.
- Admin tab components live in `artifacts/dreamstorm/src/pages/admin/{ProductsTab,SalesTab,InvoicesTab}.tsx`.
- PDF invoice: `artifacts/api-server/src/lib/pdfInvoice.ts` builds a paginated PDF (PDFKit) with repeated table header on overflow. Attached to confirmation email and served via `GET /api/orders/:id/invoice-pdf` (admin-only, paid-only). `pdfkit` and `fontkit` are in esbuild externals (build.mjs) because fontkit dynamic-requires `@swc/helpers`.
- Order confirmation email: when a payment is confirmed (MP webhook, PayPal capture, or admin manual mark-as-paid), `sendOrderConfirmation()` in `artifacts/api-server/src/lib/email.ts` mails the buyer (`to: customerEmail`) AND BCCs the store inbox (`bcc: GMAIL_USER`) so the admin gets a hidden copy of every paid order with the same PDF attachment. Subject: `✅ GraffInk Diseños — Factura N° XXXXXX confirmada`. The buyer's headers do not show the BCC.
- Buyer-facing payment description: both Mercado Pago line titles and PayPal `purchase_units[*].description` use the fixed string `"GraffInk Diseños"` (never the per-design product name) so the design name does not leak into the gateway's checkout UI / buyer's bank statement. MP still sends one line per design with the real `productId`, `quantity`, and `unit_price` so the webhook amount-check passes.
- Storefront contact info: the only public contact channel is the email `graffink.design@gmail.com` (note: "design" with a 'g' — earlier code had a typo "desing" without the 'g' that has been fixed everywhere). It is rendered in the Footer (with a `Mail` icon) and in `CustomDesign.tsx` (CTA button + helper text). WhatsApp was intentionally removed across the storefront — do not re-add unless the operator explicitly asks.
- DNI/CUIT validation: `artifacts/api-server/src/lib/dniCuit.ts` exports `isValidDniOrCuit` (DNI 7-8 OR CUIT 11 with mod-11 checksum). Applied in `payments.ts` zod refinement and in `orders.ts` admin POST. Mirrored on the storefront as `artifacts/dreamstorm/src/components/storefront/dniInput.ts` (`isAcceptableDniInput` / `dniForPayload`) which is what `CheckoutDialog` calls before firing any request. Both layers are covered by vitest suites (`dniCuit.test.ts` + `orders.invoice-pdf.test.ts` in api-server, `dniInput.test.ts` in dreamstorm).
- PayPal exchange-rate disclosure: `GET /api/payments/paypal/rate` is **public** (returns `{ arsToUsd, source, cachedAt, mode }`). The `CheckoutDialog` fetches it on entering the payment / paypal-buttons step and shows the buyer the equivalent USD amount and the rate used before they confirm the PayPal payment. The same endpoint also powers the admin Settings tab, which renders a green "LIVE" / amber "SANDBOX" badge based on `mode`.
- PayPal live vs sandbox: `resolvePaypalMode()` in `artifacts/api-server/src/routes/payments.ts` is **safe by default**. It returns `"sandbox"` UNLESS the secret `PAYPAL_MODE` is explicitly set to `live` (case-insensitive, trimmed). Even with `PAYPAL_MODE=live`, the resolver downgrades back to sandbox when `PAYPAL_CLIENT_ID` looks like a sandbox value (empty, starts with `sb-`, or contains `sandbox`) and emits a WARN. To switch to production: replace `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `VITE_PAYPAL_CLIENT_ID` with values from developer.paypal.com → Live, then set `PAYPAL_MODE=live`, then restart the API server. Module load logs the resolved mode + client-ID prefix so misconfiguration is visible in workflow logs.
- App settings: generic key/value store via `app_settings` table. `GET /api/settings` is **public** (returns `{ planchaGroupingPrice }`); `PATCH /api/settings` is admin-only. Currently stores `plancha_grouping_price` (default 1000 ARS), editable from Admin → Configuración.
- Product details: `products` rows have optional `description` (text) + `specifications` (jsonb array of `{key, value}`). The storefront `ProductCard` opens a "Ver detalles" Dialog showing image, description, and specs grid. Admin `ProductsTab` exposes a Textarea + dynamic spec rows.
- Header brand block: the storefront header (`Header.tsx`) renders the logo image alongside a two-line text block — "GraffInk" (white, black weight) above "Diseños" (primary color, letter-spaced caption) — so the page name is always readable next to the icon, both on mobile (`h-10` / `text-base`) and desktop (`h-12` / `text-lg`).
- Cart quantity stepper: each line in `CartSheet` renders a -/+ stepper (data-testids `button-decrement-<id>`, `text-quantity-<id>`, `button-increment-<id>`) plus a per-line subtotal (`item.price * item.quantity`) and the per-unit price ("$X c/u"). Backed by `updateQuantity(productId, quantity)` on `CartContext` — when `quantity <= 0` it removes the item entirely, so decrementing past 1 is a friendly remove. The trash button still does an immediate full removal.
- Armar plancha (additive service fee): cart-level toggle that ADDS a single "Armar plancha" service fee on top of the per-design subtotal. Final total = `sum(items.price * items.quantity) + planchaGroupingPrice`. Client sends `groupAsPlancha: boolean` to `/api/payments/mercadopago/preference` and `/api/payments/paypal/create-order`; the server fetches the plancha price from `app_settings` (never trusts client), adds it to the items subtotal, and persists `orders.is_plancha_grouped`. MP receives per-design line items plus a single `armar-plancha` service line so the gateway charges sum(items)+planchaPrice and the webhook amount-check still passes. Email + PDF render each design at its own price followed by a single "Armar plancha (N diseños)" service row (fee derived as `order.total - sum(items)` so historical totals stay consistent even if the live setting changes). Legacy orders persisted under the old replacement-model (where `order.total < sum(items)`) are detected automatically and rendered with the previous "Plancha agrupada (precio único)" headline + sub-rows so historical invoices remain coherent.
- Storefront "Plancha armada" category: products in this category appear ONLY in the dedicated `PlanchasArmadas` section between BestSellers and ProductGrid; they're filtered out of the main grid and category chips.

## Mercado Pago Webhook Setup

The API server validates every incoming MP webhook using HMAC-SHA256 before processing it.

**Webhook URL to register in Mercado Pago panel:**
```
https://{REPLIT_DOMAIN}/api/webhooks/mercadopago
```

**Steps to register:**
1. Log in to [mercadopago.com/developers](https://www.mercadopago.com/developers)
2. Go to **Tu negocio → Notificaciones → Webhooks → Configurar notificaciones**
3. Set the URL above and enable the **Pagos** event
4. Copy the generated **Secreto de webhook** ("Ver secreto")
5. Store it as the `MERCADOPAGO_WEBHOOK_SECRET` Replit secret

**How the signature is verified:**
- MP sends `x-signature: ts=<timestamp>,v1=<hmac-sha256>` and `x-request-id` on every webhook
- Server builds manifest: `id:<data_id>;request-id:<x-request-id>;ts:<ts>;`
- Computes `HMAC-SHA256(MERCADOPAGO_WEBHOOK_SECRET, manifest)` and compares using constant-time equality
- Returns **401** and logs a warning if the signature is missing or invalid; nothing is processed
- Returns **200** immediately after validation, then processes asynchronously

**Admin alert rate limit:** when an invalid signature is detected the server emails the admin, capped to a maximum number of alerts per hour to avoid spam during attacks. The cap defaults to **5** and can be overridden at runtime (no redeploy needed) via the `WEBHOOK_ALERT_MAX_PER_HOUR` Replit secret. Must be a positive integer; the API server throws at startup if the value is set but invalid.

## Webhook Security Events Cleanup

The `webhook_security_events` table only ever serves the latest 500 rows to the admin panel but grows on every rejected webhook, so it is trimmed on a schedule.

**Script:** `scripts/src/cleanupWebhookSecurityEvents.ts` — deletes every row whose `created_at` is older than the configured retention window and exits. Uses the same `DATABASE_URL` / `@workspace/db` pool as the rest of the workspace, and emits one JSON log line on start and one on done (with `deletedCount`).

**Run manually:**
```
pnpm --filter @workspace/scripts run cleanup-webhook-security-events
```

**Run on a schedule (production):** publish a Replit **Scheduled Deployment** with the command above, set to run **daily** (e.g. `0 4 * * *`). The deployment inherits `DATABASE_URL` and the optional retention secret automatically.

**Retention threshold:** defaults to **90 days**. Override at runtime — no redeploy needed — via the `WEBHOOK_SECURITY_EVENT_RETENTION_DAYS` Replit secret. Must be a positive integer (days); the script exits non-zero if the value is set but invalid.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
