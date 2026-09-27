import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Reports" };

export default async function Page() {
  await requireRole(["admin"]);
  return (
    <ComingSoon title="Reports" phase="Phase 7">
      Daily sales by product, category, source, and payment method.
    </ComingSoon>
  );
}
