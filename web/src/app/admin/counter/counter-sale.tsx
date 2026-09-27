"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert, Button, Card, Field, Input, Select, VegMark, cx } from "@/components/ui";
import { formatPaise, parseRupeesToPaise, paiseToRupeesInput } from "@/lib/money";
import { paymentMethodLabel, type PaymentMethod } from "@/lib/orders";
import { counterSaleAction } from "./actions";

export type CounterItem = {
  variantId: string;
  productName: string;
  variantName: string;
  category: string;
  pricePaise: number;
  isVeg: boolean;
  isEggless: boolean;
};

type Split = { key: string; method: PaymentMethod; amount: string; reference: string };
type Done = { billId: string; billNumber: string; reference: string; totalPaise: number; changePaise: number };

const QUICK_METHODS: PaymentMethod[] = ["cash", "upi", "card"];

export function CounterSale({ items, discountLimitBps, isAdmin }: { items: CounterItem[]; discountLimitBps: number; isAdmin: boolean }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountKind, setDiscountKind] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  const [reference, setReference] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<Split[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, start] = useTransition();

  const byId = useMemo(() => new Map(items.map((i) => [i.variantId, i])), [items]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => `${i.productName} ${i.variantName} ${i.category}`.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const subtotal = [...cart].reduce((s, [id, qty]) => s + (byId.get(id)?.pricePaise ?? 0) * qty, 0);
  const discountInput = discountOpen ? discountValue.trim() : "";
  const discountBps = discountKind === "percent" && /^\d+(\.\d{1,2})?$/.test(discountInput) ? Math.round(Number(discountInput) * 100) : 0;
  const discountPaise = !discountInput
    ? 0
    : discountKind === "percent"
      ? Math.round((subtotal * Math.min(discountBps, 10000)) / 10000)
      : parseRupeesToPaise(discountInput) ?? 0;
  const total = Math.max(0, subtotal - discountPaise);
  const overLimit = !isAdmin && discountPaise > Math.round((subtotal * discountLimitBps) / 10000);
  const tenderedPaise = parseRupeesToPaise(tendered);
  const change = method === "cash" && !splitMode && tenderedPaise !== null && tenderedPaise > total ? tenderedPaise - total : 0;
  const splitTotal = splits.reduce((s, p) => s + (parseRupeesToPaise(p.amount) ?? 0), 0);

  function add(id: string) {
    setError(null);
    setCart((c) => new Map(c).set(id, Math.min(999, (c.get(id) ?? 0) + 1)));
  }
  function setQty(id: string, qty: number) {
    setCart((c) => {
      const next = new Map(c);
      if (qty <= 0) next.delete(id);
      else next.set(id, Math.min(999, qty));
      return next;
    });
  }

  function reset() {
    setKey(crypto.randomUUID());
    setCart(new Map());
    setDiscountOpen(false);
    setDiscountValue("");
    setDiscountReason("");
    setMethod("cash");
    setTendered("");
    setReference("");
    setSplitMode(false);
    setSplits([]);
    setCustomerName("");
    setCustomerPhone("");
    setError(null);
    setDone(null);
    setQuery("");
  }

  function charge() {
    setError(null);
    if (cart.size === 0) return setError("Add at least one item.");
    if (method === "cash" && !splitMode && tendered && (tenderedPaise === null || tenderedPaise < total)) {
      return setError("Cash received is less than the total.");
    }
    const payments = splitMode
      ? splits.map((s) => ({ method: s.method, amountPaise: parseRupeesToPaise(s.amount) ?? 0, reference: s.reference || undefined }))
      : total > 0
        ? [{ method, amountPaise: total, reference: reference || undefined }]
        : [];
    if (splitMode && splitTotal !== total) return setError(`Split payments add up to ${formatPaise(splitTotal)}; the total is ${formatPaise(total)}.`);

    start(async () => {
      const result = await counterSaleAction({
        idempotencyKey: key,
        items: [...cart].map(([variantId, quantity]) => ({ variantId, quantity })),
        payments,
        discount: discountPaise > 0 ? { kind: discountKind, value: discountKind === "percent" ? discountBps : discountPaise, reason: discountReason } : undefined,
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
      });
      if (result.ok) {
        setDone({ billId: result.billId, billNumber: result.billNumber, reference: result.reference, totalPaise: result.totalPaise, changePaise: change });
      } else {
        setError(result.message ?? "Sale not saved.");
      }
    });
  }

  if (done) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="text-sm font-medium uppercase tracking-wider text-ok">Sale complete</p>
        <p className="mt-2 text-3xl font-semibold">{formatPaise(done.totalPaise)}</p>
        {done.changePaise > 0 && <p className="mt-2 text-xl font-semibold text-brand-strong">Change to give: {formatPaise(done.changePaise)}</p>}
        <p className="mt-3 text-sm text-muted">
          Bill <span className="font-mono">{done.billNumber}</span> · Order <span className="font-mono">{done.reference}</span>
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href={`/print/bill/${done.billId}?size=80mm`} target="_blank" rel="noreferrer"
            className="inline-flex items-center justify-center rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium hover:bg-brand-soft">
            Print bill
          </a>
          <Button className="px-5 py-2.5" onClick={reset} autoFocus>New sale</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Card>
        <label htmlFor="counter-search" className="sr-only">Search items</label>
        <Input id="counter-search" type="search" placeholder="Search ready-stock items" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No ready-stock items match. Made-to-order items use a normal order.</p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((i) => {
              const qty = cart.get(i.variantId) ?? 0;
              return (
                <li key={i.variantId}>
                  <button type="button" onClick={() => add(i.variantId)}
                    className={cx("flex h-full w-full flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors hover:border-brand hover:bg-brand-soft",
                      qty > 0 ? "border-brand bg-brand-soft/60" : "border-line bg-surface")}>
                    <span className="flex w-full items-start justify-between gap-2">
                      <span className="font-medium leading-snug">{i.productName}</span>
                      {qty > 0 && <span className="rounded-full bg-brand px-2 text-xs font-semibold text-white">{qty}</span>}
                    </span>
                    <span className="text-xs text-muted">{i.variantName}{i.isEggless && " · Eggless"}</span>
                    <span className="mt-auto flex w-full items-center justify-between pt-1">
                      <VegMark isVeg={i.isVeg} />
                      <span className="font-semibold">{formatPaise(i.pricePaise)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="mb-2 text-lg font-semibold">Sale</h2>
          {cart.size === 0 ? (
            <p className="text-sm text-muted">Tap items to add them.</p>
          ) : (
            <ul className="divide-y divide-line">
              {[...cart].map(([id, qty]) => {
                const i = byId.get(id)!;
                return (
                  <li key={id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{i.productName}</p>
                      <p className="text-xs text-muted">{i.variantName} · {formatPaise(i.pricePaise)}</p>
                    </div>
                    <Button type="button" variant="secondary" className="px-2 py-1" aria-label={`Remove one ${i.productName}`} onClick={() => setQty(id, qty - 1)}>−</Button>
                    <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty}</span>
                    <Button type="button" variant="secondary" className="px-2 py-1" aria-label={`Add one ${i.productName}`} onClick={() => setQty(id, qty + 1)}>+</Button>
                    <span className="w-20 text-right text-sm font-medium">{formatPaise(i.pricePaise * qty)}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-3 border-t border-line pt-3">
            {!discountOpen ? (
              <button type="button" className="text-sm text-brand hover:underline" onClick={() => setDiscountOpen(true)}>Add discount</button>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <label className="sr-only" htmlFor="disc-kind">Discount type</label>
                  <Select id="disc-kind" value={discountKind} onChange={(e) => setDiscountKind(e.target.value as "percent" | "amount")} className="w-24">
                    <option value="percent">%</option>
                    <option value="amount">₹</option>
                  </Select>
                  <label className="sr-only" htmlFor="disc-value">Discount</label>
                  <Input id="disc-value" inputMode="decimal" placeholder={discountKind === "percent" ? "10" : "50"} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
                  <Button type="button" variant="ghost" onClick={() => { setDiscountOpen(false); setDiscountValue(""); }}>Remove</Button>
                </div>
                <label className="sr-only" htmlFor="disc-reason">Discount reason</label>
                <Input id="disc-reason" placeholder="Reason (required)" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} maxLength={300} />
                {!isAdmin && <p className={cx("text-xs", overLimit ? "text-danger" : "text-muted")}>Counter limit: {discountLimitBps / 100}% off. Larger discounts need an admin.</p>}
              </div>
            )}
          </div>

          <dl className="mt-3 flex flex-col gap-1 text-sm">
            {discountPaise > 0 && (
              <>
                <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatPaise(subtotal)}</dd></div>
                <div className="flex justify-between text-ok"><dt>Discount</dt><dd>−{formatPaise(discountPaise)}</dd></div>
              </>
            )}
            <div className="flex items-baseline justify-between"><dt className="font-medium">Total (incl. GST)</dt><dd className="text-2xl font-semibold">{formatPaise(total)}</dd></div>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Payment</h2>
            <button type="button" className="text-sm text-brand hover:underline" onClick={() => {
              setSplitMode(!splitMode);
              setSplits(splitMode ? [] : [
                { key: crypto.randomUUID(), method: "cash", amount: "", reference: "" },
                { key: crypto.randomUUID(), method: "upi", amount: "", reference: "" },
              ]);
            }}>
              {splitMode ? "Single payment" : "Split payment"}
            </button>
          </div>
          {!splitMode ? (
            <>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment method">
                {QUICK_METHODS.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                    className={cx("rounded-lg border px-3 py-2.5 text-sm font-medium", method === m ? "border-brand bg-brand text-white" : "border-line bg-surface hover:bg-brand-soft")}>
                    {paymentMethodLabel[m]}
                  </button>
                ))}
              </div>
              {method === "cash" ? (
                <Field label="Cash received (optional)" htmlFor="tendered" hint={change > 0 ? `Change: ${formatPaise(change)}` : "Enter to calculate change."}>
                  <Input id="tendered" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={paiseToRupeesInput(total)} />
                </Field>
              ) : (
                <Field label="Transaction reference (optional)" htmlFor="pay-ref">
                  <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
                </Field>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {splits.map((s, idx) => (
                <div key={s.key} className="flex gap-2">
                  <label className="sr-only" htmlFor={`split-m-${idx}`}>Method</label>
                  <Select id={`split-m-${idx}`} value={s.method} className="w-32"
                    onChange={(e) => setSplits((c) => c.map((x) => (x.key === s.key ? { ...x, method: e.target.value as PaymentMethod } : x)))}>
                    {QUICK_METHODS.map((m) => <option key={m} value={m}>{paymentMethodLabel[m]}</option>)}
                  </Select>
                  <label className="sr-only" htmlFor={`split-a-${idx}`}>Amount</label>
                  <Input id={`split-a-${idx}`} inputMode="decimal" placeholder="Amount" value={s.amount}
                    onChange={(e) => setSplits((c) => c.map((x) => (x.key === s.key ? { ...x, amount: e.target.value } : x)))} />
                </div>
              ))}
              <p className={cx("text-xs", splitTotal === total ? "text-ok" : "text-muted")}>
                {formatPaise(splitTotal)} of {formatPaise(total)}
              </p>
            </div>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Customer details (optional)</summary>
            <div className="mt-2 grid gap-2">
              <Input aria-label="Customer name" placeholder="Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={80} />
              <Input aria-label="Customer phone" type="tel" placeholder="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            </div>
          </details>
        </Card>

        {error && <Alert tone="danger">{error}</Alert>}
        <Button className="py-3.5 text-base" disabled={pending || cart.size === 0 || overLimit || (discountPaise > 0 && !discountReason.trim())} onClick={charge}>
          {pending ? "Completing sale…" : `Charge ${formatPaise(total)}`}
        </Button>
      </div>
    </div>
  );
}
