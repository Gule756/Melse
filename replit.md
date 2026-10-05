# Melse Local Services

Melse helps people in Addis Ababa request trusted local professionals, see transparent ETB estimates, book service, and track the job.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run migrate` — apply checked-in PostgreSQL migrations
- `pnpm --filter @workspace/db run seed` — seed service categories, pricing, plans, and promotions
- `pnpm run test:api` — run API integration tests against `TEST_DATABASE_URL`
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — PostgreSQL connection string; the API checks connectivity before listening
- Initial admin provisioning: set `ADMIN_BOOTSTRAP_TOKEN` and call `/api/admin/bootstrap` once; it refuses to run after an administrator exists
- API test warning: `TEST_DATABASE_URL` must point to a dedicated disposable database with migrations already applied; the integration suite truncates its tables before each test

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/melse/src/App.tsx` — customer, technician, and admin web experiences
- `artifacts/melse/src/index.css` — shared visual language and responsive styling
- `artifacts/api-server/src/lib/auth.ts` — PostgreSQL-backed users, sessions, provider identity, and reset-token handling
- `artifacts/api-server/src/routes/melse.ts` — Melse REST endpoints
- `lib/db/src/schema/melse.ts` — Drizzle PostgreSQL schema
- `lib/db/drizzle/` — ordered PostgreSQL migrations
- `lib/api-spec/openapi.yaml` — source-of-truth API contract

## Architecture decisions

- Users, sessions, roles, provider profiles, skills, service categories, and pricing are persisted in PostgreSQL.
- Customer and provider roles may coexist on one account; active mode is persisted and cannot grant permissions.
- Provider self-registration creates a pending, unavailable profile. Only an admin can verify it; only a verified provider can become available.
- Password reset tokens are stored hashed and are one-time/expiring. A delivery adapter is not configured yet, so reset delivery is not operational.
- Booking status values are centralized as a domain union and accepted through the API contract.
- The payment surface is represented in booking state and UI, but no provider is claimed until a real Ethiopian payment integration is connected.

## Product

Customers can browse services, create requests with problem/location/urgency details, view ETB estimates, select verified technicians, book work, and track status. Technician and admin role views provide the first operational surfaces.

## User preferences

The product is Ethiopia-first: ETB pricing, Addis Ababa sample locations, mobile-first workflows, and trust signals are more important than feature count.

## Gotchas

- Use `migrate` for schema changes and run the idempotent SQL seed after migrations. `push` is intended for local development only.
- Never point `TEST_DATABASE_URL` at a shared or production database; integration tests deliberately clear test tables.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
