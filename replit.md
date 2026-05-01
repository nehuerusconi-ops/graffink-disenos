# Overview

This project is a pnpm workspace monorepo using TypeScript, designed for an e-commerce platform. It comprises an Express API server and a Vite React storefront. The platform focuses on selling custom design products, supporting product CRUD operations, order management, and secure object storage. A key feature is the "Armar plancha" (grouping designs) functionality, which allows customers to combine multiple designs into a single order with an additive service fee. The system handles various payment methods, including Mercado Pago and PayPal, with robust webhook validation and order confirmation processes, including PDF invoice generation and email notifications. The project aims to provide a comprehensive, localized e-commerce solution with a strong focus on security, administrative control, and user experience.

# User Preferences

- The agent should prioritize the use of pnpm for all package management operations within the monorepo.
- All code should be written in TypeScript, adhering to strict type-checking.
- The agent should ensure that any database interactions use Drizzle ORM.
- For API definitions, the agent must generate code from OpenAPI specifications using Orval.
- When making changes, the agent should confirm with the user before implementing major architectural shifts or external dependency introductions.
- The agent should provide detailed explanations for complex solutions or significant code changes.
- The agent should adhere to the existing monorepo structure and not introduce new root-level directories unless explicitly instructed.
- The agent should be mindful of the production-only nature of the Clerk frontend proxy and ensure development environments do not use it.
- The agent should respect the current localization (Argentine Spanish, voseo) of the storefront.
- Any modifications to payment methods or integrations should strictly follow security best practices, especially regarding webhook validation and secret management.

# System Architecture

## Monorepo Structure
The project is organized as a pnpm workspace monorepo.
- `artifacts/api-server`: Houses the Express.js API, managing product CRUD, orders, and storage signed URLs. It includes admin endpoints protected by Clerk session authentication.
- `artifacts/dreamstorm`: Contains the Vite React storefront, localized in Argentine Spanish, featuring routes for the storefront, sign-in/up, and an admin panel with sections for Designs, Earnings, and Billing.

## Technology Stack
- **Monorepo Tool**: pnpm workspaces
- **Node.js**: Version 24
- **TypeScript**: Version 5.9
- **API Framework**: Express 5
- **Database**: PostgreSQL with Drizzle ORM
- **Validation**: Zod (v4) with `drizzle-zod`
- **API Codegen**: Orval (from OpenAPI spec)
- **Build Tool**: esbuild (CJS bundle)
- **Authentication**: Clerk (`@clerk/express` for server, `@clerk/react` v6 for client)
- **Object Storage**: Replit App Storage (backed by Google Cloud Bucket)

## Feature Specifications
- **Product Management**: Public API for listing products, admin-only endpoints for category management (add/delete, system-flagged categories, automatic filter updates in UI).
- **Order Processing**: Auto-incrementing invoice numbers, JSONB item snapshots, total in ARS pesos, various payment methods (Mercado Pago, Transferencia, PayPal), and optional customer DNI/CUIT.
- **Admin Panel**:
    - **Earnings Tab**: Displays KPIs, 30-day charts, top products, and revenue by method.
    - **Billing Tab**: Lists orders, provides printable HTML invoices and downloadable PDF comprobantes (Argentine "Factura B/C" style), with date range filters and quick-range buttons.
    - **Settings Tab**: Allows editing of catalog categories and `plancha_grouping_price` for "Armar plancha" functionality.
- **Image Uploads**: Admin users can request signed PUT URLs from the API to upload images directly to GCS, with object paths rendered via the API.
- **Payment Flows**:
    - **Mercado Pago**: Uses webhooks for payment confirmation, with robust HMAC-SHA256 signature validation and asynchronous processing.
    - **PayPal**: Handles order creation and capture, with a public endpoint for exchange rate disclosure. Supports live and sandbox modes, configurable via environment variables with safety checks.
    - **Bank Transfer (Transferencia bancaria)**: Provides hardcoded CVU and holder info for manual transfers, with admin confirmation.
- **"Armar Plancha" Functionality**:
    - Cart-level toggle for an additive service fee.
    - Server-side price calculation and persistence of `is_plancha_grouped`.
    - Distinct handling for confirmation emails and fulfillment process (e.g., "En preparación" badge for buyers, admin alert email for manual assembly).
    - Dedicated storefront section for "Plancha armada" products.
- **Email Notifications**: `sendOrderConfirmation` for buyers (with PDF attachment), BCCs store inbox. `sendPlanchaAssemblyAlertEmail` for admin for grouped orders.
- **PDF Generation**: Uses PDFKit with `fontkit` for creating paginated PDF invoices with repeated table headers.
- **Security & Validation**:
    - DNI/CUIT validation (`isValidDniOrCuit`) implemented on both API and storefront.
    - Webhook security event logging and cleanup mechanism with configurable retention.
    - Rate limiting for admin alerts on invalid webhook signatures. The per-hour quota is enforced against the `webhook_alert_log` table; rows are pruned inline by `tryConsumeAlertSlot` on every alert attempt and additionally swept by a daily background job (`startWebhookAlertLogCleanupJob`, started from `artifacts/api-server/src/index.ts`) that runs once on server startup and then every 24h to evict stale rows during quiet stretches.
- **UI/UX**:
    - Storefront design in Argentine Spanish (voseo).
    - Consistent header branding ("GraffInk Diseños").
    - Cart quantity steppers with per-line subtotals and unit prices.
    - Product details dialog with description and specifications grid.
    - Public contact email `graffink.design@gmail.com` displayed in footer and `CustomDesign.tsx`.

# External Dependencies

- **Mercado Pago**: For payment processing and webhooks. Requires `MERCADOPAGO_WEBHOOK_SECRET` for validation.
- **PayPal**: For payment processing. Requires `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `VITE_PAYPAL_CLIENT_ID`, and `PAYPAL_MODE` for configuration.
- **Clerk**: For authentication and user management (`@clerk/express`, `@clerk/react`).
- **Google Cloud Bucket (via Replit App Storage)**: For object storage.
- **PostgreSQL**: Database backend.
- **Drizzle ORM**: Database interaction layer.
- **Express.js**: API framework.
- **Vite**: Frontend build tool.
- **React**: Frontend library.
- **Zod**: Schema validation.
- **Orval**: API client and schema generation.
- **esbuild**: JavaScript bundler.
- **PDFKit & Fontkit**: For PDF generation.
- **Nodemailer**: For sending emails (implied by email sending functionality).