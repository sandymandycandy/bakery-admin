import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";
import { ClosureForm, HoursForm, RemoveClosureButton } from "./hours-forms";
import { getBusinessTimezone } from "@/lib/settings";
import { formatDayHeading, zonedDayKey } from "@/lib/time";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const tz = await getBusinessTimezone();
  const [{ data: settings, error }, { data: hours }, { data: closures }] = await Promise.all([
    supabase.from("business_settings").select("*").single(),
    supabase.from("business_hours").select("*").order("weekday"),
    supabase.from("closures").select("*").gte("closed_on", zonedDayKey(new Date(), tz)).order("closed_on"),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Business details used on bills, tickets, and the calendar." />
      {error || !settings ? (
        <Alert tone="danger" title="Could not load settings">{error?.message}</Alert>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <SettingsForm settings={settings} />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Fixed for the first release</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">Timezone</dt>
                <dd className="font-medium">{settings.timezone}</dd>
              </div>
              <div>
                <dt className="text-muted">Currency</dt>
                <dd className="font-medium">{settings.currency}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-muted">Prices are treated as GST-inclusive.</p>
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Opening hours</h2>
            <p className="mb-3 mt-1 text-sm text-muted">Pickup times outside these hours are refused unless an admin overrides with a reason.</p>
            <HoursForm hours={hours ?? []} />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Closures</h2>
            <p className="mb-4 mt-1 text-sm text-muted">Holidays and one-off closed days. No pickups can be booked on these dates.</p>
            <ClosureForm />
            {closures && closures.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {closures.map((c) => (
                  <li key={c.closed_on} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{formatDayHeading(c.closed_on)}</span> · {c.reason}
                    </span>
                    <RemoveClosureButton closedOn={c.closed_on} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
