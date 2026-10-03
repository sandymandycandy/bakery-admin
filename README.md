# Auri Bakery — order and kitchen management

**New here? Start with [HANDOVER.md](HANDOVER.md).**

Planning documents: [PRD.md](PRD.md), [TODO.md](TODO.md), [PROJECT_RULES.md](PROJECT_RULES.md).

Status (2026-10-03): Phases 3, 4A and 4B are built (staff login, catalogue, orders, calendar, payments, counter sale, GST bills). Phase 4C is done except notification templates. Phase 5A (kitchen tickets, chef screen, KOT) is built and deployed. Phase 5B (packing and handover) and the 5A review fixes are in `main` with their database migrations applied; `main` deploys to Vercel on every push (Git integration, connected 2026-10-03). Production: https://bakery-admin-ten.vercel.app. See [HANDOVER.md](HANDOVER.md).

`la pater/` is the original static prototype, kept as reference.

## Structure

- `web/` — Next.js 16 app (App Router, Tailwind v4) for the admin and kitchen screens.
- `supabase/migrations/` — database schema, applied to the Supabase project `auri-bakery` (ap-south-1).
- `supabase/tests/` — SQL rule checks (access, orders, billing, capacity, no-shows, item edits, kitchen tickets, packing and handover) that run inside a rolled-back transaction, plus QA-user setup for end-to-end scripts.
- `supabase/local/` — runs those checks on a scratch local PostgreSQL, without touching the Supabase project.
- `docs/superpowers/` — design specs and implementation plans for recent work.
- `web/scripts/e2e/` — end-to-end checks through the real server actions (run against staging).

## Running locally

```bash
cd web
npm install
# web/.env.local already has the project URL and publishable key.
# Add SUPABASE_SECRET_KEY (Supabase → Project Settings → API Keys) to manage staff logins.
npm run create-admin -- --email you@example.com --name "Your Name"
npm run dev
```

Open http://localhost:3000 — it redirects to the staff sign-in page.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

SQL rule checks, on a local PostgreSQL 16+ where you are a superuser (no Supabase needed):

```bash
supabase/local/run-tests.sh
supabase/local/concurrency-kitchen.sh
```

After changing the schema, update `web/src/lib/database.types.ts` and rerun the SQL checks. See HANDOVER.md sections 3 and 5 for details, the end-to-end scripts and their caveats.

## Roles

| Role | Lands on | Can |
|---|---|---|
| Admin | `/admin` | Everything, including confirming call orders, cancel, reschedule, refunds, credit notes, staff, settings |
| Counter staff | `/admin` | Take in-store and call orders, confirm walk-ins, record payments, counter sales, issue bills, discounts up to the limit, pack and hand over orders (handing over with a balance due needs an admin) |
| Chef | `/kitchen` | Only their assigned kitchens' tickets: acknowledge, start, mark ready, report issues, print |

Access is enforced by Postgres row-level security, not just by hiding screens.
