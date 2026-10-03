import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStaff, homePathFor } from "@/lib/auth";
import { currentTablet } from "@/lib/kitchen-device";
import { LoginForm, type DemoLogin } from "./login-form";

export const metadata: Metadata = { title: "Staff sign in" };

// Demo logins appear as "fill" buttons only while their DEMO_* variables are set (owner's choice: including production).
// Unset the variables to turn this off.
function demoLogins(): DemoLogin[] {
  const accounts = [
    { label: "Demo admin", email: process.env.DEMO_ADMIN_EMAIL, password: process.env.DEMO_ADMIN_PASSWORD },
    { label: "Demo chef", email: process.env.DEMO_CHEF_EMAIL, password: process.env.DEMO_CHEF_PASSWORD },
  ];
  return accounts.filter((a): a is DemoLogin => Boolean(a.email && a.password));
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const staff = await getStaff();
  if (staff) redirect(homePathFor(staff.role));

  const { next, email } = await searchParams;
  // A registered kitchen tablet goes to the chef picker; ?email=1 still offers email and password
  // (for an admin managing the tablet).
  if (email !== "1" && (await currentTablet())) redirect("/kitchen/pin");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-brand">Auri Bakery</p>
          <h1 className="mt-2 text-2xl font-semibold">Staff sign in</h1>
          <p className="mt-1 text-sm text-muted">Admins, counter staff, and chefs.</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          <LoginForm next={typeof next === "string" ? next : undefined} demoLogins={demoLogins()} />
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          Forgot your password? Ask an admin to reset it.
        </p>
      </div>
    </main>
  );
}
