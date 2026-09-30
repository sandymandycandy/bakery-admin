# Handover — Auri Bakery order management

Date: 2026-09-30 (first written 2026-09-27). Read this first, then [TODO.md](TODO.md) ("Start here"), [PRD.md](PRD.md), and [PROJECT_RULES.md](PROJECT_RULES.md).

## 1. Where things stand

| Phase | State | What exists |
|---|---|---|
| 0–2 Planning | Mostly done | PRD v0.3, rules, TODO. Many business decisions still open (PRD section 14). |
| 3 Foundation | **Done** | Staff login, roles, kitchens, products/variants/categories, settings, audit log. Chef PIN sign-in **not built**. |
| 4A Orders | **Done** | In-store and call orders, two order lists, order detail, confirm/reject/cancel/reschedule, payments and refunds, calendar, opening hours and closures, customers. |
| 4B Billing | **Done** | Counter quick sale, discounts, GST bills (gap-free per financial year), credit notes, 80mm and A4 print. |
| 4C | **In progress** | Done: pickup windows, category caps, festival overrides, shared override prompt, calendar week and day views (day view grouped by pickup window), demo-login autofill, customer blocking and no-shows (section 9), editing items on pending and confirmed orders (section 10). Left: notification templates (blocked on owner decisions). None of 4C has been clicked through in a browser. See TODO "Phase 4C". |
| 5 KOT / chef | Not started | Kitchen tickets, chef queue, packing, handover. The `/kitchen` page is a placeholder. |
| 6 Public website | Not started | Deferred by the owner ("leave the public page for now"). |
| 7–9 | Not started | Reports, rehearsal, launch, Release 1.1 exceptions. |

The database currently holds **no products, orders, or bills**. The only staff account is **Demo Admin**. The first real order will be **B-1001** and the first bill **AB/2026-27/00001**.

## 2. Accounts and access

| What | Where |
|---|---|
| Supabase project | `auri-bakery`, ref `hljkydruionasnouyrpu`, region ap-south-1 (Mumbai), in the owner's Supabase organisation. Ask the owner to invite you. |
| Demo admin login | `demo@auri.test`. The password is in `web/.admin-password.txt` on the owner's machine; it is git-ignored. Get it from the owner privately. `@auri.test` cannot receive emails, so create a real admin before go-live and disable this one. |
| Demo chef login | **Not created yet.** Needs the secret key, then `npm run create-admin -- --email chef@auri.test --name "Demo Chef" --role chef` (chefs are assigned to every kitchen). |
| Demo-login autofill | `/login` pre-fills the demo logins while `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD` (and `DEMO_CHEF_*`) are set, with a switch when both are set. **The owner chose to allow this in production.** Anyone who opens the site is then pre-filled as admin on the live database. **Not set anywhere yet** (neither `web/.env.local` nor Vercel). Delete the variables and redeploy to turn it off; do so before real data goes in. |
| Secret key | **Not configured.** Copy it from Supabase → Project Settings → API Keys into `web/.env.local` as `SUPABASE_SECRET_KEY`. Without it, Staff & Kitchens is read-only (no creating logins or resetting passwords). Never commit it. |
| Publishable key and URL | Already in `web/.env.local` (safe for browsers). `web/.env.example` documents all variables. |
| Hosting | Vercel project `bakery-admin` (team "sandymandycandy's projects"), root `web/`, production at **https://bakery-admin-ten.vercel.app** (last deployed 2026-09-30 from `main`, commit `0a896cd`, with customer blocking, no-shows and item editing). Deployed with `vercel deploy --prod` from `web/`; **Git integration is not connected**, so pushes do not deploy. `web/vercel.json` pins the Next.js preset (without it the site served only 404s). Production env vars: the Supabase URL and publishable key only. |
| Version control | GitHub: `sandymandycandy/bakery-admin`. `main` holds all work; the `phase-4c-capacity` and `phase-4c-calendar` branches are merged and pushed. Secrets (`web/.env.local`, `web/.admin-password.txt`) are git-ignored and must be shared separately. |

## 3. Running it

```bash
cd web
npm install
npm run dev            # http://localhost:3000 → redirects to /login
npm run typecheck      # next typegen + tsc
npm run lint
npm test               # unit tests (Node's built-in runner, src/**/*.test.ts)
npm run build
npm run create-admin -- --email you@example.com --name "Your Name" [--role admin|counter|chef]   # needs SUPABASE_SECRET_KEY
```

Node 22 is used (22.18+ runs the `.ts` tests directly). There is no Docker, so there is no local Supabase; the app talks to the hosted project.

**If `npm run dev` returns 500 on every page** with a Turbopack panic about `globals.css` (`node process exited … 0xc0000142`), start with `npx next dev --webpack` instead. This happened from a sandboxed agent shell on the owner's machine; it may not affect a normal terminal. Production builds on Vercel are unaffected. There is no Docker, so there is no local Supabase; the app talks to the hosted project.

**Next.js 16 is newer than most training data and tutorials.** `web/AGENTS.md` points to the bundled docs in `web/node_modules/next/dist/docs/`. Notable differences: `middleware.ts` is now `src/proxy.ts`; `params`/`searchParams` are Promises; `PageProps<"/route">` and `LayoutProps` are global types generated by `next typegen`.

## 4. Architecture

```
auri bakery/
├── PRD.md, TODO.md, PROJECT_RULES.md, HANDOVER.md, README.md
├── la pater/                  original static prototype (reference only; do not modify)
├── supabase/
│   ├── migrations/            schema, in order (applied to the live project)
│   └── tests/                 SQL rule checks (run in a transaction, then rolled back)
└── web/                       Next.js 16 app (App Router, Tailwind v4, zod)
    ├── src/proxy.ts           session refresh; signed-out users → /login
    ├── src/lib/               auth, Supabase clients, money, time zone, order helpers, DB types
    ├── src/app/login          staff sign-in
    ├── src/app/admin/...      admin and counter screens
    ├── src/app/kitchen        chef landing (placeholder until Phase 5)
    ├── src/app/print/...      printable bill and credit note
    └── scripts/               create-admin, e2e/
```

### How writes work (important)

- **Catalogue, staff, settings, hours, and closures** are written directly through Supabase with row-level security (RLS). Only admins can write.
- **Orders, payments, bills, and credit notes can only be written through Postgres functions**: `create_order`, `confirm_order`, `reject_order`, `cancel_order`, `reschedule_order`, `update_order_items`, `record_payment`, `apply_discount`, `issue_bill`, `issue_credit_note`, `counter_sale`. Staff have **no insert or update grants** on those tables. Each function:
  - checks the caller's role itself;
  - validates everything (availability, opening hours, lead time, kitchen mapping, amounts);
  - takes an **idempotency key**, so retries never duplicate anything;
  - takes the order **version**, so concurrent edits fail with a "conflict" instead of overwriting;
  - writes an `order_events` timeline row.
- The functions are `SECURITY DEFINER` in `public`. The Supabase advisor warns about this; it is intentional (they are the only write path and each checks the role). Helpers live in the unexposed `private` schema.
- Errors use `private.fail(message, kind)`. The message is written for staff; `kind` travels in the Postgres `hint` field (`slot`, `lead_time`, `capacity`, `conflict`, `forbidden`, `unmapped`, `billed`, …). `web/src/lib/orders.ts → rpcError` maps them to UI behaviour; `slot`, `lead_time`, `blocked` and `capacity` show the shared `OverridePrompt`, where admins retry with a reason (at least 5 characters, also checked in the database).
- Every table has an audit trigger (`audit_events`: who, what, before, after).

### Invariants — do not break

- Money is **integer paise** everywhere. Prices are **GST-inclusive**; tax is the included portion per line.
- Order lines are **snapshots**: catalogue edits never change existing orders.
- All scheduling uses the **business timezone** from `business_settings` (Asia/Kolkata). Convert with `web/src/lib/time.ts`; never use the server's or browser's zone.
- Payments are an **append-only ledger**: corrections are refunds. Bills and credit notes are **immutable**, and bill numbers are **gap-free per financial year** (April–March) via `document_sequences`. A billed order cannot be cancelled until fully credited.
- Chefs see **no orders, payments, or customer data**. Phase 5 must expose kitchen tickets through their own RLS-protected tables.
- Balances come from the `order_summaries` view: total − credit notes − payments + refunds. Cancelled and rejected orders charge nothing, so a negative balance means a refund is due.

### Database migrations

Files in `supabase/migrations/` were applied to the live project in order through the Supabase MCP server. The CLI is not linked. To continue:

- Install the Supabase CLI and run `supabase link --project-ref hljkydruionasnouyrpu`. Check that the remote migration history matches the files (names: `foundation`, `orders`, `billing`, `bill_gst_split_per_rate`, `bill_gst_split_integer_division`, `counter_sale_precheck`, `capacity`, `capacity_enforcement`, `capacity_review_fixes`, `no_shows`, `edit_order_items`).
  - The last GST-split fix was applied as `bill_gst_split_integer_division`, but its file is `20260927000310_bill_gst_split_per_rate.sql` (the file already contains the fixed version). Reconcile the history names when linking.
- New tables in `public` get full API access by default in Supabase. Every migration so far **revokes** that and grants only what is needed; keep doing this, and enable RLS on every table.
- After schema changes, regenerate `web/src/lib/database.types.ts` (`supabase gen types typescript`). The current file was condensed by hand from generated output (order tables are marked `Insert: never`); the Phase 4C tables and functions were added by hand in the same shape. Replacing it with fully generated types is fine.
- Run the security and performance advisors after each migration.

## 5. Tests

| Test | How to run | Last result |
|---|---|---|
| `supabase/tests/rls_foundation.sql` | Paste into the Supabase SQL editor | 13/13 |
| `supabase/tests/orders_logic.sql` | SQL editor | 22/22 |
| `supabase/tests/billing_logic.sql` | SQL editor | all pass (includes the per-rate CGST/SGST check); rerun 2026-09-28 after 4C: unchanged |
| `supabase/tests/capacity_logic.sql` | SQL editor | 29/29 (2026-09-28): windows, boundaries, caps, festival overrides, override reasons, confirm ranking, availability, per-day lock |
| `supabase/tests/no_show_logic.sql` | SQL editor | 26/26 (2026-09-30): roles, status and pickup-time rules, once per order, version conflict, undo, block/unblock reasons and history, blocked phone refused, no direct writes. Inserts its orders with numbers from 990001, so it does not consume `order_number_seq`. |
| `supabase/tests/edit_items_logic.sql` | SQL editor | 21/21 (2026-09-30): roles and statuses, kept price vs today's price, add/remove/quantity/notes, lead time and category caps on what the edit adds, overrides, billed orders refused, discount capped, version conflicts, timeline. Orders from 990101. |
| `web/src/lib/capacity.test.ts` | `npm test` | 4/4 (2026-09-29): order-to-pickup-window matching used by the calendar day view (mirrors `private.window_for`) |
| `web/scripts/e2e/orders-4a.mjs` | Build, run `npm start -- -p 3100`, create QA users (`supabase/tests/qa_users.sql`), then `QA_PW=... npm run e2e:orders` | 29/29 |
| `web/scripts/e2e/billing-4b.mjs` | Same setup, `npm run e2e:billing` | 17/19. The 2 failures were test-script issues (assertions depend on leftover data); the app behaviour was confirmed correct. Fix the assertions before relying on it. |

Caveats:
- SQL tests roll back, but they **consume order numbers** (`order_number_seq` is not transactional). Reset it with `alter sequence public.order_number_seq restart with 1001` **only while no real orders exist**.
- The e2e scripts **commit data**. Run them against staging. Never run successful counter sales or bill issuing on the live project after launch: bills are permanent and consume real numbers.
- **Nobody has clicked through the UI in a browser yet** (including Settings → Capacity, the pickup-window panel, the calendar week/day views, and the login autofill). All checks so far are SQL-, HTTP-, typecheck- and build-level. Do a full manual pass first; consider adding Playwright. With an empty database most screens show only empty states, so the pass really needs staging data.
- Timezone helpers were checked with a small script (9/9). Unit tests now run with `npm test`, but only the capacity helper has any.

## 6. Defaults chosen (owner has not confirmed)

| Default | Where to change |
|---|---|
| Business name "Auri Bakery" (prototype says "La Patisserie Madras") | Settings |
| Kitchen 1 / Kitchen 2 | Staff & Kitchens |
| Prices include GST; intra-state CGST/SGST split | Code (migrations 0200/0300) |
| Opening hours 9 AM–9 PM every day | Settings → Opening hours |
| Bill prefix `AB`; counter staff discount limit 10% | Settings |
| Counter staff can confirm in-store orders; only admins confirm call orders, reject, cancel, reschedule, refund, or issue credit notes | Migrations (role checks in functions) |
| Pickup only; manual payment recording; no stock counts | PRD section 2 |

Business decisions still needed are listed in PRD section 14 and TODO Phase 0. The most urgent are: GSTIN/FSSAI/tax rates (check with the accountant), the real product list with kitchen mapping, opening hours, and the notification channel.

## 7. Known gaps and risks

- No staging environment. The production deployment talks to the only (live) Supabase project.
- If the demo-login variables are ever set on Vercel, the public site pre-fills an admin login for the live database (owner's choice). Remove them before real orders exist.
- No browser click-through; print layouts have not been checked with a real bill on a real 80mm printer.
- Placeholder pages: KOT, Reports, Kitchen.
- Not built yet: chef PIN sign-in on tablets (AC-34); ready-stock stock counts (blocked on PRD decision 7).
- `next start` warns about `outputFileTracingRoot` (multiple lockfiles detected on the machine). This is harmless locally; set `outputFileTracingRoot` in `next.config.ts` if it matters for deployment.
- The Supabase free plan allows two active projects, and the owner already has one other active project. A staging project may require pausing a project or upgrading.

## 8. Suggested order of work

1. Clone the repo, add the secret key, walk through every screen in a browser (locally or on the Vercel URL), and fix anything found.
2. Staging project; rerun all SQL and e2e tests there. Consider pointing a Vercel preview environment at it.
3. Finish Phase 4C: notification templates once the owner picks the channel.
4. Phase 5 KOT and chef workflow (read section 10 first): ticket tables with kitchen-scoped RLS, scheduled release via `pg_cron`, Supabase Realtime for the chef screen, packing and handover (which should mark orders completed and auto-issue bills).
5. Chef PIN sign-in (Phase 3 leftover), then Reports (Phase 7), then the public website (Phase 6) when the owner is ready.

## 9. Customer blocking and no-shows (built 2026-09-30)

Agreed with the owner on 2026-09-29; built 2026-09-30 (migration `20260930000100_no_shows.sql`, applied to the live project). Not yet clicked through in a browser. PRD 5F "Spam and no-show protection". The `customers` table already has `no_show_count`, `is_blocked` and `blocked_reason`, and `create_order` already refuses blocked phones without an admin override.

- **Owner's decision:** recording a no-show does **not** change the order's status. Staff cancel or complete the order separately.
- **Migration:**
  - `orders.no_show_at` and `orders.no_show_by`, so each order counts at most once.
  - `record_no_show(order)` for admin and counter: only for orders with a customer, past their pickup time, in confirmed/preparing/ready/cancelled. It adds one to `no_show_count` and writes an `order_events` row.
  - `undo_no_show(order, reason)`, admin only.
  - `set_customer_blocked(customer, blocked, reason)`, admin only, with a reason required both ways.
  - Added while building: a `customer_events` table (read-only for admin and counter) that keeps every block and unblock with its reason, because `customers.blocked_reason` holds only the current one.
  - Both no-show functions take the order version and bump it, like the other order writes.
  - Same conventions as the other write functions: security definer, role check, `private.fail`, revoke/grant.
- **Screens:**
  - Customer detail page `/admin/customers/[id]`: flags, block/unblock with reason, order history with no-shows marked.
  - Order detail: "Blocked" and "N no-shows" badges next to the customer, a **Record no-show** button, and **Undo** for admins.
  - New-order form: a warning under the phone field when the number belongs to a blocked customer or one with no-shows (`src/components/customer-warning.tsx`).
  - `order_summaries` was created with `o.*` before these columns existed, so the order page reads `no_show_at`/`no_show_by` from `orders` directly.
- **Tests:** SQL checks in a rolled-back transaction. Give test orders an explicit high `order_number` so the live `B-1001` sequence is not consumed.

## 10. Editing items on an order (built 2026-09-30)

Migration `20260930000200_edit_order_items.sql` (applied to the live project); `update_order_items(order, version, lines, reason, override_reason)`. The order page shows **Edit items** in the Items card.

- **Who and when:** admin and counter staff on draft and pending orders; admins only on confirmed orders, with a required reason. Never on preparing, ready or closed orders, or once a GST bill exists (credit note instead).
- **Lines:** the function takes the full new list. Existing lines (`line_id`) keep their price snapshot and change only quantity and notes; new lines (`variant_id`) take today's catalogue price; lines left out are deleted (the audit log keeps them).
- **Checks, only on what the edit adds:** availability of new or increased items (not overridable, as in `create_order`); preparation time of new or increased made-to-order items; daily caps for categories the order did not have before, counted against every other order under the same per-day lock as `capacity_problem`. A kitchen must be mapped before a made-to-order item is added to a confirmed order. Lead-time and cap refusals can be overridden by an admin with a reason.
- **Money:** totals are recalculated with `recalc_order_totals`. A discount keeps its rupee amount, capped at the new subtotal. Overpayments show the existing "Refund due" alert.
- **Timeline:** one `items_changed` event with each change (`from`/`to` quantities, notes changes) and the old and new totals.
- **Phase 5 must change this function:** once kitchen tickets exist, edits to released lines must produce kitchen-acknowledged ticket revisions (AC-12), and reductions of released lines must use `cancelled_quantity` instead of deleting rows.
- The product search and quantity controls are shared with the new-order form (`src/components/catalogue-picker.tsx`, `src/lib/catalogue.ts`).
