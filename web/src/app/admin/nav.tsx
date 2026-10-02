"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { StaffRole } from "@/lib/auth";

type NavItem = { href: string; label: string; roles: StaffRole[] };

// Primary destinations follow PRD 5B: Home | Products | Orders | Calendar | KOT.
const primary: NavItem[] = [
  { href: "/admin", label: "Home", roles: ["admin", "counter"] },
  { href: "/admin/products", label: "Products", roles: ["admin", "counter"] },
  { href: "/admin/orders", label: "Orders", roles: ["admin", "counter"] },
  { href: "/admin/calendar", label: "Calendar", roles: ["admin", "counter"] },
  { href: "/admin/kot", label: "KOT", roles: ["admin", "counter"] },
];

const secondary: NavItem[] = [
  { href: "/admin/counter", label: "Counter Sale", roles: ["admin", "counter"] },
  { href: "/admin/reports", label: "Reports", roles: ["admin"] },
  { href: "/admin/customers", label: "Customers", roles: ["admin"] },
  { href: "/admin/staff", label: "Staff & Kitchens", roles: ["admin"] },
  { href: "/admin/settings", label: "Settings", roles: ["admin"] },
];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ items, role, pathname }: { items: NavItem[]; role: StaffRole; pathname: string }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items
        .filter((item) => item.roles.includes(role))
        .map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "block rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-brand-soft font-semibold text-brand-strong" : "text-ink hover:bg-canvas",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
    </ul>
  );
}

export function AdminNav({ role }: { role: StaffRole }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="flex flex-col gap-6">
      <NavLinks items={primary} role={role} pathname={pathname} />
      <div>
        <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted">More</p>
        <NavLinks items={secondary} role={role} pathname={pathname} />
      </div>
    </nav>
  );
}
