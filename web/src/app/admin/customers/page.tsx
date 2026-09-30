import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { Badge, EmptyState, Input, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  await requireRole(["admin"]);
  const { q: qParam } = await searchParams;
  const q = (typeof qParam === "string" ? qParam : "").trim().replace(/[^\p{L}\p{N}\s+]/gu, "").slice(0, 60);
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, full_name, phone, no_show_count, is_blocked, created_at, orders(id, reference, due_at)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (q) query = /^\+?\d{4,}$/.test(q.replace(/\s/g, "")) ? query.ilike("phone", `%${q.replace(/\s/g, "")}%`) : query.ilike("full_name", `%${q}%`);
  const { data: customers } = await query;

  return (
    <>
      <PageHeader title="Customers" description="Created automatically from orders with a phone number. Only what is needed for pickup is stored." />
      <form className="mb-4 max-w-md" role="search">
        <label htmlFor="q" className="sr-only">Search customers</label>
        <Input id="q" name="q" type="search" defaultValue={q} placeholder="Name or phone" />
      </form>
      {!customers || customers.length === 0 ? (
        <EmptyState title={q ? "No customers match" : "No customers yet"}>Customers are added when an order is taken with a phone number.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Phone</th>
                <th scope="col" className="px-4 py-3 font-medium">Orders</th>
                <th scope="col" className="px-4 py-3 font-medium">Latest</th>
                <th scope="col" className="px-4 py-3 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {customers.map((c) => {
                const latest = [...c.orders].sort((a, b) => (b.due_at ?? "").localeCompare(a.due_at ?? ""))[0];
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/admin/customers/${c.id}`} className="hover:text-brand hover:underline">{c.full_name}</Link>
                    </td>
                    <td className="px-4 py-3"><a href={`tel:${c.phone}`} className="text-brand hover:underline">{c.phone}</a></td>
                    <td className="px-4 py-3">{c.orders.length}</td>
                    <td className="px-4 py-3">
                      {latest ? (
                        <Link href={`/admin/orders/${latest.id}`} className="hover:text-brand hover:underline">
                          <span className="font-mono">{latest.reference}</span>
                          {latest.due_at && <span className="text-muted"> · {formatDateTime(latest.due_at, tz)}</span>}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {c.is_blocked && <Badge tone="danger">Blocked</Badge>}
                        {c.no_show_count > 0 && <Badge tone="warn">{c.no_show_count} no-show{c.no_show_count === 1 ? "" : "s"}</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
