import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/money";
import { Alert, Badge, ButtonLink, EmptyState, Input, PageHeader, Select, VegMark } from "@/components/ui";

export const metadata: Metadata = { title: "Products" };

type Status = "active" | "archived" | "all";

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const categoryId = typeof params.category === "string" ? params.category : "";
  const status: Status = params.status === "archived" || params.status === "all" ? params.status : "active";

  const supabase = await createClient();

  let query = supabase
    .from("products")
    .select(
      "id, name, prep_type, is_veg, contains_egg, is_available, archived_at, categories(name), product_variants(id, price_paise, kitchen_id, is_eggless, archived_at, kitchens(name))",
    )
    .order("name");
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "\\$&")}%`);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (status === "active") query = query.is("archived_at", null);
  if (status === "archived") query = query.not("archived_at", "is", null);

  const [{ data: products, error }, { data: categories }, { data: unmapped }] = await Promise.all([
    query,
    supabase.from("categories").select("id, name").order("sort_order").order("name"),
    supabase.from("unmapped_variants").select("product_id, product_name, variant_name"),
  ]);

  const unmappedByProduct = new Set((unmapped ?? []).map((u) => u.product_id));

  return (
    <>
      <PageHeader
        title="Products"
        description="Catalogue, variants, prices, and which kitchen prepares each item."
        actions={
          isAdmin && (
            <>
              <ButtonLink href="/admin/products/categories" variant="secondary">
                Categories
              </ButtonLink>
              <ButtonLink href="/admin/products/new">New product</ButtonLink>
            </>
          )
        }
      />

      {unmapped && unmapped.length > 0 && (
        <div className="mb-6">
          <Alert tone="danger" title={`${unmapped.length} made-to-order variant${unmapped.length === 1 ? "" : "s"} without a kitchen`}>
            Orders containing these cannot be confirmed until a kitchen is assigned:{" "}
            {unmapped.map((u, i) => (
              <span key={`${u.product_id}-${u.variant_name}`}>
                {i > 0 && ", "}
                <Link href={`/admin/products/${u.product_id}`} className="font-medium underline">
                  {u.product_name} — {u.variant_name}
                </Link>
              </span>
            ))}
          </Alert>
        </div>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="sr-only">
            Search products
          </label>
          <Input id="q" name="q" type="search" placeholder="Search by name" defaultValue={q} />
        </div>
        <div>
          <label htmlFor="category" className="sr-only">
            Category
          </label>
          <Select id="category" name="category" defaultValue={categoryId}>
            <option value="">All categories</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="status" className="sr-only">
            Status
          </label>
          <Select id="status" name="status" defaultValue={status}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
        </div>
        <button type="submit" className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-brand-soft">
          Filter
        </button>
      </form>

      {error ? (
        <Alert tone="danger" title="Could not load products">
          {error.message}
        </Alert>
      ) : !products || products.length === 0 ? (
        <EmptyState title={q || categoryId || status !== "active" ? "No products match these filters" : "No products yet"}>
          {isAdmin && !q && !categoryId && status === "active" && (
            <>
              Start by adding <Link href="/admin/products/categories" className="text-brand underline">categories</Link>, then{" "}
              <Link href="/admin/products/new" className="text-brand underline">your first product</Link>.
            </>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Product</th>
                <th scope="col" className="px-4 py-3 font-medium">Category</th>
                <th scope="col" className="px-4 py-3 font-medium">Type</th>
                <th scope="col" className="px-4 py-3 font-medium">Price</th>
                <th scope="col" className="px-4 py-3 font-medium">Kitchen</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {products.map((p) => {
                const variants = p.product_variants.filter((v) => !v.archived_at);
                const prices = variants.map((v) => v.price_paise);
                const kitchenNames = [...new Set(variants.flatMap((v) => (v.kitchens ? [v.kitchens.name] : [])))];
                const hasEggless = variants.some((v) => v.is_eggless);
                return (
                  <tr key={p.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/products/${p.id}`} className="font-medium text-ink hover:text-brand hover:underline">
                        {p.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <VegMark isVeg={p.is_veg} />
                        {p.contains_egg && <Badge>Contains egg</Badge>}
                        {hasEggless && <Badge tone="ok">Eggless option</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{p.categories?.name}</td>
                    <td className="px-4 py-3">{p.prep_type === "made_to_order" ? "Made to order" : "Ready stock"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {prices.length === 0
                        ? <span className="text-danger">No variants</span>
                        : Math.min(...prices) === Math.max(...prices)
                          ? formatPaise(prices[0])
                          : `${formatPaise(Math.min(...prices))} – ${formatPaise(Math.max(...prices))}`}
                    </td>
                    <td className="px-4 py-3">
                      {unmappedByProduct.has(p.id) ? (
                        <Badge tone="danger">Needs kitchen</Badge>
                      ) : kitchenNames.length ? (
                        kitchenNames.join(", ")
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.archived_at ? (
                        <Badge>Archived</Badge>
                      ) : p.is_available ? (
                        <Badge tone="ok">Available</Badge>
                      ) : (
                        <Badge tone="warn">Unavailable</Badge>
                      )}
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
