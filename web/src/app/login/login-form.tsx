"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import { signIn } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(signIn, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Signing in…" className="w-full py-2.5">
        Sign in
      </SubmitButton>
    </form>
  );
}
