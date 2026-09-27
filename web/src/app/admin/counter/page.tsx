import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, PageHeader } from "@/components/ui";
import { CounterSale, type CounterItem } from "./counter-sale";

export const metadata: Metadata = { title: "Counter Sale" };

export default async function CounterPage() {
  const staff = await requireRole(["admin", "counter"]);
  const supabase = await createClient();
  const [{ data: products }, { data: settings }] = await Promise.all([
    supabase
      .from("products")
      .select("name, is_veg, categories(name, sort_order), product_variants(id, name, price_paise, is_eggless, is_available, archived_at, sort_order)")
      .eq("prep_type", "ready_stock")
      .eq("is_available", true)
      .is("archived_at", null)
      .order("name"),
    supabase.from("business_settings").select("counter_discount_limit_bps").single(),
  ]);

  const items: CounterItem[] = [...(products ?? [])]
    .sort((a, b) => (a.categories?.sort_order ?? 0) - (b.categories?.sort_order ?? 0) || a.name.localeCompare(b.name))
    .flatMap((p) =>
      p.product_variants
        .filter((v) => v.is_available && !v.archived_at)
        .sort((a, b) => a.sort_order - b.sort_order || a.price_paise - b.price_paise)
        .map((v) => ({
          variantId: v.id,
          productName: p.name,
          variantName: v.name,
          category: p.categories?.name ?? "",
          pricePaise: v.price_paise,
          isVeg: p.is_veg,
          isEggless: v.is_eggless,
        })),
    );

  return (
    <>
      <PageHeader
        title="Counter Sale"
        description={
          <>
            Walk-in sale of ready-stock items: pay, bill, done. For cakes and other made-to-order items use a{" "}
            <Link href="/admin/orders/new?source=IN_STORE" className="text-brand hover:underline">normal in-store order</Link>.
          </>
        }
      />
      {items.length === 0 ? (
        <EmptyState title="No ready-stock items">
          Mark products as “Ready stock” in <Link href="/admin/products" className="text-brand underline">Products</Link> to sell them here.
        </EmptyState>
      ) : (
        <CounterSale items={items} discountLimitBps={settings?.counter_discount_limit_bps ?? 1000} isAdmin={staff.role === "admin"} />
      )}
    </>
  );
}
