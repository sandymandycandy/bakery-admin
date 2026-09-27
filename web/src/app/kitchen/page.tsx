import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { Alert, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Kitchen" };

export default async function KitchenPage() {
  const chef = await requireRole(["chef"]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-brand">Auri Bakery · Kitchen</p>
          <h1 className="text-xl font-semibold">
            {chef.kitchens.length ? chef.kitchens.map((k) => k.name).join(" + ") : "No kitchen assigned"}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-base">{chef.fullName}</span>
          <form action={signOut}>
            <button type="submit" className="rounded-lg border border-line px-4 py-2.5 text-base font-medium hover:bg-brand-soft">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-5">
        {chef.kitchens.length === 0 ? (
          <Alert tone="danger" title="You are not assigned to a kitchen">
            Ask an admin to assign you to a kitchen before tickets can appear here.
          </Alert>
        ) : (
          <EmptyState title="No tickets yet">
            Active tickets, the upcoming schedule, and completed work arrive in Phase 5.
          </EmptyState>
        )}
      </main>
    </div>
  );
}
