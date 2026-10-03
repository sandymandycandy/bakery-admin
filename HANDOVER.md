# Handover — Auri Bakery order management

Date: 2026-10-03 (first written 2026-09-27). Read this first, then [TODO.md](TODO.md) ("Start here"), [PRD.md](PRD.md), and [PROJECT_RULES.md](PROJECT_RULES.md). Designs and plans for recent work are in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

**Latest work** (the 5A review fixes, Phase 5B packing and handover, and a local SQL test runner) was built on branch `claude/exciting-goldberg-09thku` and **merged into `main` on 2026-10-03**. Its database migrations are applied to the live project. Vercel's Git integration was connected the same day, so pushes to `main` now deploy to production (section 2). Confirm the 5B defaults (section 6).

## 1. Where things stand

| Phase | State | What exists |
|---|---|---|
| 0–2 Planning | Mostly done | PRD v0.3, rules, TODO. Many business decisions still open (PRD section 14). |
| 3 Foundation | **Done** | Staff login, roles, kitchens, products/variants/categories, settings, audit log. Chef PIN sign-in **not built** (now Phase 5D). |
| 4A Orders | **Done** | In-store and call orders, two order lists, order detail, confirm/reject/cancel/reschedule, payments and refunds, calendar, opening hours and closures, customers. |
| 4B Billing | **Done** | Counter quick sale, discounts, GST bills (gap-free per financial year), credit notes, 80mm and A4 print. |
| 4C | **Done except notifications** | Pickup windows, category caps, festival overrides, shared override prompt, calendar week/day views, demo-login autofill, customer blocking and no-shows (section 9), editing items on pending and confirmed orders (section 10). Left: notification templates (waiting for the owner to choose a channel). |
| 5A Kitchen tickets | **Done and deployed** (2026-10-03) | Tickets per kitchen on confirmation, chef screen, ready counts, issues, stop-work, printed ticket, admin KOT page, kitchen badges (section 11). The minor items from its review were fixed on 2026-10-03 (section 12): database part applied to the live project, web part in `main`. |
| 5B Packing and handover | **Built and tested** (2026-10-03), in `main` | One packing confirmation → Ready; one handover → Completed, with the balance check and a GST bill; admin reopen and credit handover (section 13). Database part applied to the live project; web part in `main`, deployed by the Git integration (section 2). **Defaults need the owner's confirmation** (section 6). |
| 5C Kitchen revisions | **Built, reviewed and deployed** (2026-10-03), in `main` | Admins change items and the pickup time after the kitchen acknowledged or started: tickets revised in place (ready counts kept), a Changed banner the kitchen acknowledges, packing waits for it (section 14). Database part (migrations `20261003000300` and the review fixes `20261003000400`) applied to the live project. |
| 5D | Not started | Chef PIN sign-in on tablets. |
| 6 Public website | Not started | Deferred by the owner ("leave the public page for now"). |
| 7–9 | Not started | Reports, rehearsal, launch, Release 1.1 exceptions. |

**Nothing has been clicked through in a browser yet.** Every check so far is SQL-, typecheck-, lint-, unit-test- and build-level. This is the biggest risk; see section 8.

The database holds **no products, orders, or bills**: two placeholder kitchens and one staff account, **Demo Admin** (no chef yet). The order number sequence was reset on 2026-10-03, so the first real order will be **B-1001**; the first bill will be **AB/2026-27/00001** (bill numbering is transactional and was never consumed). Run the SQL tests locally (section 5), not on the live project: the older test files consume order numbers there.

### Owner decisions to keep in mind

- **No stock or inventory tracking** (owner, 2026-10-02). Ready-stock items are sold without counts or allocation records. Do not design stock counts into any phase, including 5B packing.
- **Kitchen tickets go to the kitchen as soon as an order is confirmed** (no scheduled release).
- **Recording a no-show never changes the order's status.**
- **Changes after the kitchen acknowledged** (owner, 2026-10-03): the ticket keeps its status and ready counts and shows the exact changes, which the kitchen acknowledges; packing waits for that. Lowering a quantity below what is already made caps the ready count; nothing records the extra (no waste or counter-sale record).

## 2. Accounts and access

| What | Where |
|---|---|
| Supabase project | `auri-bakery`, ref `hljkydruionasnouyrpu`, region ap-south-1 (Mumbai), in the owner's Supabase organisation. Ask the owner to invite you. |
| Demo admin login | `demo@auri.test`. The password is in `web/.admin-password.txt` on the owner's machine; it is git-ignored. Get it from the owner privately. `@auri.test` cannot receive emails, so create a real admin before go-live and disable this one. |
| Demo chef login | `chef@auri.test`, created 2026-10-03, assigned to Kitchen 1 and Kitchen 2. The password is in `web/.admin-password.txt` (git-ignored) and in `web/.env.local` as `DEMO_CHEF_*` (so local `/login` shows a Demo chef button). Not yet on Vercel. |
| Demo-login autofill | `/login` pre-fills the demo logins while `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD` (and `DEMO_CHEF_*`) are set. **The owner chose to allow this in production.** Anyone who opens the site is then pre-filled as admin on the live database. **Not set anywhere yet.** Delete the variables and redeploy to turn it off; do so before real data goes in. |
| Secret key | **Configured in `web/.env.local`** (2026-10-03). It was shared in a chat session, so **rotate it before go-live** (Supabase → API Keys) and update `.env.local`. Earlier note: Copy it from Supabase → Project Settings → API Keys into `web/.env.local` as `SUPABASE_SECRET_KEY`. Without it, Staff & Kitchens is read-only (no creating logins or resetting passwords). Never commit it. |
| Publishable key and URL | Already in `web/.env.local` (safe for browsers). `web/.env.example` documents all variables. |
| Hosting | Vercel project `bakery-admin` (team "sandymandycandy's projects"), root `web/`, production at **https://bakery-admin-ten.vercel.app**. **Git integration connected 2026-10-03:** pushes to `main` deploy to production; other branches get preview deployments. The first Git deployment (2026-10-03) built nothing and served 404s until the project's **Root Directory was set to `web`** (done 2026-10-03, with framework Next.js). **The 5C merge push (`9ab84fc`) did not start a deployment**; it was deployed by hand through the API (`POST /v13/deployments` with `gitSource` for `main`). After a push, check `vercel ls` (from `web/`) shows a new Production deployment; if not, check the GitHub app connection in the Vercel dashboard. Production env vars: the Supabase URL and publishable key, plus `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD` (set 2026-10-03; they show a "Demo admin" fill button on `/login`; delete them before real data). Before that, deploys were manual (`vercel deploy --prod` from `web/`; the last one was `be85d89`); once Root Directory is `web`, run manual CLI deploys from the repository root. `web/vercel.json` pins the Next.js preset (without it the site served only 404s). |
| Version control | GitHub: `sandymandycandy/bakery-admin`. `main` holds all work, including Phase 5B (branches `phase-5a-kitchen-tickets`, `phase-5a-review-fixes` and `claude/exciting-goldberg-09thku` are merged). Secrets (`web/.env.local`, `web/.admin-password.txt`) are git-ignored and must be shared separately. |


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

The SQL rule checks do not need the hosted project. On any PostgreSQL 16+ where you are a superuser:

```bash
supabase/local/run-tests.sh                  # every check file (or name some: run-tests.sh packing_logic)
supabase/local/concurrency-kitchen.sh        # two-session lock-order check
```

**No PostgreSQL on the machine?** `supabase/local/pglite/` runs the same checks on PGlite (Postgres compiled to WebAssembly, in Node): `cd supabase/local/pglite && npm install && node run.mjs [names…]`. It needs Python for `check_results.py`. The 2026-10-03 5C results come from it; it reproduces every earlier result.

`run-tests.sh` builds a scratch database from `supabase/local/shim.sql` (stand-ins for Supabase's `auth` schema and API roles) plus every migration, runs each `supabase/tests/*.sql`, and compares every outcome with the file's `-- expect:` comments. Checks without a machine-checkable expectation (most of `orders_logic` and `billing_logic`) are printed for a person to read.

**If `npm run dev` returns 500 on every page** with a Turbopack panic about `globals.css` (`node process exited … 0xc0000142`), start with `npx next dev --webpack` instead. This happened from a sandboxed agent shell on the owner's machine; it may not affect a normal terminal. Production builds on Vercel are unaffected.

**Next.js 16 is newer than most training data and tutorials.** `web/AGENTS.md` points to the bundled docs in `web/node_modules/next/dist/docs/`. Notable differences: `middleware.ts` is now `src/proxy.ts`; `params`/`searchParams` are Promises; `PageProps<"/route">` and `LayoutProps` are global types generated by `next typegen`. The `react-hooks/purity` lint rule rejects `Date.now()` during render.

## 4. Architecture

```
auri bakery/
├── PRD.md, TODO.md, PROJECT_RULES.md, HANDOVER.md, README.md
├── docs/superpowers/          specs and implementation plans for recent work
├── la pater/                  original static prototype (reference only; do not modify)
├── supabase/
│   ├── migrations/            schema, in order (applied to the live project)
│   ├── tests/                 SQL rule checks (run in a transaction, then rolled back)
│   └── local/                 runs the checks on a scratch local PostgreSQL (no Supabase needed)
└── web/                       Next.js 16 app (App Router, Tailwind v4, zod)
    ├── src/proxy.ts           session refresh; signed-out users → /login
    ├── src/lib/               auth, Supabase clients, money, time zone, orders, kitchen, DB types
    ├── src/app/login          staff sign-in (chefs go to /kitchen)
    ├── src/app/admin/...      admin and counter screens (incl. /admin/kot)
    ├── src/app/kitchen        chef screen (tickets for the chef's kitchens)
    ├── src/app/print/...      printable bill, credit note, kitchen ticket
    ├── src/components/        shared UI, override prompt, catalogue picker, kitchen ticket card
    └── scripts/               create-admin, e2e/
```

### How writes work (important)

- **Catalogue, staff, settings, hours, and closures** are written directly through Supabase with row-level security (RLS). Only admins can write.
- **Orders, payments, bills, credit notes, customers' flags, and kitchen tickets can only be written through Postgres functions.** Staff have **no insert or update grants** on those tables.
  - Orders and money: `create_order`, `confirm_order`, `reject_order`, `cancel_order`, `reschedule_order`, `update_order_items`, `record_payment`, `apply_discount`, `issue_bill`, `issue_credit_note`, `counter_sale`, `record_no_show`, `undo_no_show`, `set_customer_blocked`, and (5B) `mark_packed`, `reopen_packing`, `record_handover`.
  - Kitchen: `acknowledge_ticket`, `start_ticket`, `set_line_ready`, `report_issue`, `resolve_issue`, `acknowledge_stop_work`, `record_ticket_print`. Read-only: `ticket_stamp` (the chef screen's change check).
- Order functions check the caller's role, validate everything, take an **idempotency key** where a retry could duplicate, take the order **version** so concurrent edits fail with "conflict", and write an `order_events` timeline row.
- Kitchen functions take **no version**: each states an end result ("12 ready", "started"), so repeats and double taps change nothing. Admins may act on tickets only as an exception with a reason (at least 5 characters).
- **Lock order: the order first, then its tickets.** `private.lock_order` locks the order (`for update`); chef actions go through `private.lock_ticket`, which locks the order (`for no key update`) before the ticket, and `private.kitchen_guard` locks the order's tickets before it checks them. Keep this order in new functions, or an admin edit and a chef tap on the same order can deadlock (`supabase/local/concurrency-kitchen.sh` reproduces it without the fix).
- The functions are `SECURITY DEFINER` in `public`. The Supabase advisor warns about this; it is intentional (they are the only write path and each checks the role). Helpers live in the unexposed `private` schema.
- Errors use `private.fail(message, kind)`. The message is written for staff; `kind` travels in the Postgres `hint` field (`slot`, `lead_time`, `capacity`, `conflict`, `forbidden`, `unmapped`, `billed`, `blocked`, `unavailable`, `kitchen`, …). `web/src/lib/orders.ts → rpcError` maps them; `slot`, `lead_time`, `blocked` and `capacity` show the shared `OverridePrompt`, where admins retry with a reason. `kitchen` is deliberately not overridable.
- Every table has an audit trigger (`audit_events`: who, what, before, after).

### Invariants — do not break

- Money is **integer paise** everywhere. Prices are **GST-inclusive**; tax is the included portion per line.
- Order lines are **snapshots**: catalogue edits never change existing orders. Kitchen ticket lines are snapshots of order lines.
- All scheduling uses the **business timezone** from `business_settings` (Asia/Kolkata). Convert with `web/src/lib/time.ts`; never use the server's or browser's zone.
- Payments are an **append-only ledger**: corrections are refunds. Bills and credit notes are **immutable**, and bill numbers are **gap-free per financial year** (April–March) via `document_sequences`. A billed order cannot be cancelled until fully credited.
- Chefs see **only kitchen tickets for their assigned kitchens** (`staff_kitchens`) and never orders, payments, customers, order events, bills or prices.
- Balances come from the `order_summaries` view: total − credit notes − payments + refunds. Cancelled and rejected orders charge nothing, so a negative balance means a refund is due.
- `order_summaries` was created with `o.*`, so columns added to `orders` later (`no_show_at`, `no_show_by`) are not in it; read them from `orders`.

### Database migrations

Files in `supabase/migrations/` were applied to the live project in order through the Supabase MCP server. The CLI is not linked. To continue:

- Install the Supabase CLI and run `supabase link --project-ref hljkydruionasnouyrpu`. Check that the remote migration history matches the files (names: `foundation`, `orders`, `billing`, `bill_gst_split_per_rate`, `bill_gst_split_integer_division`, `counter_sale_precheck`, `capacity`, `capacity_enforcement`, `capacity_review_fixes`, `no_shows`, `edit_order_items`, `kitchen_tickets`, `kitchen_review_fixes`, `packing_handover`).
  - The last GST-split fix was applied as `bill_gst_split_integer_division`, but its file is `20260927000310_bill_gst_split_per_rate.sql` (the file already contains the fixed version). Reconcile the history names when linking.
- New tables in `public` get full API access by default in Supabase. Every migration so far **revokes** that and grants only what is needed; keep doing this, and enable RLS on every table.
- When a migration replaces an existing function, copy its **latest** definition (later migrations redefine `confirm_locked`, `reschedule_order`, `cancel_order`, `update_order_items`) and change only what you need.
- After schema changes, update `web/src/lib/database.types.ts`. It was condensed by hand from generated output (write-only-by-function tables are `Insert: never`); later tables and functions were added by hand in the same shape. Replacing it with fully generated types is fine.
- Run the security and performance advisors after each migration. Expected findings today (checked 2026-10-03): `authenticated_security_definer_function_executable` for the 27 public write functions (intentional), unused indexes (empty database), `document_sequences` with no policy (intentional), leaked-password protection off (turn it on).
- **Applying through the Supabase MCP connector:** `apply_migration` waits for an interactive confirmation on destructive statements such as `DROP FUNCTION` and times out when nobody answers. Write migrations without drops (replace instead, as `20261003000100` does for `sync_ticket`), or apply them in the SQL editor.
- **Live project vs the migration files (checked 2026-10-03 by digest):** tables, columns, constraints, indexes, policies, grants, triggers, views and 62 of 71 functions are byte-identical. The other 9 (`build_tickets`, `confirm_locked`, `issue_bill_locked`, `recalc_order_totals`, `cancel_order`, `counter_sale`, `report_issue`, `reschedule_order`, `update_order_items`) differ only in SQL comments, which were left out when they were applied. Nothing to do; a later migration that replaces them brings the comments back.

## 5. Tests

| Test | How to run | Last result |
|---|---|---|
| `supabase/tests/rls_foundation.sql` | `supabase/local/run-tests.sh` | 11/11 (2026-10-03; the file has 11 checks, which the earlier "13/13" did not match) |
| `supabase/tests/orders_logic.sql` | same | 22/22 (2026-10-03): 6 machine-checked, 16 read and identical to the run before the 2026-10-03 migrations except the time-of-day message noted below |
| `supabase/tests/billing_logic.sql` | same | 21/21 (2026-10-03): 9 machine-checked, 12 read and identical |
| `supabase/tests/capacity_logic.sql` | same | 29/29 (2026-10-03): 28 machine-checked, 1 read |
| `supabase/tests/no_show_logic.sql` | same | 26/26 (2026-10-03). Orders from 990001. |
| `supabase/tests/edit_items_logic.sql` | same | 21/21 (2026-10-03). Orders from 990101. |
| `supabase/tests/kitchen_logic.sql` | same | 48/48 (2026-10-03): access per kitchen, ticket building, chef actions, ready counts and corrections, issues, prints, edits/reschedules while New and refused after acknowledgement, cancel → stop-work, and F1–F4 for the review fixes. Orders from 990201. |
| `supabase/tests/packing_logic.sql` | same | 22/22 (2026-10-03, Phase 5B): packing refusals, ready-stock-only packing, retries, balance check and credit handover, bill at handover, reopen. Orders from 990301. |
| `supabase/tests/revisions_logic.sql` | same, or `supabase/local/pglite` | 26/26 (2026-10-03, Phase 5C): who may change preparing orders, in-place revisions with kept/capped ready counts, merged change lists, acknowledgement (who, repeats), removed lines kept as cancelled, stop-work when a kitchen loses everything, New tickets still rebuilt, packing blocked until acknowledged, packed orders reopened first, reschedules, bills without removed lines. Orders from 990401. |
| `supabase/local/concurrency-kitchen.sh` | run it | PASS (2026-10-03, before 5C). Needs `psql`; not rerun since 5C replaced `kitchen_guard` with `private.revise_tickets` (which takes the same order-then-tickets locks). |
| `web/src/lib/capacity.test.ts`, `web/src/lib/kitchen.test.ts` | `npm test` | 20/20: pickup-window matching, the chef queue's grouping and ordering (changed tickets first), change-list wording and parsing, action follow-up, the stamp poller and sign-out detection |
| `web/scripts/e2e/orders-4a.mjs` | Build, `npm start -- -p 3100`, create QA users (`supabase/tests/qa_users.sql`), then `QA_PW=... npm run e2e:orders` | 29/29 (Phase 4A) |
| `web/scripts/e2e/billing-4b.mjs` | Same setup, `npm run e2e:billing` | 17/19; the 2 failures are test-script issues (assertions depend on leftover data). Fix before relying on it. |

**Prefer the local runner (section 3).** The 2026-10-03 results above come from it; the live project was compared with the migration files separately (section 4). **If you run SQL tests on the live project** through the Supabase MCP tool or any client that returns only the last result: replace the file's last two lines (`select … from r …; rollback;`) with
`do $$ begin raise exception E'RESULTS\n%', (select string_agg(check_name || ' => ' || coalesce(outcome,'NULL'), E'\n' order by n) from r); end $$;`
The error message then lists every check, and the exception rolls everything back. `supabase/local/mcp-bundle.sh <test> [migration…]` builds such a batch, with not-yet-applied migrations in front. The Supabase MCP server asks for confirmation on every batch that contains `DELETE`/`UPDATE` without `WHERE` or `DROP` (the test setup does), so prefer the PGlite runner. In the SQL editor, run the file as is. Compare each outcome with the `-- expect:` comment above it.

Caveats:
- The newer test files insert orders directly with high order numbers, so they do not consume `order_number_seq`. The older ones (`orders_logic`, `capacity_logic`, `billing_logic`) call `create_order` and **do** consume order numbers. Reset the sequence only while no real orders exist.
- The e2e scripts **commit data**. Run them against staging. Never run successful counter sales or bill issuing on the live project after launch: bills are permanent and consume real numbers.
- Some messages depend on the time of day: for example `orders_logic`'s "lead time violation" check reports the opening-hours message when run late at night.

## 6. Defaults chosen (owner has not confirmed)

| Default | Where to change |
|---|---|
| Business name "Auri Bakery" (prototype says "La Patisserie Madras") | Settings |
| Kitchen 1 / Kitchen 2 (codes `K1`, `K2`; ticket references look like `B-1001-K1`) | Staff & Kitchens |
| Prices include GST; intra-state CGST/SGST split | Code (migrations 0200/0300) |
| Opening hours 9 AM–9 PM every day | Settings → Opening hours |
| Bill prefix `AB`; counter staff discount limit 10% | Settings |
| Counter staff can confirm in-store orders; only admins confirm call orders, reject, cancel, reschedule, refund, issue credit notes, or resolve kitchen issues | Migrations (role checks in functions) |
| Counter staff can see and print kitchen tickets but not act on them | `private.ticket_actor` |
| Pickup only; manual payment recording; no stock counts (confirmed by the owner 2026-10-02) | PRD section 2 |
| 5B: counter staff can pack and hand over orders (PRD: "Admin or permitted Counter Staff") | `mark_packed`, `record_handover` (migration `20261003000200`) |
| 5B: handing over with a balance due needs an admin and a credit reason (AC-10); a refund due does not block handover | `record_handover` |
| 5B: handover issues the GST bill when the order has none (PRD 5F: every completed sale gets a bill) | `record_handover` |
| 5B: an open kitchen issue blocks packing; packing has no override (an admin acts on the ticket instead) | `mark_packed` |
| 5B: only an admin can reopen a packed order, with a reason; it returns to Preparing (Confirmed when there are no kitchen tickets) | `reopen_packing` |

Business decisions still needed are listed in PRD section 14 and TODO Phase 0. The most urgent are: GSTIN/FSSAI/tax rates (check with the accountant), the real product list with kitchen mapping, opening hours, and the notification channel.

## 7. Known gaps and risks

- **No browser click-through yet.** Print layouts have not been checked on a real 80mm printer.
- **No staging environment.** The production deployment uses the only (live) Supabase project. SQL logic can now be tested locally (section 3); the app itself still only runs against the live project.
- If the demo-login variables are ever set on Vercel, the public site pre-fills an admin login for the live database (owner's choice). Remove them before real orders exist.
- Packing is one confirmation per order. The itemized checklist (cake wording, accessories, packaging) and recipient checks are Release 1.1 (PRD 5D).
- Handover issues a GST bill when the order has none, which uses a bill number for good. Do not hand over test orders on the live project.
- The chef screen refreshes every 10 seconds by polling `GET /kitchen/stamp` (8 s timeout, one request at a time), which calls `public.ticket_stamp()`; not Supabase Realtime. A tap that fails on the network shows "Not saved" and switches the header to Offline without reloading the page. A lost or deactivated session sends the chef to `/login`.
- Placeholder pages: Reports.
- Not built yet: chef PIN sign-in on tablets (AC-34, now 5D).
- `next start` warns about `outputFileTracingRoot` (multiple lockfiles on the machine). Harmless locally.
- The Supabase free plan allows two active projects, and the owner already has one other active project. A staging project may require pausing a project or upgrading.
- Leaked-password protection is off (Supabase → Auth → Password security).
- **Minor items from the 5A review: fixed on 2026-10-03** (section 12), except one accepted limit: "Not saved" can be wrong if the connection dropped after the server committed; the next refresh corrects the screen.

## 8. Suggested order of work

1. **Check the first Git deployment** of `main` in the Vercel dashboard (section 2); fix the Root Directory if it failed. Confirm the 5B defaults (section 6). The live database already has the migrations.
2. Add the secret key, create the demo chef, assign kitchens, and add a few test products with kitchen mappings. (The order sequence is already reset to 1001.)
3. **Walk through every screen in a browser** (admin, counter, chef on a tablet-sized window, prints, and now packing and handover), ideally against a staging project, and fix what you find. Consider Playwright.
4. Walk the revision flow in a browser (5C is deployed): edit a started order, see the Changed banner on `/kitchen` and the order page, acknowledge, pack (section 14).
5. Phase 5D: chef PIN sign-in on registered tablets (needs the secret key on the server).
6. Notification templates once the owner picks the channel (PRD 5F proposes WhatsApp click-to-chat links); Reports (Phase 7, AC-35); public website (Phase 6) when the owner is ready.

## 9. Customer blocking and no-shows (built 2026-09-30)

Migration `20260930000100_no_shows.sql` (applied). PRD 5F "Spam and no-show protection".

- **Owner's decision:** recording a no-show does **not** change the order's status. Staff cancel or complete the order separately.
- **Database:** `orders.no_show_at`/`no_show_by` (each order counts at most once); `record_no_show` (admin and counter; orders with a customer, past pickup, in confirmed/preparing/ready/cancelled); `undo_no_show` (admin, reason); `set_customer_blocked` (admin, reason both ways); `customer_events` keeps every block and unblock with its reason.
- **Screens:** customer page `/admin/customers/[id]`; Blocked / N no-shows badges, Record no-show and Undo on the order page; a warning under the phone field on the new-order form (`src/components/customer-warning.tsx`).

## 10. Editing items on an order (built 2026-09-30)

Migration `20260930000200_edit_order_items.sql` (applied); `update_order_items(order, version, lines, reason, override_reason)`. The order page shows **Edit items** in the Items card.

- **Who and when:** admin and counter staff on draft and pending orders; admins only on confirmed orders, with a required reason. Never on preparing, ready or closed orders, or once a GST bill exists (credit note instead). Since 5A, also refused once any kitchen ticket is past New.
- **Lines:** the full new list. Existing lines keep their price snapshot; new lines take today's price; lines left out are deleted (the audit log keeps them).
- **Checks, only on what the edit adds:** availability (not overridable), preparation time, and daily caps for newly added categories; lead-time and cap refusals can be overridden by an admin with a reason.
- **Money:** totals recalculated; a discount keeps its rupee amount, capped at the new subtotal.
- **Timeline:** one `items_changed` event listing each change and the old and new totals; `tickets_revised` when kitchen tickets were rebuilt.
- Product search and quantity controls are shared with the new-order form (`src/components/catalogue-picker.tsx`, `src/lib/catalogue.ts`).

## 11. Kitchen tickets (Phase 5A, built 2026-10-03)

Spec `docs/superpowers/specs/2026-09-30-kitchen-tickets-design.md`; plan `docs/superpowers/plans/2026-09-30-kitchen-tickets.md`; migration `20260930000300_kitchen_tickets.sql` (applied as `kitchen_tickets`).

- **Tables:**
  - `kitchen_tickets`: one per order per kitchen; reference `B-1001-K1`; revision; status `new → acknowledged → preparing → ready`, or `cancelled`; pickup and start-by times; who/when for each step; stop-work acknowledgement; print count. No prices or customer data.
  - `kitchen_ticket_lines`: snapshot of made-to-order lines with ready counts.
  - `kitchen_issues`: problems reported by chefs, resolved by admins.
  - View `order_kitchen_progress`: `all_ready`, `open_issues`, `stop_work_pending` per order.
- **Access:** `private.can_see_kitchen` — admin and counter see all; chefs only their `staff_kitchens`.
- **When tickets are made:** in `private.confirm_locked` (both confirm paths). Ready-stock lines and counter sales get none. `private.build_tickets` rebuilds tickets when a confirmed order is edited or rescheduled **while every ticket is New** (revision + 1 only for tickets that changed; a kitchen that drops out gets a stop-work ticket that keeps its lines). Once any ticket is past New, `private.kitchen_guard` refuses edits and reschedules with kind `kitchen`.
- **Cancelling** an order cancels its tickets and raises a stop-work notice until a chef acknowledges it. Ready counts stay as a record.
- **Order status:** Confirmed → Preparing when any ticket starts. When every ticket is ready the order **stays Preparing** with an "All kitchen items ready" badge; packing then sets Ready (5B, section 13).
- **Screens:**
  - Chef screen `/kitchen`: Today / Tomorrow / Later, overdue first, source filter, kitchen switch, one-tap Ready, Part ready, Report issue, Print, stop-work notices, "Updated N s ago" / Offline banner.
  - `/admin/kot`: open issues with Resolve, stop-work list, tickets by day/kitchen/source/status.
  - Order page Kitchen card; kitchen badges in order lists and the calendar.
  - `/print/kot/[id]`: 80mm, COPY on reprints.
- **Refresh:** the chef screen polls a change stamp every 10 seconds and reloads only when it changed. Since 2026-10-03 the stamp is `public.ticket_stamp()`: a digest of the `updated_at` values of the tickets that can be on screen (still being worked on, or touched in the last two days), scoped to the chef's kitchens by row-level security. Every ticket write touches `updated_at`.
- **Since 5C** (section 14) `private.kitchen_guard` is gone: edits and reschedules revise acknowledged tickets in place instead of being refused.

## 12. Kitchen review fixes (built 2026-10-03)

Migration `20261003000100_kitchen_review_fixes.sql` (applied as `kitchen_review_fixes`); web commit `c8180e8`, SQL commit `79f28e8`.

- **One lock order** (order, then ticket): `lock_ticket` locks the order first; `kitchen_guard` locks the tickets it checks; `resolve_issue` goes through `lock_ticket`. Before this, an admin edit and a chef starting the same order's ticket deadlocked (reproduced and now passing in `supabase/local/concurrency-kitchen.sh`).
- The "Kitchen ticket ready" timeline entry carries the admin's reason when an admin acts as the kitchen (`sync_ticket(uuid, text)`; the one-argument form stays and forwards).
- `public.ticket_stamp()` replaces the count + newest `updated_at` stamp (which could miss a late commit and counted all history).
- Web: the chef screen goes to `/login` when the session is gone (401, or the proxy's redirect) instead of showing Offline forever; `/admin/kot` "Open" on today includes open tickets from earlier days; Part ready "Save" needs an admin's reason; cancelled tickets can be printed; the Resolve form catches network errors.

## 13. Packing and handover (Phase 5B, built 2026-10-03)

Spec `docs/superpowers/specs/2026-10-03-packing-handover-design.md`; migration `20261003000200_packing_handover.sql` (applied as `packing_handover`); commit `7399343`.

- **Columns on `orders`:** `packed_at`, `packed_by`, `packing_note`, `handed_over_by`, `collected_by`, `credit_reason` (`completed_at` already existed). `order_summaries` does not have them; read them from `orders`.
- **`mark_packed(order, version, note)`** (admin, counter): Confirmed or Preparing orders whose live kitchen tickets are all Ready and with no open kitchen issue → **Ready**. Ready-stock-only orders pack straight from Confirmed. Packing a Ready order again changes nothing.
- **`record_handover(order, version, collected_by, credit_reason)`** (admin, counter): Ready orders → **Completed**. A balance due is refused with kind `balance`; an admin retries with a credit reason through the shared `OverridePrompt` ("Hand over on credit"), and the balance at handover is recorded. Issues the GST bill if there is none. Handing over again changes nothing (AC-22).
- **`reopen_packing(order, version, reason)`** (admin): Ready → Preparing (Confirmed without kitchen tickets), packing record cleared, timeline keeps it.
- **Screens:** order page "Packing & handover" card (what is still missing, Mark packed, handover form with the balance, Reopen); Home "Ready for pickup" list with late collections; timeline entries Packed, Packing reopened, Handed over.
- **Not done (Release 1.1):** itemized checklist, recipient verification, partial collection, late/uncollected workflow beyond the Home list.

## 14. Kitchen revisions (Phase 5C, built 2026-10-03)

Spec `docs/superpowers/specs/2026-10-03-kitchen-revisions-design.md`; plan `docs/superpowers/plans/2026-10-03-kitchen-revisions.md`; migrations `20261003000300_kitchen_revisions.sql` and `20261003000400_kitchen_revisions_fixes.sql` (applied to the live project as `kitchen_revisions` and `kitchen_revisions_fixes`; the live function bodies were compared with the file by `md5(prosrc)`).

- **Owner's decisions:** a revised ticket keeps its status and ready counts and shows a change list the kitchen acknowledges; the chef keeps working. Lowering below the ready count caps it, with no waste record.
- **Columns:** `kitchen_tickets.pending_changes` (jsonb list of `{key, kind: quantity|notes|pickup, item, from, to}`; an added item is a quantity change from 0, a removed one to 0), `has_pending_changes` (generated), `changes_acknowledged_at/by`. Ticket lines may now be quantity 0 when cancelled. `order_kitchen_progress.changes_pending`.
- **Functions:**
  - `update_order_items` and `reschedule_order` now accept **preparing** orders (admin, reason); **ready** (packed) orders are refused with kind `kitchen` ("Reopen packing first"). They call `private.apply_ticket_changes`.
  - `private.revise_tickets` updates acknowledged, preparing and ready tickets in place (lines matched by `order_item_id`; ready counts kept or capped; new lines added; removed lines kept at 0 as cancelled; pickup moves recorded) and merges the entries into `pending_changes` with `private.merge_ticket_changes` (net change since the last acknowledgement; 2 → 3 → 2 leaves the list). `private.build_tickets` still rebuilds New tickets as in 5A and cancels kitchens with nothing left (stop-work).
  - An order line the kitchen has acknowledged is no longer deleted when it is left out of an edit: `cancelled_quantity = quantity`, value 0. Sending a removed line's id again is refused.
  - `public.acknowledge_ticket_changes(ticket, reason)`: the assigned chef, or an admin with a reason; repeats do nothing; timeline `ticket_changes_acknowledged`.
  - `mark_packed` refuses while any live ticket has unacknowledged changes. `sync_ticket` ignores cancelled lines; `set_line_ready` refuses them. Bills leave out fully cancelled lines.
- **Screens:** chef screen and order page show a "Changed · revision N" banner with the change list and **Acknowledge changes**; removed lines struck through; Ready tickets with changes stay on the chef's Active tab and sort first. Order page: Edit items and Reschedule on preparing orders, removed items struck through, a hint to reopen packed orders, the packing card names kitchens that have not acknowledged, the timeline lists each change. `/admin/kot`: "Awaiting acknowledgement of changes". Order lists and calendar: "Change unacknowledged" badge. Print: REVISED rN, the change list, removed lines.
- **Review fixes** (`20261003000400`): removed lines no longer count as already on the order for category caps; `acknowledge_ticket_changes(ticket, reason, expected_revision)` refuses (kind `conflict`) when the order changed again after the screen loaded, so a chef never clears changes they have not seen.
- **Deferred review minors:** `order_summaries.kitchen_ids` and the reschedule preview still include removed lines; stop-work notices and the cancelled-ticket print show earlier-removed lines as "0×"; an item added and removed before acknowledgement leaves a "Removed" line on the chef card; Ready tickets with changes also show under Done today and twice on `/admin/kot`; a revision that makes a ticket Ready records the admin as `ready_by`; `report_issue` accepts a removed line on the server; pickup change entries compare timestamps as text.
- **Not done:** moving items between kitchens; waste or counter-sale records; edits on billed orders (credit note). Not yet walked through in a browser.
