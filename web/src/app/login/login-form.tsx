"use client";

import { useActionState, useState } from "react";
import { Field, Input, cx } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import { signIn } from "./actions";

export type DemoLogin = { label: string; email: string; password: string };

export function LoginForm({ next, demoLogins = [] }: { next?: string; demoLogins?: DemoLogin[] }) {
  const [state, action] = useActionState<ActionState, FormData>(signIn, {});
  const [demoIndex, setDemoIndex] = useState(0);
  const demo = demoLogins[demoIndex];

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      {demoLogins.length > 1 && (
        <div className="flex gap-1 rounded-lg border border-line bg-canvas p-1" role="group" aria-label="Demo login">
          {demoLogins.map((d, i) => (
            <button key={d.label} type="button" onClick={() => setDemoIndex(i)} aria-pressed={i === demoIndex}
              className={cx("flex-1 rounded-md px-3 py-1.5 text-sm font-medium", i === demoIndex ? "bg-surface text-brand-strong shadow-sm" : "text-muted hover:text-ink")}>
              {d.label}
            </button>
          ))}
        </div>
      )}
      {/* The key remounts the inputs so switching demo login replaces their values. */}
      <Field label="Email" htmlFor="email">
        <Input key={`email-${demoIndex}`} id="email" name="email" type="email" autoComplete="username" required autoFocus defaultValue={demo?.email} />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input key={`password-${demoIndex}`} id="password" name="password" type="password" autoComplete="current-password" required defaultValue={demo?.password} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Signing in…" className="w-full py-2.5">
        Sign in
      </SubmitButton>
    </form>
  );
}
