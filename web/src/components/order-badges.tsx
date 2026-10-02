import { Badge } from "@/components/ui";
import { sourceLabel, statusLabel, statusTone, type OrderSource, type OrderStatus } from "@/lib/orders";

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>;
}

// Call and Online share a list, so their badges must look different, not just read differently (AC-01).
export function SourceBadge({ source }: { source: OrderSource }) {
  const styles: Record<OrderSource, string> = {
    IN_STORE: "border-line bg-canvas text-ink",
    CALL: "border-sky-300 bg-sky-50 text-sky-800",
    ONLINE: "border-violet-300 bg-violet-50 text-violet-800",
  };
  const icons: Record<OrderSource, string> = { IN_STORE: "🏪", CALL: "📞", ONLINE: "🌐" };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${styles[source]}`}>
      <span aria-hidden>{icons[source]}</span>
      {sourceLabel[source]}
    </span>
  );
}

export type KitchenProgress = { all_ready: boolean | null; open_issues: number | null };

// Kitchen state from order_kitchen_progress. Ready itself is set by packing (Phase 5B).
export function KitchenFlags({ progress }: { progress?: KitchenProgress }) {
  if (!progress) return null;
  return (
    <>
      {progress.all_ready && <Badge tone="ok">All kitchen items ready</Badge>}
      {(progress.open_issues ?? 0) > 0 && <Badge tone="danger">Issue</Badge>}
    </>
  );
}
