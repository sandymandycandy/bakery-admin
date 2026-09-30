# Bakery Project — To-do List

Status (2026-09-30): Phases 3, 4A and 4B are built and tested. Phase 4C capacity caps, the shared override prompt, and calendar week/day views are built; all of it is on `main` and deployed to Vercel production (https://bakery-admin-ten.vercel.app). Customer blocking and no-shows were built and deployed on 2026-09-30; editing items on pending and confirmed orders was built the same day (not deployed yet). No browser click-through yet. **Next: a browser click-through on staging data, then Phase 5 (KOT)**; notification templates wait for the owner's channel decision. See HANDOVER.md for setup, architecture, and known gaps.
Checkboxes represent actual completion, not intentions.

## Start here — next developer

1. [ ] Read [HANDOVER.md](HANDOVER.md), then PRD sections 5F, 7, 10A, and 14A.
2. [ ] Get access to the Supabase project `auri-bakery` (ask the owner to invite you) and add `SUPABASE_SECRET_KEY` to `web/.env.local`.
3. [x] Code is on GitHub: `sandymandycandy/bakery-admin` (branch `main`). Clone it; get `web/.env.local` values from the owner.
4. [ ] Run the app locally and click through every admin screen in a browser (never done yet — only HTTP-level tests so far).
5. [ ] Create a staging Supabase project so tests can create bills without consuming the live bill sequence.
6. [ ] Enable Leaked Password Protection (Supabase → Auth → Password security).
7. [ ] Continue with Phase 4C below.
8. [ ] Decide about demo-login autofill on the live site (`DEMO_*` variables; not set yet). Remove them before real data goes in (HANDOVER section 2).
9. [ ] Create the demo chef login (`npm run create-admin -- … --role chef`; needs the secret key).

## Phase 0 — Planning and business decisions

- [x] Inspect existing workspace material without changing the prototype.
- [x] Draft [PRD.md](PRD.md) with public, admin, chef, calendar, and KOT scope.
- [x] Define the two source lists and item-based routing between two kitchens.
- [x] Document statuses, revisions, operational exceptions, and acceptance scenarios.
- [x] Create [PROJECT_RULES.md](PROJECT_RULES.md).
- [x] Expand the plan with seven operational workflows, related rules, and AC-21 through AC-27.
- [ ] Confirm business name and reuse of the existing prototype.
- [ ] Supply kitchen names and a product/variant-to-kitchen mapping table.
- [x] Confirm website ordering and call orders for the first release.
- [x] Retain Kitchen 1 and Kitchen 2 as planning placeholders; actual mapping remains open.
- [ ] Confirm pickup/delivery scope, timezone, currency, hours, and slots.
- [ ] Confirm acceptance permissions, payment/deposit policies, cancellation rules, and customer notification method.
- [ ] Confirm ready-stock handling, lead times, and production release rules.
- [ ] Confirm staff roles, kitchen devices, and printing needs.
- [ ] Set budget, expected volume, and target launch date.
- [ ] Confirm packing owner/checks, substitution consent, remake authority, and waste reasons.
- [ ] Define holding deadlines, late-pickup contact process, and uncollected-order outcomes.
- [ ] Decide launch timing for daily reconciliation and detailed bulk/custom specifications; document applicability of AC-26 and AC-27.
- [x] Split delivery into Release 1 (core loop plus admin overrides) and Release 1.1 (operational exception workflows) — v0.3 review.
- [x] Add Release 1 essentials to the PRD (section 5F), the recommended stack (10A), glossary (14A), and AC-28 to AC-36.
- [ ] Supply GSTIN, FSSAI licence, tax rates/HSN per category, and bill format; confirm with the accountant.
- [ ] Choose the Release 1 notification channel and pending-order alert time.
- [ ] Choose OTP provider (or captcha plus callback), submission limits, and deposit threshold.
- [ ] Supply veg/non-veg, eggless variants, and allergen data for every product.
- [ ] Set discount permissions/limits, daily/slot caps, ordering cut-offs, and the festival calendar.
- [ ] Confirm kitchen tablets and PIN sign-in.
- [x] Confirm the recommended stack (Next.js + Supabase + Vercel); hosting budget still open.

Exit: material business decisions recorded in PRD; unresolved choices remain explicitly marked.

## Phase 1 — Workflow and design definition

Depends on: relevant Phase 0 decisions.

Note: coding started before this phase was completed (owner's request). Screens were designed directly in code with a neutral placeholder style; walk them through with the owner before launch.

- [ ] Walk through one in-store, one call, and one online order with the owner.
- [ ] Walk through a future order, a mixed-kitchen order, a reschedule, and a cancellation after preparation starts.
- [ ] Confirm state transitions, partial quantities, packing responsibility, and handover permissions.
- [ ] Walk through daily product totals, a substitution awaiting consent, damaged-item remake, and an expired collection hold.
- [ ] Plan production summary, packing checklist, operational holds, incident register, and collection follow-up screens within KOT/Orders.
- [ ] Research public-site and operational screen references; record which choices each reference supports.
- [ ] Agree brand assets/content and a visual direction before visual implementation.
- [ ] Plan public product, checkout, confirmation, and protected status screens.
- [x] Plan admin Home, Products, two Orders lists, order detail, and Calendar screens (built directly; KOT still to plan).
- [x] Plan Counter Sale and bill/credit-note print layouts (80mm and A4) — built. Reports and the admin-override dialog still to plan.
- [ ] Plan OTP verification in checkout, notification templates, and the capacity/closure settings screens.
- [ ] Plan kitchen sign-in, active tickets, upcoming schedule, ticket details, and alerts.
- [ ] Include loading, empty, error, permission, stale-data, and mobile states in designs.
- [ ] Review screen flows against PRD acceptance scenarios.

Exit: reviewable screen/workflow specification with decisions recorded; no code required for this phase.

## Phase 2 — Technical planning

Depends on: settled order rules and initial screen/workflow specification.

Note: items marked done below are specified by the implemented migrations in `supabase/migrations/` (the SQL is the specification).

- [x] Confirm the recommended stack (PRD 10A): Next.js 16 + Supabase + Vercel. Hosting budget still open.
- [x] Specify bill numbering (gap-free per financial year), credit notes, and tax calculation (migration 0300/0310).
- [ ] Specify trusted-device registration and PIN sign-in security.
- [x] Specify shared order data, staff access, kitchen assignment, and record relationships (migrations 0100/0200).
- [ ] Specify ticket generation (Phase 5). Transactional confirmation, duplicate prevention (idempotency keys), and conflict handling (order version) are done.
- [ ] Specify release scheduling, restart recovery, and alert handling (Phase 5). Timezone behaviour is done (business timezone in settings; `web/src/lib/time.ts`).
- [ ] Specify live updates/reconnect behavior and audit records.
- [ ] Specify protected order tracking and settle guest versus account access.
- [ ] Specify stock allocation (blocked on PRD decision 7). Payment and balance calculations are done (`order_summaries` view).
- [ ] Specify usable-ready versus gross prepared quantities, remake links, hold flags, and packing-check invalidation after revisions.
- [ ] Define backup/restore, deployment environments, monitoring, and rollback approach.
- [ ] Map each acceptance scenario to its test approach.

Exit: implementation plan with dependencies and remaining external services/hardware identified.

## Phase 3 — Foundation and catalogue implementation

Start only after the user requests coding. Depends on: Phase 2.

- [x] Set up the Supabase project (auri-bakery, ap-south-1) and the Next.js app in `web/`.
- [ ] Set up a staging environment (separate Supabase project).
- [x] Implement staff email sign-in, admin/counter/chef roles, kitchen assignments, and RLS enforcement.
- [ ] Implement trusted kitchen devices and chef PIN switching (AC-34).
- [x] Configure two placeholder kitchens and business settings (name, contact, GSTIN, FSSAI).
- [x] Add opening hours and closures (Settings; enforced on every pickup time, 4A).
- [x] Add capacity caps and pickup windows (4C, 2026-09-28). Cut-offs dropped by owner decision.
- [x] Implement categories, products, variants (including eggless), veg/egg/allergen marks, GST rate/HSN, availability, lead times, and kitchen mapping.
- [x] Implement audit foundations (row-level audit trigger on catalogue, staff, kitchens, settings). Order snapshots come with orders.
- [x] Verify unauthorized access is denied and unmapped made-to-order variants are listed (SQL RLS checks plus 26 HTTP-level checks, 2026-09-27).
- [ ] Click through the admin forms in a browser (not yet done; the browser extension was not connected).

Exit: staff access and catalogue work reliably; AC-06 and relevant AC-09 checks pass.

## Phase 4 — Orders, calendar, and payments

Depends on: Phase 3.

- [x] Implement shared order records with IN_STORE, ONLINE, and CALL sources (4A).
- [x] Implement in-store/call entry, pending review, confirmation, rejection, and order details (4A).
- [x] Implement the two order lists and their search, filters, counts, and source badges (4A).
- [x] Implement item snapshots, GST-inclusive totals, deposits, balance, and manual refund records (4A).
- [ ] Implement ready-stock allocation where included (blocked: stock-count policy, PRD decision 7).
- [x] Implement Counter Sale quick checkout with split payments and change calculation (AC-28, 4B).
- [x] Implement manual order discounts (amount or %) with reason, attribution, and a counter-staff limit (4B).
- [x] Implement GST bills (gap-free per financial year, per-rate CGST/SGST), credit notes, and 80mm/A4 print (AC-29, 4B).
- [x] Implement due-date calendar (agenda + month) with source/kitchen/status filters (4A). Week/day views remain for 4C.
- [x] Implement window/day caps and admin overrides with reason (AC-32, staff side; `supabase/tests/capacity_logic.sql`). The website side uses `pickup_availability` in Phase 6.
- [x] Implement rescheduling, opening-hours/closure/lead-time validation, conflict detection, and cancellation history (4A).
- [x] Implement the admin-override action with mandatory reason (at least 5 characters) and timeline entry (AC-36, shared `OverridePrompt`). Kitchen acknowledgement of released-work changes comes with Phase 5.
- [ ] Implement notification templates, sent-records, and the pending-order alert (AC-31).
- [x] Verify AC-01, AC-07, AC-11, AC-17, AC-18, AC-19 (22 SQL checks in `supabase/tests/orders_logic.sql`, 29 end-to-end checks, 2026-09-27).
- [x] Verify AC-28 and AC-29 (billing SQL checks in `supabase/tests/billing_logic.sql`; HTTP checks of all rejection paths, 2026-09-27). Success paths were not run over HTTP to avoid consuming real bill numbers.
- [ ] Verify AC-10 (needs handover, Phase 5), AC-32, and AC-36 once 4C lands.
- [ ] Set up a staging Supabase project so end-to-end tests can create real bills without touching the live bill sequence (see Start here).

### Phase 4C — next up

- [x] Pickup windows per weekday with limits, daily caps per category (counting orders), festival date overrides, admin override with reason (AC-32). Cut-offs dropped. **Browser click-through of Settings → Capacity and the new-order/reschedule panels still to do.**
- [x] Calendar week and day views (day view grouped by pickup window with window and category usage). **Browser click-through still to do** (no orders in the database yet).
- [x] Admin override prompt as a shared component with mandatory reason and timeline entry (AC-36).
- [ ] Notification templates: WhatsApp click-to-chat links for accepted/rejected/rescheduled/ready/cancelled, `notification_records` table, pending-order alert after N minutes (PRD 5F, AC-31).
- [x] Customer blocking and no-show recording (HANDOVER section 9; `supabase/tests/no_show_logic.sql` 26/26). Recording a no-show does not change the order's status. **Browser click-through still to do.**
- [x] Editing items on pending and confirmed orders (HANDOVER section 10; `supabase/tests/edit_items_logic.sql` 21/21). **Browser click-through still to do.** Phase 5 must turn edits to released work into acknowledged revisions.
- [x] Demo-login autofill on `/login` for admin and chef, controlled by `DEMO_*` env variables (owner allowed it in production).
- [x] First Vercel production deployment (`bakery-admin` project, manual `vercel deploy --prod` from `web/`; Git integration not connected).

Exit: a staff-entered order remains consistent across lists, detail, calendar, and payment records.

## Phase 5 — KOT and chef workflow

Depends on: confirmed orders from Phase 4.

- [ ] Generate separate kitchen tickets from the relevant order items.
- [ ] Implement Scheduled/New release timing, restart recovery, and duplicate prevention.
- [ ] Implement chef queues, kitchen schedule, source filters, and order/item detail.
- [ ] Implement acknowledgement, preparation, partial quantities, readiness, and issue reporting.
- [ ] Derive aggregate readiness; implement packing and handover steps.
- [ ] Implement basic packing confirmation with packer attribution and one-time handover recording (AC-22, basic part).
- [ ] Implement revisions, cancellation acknowledgements, and controlled kitchen reassignment.
- [ ] Implement live updates, connectivity state, and recovery.
- [ ] Implement KOT browser print/reprint (80mm) preserving ticket identity and revision.
- [ ] Show eggless/veg marks prominently on KOT lines (AC-33).
- [ ] Verify AC-02 through AC-05, AC-08, AC-09, AC-12 through AC-14, AC-16, and AC-33.

Exit: two kitchen users can complete a mixed order without duplicated work or premature readiness.

## Phase 6 — Public website and customer flow

Depends on: approved content/design and stable order handling. Catalogue content can be prepared earlier.

- [ ] Implement the public home, products, details, contact, and policy pages.
- [ ] Replace unverified claims and placeholder business data with owner-supplied content.
- [ ] Compress and resize prototype photos (WebP/AVIF, responsive sizes) before reuse.
- [ ] Show veg/egg marks and FSSAI licence number on the site.
- [ ] Implement cart, slot selection, submission, confirmation, and protected status access.
- [ ] Implement phone OTP (or captcha plus callback), rate limits, number blocking, and deposit threshold (AC-30).
- [ ] Reuse the shared order/routing rules for public orders.
- [ ] Implement explicit pending acceptance, validation, submission recovery, and duplicate protection.
- [ ] Implement customer confirmation/status messaging through the chosen channel.
- [ ] Verify public flows, mobile usability, keyboard access, AC-07, AC-15, AC-17, and AC-30.
- [ ] Review the rendered website against the chosen visual references.

Exit: a customer can follow the chosen ordering process, and staff can fulfill the resulting order.

## Phase 7 — Admin overview and complete rehearsal

Depends on: Phases 4–6, adjusted for chosen public scope.

- [ ] Add kitchen workload and remaining alerts to Home. Due today, awaiting confirmation, overdue, balance due, next-7-days, missing-routing alert, and setup checklist are done.
- [ ] Validate dashboard counts and dates against underlying order records.
- [ ] Implement the daily sales report with CSV export (AC-35).
- [ ] Complete settings and staff-management screens.
- [ ] Run all Release 1 acceptance scenarios (PRD section 12), including concurrent edits and interrupted connections; run AC-26/AC-27 if selected for launch.
- [ ] Rehearse exceptions using admin overrides: unavailable item, damaged item, late pickup (AC-36).
- [ ] Rehearse a full shift with counter staff and one user in each kitchen on real devices.
- [ ] Verify print output if printing is in scope.
- [ ] Check typical-volume performance and the proposed kitchen-update target.
- [ ] Restore a backup in staging and verify recovered records (AC-20).
- [ ] Prepare operating guidance for order changes, kitchen issues, cancellations, and recovery.

Exit: owner/staff acceptance recorded; blocking defects resolved and known limits documented.

## Phase 8 — Launch preparation and rollout

- [ ] Load verified products, prices, kitchen mappings, hours, policies, and real staff accounts.
- [ ] Confirm domain/hosting and any paid integrations before committing spend.
- [ ] Configure production secrets, backups, monitoring, and staff recovery procedures.
- [ ] Record launch readiness, support ownership, and rollback instructions.
- [ ] Publish when requested and run a controlled end-to-end production order.
- [ ] Observe initial operating shifts and resolve production issues.
- [ ] Review admin-override logs from the first weeks to prioritize Release 1.1 workflows.

## Phase 9 — Release 1.1 operational exceptions

Depends on: Release 1 live and stable. Use override logs to confirm priorities.

- [ ] Implement per-kitchen daily production summary with variant/time grouping and contributing ticket links (AC-21).
- [ ] Implement the itemized packing checklist with revision-driven rechecking (AC-22, full).
- [ ] Implement substitution proposals, customer response evidence, affected-work holds, and approved order revisions (AC-23).
- [ ] Implement quality incidents, usable-quantity adjustments, approved remake tickets, after-sales replacement handover, and waste register (AC-24).
- [ ] Implement late/uncollected flags, manual contact history, hold deadlines, reviewed extensions, and disposition records (AC-25).
- [ ] Verify AC-21 through AC-25, including their interactions with kitchen routing, cancellation, packing, and payments.

## Later backlog — outside the default first release

### Conditional operational modules — timing to be decided

These modules are fully described in PRD section 5E. Move their tasks into the release plan if selected; basic payment records and manual quotes remain part of the first release regardless.

- [ ] Daily reconciliation: define register/shift scope, transaction intervals, opening float, cash movements, expected/count totals, difference review, and audited closing/reopening.
- [ ] Daily reconciliation: implement admin Daily Close after payment records exist; verify deposit timing, refund handling, duplicate interval protection, and AC-26.
- [ ] Bulk/custom specifications: define required fields, reference files, quote versions, customer acceptance, expiry, deposit conditions, and change deadlines.
- [ ] Bulk/custom specifications: implement versioned quote-to-order handling after order revisions exist; verify only accepted specifications release, file access is restricted, and AC-27 passes.

### Deferred integrations and larger features

- [ ] Online payment gateway and automated refunds.
- [ ] Delivery/driver operations and delivery marketplace integrations.
- [ ] Automated customer SMS, email, or WhatsApp notifications.
- [ ] Raw-material inventory, recipes, purchasing, and production batches.
- [ ] Loyalty, promotions, accounts, and advanced reporting.
- [ ] Multiple branches and multi-stage cross-kitchen items.
- [ ] Dedicated printer integration, full offline operation, and automatic capacity planning.

## Tracking conventions

- Use task states: Planned, In Progress, Blocked, Done when assigning work later.
- For a blocked task, record the missing decision/dependency and the next action.
- Add an owner and estimate after business scope and stack are settled; current phases are dependency-based, not a promised schedule.
- Mark implementation tasks complete only with evidence appropriate to the change.
- Update PRD first when a task changes agreed behavior; keep this checklist consistent with it.
