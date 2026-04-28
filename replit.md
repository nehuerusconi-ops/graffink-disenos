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

- `artifacts/api-server` — Express API: products CRUD + storage signed URLs, gated by `requireAuth` middleware that uses Clerk session.
- `artifacts/dreamstorm` — Vite React storefront in Argentine Spanish (voseo). Routes: `/` storefront, `/sign-in`, `/sign-up`, `/admin` (Clerk-protected admin panel for products).

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

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
