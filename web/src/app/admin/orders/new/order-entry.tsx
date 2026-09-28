"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Textarea, VegMark, cx } from "@/components/ui";
import { SourceBadge } from "@/components/order-badges";
import { formatLeadTime, formatPaise } from "@/lib/money";
import { OverridePrompt } from "@/components/override-prompt";
import { PickupWindows } from "@/components/pickup-windows";
import { createOrderAction } from "../actions";

export type CatalogueProduct = {
  id: string;
  name: string;
  category: string;
  categoryId: string;
  isVeg: boolean;
  containsEgg: boolean;
  prepType: "made_to_order" | "ready_stock";
  variants: { id: string; name: string; pricePaise: number; isEggless: boolean; leadTimeMinutes: number; hasKitchen: boolean }[];
};

type Line = { key: string; productId: string; variantId: string; quantity: number; notes: string };

export function OrderEntry({
  source,
  catalogue,
  canConfirm,
  isAdmin,
  defaultDueLocal,
  minDueLocal,
}: {
  source: "IN_STORE" | "CALL";
  catalogue: CatalogueProduct[];
  canConfirm: boolean;
  isAdmin: boolean;
  defaultDueLocal: string;
  minDueLocal: string;
}) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [pickupNow, setPickupNow] = useState(source === "IN_STORE");
  const [dueLocal, setDueLocal] = useState(defaultDueLocal);
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [confirm, setConfirm] = useState(canConfirm && source === "IN_STORE");
  const [error, setError] = useState<{ message: string; kind?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const variantIndex = useMemo(() => {
    const map = new Map<string, { product: CatalogueProduct; variant: CatalogueProduct["variants"][number] }>();
    for (const product of catalogue) for (const variant of product.variants) map.set(variant.id, { product, variant });
    return map;
  }, [catalogue]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? catalogue.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) : catalogue;
  }, [catalogue, query]);

  const total = lines.reduce((sum, l) => sum + (variantIndex.get(l.variantId)?.variant.pricePaise ?? 0) * l.quantity, 0);
  const maxLead = lines.reduce((max, l) => {
    const entry = variantIndex.get(l.variantId);
    return entry && entry.product.prepType === "made_to_order" ? Math.max(max, entry.variant.leadTimeMinutes) : max;
  }, 0);
  const unmapped = lines.filter((l) => {
    const e = variantIndex.get(l.variantId);
    return e && e.product.prepType === "made_to_order" && !e.variant.hasKitchen;
  });
  const categoryIds = [...new Set(lines.map((l) => variantIndex.get(l.variantId)?.product.categoryId).filter((id): id is string => Boolean(id)))];
  const needsCustomer = source === "CALL" || !pickupNow;

  function addVariant(productId: string, variantId: string) {
    setError(null);
    setLines((current) => {
      const existing = current.find((l) => l.variantId === variantId && !l.notes);
      if (existing) return current.map((l) => (l === existing ? { ...l, quantity: Math.min(999, l.quantity + 1) } : l));
      return [...current, { key: crypto.randomUUID(), productId, variantId, quantity: 1, notes: "" }];
    });
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function submit(overrideReason?: string) {
    setError(null);
    startTransition(async () => {
      const result = await createOrderAction({
        idempotencyKey,
        source,
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, notes: l.notes })),
        customerName,
        customerPhone,
        dueLocal: pickupNow ? null : dueLocal,
        customerNotes,
        internalNotes,
        confirm,
        overrideReason,
      });
      if (result.ok) {
        router.push(`/admin/orders/${result.orderId}?created=1`);
      } else {
        setError({ message: result.message ?? "Could not save the order.", kind: result.kind });
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      {/* Catalogue */}
      <Card className="order-2 lg:order-1">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Add items</h2>
          <SourceBadge source={source} />
        </div>
        <label htmlFor="product-search" className="sr-only">Search products</label>
        <Input
          id="product-search"
          type="search"
          placeholder="Search products or categories"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <ul className="mt-4 flex max-h-[32rem] flex-col gap-3 overflow-y-auto pr-1">
          {filtered.length === 0 && <li className="py-6 text-center text-sm text-muted">No available products match.</li>}
          {filtered.map((p) => (
            <li key={p.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <VegMark isVeg={p.isVeg} />
                <span className="text-xs text-muted">{p.category}</span>
                {p.prepType === "ready_stock" && <Badge>Ready stock</Badge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => addVariant(p.id, v.id)}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-left text-sm hover:border-brand hover:bg-brand-soft"
                  >
                    <span className="font-medium">{v.name}</span> · {formatPaise(v.pricePaise)}
                    {v.isEggless && <span className="ml-1 text-xs text-ok">Eggless</span>}
                    {p.prepType === "made_to_order" && v.leadTimeMinutes > 0 && (
                      <span className="ml-1 text-xs text-muted">({formatLeadTime(v.leadTimeMinutes)})</span>
                    )}
                    {p.prepType === "made_to_order" && !v.hasKitchen && <span className="ml-1 text-xs text-danger">No kitchen</span>}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Order */}
      <div className="order-1 flex flex-col gap-4 lg:order-2">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Order</h2>
          {lines.length === 0 ? (
            <p className="text-sm text-muted">No items yet. Pick products from the list.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {lines.map((l) => {
                const entry = variantIndex.get(l.variantId);
                if (!entry) return null;
                return (
                  <li key={l.key} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{entry.product.name}</p>
                        <p className="text-sm text-muted">
                          {entry.variant.name}
                          {entry.variant.isEggless && " · Eggless"} · {formatPaise(entry.variant.pricePaise)}
                        </p>
                      </div>
                      <p className="whitespace-nowrap font-medium">{formatPaise(entry.variant.pricePaise * l.quantity)}</p>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button type="button" variant="secondary" className="px-2.5 py-1" aria-label={`Decrease ${entry.product.name}`}
                        onClick={() => updateLine(l.key, { quantity: Math.max(1, l.quantity - 1) })}>−</Button>
                      <label className="sr-only" htmlFor={`qty-${l.key}`}>Quantity</label>
                      <Input id={`qty-${l.key}`} inputMode="numeric" className="w-16 text-center" value={l.quantity}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/g, ""));
                          updateLine(l.key, { quantity: Math.min(999, Math.max(1, n || 1)) });
                        }} />
                      <Button type="button" variant="secondary" className="px-2.5 py-1" aria-label={`Increase ${entry.product.name}`}
                        onClick={() => updateLine(l.key, { quantity: Math.min(999, l.quantity + 1) })}>+</Button>
                      <Button type="button" variant="ghost" className="ml-auto" onClick={() => setLines((c) => c.filter((x) => x.key !== l.key))}>
                        Remove
                      </Button>
                    </div>
                    <label className="sr-only" htmlFor={`notes-${l.key}`}>Item notes</label>
                    <Input id={`notes-${l.key}`} className="mt-2" placeholder="Notes, e.g. cake message" maxLength={500}
                      value={l.notes} onChange={(e) => updateLine(l.key, { notes: e.target.value })} />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="text-sm text-muted">Total (incl. GST)</span>
            <span className="text-xl font-semibold">{formatPaise(total)}</span>
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Pickup</h2>
          {source === "IN_STORE" && (
            <div className="flex gap-4" role="radiogroup" aria-label="Pickup time">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="pickup" className="accent-brand" checked={pickupNow} onChange={() => setPickupNow(true)} />
                Now (walk-in)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="pickup" className="accent-brand" checked={!pickupNow} onChange={() => setPickupNow(false)} />
                Later
              </label>
            </div>
          )}
          {!pickupNow && (
            <>
              <Field label="Pickup date and time" htmlFor="due" hint={maxLead > 0 ? `These items need ${formatLeadTime(maxLead)} of preparation.` : "Bakery timezone."}>
                <Input id="due" type="datetime-local" value={dueLocal} min={minDueLocal} onChange={(e) => setDueLocal(e.target.value)} required />
              </Field>
              <PickupWindows
                dayKey={dueLocal.slice(0, 10)}
                time={dueLocal.slice(11, 16)}
                categoryIds={categoryIds}
                onPick={(t) => setDueLocal(`${dueLocal.slice(0, 10)}T${t}`)}
              />
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={needsCustomer ? "Customer name" : "Customer name (optional)"} htmlFor="cname">
              <Input id="cname" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={80} autoComplete="off" />
            </Field>
            <Field label={needsCustomer ? "Phone" : "Phone (optional)"} htmlFor="cphone">
              <Input id="cphone" type="tel" inputMode="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} autoComplete="off" />
            </Field>
          </div>
          <Field label="Customer notes" htmlFor="cnotes">
            <Textarea id="cnotes" value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} maxLength={1000} className="min-h-14" />
          </Field>
          <Field label="Internal notes (staff only)" htmlFor="inotes">
            <Textarea id="inotes" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} maxLength={1000} className="min-h-14" />
          </Field>
          {canConfirm ? (
            <Checkbox
              label="Confirm now"
              hint={source === "CALL" ? "Confirms the pickup promise. Leave unticked to review later." : "Walk-in and counter orders are usually confirmed straight away."}
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
          ) : (
            <p className="text-sm text-muted">An admin will confirm this order.</p>
          )}
        </Card>

        {unmapped.length > 0 && confirm && (
          <Alert tone="danger" title="Kitchen missing">
            {unmapped.length === 1 ? "One item has" : `${unmapped.length} items have`} no preparing kitchen, so the order cannot be confirmed yet. Untick “Confirm now” or fix the product first.
          </Alert>
        )}

        {error && (
          <OverridePrompt
            key={error.message}
            title="Order not saved"
            error={error}
            isAdmin={isAdmin}
            pending={pending}
            onOverride={(reason) => submit(reason)}
          />
        )}

        <Button
          type="button"
          className={cx("py-3 text-base")}
          disabled={pending || lines.length === 0}
          onClick={() => submit()}
        >
          {pending ? "Saving…" : confirm ? `Create and confirm · ${formatPaise(total)}` : `Create order · ${formatPaise(total)}`}
        </Button>
      </div>
    </div>
  );
}
