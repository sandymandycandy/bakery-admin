import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { addDays, dateToZonedLocal, zonedDayKey } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui";
import { loadCatalogue } from "@/lib/catalogue";
import { OrderEntry } from "./order-entry";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: PageProps<"/admin/orders/new">) {
  const staff = await requireRole(["admin", "counter"]);
  const { source: sourceParam } = await searchParams;
  const source = sourceParam === "CALL" ? "CALL" : "IN_STORE";
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const catalogue = await loadCatalogue(supabase);

  const tomorrow = addDays(zonedDayKey(new Date(), tz), 1);

  return (
    <>
      <PageHeader
        title={source === "CALL" ? "New call order" : "New in-store order"}
        description={
          <>
            <Link href="/admin/orders" className="text-brand hover:underline">Orders</Link> / New ·{" "}
            <Link href={`/admin/orders/new?source=${source === "CALL" ? "IN_STORE" : "CALL"}`} className="text-brand hover:underline">
              Switch to {source === "CALL" ? "in-store" : "call"} order
            </Link>
          </>
        }
      />
      {catalogue.length === 0 ? (
        <EmptyState title="No products available to order">
          Add products with at least one available variant in <Link href="/admin/products" className="text-brand underline">Products</Link>.
        </EmptyState>
      ) : (
        <OrderEntry
          key={source}
          source={source}
          catalogue={catalogue}
          canConfirm={staff.role === "admin" || source === "IN_STORE"}
          isAdmin={staff.role === "admin"}
          defaultDueLocal={`${tomorrow}T11:00`}
          minDueLocal={dateToZonedLocal(new Date(), tz)}
        />
      )}
    </>
  );
}
