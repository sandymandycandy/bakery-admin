import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { Alert, Card, PageHeader } from "@/components/ui";
import { getBusinessTimezone } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { deviceTokenHash } from "@/lib/kitchen-device";
import {
  clearChefPin,
  createStaff,
  registerTablet,
  resetStaffPassword,
  revokeTablet,
  setChefPin,
  updateKitchen,
  updateStaff,
} from "./actions";
import { KitchenForm, NewStaffForm, RegisterTabletForm, StaffRow, TabletRow, type StaffMember, type Tablet } from "./staff-forms";

export const metadata: Metadata = { title: "Staff & Kitchens" };

// When each chef's PIN was set (service role: staff cannot read staff_pins at all).
async function loadPins(): Promise<Map<string, string>> {
  if (!env.supabaseSecretKey) return new Map();
  const { data } = await createAdminClient().from("staff_pins").select("user_id, set_at");
  return new Map((data ?? []).map((p) => [p.user_id, p.set_at] as const));
}

async function loadEmails(): Promise<Map<string, string>> {
  if (!env.supabaseSecretKey) return new Map();
  const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
  return new Map((data?.users ?? []).flatMap((u) => (u.email ? [[u.id, u.email] as const] : [])));
}

export default async function StaffPage() {
  const me = await requireRole(["admin"]);
  const supabase = await createClient();

  const [{ data: kitchens }, { data: profiles }, emails, pins, { data: devices }, tz, thisDevice] = await Promise.all([
    supabase.from("kitchens").select("*").order("sort_order"),
    supabase.from("staff_profiles").select("user_id, full_name, role, is_active, staff_kitchens(kitchen_id)").order("full_name"),
    loadEmails(),
    loadPins(),
    supabase.from("kitchen_devices").select("*").order("registered_at", { ascending: false }),
    getBusinessTimezone(),
    deviceTokenHash(),
  ]);
  const kitchenName = new Map((kitchens ?? []).map((k) => [k.id, k.name]));
  const tablets: Tablet[] = (devices ?? []).map((d) => ({
    id: d.id,
    label: d.label,
    kitchenName: kitchenName.get(d.kitchen_id) ?? "Kitchen",
    registered: formatDateTime(d.registered_at, tz),
    lastUsed: d.last_used_at ? formatDateTime(d.last_used_at, tz) : null,
    failedPins: d.failed_pins,
    revoked: d.revoked_at ? formatDateTime(d.revoked_at, tz) : null,
    isThisBrowser: thisDevice !== null && d.token_hash === thisDevice,
  }));

  const members: StaffMember[] = (profiles ?? []).map((p) => ({
    user_id: p.user_id,
    full_name: p.full_name,
    role: p.role,
    is_active: p.is_active,
    email: emails.get(p.user_id) ?? null,
    kitchen_ids: p.staff_kitchens.map((sk) => sk.kitchen_id),
    pin_set_at: pins.get(p.user_id) ?? null,
  }));
  const chefsWithoutKitchen = members.filter((m) => m.is_active && m.role === "chef" && m.kitchen_ids.length === 0);

  return (
    <>
      <PageHeader title="Staff & Kitchens" description="Individual logins for every staff member. No shared chef passwords." />

      <div className="flex flex-col gap-6">
        {!env.supabaseSecretKey && (
          <Alert title="Staff logins are read-only">
            To create logins and reset passwords, add <code className="font-mono">SUPABASE_SECRET_KEY</code> to{" "}
            <code className="font-mono">web/.env.local</code> (Supabase dashboard → Project Settings → API Keys) and restart the app.
          </Alert>
        )}
        {chefsWithoutKitchen.length > 0 && (
          <Alert tone="danger" title="Chefs without a kitchen">
            {chefsWithoutKitchen.map((c) => c.full_name).join(", ")} will not see any tickets until assigned.
          </Alert>
        )}

        <Card>
          <h2 className="text-lg font-semibold">Kitchens</h2>
          <p className="mb-4 mt-1 text-sm text-muted">Placeholder names until the bakery confirms them (PRD decision 2).</p>
          <div className="flex flex-col gap-3">
            {(kitchens ?? []).map((k) => (
              <KitchenForm key={k.id} kitchen={k} action={updateKitchen.bind(null, k.id)} />
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">Add staff member</h2>
          <NewStaffForm
            kitchens={kitchens ?? []}
            action={createStaff}
            disabledReason={env.supabaseSecretKey ? undefined : "Needs SUPABASE_SECRET_KEY."}
          />
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Kitchen tablets</h2>
          <p className="mb-4 mt-1 text-sm text-muted">
            On a registered tablet, chefs tap their name and type their PIN instead of an email and password. Open this page on the
            tablet itself to register it. Revoking a tablet signs out anyone using it within seconds.
          </p>
          <RegisterTabletForm
            kitchens={kitchens ?? []}
            action={registerTablet}
            disabledReason={env.supabaseSecretKey ? undefined : "PIN sign-in needs SUPABASE_SECRET_KEY on the server."}
          />
          {tablets.length > 0 && (
            <ul className="mt-4 flex flex-col gap-3">
              {tablets.map((t) => (
                <TabletRow key={t.id} tablet={t} revokeAction={revokeTablet.bind(null, t.id)} />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">Staff ({members.length})</h2>
          <ul className="flex flex-col gap-3">
            {members.map((m) => (
              <StaffRow
                key={m.user_id}
                member={m}
                kitchens={kitchens ?? []}
                isSelf={m.user_id === me.userId}
                saveAction={updateStaff.bind(null, m.user_id)}
                resetAction={resetStaffPassword.bind(null, m.user_id)}
                pinAction={env.supabaseSecretKey && m.role === "chef" ? setChefPin.bind(null, m.user_id) : undefined}
                clearPinAction={m.role === "chef" ? clearChefPin.bind(null, m.user_id) : undefined}
                pinSetLabel={m.pin_set_at ? formatDateTime(m.pin_set_at, tz) : null}
              />
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
