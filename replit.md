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
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Notes

- The Clerk frontend proxy at `/api/__clerk` is **production-only**; in development the React client must NOT pass `proxyUrl` (it talks to `*.clerk.accounts.dev` directly via the publishable key).
- Storefront product data is fetched from `GET /api/products` via the generated `useListProducts` hook; the static `PRODUCTS` constant in `src/data/products.ts` is kept only for the `Product`/`Category` types.
- Admin uploads call `POST /api/storage/uploads/request-url` (auth-gated) for a signed PUT URL, then upload directly to GCS. Returned `objectPath` (e.g. `/objects/uploads/xxxx`) is rendered through `/api/storage{objectPath}`.
- Orders: `orders` table has auto-incremented `invoice_number` (`serial`) for facturación, jsonb `items` snapshot, total in ARS pesos (integer), `payment_method` enum (mercadopago | uala | paypal), and nullable `customer_dni text` (DNI 7-8 digits or CUIT 11 digits). Checkout collects customer name + email + optional DNI/CUIT then POSTs to `/api/payments/*`. Admin "Ganancias" tab calls `/api/orders/stats` for KPIs + 30-day chart + top products + revenue-by-method. Admin "Facturación" tab lists orders with a printable HTML invoice + a downloadable PDF comprobante (Argentine non-fiscal "Factura B/C" style) for paid orders.
- Admin tab components live in `artifacts/dreamstorm/src/pages/admin/{ProductsTab,SalesTab,InvoicesTab}.tsx`.
- PDF invoice: `artifacts/api-server/src/lib/pdfInvoice.ts` builds a paginated PDF (PDFKit) with repeated table header on overflow. Attached to confirmation email and served via `GET /api/orders/:id/invoice-pdf` (admin-only, paid-only). `pdfkit` and `fontkit` are in esbuild externals (build.mjs) because fontkit dynamic-requires `@swc/helpers`.
- DNI/CUIT validation: `artifacts/api-server/src/lib/dniCuit.ts` exports `isValidDniOrCuit` (DNI 7-8 OR CUIT 11 with mod-11 checksum). Applied in `payments.ts` zod refinement and in `orders.ts` admin POST.
- PayPal exchange-rate disclosure: `GET /api/payments/paypal/rate` is **public** (returns `{ arsToUsd, source, cachedAt }`). The `CheckoutDialog` fetches it on entering the payment / paypal-buttons step and shows the buyer the equivalent USD amount and the rate used before they confirm the PayPal payment. The same endpoint also powers the admin Settings tab.

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

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
