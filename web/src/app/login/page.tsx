import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff, homePathFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Staff sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const staff = await getStaff();
  if (staff) redirect(homePathFor(staff.role));

  const { next } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-brand">Auri Bakery</p>
          <h1 className="mt-2 text-2xl font-semibold">Staff sign in</h1>
          <p className="mt-1 text-sm text-muted">Admins, counter staff, and chefs.</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          Forgot your password? Ask an admin to reset it.
        </p>
      </div>
    </main>
  );
}
