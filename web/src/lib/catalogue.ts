import type { createClient } from "@/lib/supabase/server";

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

// Products with at least one orderable variant, in category order, for the order screens.
export async function loadCatalogue(supabase: Awaited<ReturnType<typeof createClient>>): Promise<CatalogueProduct[]> {
  const { data: products } = await supabase
    .from("products")
    .select("id, name, category_id, is_veg, contains_egg, prep_type, categories(name, sort_order), product_variants(id, name, price_paise, is_eggless, lead_time_minutes, kitchen_id, is_available, archived_at, sort_order)")
    .is("archived_at", null)
    .eq("is_available", true)
    .order("name");

  const sorted = [...(products ?? [])].sort(
    (a, b) =>
      (a.categories?.sort_order ?? 0) - (b.categories?.sort_order ?? 0) ||
      (a.categories?.name ?? "").localeCompare(b.categories?.name ?? "") ||
      a.name.localeCompare(b.name),
  );
  return sorted
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.categories?.name ?? "",
      categoryId: p.category_id,
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
}
