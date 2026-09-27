"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkbox, dbError, optionalText, text, zodErrors } from "@/lib/form";
import { parseRupeesToPaise } from "@/lib/money";
import type { ActionState } from "@/components/form-status";

const uuid = z.uuid("Choose a valid option.");
const optionalUuid = z.union([z.literal("").transform(() => null), uuid]);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().min(1, "Enter a category name.").max(60, "Keep the name under 60 characters."),
  default_kitchen_id: optionalUuid,
  sort_order: z.coerce.number().int().min(0).max(9999),
  is_active: z.boolean(),
});

function readCategory(formData: FormData) {
  return categorySchema.safeParse({
    name: text(formData, "name"),
    default_kitchen_id: text(formData, "default_kitchen_id"),
    sort_order: text(formData, "sort_order") || "0",
    is_active: checkbox(formData, "is_active"),
  });
}

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readCategory(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert(parsed.data);
  if (error) return dbError(error, "category");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: `Added “${parsed.data.name}”.` };
}

export async function updateCategory(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readCategory(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("categories").update(parsed.data).eq("id", id);
  if (error) return dbError(error, "category");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const productSchema = z.object({
  name: z.string().min(1, "Enter a product name.").max(100, "Keep the name under 100 characters."),
  category_id: uuid,
  description: z.string().max(2000).nullable(),
  prep_type: z.enum(["made_to_order", "ready_stock"]),
  is_veg: z.boolean(),
  contains_egg: z.boolean(),
  allergens: z.array(z.string().min(1).max(40)).max(20),
  hsn_code: z
    .string()
    .regex(/^\d{4,8}$/, "HSN code is 4 to 8 digits.")
    .nullable(),
  tax_rate_bps: z
    .number({ error: "Enter a GST rate such as 5 or 18." })
    .int()
    .min(0, "GST rate cannot be negative.")
    .max(2800, "GST rate cannot exceed 28%."),
  is_available: z.boolean(),
});

function readProduct(formData: FormData) {
  const taxText = text(formData, "tax_rate") || "0";
  const taxPercent = Number(taxText);
  return productSchema.safeParse({
    name: text(formData, "name"),
    category_id: text(formData, "category_id"),
    description: optionalText(formData, "description"),
    prep_type: text(formData, "prep_type"),
    is_veg: text(formData, "food_type") !== "non_veg",
    contains_egg: checkbox(formData, "contains_egg"),
    allergens: text(formData, "allergens")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean)
      .filter((a, i, all) => all.indexOf(a) === i),
    hsn_code: optionalText(formData, "hsn_code"),
    tax_rate_bps: /^\d+(\.\d{1,2})?$/.test(taxText) ? Math.round(taxPercent * 100) : NaN,
    is_available: checkbox(formData, "is_available"),
  });
}

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readProduct(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("products").insert(parsed.data).select("id").single();
  if (error) return dbError(error, "product");

  revalidatePath("/admin/products");
  redirect(`/admin/products/${data.id}?created=1`);
}

export async function updateProduct(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readProduct(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("products").update(parsed.data).eq("id", id);
  if (error) return dbError(error, "product");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: "Product saved." };
}

export async function setProductArchived(id: string, archived: boolean) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error(dbError(error, "product").message);
  revalidatePath("/admin/products", "layout");
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const variantSchema = z.object({
  name: z.string().min(1, "Enter a variant name, e.g. 500 g or Regular.").max(60),
  price_paise: z.number({ error: "Enter a price in rupees, e.g. 450 or 450.50." }).int().min(0),
  kitchen_id: optionalUuid,
  lead_time_minutes: z
    .number({ error: "Enter the lead time in hours and minutes." })
    .int()
    .min(0)
    .max(43200, "Lead time cannot exceed 30 days."),
  is_eggless: z.boolean(),
  is_available: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(9999),
});

function readVariant(formData: FormData) {
  const hours = Number(text(formData, "lead_hours") || "0");
  const minutes = Number(text(formData, "lead_minutes") || "0");
  const lead =
    Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && minutes >= 0 && minutes < 60
      ? hours * 60 + minutes
      : NaN;
  return variantSchema.safeParse({
    name: text(formData, "name"),
    price_paise: parseRupeesToPaise(text(formData, "price")) ?? NaN,
    kitchen_id: text(formData, "kitchen_id"),
    lead_time_minutes: lead,
    is_eggless: checkbox(formData, "is_eggless"),
    is_available: checkbox(formData, "is_available"),
    sort_order: text(formData, "sort_order") || "0",
  });
}

export async function createVariant(productId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readVariant(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").insert({ ...parsed.data, product_id: productId });
  if (error) return dbError(error, "variant");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: `Added variant “${parsed.data.name}”.` };
}

export async function updateVariant(variantId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readVariant(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").update(parsed.data).eq("id", variantId);
  if (error) return dbError(error, "variant");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: "Variant saved." };
}

export async function setVariantArchived(variantId: string, archived: boolean) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", variantId);
  if (error) throw new Error(dbError(error, "variant").message);
  revalidatePath("/admin/products", "layout");
}
