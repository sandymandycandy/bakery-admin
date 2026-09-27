import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { addDays, dateToZonedLocal, zonedDayKey } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui";
import { OrderEntry, type CatalogueProduct } from "./order-entry";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: PageProps<"/admin/orders/new">) {
  const staff = await requireRole(["admin", "counter"]);
  const { source: sourceParam } = await searchParams;
  const source = sourceParam === "CALL" ? "CALL" : "IN_STORE";
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, name, is_veg, contains_egg, prep_type, categories(name, sort_order), product_variants(id, name, price_paise, is_eggless, lead_time_minutes, kitchen_id, is_available, archived_at, sort_order)")
    .is("archived_at", null)
    .eq("is_available", true)
    .order("name");

  const sorted = [...(products ?? [])].sort(
    (a, b) =>
      (a.categories?.sort_order ?? 0) - (b.categories?.sort_order ?? 0) ||
      (a.categories?.name ?? "").localeCompare(b.categories?.name ?? "") ||
      a.name.localeCompare(b.name),
  );
  const catalogue: CatalogueProduct[] = sorted
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.categories?.name ?? "",
      isVeg: p.is_veg,
      containsEgg: p.contains_egg,
      prepType: p.prep_type,
      variants: p.product_variants
        .filter((v) => v.is_available && !v.archived_at)
        .sort((a, b) => a.sort_order - b.sort_order || a.price_paise - b.price_paise)
        .map((v) => ({
          id: v.id,
          name: v.name,
          pricePaise: v.price_paise,
          isEggless: v.is_eggless,
          leadTimeMinutes: v.lead_time_minutes,
          hasKitchen: Boolean(v.kitchen_id),
        })),
    }))
    .filter((p) => p.variants.length > 0);

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
