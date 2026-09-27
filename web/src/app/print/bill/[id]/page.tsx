import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { paymentMethodLabel } from "@/lib/orders";
import { formatDateTime } from "@/lib/time";
import { PrintControls } from "../../print-controls";

export const metadata: Metadata = { title: "Bill" };

type BillLine = {
  line_no: number;
  name: string;
  variant: string;
  hsn: string | null;
  is_veg: boolean;
  quantity: number;
  unit_price_paise: number;
  gross_paise: number;
  discount_paise: number;
  net_paise: number;
  tax_rate_bps: number;
  tax_paise: number;
  taxable_paise: number;
};
type Business = { name: string; address: string | null; phone: string | null; email: string | null; gstin: string | null; fssai_licence: string | null };

export default async function BillPrintPage({ params, searchParams }: PageProps<"/print/bill/[id]">) {
  await requireRole(["admin", "counter"]);
  const { id } = await params;
  const { size: sizeParam } = await searchParams;
  const size = sizeParam === "a4" ? "a4" : "80mm";
  if (!z.uuid().safeParse(id).success) notFound();
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const { data: bill } = await supabase.from("bills").select("*, orders(reference)").eq("id", id).maybeSingle();
  if (!bill) notFound();
  const [{ data: payments }, { data: credits }] = await Promise.all([
    supabase.from("payments").select("kind, method, amount_paise").eq("order_id", bill.order_id).order("recorded_at"),
    supabase.from("credit_notes").select("credit_note_number, total_paise, issued_at").eq("bill_id", bill.id).order("issued_at"),
  ]);

  const business = bill.business as unknown as Business;
  const lines = bill.lines as unknown as BillLine[];
  const paid = (payments ?? []).reduce((s, p) => s + (p.kind === "payment" ? p.amount_paise : -p.amount_paise), 0);
  const credited = (credits ?? []).reduce((s, c) => s + c.total_paise, 0);
  const balance = bill.total_paise - credited - paid;
  const narrow = size === "80mm";

  // GST summary by rate, as required on tax invoices.
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const l of lines) {
    const row = byRate.get(l.tax_rate_bps) ?? { taxable: 0, tax: 0 };
    row.taxable += l.taxable_paise;
    row.tax += l.tax_paise;
    byRate.set(l.tax_rate_bps, row);
  }

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <style>{`@page { size: ${narrow ? "80mm auto" : "A4"}; margin: ${narrow ? "3mm" : "12mm"}; }`}</style>
      <PrintControls basePath={`/print/bill/${bill.id}`} size={size} />
      <article className={narrow
        ? "mx-auto w-[76mm] bg-white p-3 font-mono text-[11px] leading-snug text-black shadow print:w-full print:p-0 print:shadow-none"
        : "mx-auto max-w-3xl bg-white p-10 text-sm text-black shadow print:max-w-none print:p-0 print:shadow-none"}>
        <header className={narrow ? "text-center" : "flex justify-between gap-6"}>
          <div>
            <h1 className={narrow ? "text-sm font-bold" : "text-2xl font-bold"}>{business.name}</h1>
            {business.address && <p className="whitespace-pre-line">{business.address}</p>}
            {business.phone && <p>Ph: {business.phone}</p>}
            {business.gstin && <p>GSTIN: {business.gstin}</p>}
            {business.fssai_licence && <p>FSSAI Lic. No: {business.fssai_licence}</p>}
          </div>
          <div className={narrow ? "mt-2 border-y border-dashed border-black py-1" : "text-right"}>
            <p className="font-bold">TAX INVOICE</p>
            <p>Bill No: {bill.bill_number}</p>
            <p>Date: {formatDateTime(bill.issued_at, tz)}</p>
            <p>Order: {bill.orders?.reference}</p>
            {bill.customer_name && <p>Customer: {bill.customer_name}</p>}
            {bill.customer_phone && <p>Ph: {bill.customer_phone}</p>}
          </div>
        </header>

        <table className={narrow ? "mt-2 w-full" : "mt-8 w-full border-collapse"}>
          <thead>
            <tr className={narrow ? "border-b border-dashed border-black" : "border-b-2 border-black text-left"}>
              <th className="py-1 text-left font-semibold">Item</th>
              {!narrow && <th className="py-1 font-semibold">HSN</th>}
              <th className="py-1 text-right font-semibold">Qty</th>
              <th className="py-1 text-right font-semibold">Rate</th>
              {!narrow && <th className="py-1 text-right font-semibold">GST</th>}
              <th className="py-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line_no} className={narrow ? "align-top" : "border-b border-gray-300 align-top"}>
                <td className="py-1 pr-1">
                  {l.name}
                  {l.variant && <span className="block">{l.variant}</span>}
                  {narrow && <span className="block">GST {l.tax_rate_bps / 100}%{l.hsn ? ` · HSN ${l.hsn}` : ""}</span>}
                </td>
                {!narrow && <td className="py-1 text-center">{l.hsn ?? "—"}</td>}
                <td className="py-1 text-right">{l.quantity}</td>
                <td className="py-1 text-right">{(l.unit_price_paise / 100).toFixed(2)}</td>
                {!narrow && <td className="py-1 text-right">{l.tax_rate_bps / 100}%</td>}
                <td className="py-1 text-right">{(l.gross_paise / 100).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className={narrow ? "mt-2 border-t border-dashed border-black pt-1" : "ml-auto mt-6 w-72"}>
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatPaise(bill.subtotal_paise)}</dd></div>
          {bill.discount_paise > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−{formatPaise(bill.discount_paise)}</dd></div>}
          <div className="flex justify-between"><dt>Taxable value</dt><dd>{formatPaise(bill.taxable_paise)}</dd></div>
          <div className="flex justify-between"><dt>CGST</dt><dd>{formatPaise(bill.cgst_paise)}</dd></div>
          <div className="flex justify-between"><dt>SGST</dt><dd>{formatPaise(bill.sgst_paise)}</dd></div>
          <div className={narrow ? "mt-1 flex justify-between border-t border-dashed border-black pt-1 text-sm font-bold" : "mt-2 flex justify-between border-t-2 border-black pt-2 text-lg font-bold"}>
            <dt>Total</dt><dd>{formatPaise(bill.total_paise)}</dd>
          </div>
        </dl>

        <table className={narrow ? "mt-2 w-full" : "mt-6 w-full max-w-md text-xs"}>
          <thead>
            <tr className="border-b border-dashed border-black">
              <th className="text-left font-semibold">GST rate</th>
              <th className="text-right font-semibold">Taxable</th>
              <th className="text-right font-semibold">CGST</th>
              <th className="text-right font-semibold">SGST</th>
            </tr>
          </thead>
          <tbody>
            {[...byRate].sort(([a], [b]) => a - b).map(([rate, row]) => (
              <tr key={rate}>
                <td>{rate / 100}%</td>
                <td className="text-right">{(row.taxable / 100).toFixed(2)}</td>
                <td className="text-right">{(Math.floor(row.tax / 2) / 100).toFixed(2)}</td>
                <td className="text-right">{((row.tax - Math.floor(row.tax / 2)) / 100).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className={narrow ? "mt-2 border-t border-dashed border-black pt-1" : "mt-6"}>
          {(payments ?? []).map((p, i) => (
            <div key={i} className="flex justify-between">
              <span>{p.kind === "refund" ? "Refund" : "Paid"} ({paymentMethodLabel[p.method]})</span>
              <span>{p.kind === "refund" ? "−" : ""}{formatPaise(p.amount_paise)}</span>
            </div>
          ))}
          {(credits ?? []).map((c) => (
            <div key={c.credit_note_number} className="flex justify-between">
              <span>Credit note {c.credit_note_number}</span>
              <span>−{formatPaise(c.total_paise)}</span>
            </div>
          ))}
          <div className="flex justify-between font-semibold">
            <span>{balance > 0 ? "Balance due" : balance < 0 ? "Refund due" : "Fully paid"}</span>
            <span>{balance !== 0 && formatPaise(Math.abs(balance))}</span>
          </div>
        </section>

        <footer className={narrow ? "mt-3 text-center" : "mt-10 text-center text-xs text-gray-600"}>
          <p>Prices are inclusive of GST.</p>
          <p>Thank you!</p>
        </footer>
      </article>
    </div>
  );
}
