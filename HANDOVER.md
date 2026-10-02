# Handover — Auri Bakery order management

Date: 2026-10-03 (first written 2026-09-27). Read this first, then [TODO.md](TODO.md) ("Start here"), [PRD.md](PRD.md), and [PROJECT_RULES.md](PROJECT_RULES.md). Designs and plans for recent work are in `docs/superpowers/specs/` and `docs/superpowers/plans/`.

## 1. Where things stand

| Phase | State | What exists |
|---|---|---|
| 0–2 Planning | Mostly done | PRD v0.3, rules, TODO. Many business decisions still open (PRD section 14). |
| 3 Foundation | **Done** | Staff login, roles, kitchens, products/variants/categories, settings, audit log. Chef PIN sign-in **not built** (now Phase 5D). |
| 4A Orders | **Done** | In-store and call orders, two order lists, order detail, confirm/reject/cancel/reschedule, payments and refunds, calendar, opening hours and closures, customers. |
| 4B Billing | **Done** | Counter quick sale, discounts, GST bills (gap-free per financial year), credit notes, 80mm and A4 print. |
| 4C | **Done except notifications** | Pickup windows, category caps, festival overrides, shared override prompt, calendar week/day views, demo-login autofill, customer blocking and no-shows (section 9), editing items on pending and confirmed orders (section 10). Left: notification templates (waiting for the owner to choose a channel). |
| 5A Kitchen tickets | **Done and deployed** (2026-10-03) | Tickets per kitchen on confirmation, chef screen, ready counts, issues, stop-work, printed ticket, admin KOT page, kitchen badges (section 11). Reviewed; review fixes deployed. |
| 5B–5D | Not started | 5B packing and handover (orders reach Ready and Completed), 5C revisions after the kitchen has acknowledged, 5D chef PIN sign-in on tablets. |
| 6 Public website | Not started | Deferred by the owner ("leave the public page for now"). |
| 7–9 | Not started | Reports, rehearsal, launch, Release 1.1 exceptions. |

**Nothing has been clicked through in a browser yet.** Every check so far is SQL-, typecheck-, lint-, unit-test- and build-level. This is the biggest risk; see section 8.

The database holds **no products, orders, or bills**. The only staff account is **Demo Admin**. Test runs have advanced the order number sequence to 1076; while no real orders exist, reset it so the first real order is B-1001: `alter sequence public.order_number_seq restart with 1001`. The first bill will be **AB/2026-27/00001** (bill numbering is transactional and was never consumed).

### Owner decisions to keep in mind

- **No stock or inventory tracking** (owner, 2026-10-02). Ready-stock items are sold without counts or allocation records. Do not design stock counts into any phase, including 5B packing.
- **Kitchen tickets go to the kitchen as soon as an order is confirmed** (no scheduled release).
- **Recording a no-show never changes the order's status.**
- **Item edits and reschedules are refused once a kitchen has acknowledged a ticket**, until 5C adds kitchen revisions. Cancel and recreate meanwhile.

## 2. Accounts and access

| What | Where |
|---|---|
| Supabase project | `auri-bakery`, ref `hljkydruionasnouyrpu`, region ap-south-1 (Mumbai), in the owner's Supabase organisation. Ask the owner to invite you. |
| Demo admin login | `demo@auri.test`. The password is in `web/.admin-password.txt` on the owner's machine; it is git-ignored. Get it from the owner privately. `@auri.test` cannot receive emails, so create a real admin before go-live and disable this one. |
| Demo chef login | **Not created yet, and needed to use `/kitchen`.** Needs the secret key: `npm run create-admin -- --email chef@auri.test --name "Demo Chef" --role chef`, then assign the chef to kitchens in Staff & Kitchens (a chef with no kitchen sees no tickets). |
| Demo-login autofill | `/login` pre-fills the demo logins while `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD` (and `DEMO_CHEF_*`) are set. **The owner chose to allow this in production.** Anyone who opens the site is then pre-filled as admin on the live database. **Not set anywhere yet.** Delete the variables and redeploy to turn it off; do so before real data goes in. |
| Secret key | **Not configured.** Copy it from Supabase → Project Settings → API Keys into `web/.env.local` as `SUPABASE_SECRET_KEY`. Without it, Staff & Kitchens is read-only (no creating logins or resetting passwords). Never commit it. |
| Publishable key and URL | Already in `web/.env.local` (safe for browsers). `web/.env.example` documents all variables. |
| Hosting | Vercel project `bakery-admin` (team "sandymandycandy's projects"), root `web/`, production at **https://bakery-admin-ten.vercel.app**. Last deployed 2026-10-03 from `main` (commit `be85d89`: Phase 5A kitchen tickets plus review fixes). Deploy with `vercel deploy --prod` from `web/`; **Git integration is not connected**, so pushes do not deploy. `web/vercel.json` pins the Next.js preset (without it the site served only 404s). Production env vars: the Supabase URL and publishable key only. |
| Version control | GitHub: `sandymandycandy/bakery-admin`. `main` holds all work, including Phase 5A (branches `phase-5a-kitchen-tickets` and `phase-5a-review-fixes` are merged). Secrets (`web/.env.local`, `web/.admin-password.txt`) are git-ignored and must be shared separately. |


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
│   └── tests/                 SQL rule checks (run in a transaction, then rolled back)
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
  - Orders and money: `create_order`, `confirm_order`, `reject_order`, `cancel_order`, `reschedule_order`, `update_order_items`, `record_payment`, `apply_discount`, `issue_bill`, `issue_credit_note`, `counter_sale`, `record_no_show`, `undo_no_show`, `set_customer_blocked`.
  - Kitchen: `acknowledge_ticket`, `start_ticket`, `set_line_ready`, `report_issue`, `resolve_issue`, `acknowledge_stop_work`, `record_ticket_print`.
- Order functions check the caller's role, validate everything, take an **idempotency key** where a retry could duplicate, take the order **version** so concurrent edits fail with "conflict", and write an `order_events` timeline row.
- Kitchen functions take **no version**: each states an end result ("12 ready", "started"), so repeats and double taps change nothing. Admins may act on tickets only as an exception with a reason (at least 5 characters).
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

- Install the Supabase CLI and run `supabase link --project-ref hljkydruionasnouyrpu`. Check that the remote migration history matches the files (names: `foundation`, `orders`, `billing`, `bill_gst_split_per_rate`, `bill_gst_split_integer_division`, `counter_sale_precheck`, `capacity`, `capacity_enforcement`, `capacity_review_fixes`, `no_shows`, `edit_order_items`, `kitchen_tickets`).
  - The last GST-split fix was applied as `bill_gst_split_integer_division`, but its file is `20260927000310_bill_gst_split_per_rate.sql` (the file already contains the fixed version). Reconcile the history names when linking.
- New tables in `public` get full API access by default in Supabase. Every migration so far **revokes** that and grants only what is needed; keep doing this, and enable RLS on every table.
- When a migration replaces an existing function, copy its **latest** definition (later migrations redefine `confirm_locked`, `reschedule_order`, `cancel_order`, `update_order_items`) and change only what you need.
- After schema changes, update `web/src/lib/database.types.ts`. It was condensed by hand from generated output (write-only-by-function tables are `Insert: never`); later tables and functions were added by hand in the same shape. Replacing it with fully generated types is fine.
- Run the security and performance advisors after each migration. Expected findings today: `authenticated_security_definer_function_executable` (intentional), unused indexes (empty database), `document_sequences` with no policy (intentional), leaked-password protection off (turn it on).

## 5. Tests

| Test | How to run | Last result |
|---|---|---|
| `supabase/tests/rls_foundation.sql` | SQL editor | 13/13 |
| `supabase/tests/orders_logic.sql` | SQL editor | 22/22 (rerun 2026-10-03 with 5A: unchanged) |
| `supabase/tests/billing_logic.sql` | SQL editor | all pass (rerun 2026-10-03 with 5A: unchanged) |
| `supabase/tests/capacity_logic.sql` | SQL editor | 29/29 (rerun 2026-10-03 with 5A: unchanged) |
| `supabase/tests/no_show_logic.sql` | SQL editor | 26/26 (2026-09-30). Orders from 990001. |
| `supabase/tests/edit_items_logic.sql` | SQL editor | 21/21 (rerun 2026-10-03 with 5A: unchanged). Orders from 990101. |
| `supabase/tests/kitchen_logic.sql` | SQL editor | 44/44 (2026-10-03, against the applied schema): access per kitchen, ticket building, chef actions, ready counts and corrections, issues, prints, edits/reschedules while New and refused after acknowledgement, cancel → stop-work. Orders from 990201. |
| `web/src/lib/capacity.test.ts`, `web/src/lib/kitchen.test.ts` | `npm test` | 7/7: pickup-window matching, and the chef queue's day grouping and ordering |
| `web/scripts/e2e/orders-4a.mjs` | Build, `npm start -- -p 3100`, create QA users (`supabase/tests/qa_users.sql`), then `QA_PW=... npm run e2e:orders` | 29/29 (Phase 4A) |
| `web/scripts/e2e/billing-4b.mjs` | Same setup, `npm run e2e:billing` | 17/19; the 2 failures are test-script issues (assertions depend on leftover data). Fix before relying on it. |

**Running SQL tests through the Supabase MCP tool or any client that returns only the last result:** replace the file's last two lines (`select … from r …; rollback;`) with
`do $$ begin raise exception E'RESULTS\n%', (select string_agg(check_name || ' => ' || coalesce(outcome,'NULL'), E'\n' order by n) from r); end $$;`
The error message then lists every check, and the exception rolls everything back. In the SQL editor, run the file as is. Compare each outcome with the `-- expect:` comment above it.

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

Business decisions still needed are listed in PRD section 14 and TODO Phase 0. The most urgent are: GSTIN/FSSAI/tax rates (check with the accountant), the real product list with kitchen mapping, opening hours, and the notification channel.

## 7. Known gaps and risks

- **No browser click-through yet.** Print layouts have not been checked on a real 80mm printer.
- **No staging environment.** The production deployment and all test runs use the only (live) Supabase project.
- If the demo-login variables are ever set on Vercel, the public site pre-fills an admin login for the live database (owner's choice). Remove them before real orders exist.
- **Orders cannot be completed in the app yet.** Kitchen work ends with "All kitchen items ready"; packing, Ready and handover/Completed arrive in 5B.
- **Edits after the kitchen acknowledges are refused** (5A holding measure); 5C must add kitchen-acknowledged revisions and preserve prepared quantities.
- The chef screen refreshes every 10 seconds by polling `GET /kitchen/stamp` (8 s timeout, one request at a time), not Supabase Realtime. A tap that fails on the network shows "Not saved" and switches the header to Offline without reloading the page.
- Placeholder pages: Reports.
- Not built yet: chef PIN sign-in on tablets (AC-34, now 5D).
- `next start` warns about `outputFileTracingRoot` (multiple lockfiles on the machine). Harmless locally.
- The Supabase free plan allows two active projects, and the owner already has one other active project. A staging project may require pausing a project or upgrading.
- Leaked-password protection is off (Supabase → Auth → Password security).
- **Minor items from the 5A review, not yet fixed** (low impact; pick up during 5B/5C):
  - `kitchen_guard` reads tickets without row locks: a chef acknowledging at the same moment as an admin edit can be reset to New; the opposite lock order of `start_ticket` and the edit path can deadlock (a retry works). Lock the order's tickets in `kitchen_guard`, and lock the order before the ticket in `start_ticket_locked`.
  - The change stamp uses transaction-start `now()`; a long transaction committing late may not move it until the next change. `count: "exact"` over all tickets grows with history.
  - A deactivated chef or lost session shows Offline forever instead of going to `/login` (the stamp route returns 401).
  - "Not saved" can be wrong if the connection dropped after the server committed; the next refresh corrects the screen.
  - `/admin/kot` default (Open, today) hides open tickets from earlier days.
  - Part ready Save is not disabled for an admin without a reason (the server refuses it with a message).
  - Cancelled tickets have no Print button in the order page Kitchen card.
  - `ResolveIssueForm` has no try/catch around its action.
  - The `ticket_ready` timeline event omits the admin's reason.

## 8. Suggested order of work

1. Add the secret key, create the demo chef, assign kitchens, reset `order_number_seq` to 1001, and add a few test products with kitchen mappings.
2. **Walk through every screen in a browser** (admin, counter, chef on a tablet-sized window, prints), ideally against a staging project, and fix what you find. Consider Playwright.
3. Phase 5B: packing and handover (one packing confirmation per order → Ready; one-time handover → Completed, with the balance check; no stock allocation).
4. Phase 5C: kitchen revisions after acknowledgement (replaces the holding measure in `update_order_items`/`reschedule_order`; see section 11).
5. Phase 5D: chef PIN sign-in on registered tablets.
6. Notification templates once the owner picks the channel; Reports (Phase 7); public website (Phase 6) when the owner is ready.

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
- **Order status:** Confirmed → Preparing when any ticket starts. When every ticket is ready the order **stays Preparing** with an "All kitchen items ready" badge; Ready is set by packing in 5B.
- **Screens:**
  - Chef screen `/kitchen`: Today / Tomorrow / Later, overdue first, source filter, kitchen switch, one-tap Ready, Part ready, Report issue, Print, stop-work notices, "Updated N s ago" / Offline banner.
  - `/admin/kot`: open issues with Resolve, stop-work list, tickets by day/kitchen/source/status.
  - Order page Kitchen card; kitchen badges in order lists and the calendar.
  - `/print/kot/[id]`: 80mm, COPY on reprints.
- **Refresh:** the chef screen polls a change stamp (`ticketStamp`: count + latest `updated_at`) every 10 seconds and reloads only when it changed. Every ticket write touches `updated_at`.
- **5C must change** `update_order_items` and `reschedule_order`: replace the `kitchen_guard` refusal with kitchen-acknowledged revisions, preserve prepared quantities, and reduce released lines via `cancelled_quantity` instead of deleting order lines.
