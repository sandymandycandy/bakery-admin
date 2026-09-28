// Shapes returned by public.pickup_availability (migration 0410).
export type WindowUsage = { starts_at: string; ends_at: string; used: number; max: number | null };
export type CategoryUsage = { category_id: string; name: string; used: number; max: number };
export type PickupAvailability = { windows: WindowUsage[]; categories: CategoryUsage[] };

// Window rows as sent to set_pickup_windows / set_date_windows.
export type WindowInput = { starts_at: string; ends_at: string; max_orders: number | null };

// "09:00" -> "9:00 AM", "13:30" -> "1:30 PM".
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}
