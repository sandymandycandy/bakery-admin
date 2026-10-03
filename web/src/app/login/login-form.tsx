"use client";

import { useActionState, useState } from "react";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import { signIn } from "./actions";

export type DemoLogin = { label: string; email: string; password: string };

export function LoginForm({ next, demoLogins = [] }: { next?: string; demoLogins?: DemoLogin[] }) {
  const [state, action] = useActionState<ActionState, FormData>(signIn, {});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Signing in…" className="w-full py-2.5">
        Sign in
      </SubmitButton>
      {demoLogins.length > 0 && (
        <div className="border-t border-line pt-4">
          <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-muted">Demo logins</p>
          <div className="flex gap-2" role="group" aria-label="Fill a demo login">
            {demoLogins.map((d) => (
              <button key={d.label} type="button" onClick={() => { setEmail(d.email); setPassword(d.password); }}
                className="flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-medium text-ink hover:border-brand hover:text-brand-strong">
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
