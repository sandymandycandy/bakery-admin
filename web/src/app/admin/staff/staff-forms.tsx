"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Badge, Button, Checkbox, Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import type { Tables } from "@/lib/database.types";

type Kitchen = Pick<Tables<"kitchens">, "id" | "name" | "is_active">;
type SaveAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
export type StaffMember = {
  user_id: string;
  full_name: string;
  role: "admin" | "counter" | "chef";
  is_active: boolean;
  email: string | null;
  kitchen_ids: string[];
  pin_set_at: string | null;
};

const roleLabels = { admin: "Admin", counter: "Counter staff", chef: "Chef" };

export function KitchenForm({ kitchen, action }: { kitchen: Tables<"kitchens">; action: SaveAction }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-line p-4">
      <div className="min-w-48 flex-1">
        <label htmlFor={`kitchen-${kitchen.id}`} className="mb-1 block text-xs font-medium text-muted">
          {kitchen.code} name
        </label>
        <Input id={`kitchen-${kitchen.id}`} name="name" defaultValue={kitchen.name} required maxLength={60} />
        {state.fieldErrors?.name && <p className="mt-1 text-xs text-danger">{state.fieldErrors.name}</p>}
      </div>
      <div className="pb-2">
        <Checkbox name="is_active" label="Active" defaultChecked={kitchen.is_active} />
      </div>
      <SubmitButton variant="secondary">Save</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

function RoleAndKitchens({
  kitchens,
  defaultRole,
  defaultKitchenIds,
  errors,
  prefix,
}: {
  kitchens: Kitchen[];
  defaultRole: StaffMember["role"];
  defaultKitchenIds: string[];
  errors: Record<string, string>;
  prefix: string;
}) {
  const [role, setRole] = useState(defaultRole);
  return (
    <>
      <Field label="Role" htmlFor={`${prefix}-role`} error={errors.role}>
        <Select id={`${prefix}-role`} name="role" value={role} onChange={(e) => setRole(e.target.value as StaffMember["role"])}>
          <option value="chef">Chef</option>
          <option value="counter">Counter staff</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Kitchens</legend>
        <div className="flex flex-wrap gap-4">
          {kitchens.map((k) => (
            <Checkbox
              key={k.id}
              name="kitchen_ids"
              value={k.id}
              label={k.name + (k.is_active ? "" : " (inactive)")}
              defaultChecked={defaultKitchenIds.includes(k.id)}
            />
          ))}
        </div>
        {errors.kitchen_ids ? (
          <p className="text-xs text-danger">{errors.kitchen_ids}</p>
        ) : (
          <p className="text-xs text-muted">
            {role === "chef" ? "Chefs see only tickets for the kitchens ticked here." : "Only used for chefs."}
          </p>
        )}
      </fieldset>
    </>
  );
}

export function NewStaffForm({ kitchens, action, disabledReason }: { kitchens: Kitchen[]; action: SaveAction; disabledReason?: string }) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const err = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction}>
      <fieldset disabled={Boolean(disabledReason)} className="grid gap-4 md:grid-cols-2">
        <Field label="Full name" htmlFor="new-staff-name" error={err.full_name}>
          <Input id="new-staff-name" name="full_name" required maxLength={80} />
        </Field>
        <Field label="Email (used to sign in)" htmlFor="new-staff-email" error={err.email}>
          <Input id="new-staff-email" name="email" type="email" required autoComplete="off" />
        </Field>
        <Field label="Temporary password" htmlFor="new-staff-password" error={err.password} hint="At least 10 characters. Share it privately.">
          <Input id="new-staff-password" name="password" type="password" required minLength={10} autoComplete="new-password" />
        </Field>
        <RoleAndKitchens kitchens={kitchens} defaultRole="chef" defaultKitchenIds={[]} errors={err} prefix="new-staff" />
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <SubmitButton pendingText="Creating…" disabled={Boolean(disabledReason)}>
          Create staff login
        </SubmitButton>
        {disabledReason ? <p className="text-sm text-warn">{disabledReason}</p> : <FormMessage state={state} />}
      </div>
    </form>
  );
}

export function StaffRow({
  member,
  kitchens,
  isSelf,
  saveAction,
  resetAction,
  pinAction,
  clearPinAction,
  pinSetLabel,
}: {
  member: StaffMember;
  kitchens: Kitchen[];
  isSelf: boolean;
  saveAction: SaveAction;
  resetAction: SaveAction;
  pinAction?: SaveAction;
  clearPinAction?: () => Promise<ActionState>;
  pinSetLabel?: string | null;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "password" | "pin">("view");
  const [pinState, pinFormAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await pinAction!(prev, formData);
    if (result.ok) setMode("view");
    return result;
  }, {});
  const [clearState, clearFormAction] = useActionState<ActionState, FormData>(async () => {
    const result = await clearPinAction!();
    if (result.ok) setMode("view");
    return result;
  }, {});
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await saveAction(prev, formData);
    if (result.ok) setMode("view");
    return result;
  }, {});
  const [resetState, resetFormAction] = useActionState(resetAction, {});
  const err = state.fieldErrors ?? {};

  const kitchenNames = kitchens.filter((k) => member.kitchen_ids.includes(k.id)).map((k) => k.name);

  return (
    <li className="rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{member.full_name}</span>
            {isSelf && <Badge tone="brand">You</Badge>}
            <Badge>{roleLabels[member.role]}</Badge>
            {!member.is_active && <Badge tone="danger">Disabled</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {member.email ?? "Email hidden (secret key not set)"}
            {member.role === "chef" && ` · ${kitchenNames.length ? kitchenNames.join(", ") : "No kitchen assigned"}`}
            {member.role === "chef" && pinAction && ` · ${pinSetLabel ? `PIN set ${pinSetLabel}` : "No PIN"}`}
          </p>
        </div>
        {mode === "view" && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setMode("edit")}>Edit</Button>
            <Button variant="ghost" onClick={() => setMode("password")}>Reset password</Button>
            {member.role === "chef" && pinAction && (
              <Button variant="ghost" onClick={() => setMode("pin")}>{pinSetLabel ? "Reset PIN" : "Set PIN"}</Button>
            )}
          </div>
        )}
      </div>
      {mode === "view" && state.ok && state.message && <p className="mt-2 text-sm text-ok">{state.message}</p>}
      {mode === "view" && pinState.ok && pinState.message && <p className="mt-2 text-sm text-ok">{pinState.message}</p>}
      {mode === "view" && clearState.ok && clearState.message && <p className="mt-2 text-sm text-ok">{clearState.message}</p>}

      {mode === "pin" && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <form action={pinFormAction} className="flex flex-wrap items-end gap-3">
            <Field
              label={`Kitchen tablet PIN for ${member.full_name}`}
              htmlFor={`staff-${member.user_id}-pin`}
              error={pinState.fieldErrors?.pin}
              hint="4 to 6 digits. Works only on registered kitchen tablets."
            >
              <Input
                id={`staff-${member.user_id}-pin`}
                name="pin"
                inputMode="numeric"
                pattern="[0-9]{4,6}"
                maxLength={6}
                autoComplete="off"
                required
                className="w-32"
              />
            </Field>
            <SubmitButton>Save PIN</SubmitButton>
            <Button type="button" variant="secondary" onClick={() => setMode("view")}>Cancel</Button>
          </form>
          {pinSetLabel && (
            <form action={clearFormAction}>
              <SubmitButton variant="ghost" pendingText="Removing…">Remove PIN</SubmitButton>
            </form>
          )}
          <FormMessage state={pinState} />
          {!clearState.ok && <FormMessage state={clearState} />}
        </div>
      )}

      {mode === "edit" && (
        <form action={formAction} className="mt-4 border-t border-line pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full name" htmlFor={`staff-${member.user_id}-name`} error={err.full_name}>
              <Input id={`staff-${member.user_id}-name`} name="full_name" defaultValue={member.full_name} required />
            </Field>
            <RoleAndKitchens
              kitchens={kitchens}
              defaultRole={member.role}
              defaultKitchenIds={member.kitchen_ids}
              errors={err}
              prefix={`staff-${member.user_id}`}
            />
            <div className="md:col-span-2">
              <Checkbox
                name="is_active"
                label="Active"
                hint="Untick to block this person immediately. Their history is kept."
                defaultChecked={member.is_active}
                disabled={isSelf}
              />
              {isSelf && <input type="hidden" name="is_active" value="on" />}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SubmitButton>Save</SubmitButton>
            <Button type="button" variant="secondary" onClick={() => setMode("view")}>Cancel</Button>
            <FormMessage state={state} />
          </div>
        </form>
      )}

      {mode === "password" && (
        <form action={resetFormAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <div className="min-w-60">
            <label htmlFor={`pw-${member.user_id}`} className="mb-1 block text-sm font-medium">New password</label>
            <Input id={`pw-${member.user_id}`} name="password" type="password" minLength={10} required autoComplete="new-password" />
          </div>
          <SubmitButton pendingText="Resetting…">Set password</SubmitButton>
          <Button type="button" variant="secondary" onClick={() => setMode("view")}>Close</Button>
          <FormMessage state={resetState} />
        </form>
      )}
    </li>
  );
}

export type Tablet = {
  id: string;
  label: string;
  kitchenName: string;
  registered: string;
  lastUsed: string | null;
  failedPins: number;
  revoked: string | null;
  isThisBrowser: boolean;
};

export function RegisterTabletForm({ kitchens, action, disabledReason }: { kitchens: Kitchen[]; action: SaveAction; disabledReason?: string }) {
  const [state, formAction] = useActionState(action, {});
  const err = state.fieldErrors ?? {};
  const active = kitchens.filter((k) => k.is_active);
  return (
    <form action={formAction}>
      <fieldset disabled={Boolean(disabledReason)} className="flex flex-wrap items-end gap-3">
        <Field label="Kitchen" htmlFor="tablet-kitchen" error={err.kitchen_id}>
          <Select id="tablet-kitchen" name="kitchen_id" defaultValue={active[0]?.id}>
            {active.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tablet name" htmlFor="tablet-label" error={err.label}>
          <Input id="tablet-label" name="label" defaultValue="Kitchen tablet" required maxLength={60} />
        </Field>
        <SubmitButton pendingText="Registering…">Register this browser as a tablet</SubmitButton>
      </fieldset>
      <div className="mt-2">
        {disabledReason ? <p className="text-sm text-warn">{disabledReason}</p> : <FormMessage state={state} />}
      </div>
    </form>
  );
}

export function TabletRow({ tablet, revokeAction }: { tablet: Tablet; revokeAction: () => Promise<ActionState> }) {
  const [state, formAction] = useActionState<ActionState, FormData>(async () => revokeAction(), {});
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{tablet.label}</span>
          <Badge>{tablet.kitchenName}</Badge>
          {tablet.isThisBrowser && <Badge tone="brand">This browser</Badge>}
          {tablet.revoked && <Badge tone="danger">Revoked</Badge>}
          {tablet.failedPins > 0 && !tablet.revoked && <Badge tone="warn">{tablet.failedPins} wrong PIN{tablet.failedPins === 1 ? "" : "s"}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">
          Registered {tablet.registered}
          {tablet.lastUsed ? ` · last PIN sign-in ${tablet.lastUsed}` : " · no PIN sign-in yet"}
          {tablet.revoked && ` · revoked ${tablet.revoked}`}
        </p>
      </div>
      {!tablet.revoked && (
        <form action={formAction} className="flex items-center gap-3">
          <SubmitButton variant="danger" pendingText="Revoking…">Revoke</SubmitButton>
          <FormMessage state={state} />
        </form>
      )}
    </li>
  );
}
