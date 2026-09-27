import { requireRole } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { AdminNav } from "./nav";

const roleLabel = { admin: "Admin", counter: "Counter staff", chef: "Chef" } as const;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const staff = await requireRole(["admin", "counter"]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex h-full flex-col gap-6 p-4">
          <div className="px-3 pt-1">
            <p className="text-xs font-medium uppercase tracking-widest text-brand">Auri Bakery</p>
            <p className="text-sm text-muted">Order management</p>
          </div>
          <AdminNav role={staff.role} />
          <div className="mt-auto border-t border-line px-3 pt-4">
            <p className="truncate text-sm font-medium">{staff.fullName}</p>
            <p className="text-xs text-muted">{roleLabel[staff.role]}</p>
            <form action={signOut} className="mt-2">
              <button type="submit" className="text-sm text-brand hover:underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
