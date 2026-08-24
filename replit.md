# Melse Local Services

Melse helps people in Addis Ababa request trusted local professionals, see transparent ETB estimates, book service, and track the job.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/melse/src/App.tsx` — customer, technician, and admin web experiences
- `artifacts/melse/src/index.css` — shared visual language and responsive styling
- `artifacts/api-server/src/lib/melse-store.ts` — isolated MVP service catalog and in-process domain state
- `artifacts/api-server/src/routes/melse.ts` — Melse REST endpoints
- `lib/api-spec/openapi.yaml` — source-of-truth API contract

## Architecture decisions

- The MVP keeps the managed-service loop short: request, estimate, verified technician, booking, tracking.
- Booking status values are centralized as a domain union and accepted through the API contract.
- The payment surface is represented in booking state and UI, but no provider is claimed until a real Ethiopian payment integration is connected.

## Product

Customers can browse services, create requests with problem/location/urgency details, view ETB estimates, select verified technicians, book work, and track status. Technician and admin role views provide the first operational surfaces.

## User preferences

The product is Ethiopia-first: ETB pricing, Addis Ababa sample locations, mobile-first workflows, and trust signals are more important than feature count.

## Gotchas

The current MVP store is intentionally isolated in the API layer; replace it with the normalized database modules before treating the app as production-ready.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
