"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Field, Input, Select, Textarea, VegMark, cx } from "@/components/ui";
import { SourceBadge } from "@/components/order-badges";
import { formatDateTime, formatTime } from "@/lib/time";
import {
  ADMIN_KITCHEN_REASON_MIN,
  KITCHEN_OFFLINE_EVENT,
  actionFollowUp,
  describeChange,
  issueKindLabel,
  ticketStatusLabel,
  ticketStatusTone,
  type IssueKind,
  type KitchenTicket,
} from "@/lib/kitchen";
import {
  acknowledgeStopWorkAction,
  acknowledgeTicketAction,
  acknowledgeTicketChangesAction,
  recordTicketPrintAction,
  reportIssueAction,
  setLineReadyAction,
  startTicketAction,
} from "@/app/kitchen/actions";

// chef: a chef on their own kitchen. admin: an admin acting as the kitchen (reason required).
// view: counter staff and finished tickets (print only).
export type TicketMode = "chef" | "admin" | "view";

type Outcome = { ok?: boolean; message?: string };

// Runs a ticket action. A thrown error means the request never reached the server, so nothing was
// saved: tell the header (it shows Offline) and do not refresh, because a refresh on a dropped
// connection reloads the whole page into the browser's offline screen.
function useTicketAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<Outcome>, onDone?: () => void) {
    setError(null);
    start(async () => {
      let result: Outcome | "network-error";
      try {
        result = await action();
      } catch {
        result = "network-error";
      }
      const next = actionFollowUp(result);
      setError(next.message);
      if (result !== "network-error" && result.ok) onDone?.();
      if (next.offline) window.dispatchEvent(new Event(KITCHEN_OFFLINE_EVENT));
      if (next.refresh) router.refresh();
    });
  }
  return { pending, error, run };
}

function AdminReason({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label="Reason for acting as the kitchen (recorded)"
      htmlFor={`reason-${id}`}
      hint={`At least ${ADMIN_KITCHEN_REASON_MIN} characters.`}
      className="mt-3"
    >
      <Input id={`reason-${id}`} value={value} onChange={(e) => onChange(e.target.value)} maxLength={300} />
    </Field>
  );
}

export function TicketCard({
  ticket,
  tz,
  mode,
  nowIso,
  orderHref,
}: {
  ticket: KitchenTicket;
  tz: string;
  mode: TicketMode;
  nowIso: string;
  orderHref?: string;
}) {
  const { pending, error, run } = useTicketAction();
  const [reason, setReason] = useState("");
  const [partLine, setPartLine] = useState<string | null>(null);
  const [partCount, setPartCount] = useState("");
  const [reporting, setReporting] = useState(false);

  const now = Date.parse(nowIso);
  const open = ticket.status !== "cancelled";
  const working = open && ticket.status !== "ready";
  const lateStart = working && Date.parse(ticket.start_by) < now;
  const overdue = working && Date.parse(ticket.due_at) < now;
  const canAct = mode === "chef" || (mode === "admin" && reason.trim().length >= ADMIN_KITCHEN_REASON_MIN);
  const adminReason = mode === "admin" ? reason.trim() : undefined;
  const openIssues = ticket.issues.filter((i) => !i.resolved_at);
  const changes = open ? ticket.pending_changes : [];

  return (
    <article className={cx("rounded-xl border bg-surface p-4", overdue ? "border-2 border-danger" : "border-line")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-lg font-semibold">{ticket.reference}</h3>
            <SourceBadge source={ticket.source} />
            {ticket.revision > 1 && <Badge tone="warn">Revised</Badge>}
            <Badge tone={ticketStatusTone[ticket.status]}>{ticketStatusLabel[ticket.status]}</Badge>
          </div>
          {orderHref && (
            <Link href={orderHref} className="text-sm text-brand hover:underline">
              Open order
            </Link>
          )}
        </div>
        <div className="text-right">
          <p className={cx("text-lg font-semibold", overdue && "text-danger")}>Pickup {formatDateTime(ticket.due_at, tz)}</p>
          <p className={cx("text-sm", lateStart ? "font-semibold text-danger" : "text-muted")}>
            Start by {formatTime(ticket.start_by, tz)}
          </p>
        </div>
      </header>

      {changes.length > 0 && (
        <div role="alert" className="mt-3 rounded-lg border-2 border-warn bg-warn-soft p-3">
          <p className="text-lg font-bold">Changed · revision {ticket.revision}</p>
          <ul className="mt-1 list-disc pl-5 text-base">
            {changes.map((c) => (
              <li key={c.key}>{describeChange(c, (iso) => formatDateTime(iso, tz))}</li>
            ))}
          </ul>
          {mode !== "view" && (
            <Button
              className="mt-3 px-5 py-3 text-base"
              disabled={pending || !canAct}
              onClick={() => run(() => acknowledgeTicketChangesAction(ticket.id, adminReason))}
            >
              {pending ? "Saving…" : "Acknowledge changes"}
            </Button>
          )}
        </div>
      )}

      {mode === "admin" && (working || changes.length > 0) && <AdminReason id={ticket.id} value={reason} onChange={setReason} />}

      <ul className="mt-3 divide-y divide-line">
        {ticket.lines.map((l) =>
          l.status === "cancelled" && open ? (
            <li key={l.id} className="py-3 text-lg text-muted">
              <span className="line-through">
                {l.product_name} — {l.variant_name}
              </span>{" "}
              <Badge tone="danger">Removed</Badge>
            </li>
          ) : (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">
                  <span className="mr-2 text-2xl tabular-nums">{l.quantity}×</span>
                  {l.product_name} — {l.variant_name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <VegMark isVeg={l.is_veg} />
                  {l.is_eggless ? <Badge tone="ok">Eggless</Badge> : l.contains_egg && <Badge tone="warn">Contains egg</Badge>}
                  {l.allergens.length > 0 && <span className="font-medium text-danger">Allergens: {l.allergens.join(", ")}</span>}
                </div>
                {l.notes && <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-base font-medium">“{l.notes}”</p>}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={cx("text-sm tabular-nums", l.ready_quantity === l.quantity ? "font-semibold text-ok" : "text-muted")}>
                  {l.ready_quantity}/{l.quantity} ready
                </span>
                {working && mode !== "view" && (
                  <div className="flex gap-2">
                    {l.ready_quantity < l.quantity && (
                      <Button
                        className="px-5 py-3 text-base"
                        disabled={pending || !canAct}
                        onClick={() => run(() => setLineReadyAction(l.id, l.quantity, adminReason))}
                      >
                        Ready
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      className="py-3"
                      disabled={pending || !canAct}
                      onClick={() => {
                        setPartLine(partLine === l.id ? null : l.id);
                        setPartCount(String(l.ready_quantity));
                      }}
                    >
                      Part ready
                    </Button>
                  </div>
                )}
                {partLine === l.id && (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!canAct) return;
                      run(() => setLineReadyAction(l.id, Number(partCount), adminReason), () => setPartLine(null));
                    }}
                  >
                    <label htmlFor={`part-${l.id}`} className="text-sm">
                      Ready
                    </label>
                    <Input
                      id={`part-${l.id}`}
                      inputMode="numeric"
                      className="w-20 text-center text-base"
                      value={partCount}
                      onChange={(e) => setPartCount(e.target.value.replace(/\D/g, ""))}
                    />
                    <span className="text-sm text-muted">of {l.quantity}</span>
                    <Button type="submit" variant="secondary" disabled={pending || !canAct || partCount === ""}>
                      Save
                    </Button>
                  </form>
                )}
              </div>
            </li>
          ),
        )}
      </ul>

      {openIssues.length > 0 && (
        <Alert tone="danger" title="Issue reported">
          <ul>
            {openIssues.map((i) => (
              <li key={i.id}>
                {issueKindLabel[i.kind as IssueKind] ?? i.kind}: {i.note}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {/* Every ticket can be printed, cancelled ones too (the print says CANCELLED · DO NOT MAKE).
          The action buttons below only match tickets that are still open. */}
      <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {mode !== "view" && ticket.status === "new" && (
          <Button variant="secondary" className="py-3" disabled={pending || !canAct}
            onClick={() => run(() => acknowledgeTicketAction(ticket.id, adminReason))}>
            Acknowledge
          </Button>
        )}
        {mode !== "view" && (ticket.status === "new" || ticket.status === "acknowledged") && (
          <Button className="py-3" disabled={pending || !canAct} onClick={() => run(() => startTicketAction(ticket.id, adminReason))}>
            Start
          </Button>
        )}
        {mode !== "view" && working && (
          <Button variant="secondary" className="py-3" onClick={() => setReporting(!reporting)}>
            Report issue
          </Button>
        )}
        <PrintTicketButton ticketId={ticket.id} />
      </footer>
      {reporting && <IssueForm ticket={ticket} onDone={() => setReporting(false)} />}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </article>
  );
}

function IssueForm({ ticket, onDone }: { ticket: KitchenTicket; onDone: () => void }) {
  const { pending, error, run } = useTicketAction();
  const [kind, setKind] = useState<IssueKind>("ingredient");
  const [lineId, setLineId] = useState("");
  const [note, setNote] = useState("");

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-lg border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => reportIssueAction({ ticketId: ticket.id, lineId: lineId || null, kind, note }), onDone);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened" htmlFor={`kind-${ticket.id}`}>
          <Select id={`kind-${ticket.id}`} value={kind} onChange={(e) => setKind(e.target.value as IssueKind)}>
            {(Object.keys(issueKindLabel) as IssueKind[]).map((k) => (
              <option key={k} value={k}>
                {issueKindLabel[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Item" htmlFor={`line-${ticket.id}`}>
          <Select id={`line-${ticket.id}`} value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">Whole ticket</option>
            {ticket.lines.filter((l) => l.status !== "cancelled").map((l) => (
              <option key={l.id} value={l.id}>
                {l.product_name} — {l.variant_name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Note for the admin" htmlFor={`note-${ticket.id}`}>
        <Textarea id={`note-${ticket.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required />
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending || note.trim().length < 3}>
          {pending ? "Sending…" : "Send to admin"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function StopWorkNotice({ ticket, tz, mode }: { ticket: KitchenTicket; tz: string; mode: TicketMode }) {
  const { pending, error, run } = useTicketAction();
  const [reason, setReason] = useState("");
  const canAct = mode === "chef" || (mode === "admin" && reason.trim().length >= ADMIN_KITCHEN_REASON_MIN);

  return (
    <article role="alert" className="rounded-xl border-2 border-danger bg-danger-soft p-4">
      <p className="text-xl font-bold text-danger">STOP WORK · {ticket.reference}</p>
      <p className="mt-1 text-base">
        {ticket.cancel_reason ?? "Cancelled"}
        {ticket.cancelled_at && ` · ${formatTime(ticket.cancelled_at, tz)}`}
      </p>
      <ul className="mt-2 text-base">
        {ticket.lines.map((l) => (
          <li key={l.id}>
            {l.quantity}× {l.product_name} — {l.variant_name}
            {l.ready_quantity > 0 && ` (${l.ready_quantity} already made)`}
          </li>
        ))}
      </ul>
      {mode === "admin" && <AdminReason id={`stop-${ticket.id}`} value={reason} onChange={setReason} />}
      {mode !== "view" && (
        <Button
          variant="danger"
          className="mt-3 py-3 text-base"
          disabled={pending || !canAct}
          onClick={() => run(() => acknowledgeStopWorkAction(ticket.id, mode === "admin" ? reason.trim() : undefined))}
        >
          {pending ? "Saving…" : "I've stopped this work"}
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </article>
  );
}

// Records the print first (so reprints show COPY), then opens the 80mm ticket in a new tab. The tab
// opens during the click so pop-up blockers allow it.
export function PrintTicketButton({ ticketId }: { ticketId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        className="py-3"
        disabled={pending}
        onClick={() => {
          setError(null);
          const win = window.open("", "_blank");
          start(async () => {
            try {
              const result = await recordTicketPrintAction(ticketId);
              if (result.ok) {
                if (win) win.location.href = `/print/kot/${ticketId}`;
              } else {
                win?.close();
                setError(result.message ?? "Could not print.");
              }
            } catch {
              win?.close();
              setError("Not saved, check the connection.");
              window.dispatchEvent(new Event(KITCHEN_OFFLINE_EVENT));
            }
          });
        }}
      >
        {pending ? "Preparing…" : "Print"}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
    </>
  );
}
