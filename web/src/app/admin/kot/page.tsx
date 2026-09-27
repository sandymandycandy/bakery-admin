import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "KOT" };

export default async function Page() {
  await requireRole(["admin"]);
  return (
    <ComingSoon title="KOT" phase="Phase 5">
      Kitchen tickets across both kitchens, with release timing and print.
    </ComingSoon>
  );
}
