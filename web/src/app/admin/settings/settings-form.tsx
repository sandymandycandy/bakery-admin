"use client";

import { useActionState } from "react";
import { Field, Input, Textarea } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import type { Tables } from "@/lib/database.types";
import { updateSettings } from "./actions";

export function SettingsForm({ settings }: { settings: Tables<"business_settings"> }) {
  const [state, action] = useActionState<ActionState, FormData>(updateSettings, {});
  const err = state.fieldErrors ?? {};

  return (
    <form action={action}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Business name" htmlFor="business_name" error={err.business_name} hint="Final name is still an open decision.">
          <Input id="business_name" name="business_name" defaultValue={settings.business_name} required maxLength={80} />
        </Field>
        <Field label="Phone" htmlFor="phone" error={err.phone}>
          <Input id="phone" name="phone" type="tel" defaultValue={settings.phone ?? ""} />
        </Field>
        <Field label="Email" htmlFor="email" error={err.email}>
          <Input id="email" name="email" type="email" defaultValue={settings.email ?? ""} />
        </Field>
        <Field label="Address" htmlFor="address" error={err.address} className="md:col-span-2">
          <Textarea id="address" name="address" defaultValue={settings.address ?? ""} maxLength={300} />
        </Field>
        <Field label="GSTIN" htmlFor="gstin" error={err.gstin} hint="Printed on customer bills.">
          <Input id="gstin" name="gstin" defaultValue={settings.gstin ?? ""} maxLength={15} className="font-mono uppercase" />
        </Field>
        <Field label="FSSAI licence number" htmlFor="fssai_licence" error={err.fssai_licence} hint="Shown on bills and, later, the website.">
          <Input id="fssai_licence" name="fssai_licence" inputMode="numeric" defaultValue={settings.fssai_licence ?? ""} maxLength={14} className="font-mono" />
        </Field>
        <Field label="Bill number prefix" htmlFor="bill_prefix" error={err.bill_prefix} hint="Bills print as PREFIX/2026-27/00001. Change only before the first bill of a year.">
          <Input id="bill_prefix" name="bill_prefix" defaultValue={settings.bill_prefix} maxLength={6} className="font-mono uppercase" required />
        </Field>
        <Field label="Counter staff discount limit (%)" htmlFor="counter_discount_limit" error={err.counter_discount_limit_bps} hint="Larger discounts need an admin.">
          <Input id="counter_discount_limit" name="counter_discount_limit" inputMode="decimal" defaultValue={String(settings.counter_discount_limit_bps / 100)} />
        </Field>
      </div>
      <div className="mt-6 flex items-center gap-4">
        <SubmitButton>Save settings</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
